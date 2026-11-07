import json
import io
import os
import shutil
import subprocess
import uuid
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import perf_counter

from loguru import logger

from ..config import (VIDEO_EXTS, IMAGE_EXTS, RAW_EXTS, THUMB_DIR,
                      AUDIO_EXTS, ENCRYPTED_AUDIO_EXTS, AUDIO_LIKE_VIDEO_EXTS)
from ..db import get_db

# Timeout for external tool calls (ffprobe/ffmpeg/exiftool)
# External disks and large files need more time
PROBE_TIMEOUT = 60
EXIFTOOL_TIMEOUT = 30
FFMPEG_TIMEOUT = 60
IMPORT_WORKERS = 2
IMPORT_BATCH_SIZE = 16


def _delete_media_records(db, ids: list[int], thumb_paths: list[str | None] = None):
    """Delete media records by IDs, including thumbnails, tags, segments, FTS, exclusion pairs."""
    obsolete = []
    with db:
        for i, mid in enumerate(ids):
            tp = thumb_paths[i] if thumb_paths and i < len(thumb_paths) else None
            if tp:
                obsolete.append(tp)
            cov = db.execute("SELECT cover_art_path FROM media WHERE id = ?", (mid,)).fetchone()
            if cov and cov["cover_art_path"]:
                obsolete.append(cov["cover_art_path"])
            db.execute("DELETE FROM media_tags WHERE media_id = ?", (mid,))
            db.execute("DELETE FROM media_segment WHERE media_id = ?", (mid,))
            db.execute("DELETE FROM music_segment WHERE media_id = ?", (mid,))
            db.execute("DELETE FROM media_fts WHERE media_id = ?", (mid,))
            db.execute("DELETE FROM dup_exclusions WHERE media_id_a = ? OR media_id_b = ?", (mid, mid))
            db.execute("DELETE FROM media WHERE id = ?", (mid,))
    cleanup_thumbnails(obsolete)


def cleanup_thumbnails(names):
    for name in set(names):
        if not name:
            continue
        try:
            (THUMB_DIR / name).unlink(missing_ok=True)
        except OSError as e:
            logger.warning("缓存清理失败 {}: {}", name, e)


def _collect_files(paths: list[str], strict: bool = False, encrypted=None) -> list[Path]:
    files = []
    seen = set()
    supported = VIDEO_EXTS | IMAGE_EXTS | AUDIO_EXTS
    if encrypted is not None:
        supported = supported | ENCRYPTED_AUDIO_EXTS

    def add_file(path):
        if path in seen:
            return
        seen.add(path)
        if path.suffix.lower() in ENCRYPTED_AUDIO_EXTS:
            encrypted.append({"file_name": path.name, "file_path": str(path)})
        else:
            files.append(path)

    for p in dict.fromkeys(paths):
        path = Path(p)
        if path.is_file() and path.name.startswith("._"):
            continue
        if path.is_file() and path.suffix.lower() in supported:
            add_file(path)
        elif path.is_dir():
            def scan_error(error):
                if strict:
                    raise error
            for directory, _, names in os.walk(path, onerror=scan_error):
                for name in names:
                    f = Path(directory) / name
                    if not name.startswith("._") and f.suffix.lower() in supported:
                        if strict:
                            f.stat()  # Disappearance/unreadable entries must not look like a successful empty scan.
                        if f.is_file():
                            add_file(f)
    return files


def _scan_media_type(ext: str) -> str:
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    return "image"


def scan_only(paths: list[str], encrypted=None) -> list[dict]:
    files = _collect_files(paths, encrypted=encrypted)
    db = get_db()
    results = []
    skipped = []
    for f in files:
        existing = db.execute("SELECT id FROM media WHERE file_path = ?", (str(f),)).fetchone()
        if existing:
            skipped.append({"file_name": f.name, "file_path": str(f), "media_id": existing["id"]})
            continue
        # 注意：AUDIO_LIKE_VIDEO_EXTS（.mp4/.m4v）此处预标 video，_import_one 时按流判定修正
        results.append({
            "file_path": str(f),
            "file_name": f.name,
            "media_type": _scan_media_type(f.suffix.lower()),
            "file_size": f.stat().st_size,
        })
    return results, skipped


