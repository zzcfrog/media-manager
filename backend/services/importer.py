import json
import logging
import shutil
import subprocess
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
        logger.warning(f"import failed: {filepath} — {e}")
        return None


def _import_one(db, filepath: Path) -> dict | None:
    ext = filepath.suffix.lower()
    media_type = "video" if ext in VIDEO_EXTS else "image"

    existing = db.execute("SELECT id, thumbnail_path FROM media WHERE file_path = ?", (str(filepath),)).fetchone()
    if existing:
        if existing["thumbnail_path"]:
            old_thumb = THUMB_DIR / existing["thumbnail_path"]
            if old_thumb.exists():
                old_thumb.unlink()
        return None

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
        "INSERT INTO media (file_path, file_name, media_type, file_size, duration, width, height, fps, "
        "video_codec, video_profile, bit_rate, audio_codec, audio_sample_rate, audio_channels, "
        "color_space, color_range, pix_fmt, camera_make, camera_model, lens_model, date_taken, thumbnail_path, "
        "has_xmp, picture_control, embedding) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            str(filepath), filepath.name, media_type,
            filepath.stat().st_size,
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
        "-ImageWidth", "-ImageHeight", "-FileType", "-ColorSpace", "-Compression", "-BitsPerSample",
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


def _generate_thumbnail(filepath: Path, media_type: str) -> str | None:
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    thumb_name = f"{filepath.stem}_{ts}.jpg"
    thumb_path = THUMB_DIR / thumb_name

    # Try ffmpeg first
    if shutil.which("ffmpeg"):
        if media_type == "video":
            cmd = [
                "ffmpeg", "-i", str(filepath), "-ss", "1", "-frames:v", "1",
                "-vf", "scale=320:-1", "-y", str(thumb_path),
            ]
        else:
            cmd = [
                "ffmpeg", "-i", str(filepath),
                "-vf", "scale=320:-1", "-y", str(thumb_path),
            ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
        if result.returncode == 0 and thumb_path.exists():
            return thumb_name

    # Fallback: extract embedded thumbnail via exiftool (for RAW files etc.)
    if media_type == "image" and shutil.which("exiftool"):
        try:
            return _extract_exif_thumbnail(filepath, thumb_path, thumb_name)
        except Exception:
            pass

    return None


def _extract_exif_thumbnail(filepath: Path, thumb_path: Path, thumb_name: str) -> str | None:
    for tag in ("ThumbnailImage", "JpgFromRaw", "PreviewImage"):
        cmd = ["exiftool", "-b", f"-{tag}", str(filepath)]
        result = subprocess.run(cmd, capture_output=True, timeout=EXIFTOOL_TIMEOUT)
        if result.returncode == 0 and len(result.stdout) > 100:
            thumb_path.write_bytes(result.stdout)
            if thumb_path.exists():
                # Resize to consistent width
                if shutil.which("ffmpeg"):
                    tmp = thumb_path.with_suffix(".tmp.jpg")
                    subprocess.run(
                        ["ffmpeg", "-i", str(thumb_path), "-vf", "scale=320:-1", "-y", str(tmp)],
                        capture_output=True, text=True, timeout=FFMPEG_TIMEOUT,
                    )
                    if tmp.exists():
                        tmp.replace(thumb_path)
                return thumb_name
    return None


