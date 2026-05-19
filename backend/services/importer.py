import json
import logging
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from ..config import VIDEO_EXTS, IMAGE_EXTS, RAW_EXTS, THUMB_DIR
from ..db import get_db

logger = logging.getLogger(__name__)

# Timeout for external tool calls (ffprobe/ffmpeg/exiftool)
# External disks and large files need more time
PROBE_TIMEOUT = 60
EXIFTOOL_TIMEOUT = 30
FFMPEG_TIMEOUT = 60


def _delete_media_records(db, ids: list[int], thumb_paths: list[str | None] = None):
    """Delete media records by IDs, including thumbnails, tags, segments, FTS, collections."""
    for i, mid in enumerate(ids):
        tp = thumb_paths[i] if thumb_paths and i < len(thumb_paths) else None
        if tp:
            thumb = THUMB_DIR / tp
            if thumb.exists():
                thumb.unlink()
        db.execute("DELETE FROM media_tags WHERE media_id = ?", (mid,))
        db.execute("DELETE FROM collection_items WHERE media_id = ?", (mid,))
        db.execute("DELETE FROM media_segment WHERE media_id = ?", (mid,))
        db.execute("DELETE FROM media_fts WHERE media_id = ?", (mid,))
        db.execute("DELETE FROM media WHERE id = ?", (mid,))


def _collect_files(paths: list[str]) -> list[Path]:
    files = []
    for p in paths:
        path = Path(p)
        if path.is_file() and path.name.startswith("._"):
            continue
        if path.is_file() and path.suffix.lower() in (VIDEO_EXTS | IMAGE_EXTS):
            files.append(path)
        elif path.is_dir():
            for f in path.rglob("*"):
                if f.is_file() and not f.name.startswith("._") and f.suffix.lower() in (VIDEO_EXTS | IMAGE_EXTS):
                    files.append(f)
    return files


def scan_only(paths: list[str]) -> list[dict]:
    files = _collect_files(paths)
    db = get_db()
    results = []
    skipped = []
    for f in files:
        existing = db.execute("SELECT id FROM media WHERE file_path = ?", (str(f),)).fetchone()
        if existing:
            skipped.append({"file_name": f.name, "file_path": str(f), "media_id": existing["id"]})
            continue
        ext = f.suffix.lower()
        results.append({
            "file_path": str(f),
            "file_name": f.name,
            "media_type": "video" if ext in VIDEO_EXTS else "image",
            "file_size": f.stat().st_size,
        })
    return results, skipped


def import_single_file(file_path: str) -> dict | None:
    filepath = Path(file_path)
    if not filepath.exists() or filepath.name.startswith("._"):
        return None
    if filepath.suffix.lower() not in (VIDEO_EXTS | IMAGE_EXTS):
        return None
    db = get_db()
    try:
        return _import_one(db, filepath)
    except Exception as e:
        logger.error(f"import failed: {filepath} — {e}", exc_info=True)
        raise


def _import_one(db, filepath: Path, force_update: bool = False) -> dict | None:
    ext = filepath.suffix.lower()
    media_type = "video" if ext in VIDEO_EXTS else "image"

    stat = filepath.stat()
    existing = db.execute(
        "SELECT id, file_size, file_mtime, thumbnail_path FROM media WHERE file_path = ?",
        (str(filepath),),
    ).fetchone()

    if existing:
        if not force_update:
            return None
        # Skip if file hasn't changed (same size and mtime)
        if existing["file_size"] == stat.st_size and existing["file_mtime"] == stat.st_mtime:
            return None
        # File changed — clean up old record and re-import
        _delete_media_records(db, [existing["id"]], [existing["thumbnail_path"]])

    meta = _probe(filepath, media_type) if media_type == "video" else _probe_image(filepath)
    thumb = _generate_thumbnail(filepath, media_type)
    if thumb:
        meta["thumbnail_path"] = thumb

    embedding = None
    if media_type == "image":
        try:
            from .embedding import compute_embedding
            embedding = compute_embedding(filepath, "image")
        except Exception:
            pass

    xmp_exists = 1 if media_type == "image" and filepath.with_suffix(".xmp").exists() else 0

    cur = db.execute(
        "INSERT INTO media (file_path, file_name, media_type, file_size, file_mtime, duration, width, height, fps, "
        "video_codec, video_profile, bit_rate, audio_codec, audio_sample_rate, audio_channels, "
        "color_space, color_range, pix_fmt, camera_make, camera_model, lens_model, date_taken, thumbnail_path, "
        "has_xmp, picture_control, embedding) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            str(filepath), filepath.name, media_type,
            stat.st_size, stat.st_mtime,
            meta.get("duration"), meta.get("width"), meta.get("height"),
            meta.get("fps"), meta.get("video_codec"), meta.get("video_profile"),
            meta.get("bit_rate"), meta.get("audio_codec"), meta.get("audio_sample_rate"),
            meta.get("audio_channels"), meta.get("color_space"), meta.get("color_range"),
            meta.get("pix_fmt"), meta.get("camera_make"), meta.get("camera_model"),
            meta.get("lens_model"), meta.get("date_taken"), meta.get("thumbnail_path"),
            xmp_exists, meta.get("picture_control"), embedding,
        ),
    )
    media_id = cur.lastrowid

    db.execute(
        "INSERT INTO media_fts (media_id, file_name) VALUES (?, ?)",
        (media_id, filepath.name),
    )
    db.commit()

    row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    logger.info(f"imported: {filepath.name} id={media_id}")
    return dict(row)