def import_single_file(file_path: str, organize_people=False, people_media_type='all', classify_media=False) -> dict | None:
    filepath = Path(file_path)
    if not filepath.exists() or filepath.name.startswith("._"):
        return None
    if filepath.suffix.lower() not in (VIDEO_EXTS | IMAGE_EXTS | AUDIO_EXTS):
        return None
    db = get_db()
    try:
        return _import_one(db, filepath, organize_people=organize_people, people_media_type=people_media_type, classify_media=classify_media)
    except Exception as e:
        logger.exception("import failed: {} — {}", filepath, e)
        raise


from .classification_jobs import foreground_work


@foreground_work
def _prepare_import(filepath: Path, exif_tags=None) -> dict:
    """Prepare media on a worker; never access a Flask context or database here."""
    start = perf_counter()
    stat = filepath.stat()
    ext = filepath.suffix.lower()
    if ext in AUDIO_EXTS:
        media_type, meta = "audio", _probe_audio(filepath)
    elif ext in AUDIO_LIKE_VIDEO_EXTS:
        # .mp4/.m4v 可能是纯音频轨（如「xxx_音频.mp4」）：按流判定归属，probe 不新增子进程
        meta = _probe(filepath, "video", exif_tags=exif_tags)
        has_video = meta.pop("_has_video", True)
        has_audio = meta.pop("_has_audio", False)
        if not has_video and has_audio:
            media_type = "audio"
            au_meta = _probe_audio(filepath)
            meta.update({k: au_meta[k] for k in ("audio_codec", "audio_sample_rate",
                                                 "audio_channels", "duration", "bit_rate",
                                                 "music_title", "music_artist", "music_album")})
        else:
            media_type = "video"
    elif ext in VIDEO_EXTS:
        media_type = "video"
        meta = _probe(filepath, media_type, exif_tags=exif_tags)
    else:
        media_type = "image"
        meta = _probe_image(filepath, exif_tags=exif_tags)

    probed = perf_counter()
    image = None
    try:
        # Reuse JPEG pixels without changing the existing embedding's orientation
        # or preprocessing. RAW embeddings still use the full RAW decode.
        if ext in (".jpg", ".jpeg"):
            try:
                from PIL import Image
                image = Image.open(filepath)
                image.load()
            except Exception:
                if image is not None:
                    image.close()
                image = None
        thumb = _generate_thumbnail(filepath, media_type, image=image,
                                    orientation=meta.pop("_orientation", None))
        meta["thumbnail_path"] = thumb
        if media_type == "audio":
            meta["cover_art_path"] = _extract_cover_art(filepath)
        previewed = perf_counter()
        meta["embedding"] = None
        if media_type == "image":
            try:
                from .embedding import compute_embedding
                meta["embedding"] = compute_embedding(filepath, "image", image=image)
            except Exception:
                pass
        meta.update(file_path=str(filepath), file_name=filepath.name, media_type=media_type,
                    file_size=stat.st_size, file_mtime=stat.st_mtime,
                    has_xmp=int(media_type == "image" and filepath.with_suffix(".xmp").exists()))
        logger.debug("import prepare ext={} probe={:.3f}s preview={:.3f}s embedding={:.3f}s",
                     ext, probed - start, previewed - probed, perf_counter() - previewed)
        return meta
    except BaseException:
        cleanup_thumbnails([meta.get("thumbnail_path"), meta.get("cover_art_path")])
        raise
    finally:
        if image is not None:
            image.close()


def _import_one(db, filepath: Path, force_update: bool = False, prepared=None, organize_people=False, people_media_type='all', classify_media=False) -> dict | None:
    """Commit one prepared item on the caller's database thread."""
    saved = False
    generated = []
    if prepared is not None:
        generated = [prepared.get("thumbnail_path"), prepared.get("cover_art_path")]
    try:
        stat = filepath.stat()
        existing = db.execute("SELECT * FROM media WHERE file_path = ?", (str(filepath),)).fetchone()
        if existing and (not force_update or (existing["file_size"] == stat.st_size
                                             and existing["file_mtime"] == stat.st_mtime)):
            return None
        if prepared is None:
            prepared = _prepare_import(filepath)
            generated = [prepared.get("thumbnail_path"), prepared.get("cover_art_path")]
        # An unplugged or changed source must not be reported as a completed import.
        stat = filepath.stat()
        if prepared["file_size"] != stat.st_size or prepared["file_mtime"] != stat.st_mtime:
            raise RuntimeError("Source changed during import; retry this file")
        row = _save_import(db, prepared, existing, organize_people=organize_people, people_media_type=people_media_type, classify_media=classify_media)
        saved = True
        return row
    finally:
        if not saved:
            cleanup_thumbnails(generated)


def _save_import(db, prepared, existing, organize_people=False, people_media_type='all', classify_media=False):
    columns = [
        "file_path", "file_name", "media_type", "file_size", "file_mtime", "duration", "width", "height", "fps",
        "video_codec", "video_profile", "bit_rate", "audio_codec", "audio_sample_rate", "audio_channels",
        "color_space", "color_range", "pix_fmt", "camera_make", "camera_model", "lens_model", "date_taken",
        "thumbnail_path", "cover_art_path", "has_xmp", "picture_control", "embedding", "music_title", "music_artist", "music_album",
    ]
    values = {c: prepared.get(c) for c in columns}
    if existing:
        for c in ("thumbnail_path", "cover_art_path"):
            if values[c] is None:
                values[c] = existing[c]
    try:
        if existing:
            media_id = existing["id"]
            db.execute("UPDATE media SET " + ",".join(c + "=?" for c in columns) +
                       ", file_hash=NULL, phash=NULL, updated_at=datetime('now') WHERE id=?",
                       [values[c] for c in columns] + [media_id])
        else:
            media_id = db.execute("INSERT INTO media (" + ",".join(columns) + ") VALUES (" +
                                  ",".join("?" for _ in columns) + ")", [values[c] for c in columns]).lastrowid
        from ..blueprints.analysis import refresh_media_fts
        refresh_media_fts(db, media_id)
        row = dict(db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone())
        from .model_preferences import classification_enabled, people_enabled
        classify = classify_media and classification_enabled(db,'fast') and row['media_type']=='image'
        if classify:
            from .classification_jobs import enqueue
            enqueue(db,media_id,'fast',batch_id=prepared.get('_classification_batch'))
        recognize_people=organize_people and people_enabled(db) and row['media_type'] in ('image','video') and people_media_type in ('all',row['media_type'])
        if recognize_people:
            from .people_jobs import enqueue as enqueue_people
            enqueue_people(db,media_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    if existing:
        for c in ("thumbnail_path", "cover_art_path"):
            if existing[c] and existing[c] != values[c]:
                try:
                    (THUMB_DIR / existing[c]).unlink(missing_ok=True)
                except OSError:
                    logger.warning("旧缓存清理失败: {}", existing[c])

    if classify:
        try:
            from flask import current_app
            from .classification_jobs import ensure_worker
            ensure_worker(current_app._get_current_object())
        except Exception:
            logger.warning('分类任务已登记，后台调度稍后重试')
    if recognize_people:
        try:
            from flask import current_app
            from .people_jobs import ensure_worker as ensure_people_worker
            ensure_people_worker(current_app._get_current_object())
        except Exception:
            logger.warning('人物任务已登记，后台调度稍后重试')
    logger.info("imported: {} id={}", values["file_name"], media_id)
    return row


def import_batch(db, paths, organize_people=False, people_media_type='all', classify_media=False):
    """Bounded preparation, ordered commits and progress; discard uncommitted caches on disconnect."""
    classification_batch=__import__("uuid").uuid4().hex
    with ThreadPoolExecutor(max_workers=IMPORT_WORKERS, thread_name_prefix="media-import") as pool:
        for offset in range(0, len(paths), IMPORT_BATCH_SIZE):
            chunk = [Path(p) for p in paths[offset:offset + IMPORT_BATCH_SIZE]]
            placeholders = ",".join("?" for _ in chunk)
            known = {r[0] for r in db.execute(f"SELECT file_path FROM media WHERE file_path IN ({placeholders})",
                                             [str(p) for p in chunk])}
            pending = list(dict.fromkeys(p for p in chunk if str(p) not in known))
            metadata = _run_exiftool_batch([p for p in pending if p.suffix.lower() in IMAGE_EXTS | VIDEO_EXTS])
            futures = {p: pool.submit(_prepare_import, p, metadata.get(str(p))) for p in pending}
            try:
                for index, path in enumerate(chunk, offset + 1):
                    event = {"done": index, "total": len(paths), "file_path": str(path)}
                    future = futures.pop(path, None)
                    try:
                        if future:
                            prepared=future.result()
                            prepared['_classification_batch']=classification_batch
                            result=_import_one(db,path,prepared=prepared,organize_people=organize_people,people_media_type=people_media_type,classify_media=classify_media)
                        else:
                            result=None
                        if result:
                            result.pop("embedding", None)
                            event.update(type="ok", data=result)
                        else:
                            event.update(type="skip")
                    except Exception as e:
                        logger.exception("batch import failed: {} — {}", path, e)
                        event.update(type="fail", error=str(e))
                    yield event
            finally:
                # Running subprocesses finish within their timeouts. Do not write
                # additional records after the client has stopped consuming SSE.
                for future in futures.values():
                    future.cancel()
                for future in futures.values():
                    if not future.cancelled():
                        try:
                            prepared = future.result()
                            cleanup_thumbnails([prepared.get("thumbnail_path"), prepared.get("cover_art_path")])
                        except Exception:
                            pass


def _probe(filepath: Path, media_type: str, exif_tags=None) -> dict:
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
           "-show_format", "-show_streams", str(filepath)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=PROBE_TIMEOUT)
    info = json.loads(result.stdout)
    vs = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    au = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), {})
    fmt = info.get("format", {})
    tags = vs.get("tags", {}) or {}

    meta = {
        "width": vs.get("width"),
        "height": vs.get("height"),
        "fps": vs.get("r_frame_rate"),
        "video_codec": vs.get("codec_name"),
        "video_profile": vs.get("profile"),
        "bit_rate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        "audio_codec": au.get("codec_name"),
        "audio_sample_rate": int(au["sample_rate"]) if au.get("sample_rate") else None,
        "audio_channels": au.get("channels"),
        "color_space": vs.get("color_space"),
        "color_range": vs.get("color_range"),
        "pix_fmt": vs.get("pix_fmt"),
        "duration": float(fmt["duration"]) if fmt.get("duration") else None,
        # 流判定布尔（.mp4/.m4v 纯音轨归 audio），_import_one 消费后 pop
        "_has_video": bool(vs),
        "_has_audio": bool(au),
        "camera_model": tags.get("com.apple.quicktime.model") or tags.get("model"),
        "camera_make": None,
        "lens_model": None,
        "picture_control": None,
        "date_taken": _normalize_date(
            tags.get("com.apple.quicktime.creationdate")
            or tags.get("creation_time")
            or datetime.fromtimestamp(filepath.stat().st_mtime).isoformat()
        ),
    }
    _exif_probe(filepath, meta, exif_tags=exif_tags)

    # DJI D-Log M: detected from filename suffix _D (not in metadata)
    if not meta.get("picture_control") and meta.get("camera_make") == "DJI":
        if filepath.stem.endswith("_D"):
            meta["picture_control"] = "D-Log M"

    return meta