def _probe(filepath: Path, media_type: str) -> dict:
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
    _exif_probe(filepath, meta)

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
    if not shutil.which("exiftool"):
        return None
    cmd = [
        "exiftool", "-json", "-a",
        "-Make", "-Model", "-CameraModelName", "-LensModel", "-Encoder",
        "-DateTimeOriginal", "-CreateDate",
        "-ImageWidth", "-ImageHeight", "-Orientation", "-FileType", "-ColorSpace", "-Compression", "-BitsPerSample",
        "-PictureControlName",
        str(filepath),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=EXIFTOOL_TIMEOUT)
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        if data and isinstance(data, list):
            return data[0]
    except Exception:
        pass
    return None


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


def _exif_probe(filepath: Path, meta: dict):
    """Enhance video metadata with exiftool (camera info fallback)."""
    tags = _run_exiftool(filepath)
    if tags:
        _apply_exif_tags(tags, meta)


def _probe_image(filepath: Path) -> dict:
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
    tags = _run_exiftool(filepath)
    if tags:
        _apply_exif_tags(tags, meta)
    return meta


def _get_exif_orientation(filepath: Path) -> int:
    """Read EXIF Orientation from file, return numeric value (1=normal)."""
    if not shutil.which("exiftool"):
        return 1
    try:
        cmd = ["exiftool", "-json", "-Orientation", str(filepath)]
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
    if orient in (1, 2, 3, 4):
        if orient == 3:
            from PIL import Image
            img = Image.open(thumb_path)
            img = img.rotate(180, expand=True)
            img.save(thumb_path, "JPEG", quality=85)
    elif orient in (5, 6, 7, 8):
        from PIL import Image
        img = Image.open(thumb_path)
        angle = 270 if orient in (5, 6) else 90
        img = img.rotate(angle, expand=True)
        img.save(thumb_path, "JPEG", quality=85)


def _generate_thumbnail(filepath: Path, media_type: str) -> str | None:
    thumb_name = f"{uuid.uuid4().hex}.jpg"
    thumb_path = THUMB_DIR / thumb_name

    if media_type == "video":
        if shutil.which("ffmpeg"):
            cmd = [
                "ffmpeg", "-i", str(filepath), "-ss", "1", "-frames:v", "1",
                "-vf", "scale=320:-1", "-y", str(thumb_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
            if result.returncode == 0 and thumb_path.exists():
                return thumb_name
    else:
        # PIL: apply EXIF auto-rotation from camera
        try:
            from PIL import Image, ImageOps
            img = Image.open(filepath)
            img = ImageOps.exif_transpose(img)
            if img.mode != "RGB":
                img = img.convert("RGB")
            w, h = img.size
            tw, th = 320, round(320 * h / w)
            img = img.resize((tw, th), Image.LANCZOS)
            img.save(thumb_path, "JPEG", quality=85)
            return thumb_name
        except Exception:
            pass

        # Get orientation for fallback paths
        orient = _get_exif_orientation(filepath)

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

        # Fallback: exiftool (RAW files)
        if shutil.which("exiftool"):
            try:
                result = _extract_exif_thumbnail(filepath, thumb_path, thumb_name)
                if result:
                    _rotate_thumbnail(thumb_path, orient)
                    return result
            except Exception:
                pass

    return None


def _extract_exif_thumbnail(filepath: Path, thumb_path: Path, thumb_name: str) -> str | None:
    # Prefer full-resolution embedded JPEGs over tiny 4:3 ThumbnailImage
    for tag in ("JpgFromRaw", "PreviewImage", "ThumbnailImage"):
        cmd = ["exiftool", "-b", f"-{tag}", str(filepath)]
        result = subprocess.run(cmd, capture_output=True, timeout=EXIFTOOL_TIMEOUT)
        if result.returncode == 0 and len(result.stdout) > 100:
            thumb_path.write_bytes(result.stdout)
            if thumb_path.exists():
                if shutil.which("ffmpeg"):
                    tmp = thumb_path.with_suffix(".tmp.jpg")
                    subprocess.run(
                        ["ffmpeg", "-noautorotate", "-i", str(thumb_path),
                         "-vf", "scale=320:-1", "-y", str(tmp)],
                        capture_output=True, text=True, timeout=FFMPEG_TIMEOUT,
                    )
                    if tmp.exists():
                        tmp.replace(thumb_path)
                return thumb_name
    return None