def _normalize_date(s: str) -> str:
    """Convert exiftool date like '2024:08:17 15:40:39' to ISO '2024-08-17 15:40:39'."""
    if not s:
        return s
    parts = s.strip().split()
    if len(parts) >= 1 and parts[0].count(":") == 2 and "-" not in parts[0]:
        parts[0] = parts[0].replace(":", "-")
    return " ".join(parts)


def _run_exiftool(filepath: Path) -> dict | None:
    """Run exiftool and return parsed tags dict, or None on failure."""
    return _run_exiftool_batch([filepath]).get(str(filepath))


def _run_exiftool_batch(paths) -> dict:
    """One process for a small window of files; absent results retry individually."""
    if not paths:
        return {}
    if not shutil.which("exiftool"):
        return {}
    cmd = [
        "exiftool", "-json", "-a",
        "-Make", "-Model", "-CameraModelName", "-LensModel", "-Encoder",
        "-DateTimeOriginal", "-CreateDate",
        "-ImageWidth", "-ImageHeight", "-Orientation#", "-FileType", "-ColorSpace", "-Compression", "-BitsPerSample",
        "-PictureControlName",
        *[str(p) for p in paths],
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=EXIFTOOL_TIMEOUT)
        data = json.loads(result.stdout)
        if data and isinstance(data, list):
            return {item["SourceFile"]: item for item in data if "SourceFile" in item}
    except Exception:
        pass
    return {}


def _apply_exif_tags(tags: dict, meta: dict):
    """Apply exiftool tags to meta dict (shared by video and image)."""
    if tags.get("Make"):
        meta["camera_make"] = tags["Make"].strip()
    model = tags.get("Model") or tags.get("CameraModelName")
    if model:
        meta["camera_model"] = model.strip()
    if tags.get("LensModel"):
        meta["lens_model"] = tags["LensModel"].strip()
    if not meta.get("camera_model") and tags.get("Encoder", "").startswith("DJI"):
        meta["camera_make"] = "DJI"
        meta["camera_model"] = tags["Encoder"].strip()
    dt = tags.get("DateTimeOriginal") or tags.get("CreateDate")
    if dt:
        meta["date_taken"] = _normalize_date(str(dt).strip())
    if tags.get("ImageWidth") and (not meta.get("width") or meta["width"] == 0):
        meta["width"] = int(tags["ImageWidth"])
    if tags.get("ImageHeight") and (not meta.get("height") or meta["height"] == 0):
        meta["height"] = int(tags["ImageHeight"])
    # Swap width/height for 90°/270° EXIF orientations
    orient = tags.get("Orientation")
    if orient:
        s = str(orient).strip()
        if s.isdigit():
            o = int(s)
        elif "90" in s or "270" in s:
            o = 6
        else:
            o = 1
        if o in (5, 6, 7, 8) and meta.get("width") and meta.get("height"):
            meta["width"], meta["height"] = meta["height"], meta["width"]
        meta["_orientation"] = o
    if tags.get("FileType") and not meta.get("video_codec"):
        meta["video_codec"] = tags["FileType"]
    if tags.get("Compression") and not meta.get("video_profile"):
        meta["video_profile"] = tags["Compression"]
    if tags.get("ColorSpace") and not meta.get("color_space"):
        meta["color_space"] = tags["ColorSpace"]
    if tags.get("BitsPerSample") and not meta.get("pix_fmt"):
        bits = str(tags["BitsPerSample"]).split()[0]
        meta["pix_fmt"] = f"{bits}-bit"
    if tags.get("PictureControlName"):
        meta["picture_control"] = tags["PictureControlName"].strip()


def _exif_probe(filepath: Path, meta: dict, exif_tags=None):
    """Enhance video metadata with exiftool (camera info fallback)."""
    tags = exif_tags if exif_tags is not None else _run_exiftool(filepath)
    if tags:
        _apply_exif_tags(tags, meta)


def _probe_audio(filepath: Path) -> dict:
    """音频元数据：ffprobe（流参数 + format.tags 的 ID3 title/artist/album），exiftool 兜底。"""
    meta = {
        "duration": None, "bit_rate": None,
        "audio_codec": None, "audio_sample_rate": None, "audio_channels": None,
        "music_title": None, "music_artist": None, "music_album": None,
        "date_taken": _normalize_date(datetime.fromtimestamp(filepath.stat().st_mtime).isoformat()),
    }
    try:
        cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
               "-show_format", "-show_streams", str(filepath)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=PROBE_TIMEOUT)
        info = json.loads(result.stdout)
        au = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), {})
        fmt = info.get("format", {})
        ftags = fmt.get("tags", {}) or {}
        meta.update({
            "duration": float(fmt["duration"]) if fmt.get("duration") else None,
            "bit_rate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
            "audio_codec": au.get("codec_name"),
            "audio_sample_rate": int(au["sample_rate"]) if au.get("sample_rate") else None,
            "audio_channels": au.get("channels"),
        })
        # ID3（大小写键名因容器而异：title/Title/TITLE）
        def _tag(*keys):
            for k in keys:
                for kk, vv in ftags.items():
                    if kk.lower() == k and vv:
                        return str(vv).strip()
            return None
        meta["music_title"] = _tag("title")
        meta["music_artist"] = _tag("artist", "album_artist")
        meta["music_album"] = _tag("album")
    except Exception as e:
        logger.warning("audio probe failed {}: {}", filepath.name, e)

    # ID3 缺失时 exiftool 兜底（_run_exiftool 固定字段不含 ID3，单独探测）
    if not meta.get("music_title") and shutil.which("exiftool"):
        try:
            cmd = ["exiftool", "-json", "-Title", "-Artist", "-Album", str(filepath)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=EXIFTOOL_TIMEOUT)
            data = json.loads(result.stdout)
            if data and isinstance(data, list):
                tags = data[0]
                meta["music_title"] = meta.get("music_title") or (str(tags["Title"]).strip() if tags.get("Title") else None)
                meta["music_artist"] = meta.get("music_artist") or (str(tags["Artist"]).strip() if tags.get("Artist") else None)
                meta["music_album"] = meta.get("music_album") or (str(tags["Album"]).strip() if tags.get("Album") else None)
        except Exception:
            pass
    return meta


def _probe_image(filepath: Path, exif_tags=None) -> dict:
    """Extract all image metadata via exiftool only."""
    meta = {
        "width": None, "height": None, "fps": None,
        "video_codec": None, "video_profile": None, "bit_rate": None,
        "audio_codec": None, "audio_sample_rate": None, "audio_channels": None,
        "color_space": None, "color_range": None, "pix_fmt": None,
        "duration": None,
        "camera_make": None, "camera_model": None, "lens_model": None,
        "picture_control": None,
        "date_taken": _normalize_date(datetime.fromtimestamp(filepath.stat().st_mtime).isoformat()),
    }
    tags = exif_tags if exif_tags is not None else _run_exiftool(filepath)
    if tags:
        _apply_exif_tags(tags, meta)
    return meta


def _get_exif_orientation(filepath: Path) -> int:
    """Read EXIF Orientation from file, return numeric value (1=normal)."""
    if not shutil.which("exiftool"):
        return 1
    try:
        cmd = ["exiftool", "-json", "-Orientation#", str(filepath)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=EXIFTOOL_TIMEOUT)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if data and isinstance(data, list):
                orient = data[0].get("Orientation", "")
                s = str(orient).strip()
                if s.isdigit():
                    return int(s)
                if "90" in s:
                    return 6
                if "180" in s:
                    return 3
                if "270" in s:
                    return 8
    except Exception:
        pass
    return 1


def _rotate_thumbnail(thumb_path: Path, orient: int):
    """Rotate an already-saved thumbnail JPEG according to EXIF orientation."""
    if orient in range(2, 9):
        from PIL import Image, ImageOps
        with Image.open(thumb_path) as img:
            img.getexif()[274] = orient
            rotated = ImageOps.exif_transpose(img)
            rotated.save(thumb_path, "JPEG", quality=85)


def _generate_thumbnail(filepath: Path, media_type: str, image=None, orientation=None) -> str | None:
    thumb_name = f"{uuid.uuid4().hex}.jpg"
    thumb_path = THUMB_DIR / thumb_name
    try:
        result = _write_thumbnail(filepath, media_type, thumb_path, image, orientation)
        if result:
            return thumb_name
    except BaseException:
        thumb_path.unlink(missing_ok=True)
        raise
    thumb_path.unlink(missing_ok=True)
    return None


def _write_thumbnail(filepath, media_type, thumb_path, image, orientation):
    thumb_name = thumb_path.name

    # RAW often already contains a camera-rendered JPEG. Avoid a failed decoder
    # and another orientation probe before trying that preview.
    raw = filepath.suffix.lower() in RAW_EXTS
    if raw and shutil.which("exiftool"):
        try:
            orient = orientation if orientation is not None else _get_exif_orientation(filepath)
            if _extract_exif_thumbnail(filepath, thumb_path, thumb_name, orientation=orient):
                _rotate_thumbnail(thumb_path, orient)
                return thumb_name
        except Exception:
            thumb_path.unlink(missing_ok=True)

    if media_type == "video":
        if shutil.which("ffmpeg"):
            cmd = [
                "ffmpeg", "-i", str(filepath), "-ss", "1", "-frames:v", "1",
                "-vf", "scale=320:-1", "-y", str(thumb_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
            if result.returncode == 0 and thumb_path.exists():
                return thumb_name
    elif media_type == "audio":
        # 波形缩略图：8k 单声道降采样（解码耗时约降一个量级），超长曲截断 30 分钟
        if shutil.which("ffmpeg"):
            try:
                cmd = [
                    "ffmpeg", "-i", str(filepath), "-t", "1800",
                    "-ac", "1", "-ar", "8000",
                    "-filter_complex", "showwavespic=s=640x240:colors=#6c8cff",
                    "-frames:v", "1", "-y", str(thumb_path),
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
                if result.returncode == 0 and thumb_path.exists():
                    return thumb_name
            except Exception as e:
                logger.warning("waveform thumbnail failed {}: {}", filepath.name, e)
        return None  # 音频无图可回退，缺缩略图由前端 no-thumb 占位
    else:
        # PIL: apply EXIF auto-rotation from camera
        try:
            from PIL import Image, ImageOps
            from contextlib import nullcontext
            with (nullcontext(image) if image is not None else Image.open(filepath)) as source:
                img = ImageOps.exif_transpose(source)
            if img.mode != "RGB":
                img = img.convert("RGB")
            w, h = img.size
            tw, th = 320, round(320 * h / w)
            img = img.resize((tw, max(1, th)), Image.LANCZOS, reducing_gap=3.0)
            img.save(thumb_path, "JPEG", quality=85)
            return thumb_name
        except Exception:
            pass

        # Get orientation for fallback paths
        orient = orientation if orientation is not None else _get_exif_orientation(filepath)

        # Fallback: ffmpeg (raw pixels, rotate afterwards)
        if shutil.which("ffmpeg"):
            cmd = [
                "ffmpeg", "-noautorotate", "-i", str(filepath),
                "-vf", "scale=320:-1", "-y", str(thumb_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
            if result.returncode == 0 and thumb_path.exists():
                _rotate_thumbnail(thumb_path, orient)
                return thumb_name

        # Embedded previews for other image formats (RAW was already tried above).
        if not raw and shutil.which("exiftool"):
            try:
                result = _extract_exif_thumbnail(filepath, thumb_path, thumb_name)
                if result:
                    _rotate_thumbnail(thumb_path, orient)
                    return result
            except Exception:
                pass

    return None


def _extract_cover_art(filepath: Path) -> str | None:
    """提取音频内嵌封面（ID3 APIC / M4A covr / FLAC PICTURE / OGG picture）到 THUMB_DIR。

    返回文件名（如 uuid.jpg）；无封面/提取失败返回 None（前端回落波形图）。
    主路径 ffmpeg（attached-pic 视频流，一步缩放转 JPEG），兜底 exiftool 原始字节 + PIL 缩放。
    """
    cover_name = f"{uuid.uuid4().hex}.jpg"
    cover_path = THUMB_DIR / cover_name

    # 主：ffmpeg 取第一个 attached-pic 流（无封面时退出码非 0，不会产生有效输出）
    if shutil.which("ffmpeg"):
        cmd = [
            "ffmpeg", "-i", str(filepath),
            "-an", "-map", "0:v:0",
            "-frames:v", "1",
            "-vf", "scale=320:-1",
            "-y", str(cover_path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
            if result.returncode == 0 and cover_path.exists() and cover_path.stat().st_size > 100:
                return cover_name
        except Exception as e:
            logger.warning("cover extract (ffmpeg) failed {}: {}", filepath.name, e)
        if cover_path.exists():
            cover_path.unlink(missing_ok=True)

    # 兜底：exiftool 原始封面字节 + PIL 缩放（wma WM/Picture、ffmpeg 不认的格式）
    if shutil.which("exiftool"):
        try:
            from PIL import Image, ImageOps
            import io
            for tag in ("Picture", "CoverArt", "PreviewImage"):
                result = subprocess.run(
                    ["exiftool", "-b", f"-{tag}", str(filepath)],
                    capture_output=True, timeout=EXIFTOOL_TIMEOUT,
                )
                if result.returncode != 0 or len(result.stdout) <= 100:
                    continue
                img = Image.open(io.BytesIO(result.stdout))
                img = ImageOps.exif_transpose(img)
                if img.mode != "RGB":
                    img = img.convert("RGB")
                img.thumbnail((320, 320), Image.LANCZOS)
                img.save(cover_path, "JPEG", quality=85)
                if cover_path.exists():
                    return cover_name
                break
        except Exception as e:
            logger.warning("cover extract (exiftool) failed {}: {}", filepath.name, e)

    if cover_path.exists():
        cover_path.unlink(missing_ok=True)
    return None


def _extract_exif_thumbnail(filepath: Path, thumb_path: Path, thumb_name: str, orientation=1) -> str | None:
    # Prefer full-resolution embedded JPEGs over tiny 4:3 ThumbnailImage
    raw = filepath.suffix.lower() in RAW_EXTS
    stamp = filepath.stat() if raw else None
    fallback = None
    def write(content):
        from PIL import Image
        with Image.open(io.BytesIO(content)) as img:
            # Retain RAW detail once, alongside the lightweight grid thumbnail.
            if raw:
                from .raw_preview import save_preview, MAX_EDGE
                img.draft('RGB', (MAX_EDGE, MAX_EDGE))
                try:save_preview(filepath, img, orientation, stamp=stamp)
                except OSError:pass  # A cache failure must not fail the import.
            else:
                img.draft('RGB', (320, max(1, round(320 * img.height / img.width))))
            img = img.convert('RGB')
            img = img.resize((320, max(1, round(320 * img.height / img.width))),
                             Image.Resampling.LANCZOS, reducing_gap=3.0)
            img.save(thumb_path, 'JPEG', quality=85)
        return thumb_name
    for tag in ("JpgFromRaw", "PreviewImage", "ThumbnailImage"):
        cmd = ["exiftool", "-b", f"-{tag}", str(filepath)]
        result = subprocess.run(cmd, capture_output=True, timeout=EXIFTOOL_TIMEOUT)
        if result.returncode == 0 and len(result.stdout) > 100:
            from PIL import Image
            try:
                with Image.open(io.BytesIO(result.stdout)) as img:
                    if raw and max(img.size) < 1600:
                        if fallback is None or max(img.size)>fallback[0]:fallback=(max(img.size),result.stdout)
                        continue
                return write(result.stdout)
            except (OSError, ValueError):
                continue  # A damaged embedded preview must not prevent the other fallbacks.
    if fallback:
        return write(fallback[1])
    return None


