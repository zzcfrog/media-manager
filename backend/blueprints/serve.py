import io
import shutil
import subprocess
from pathlib import Path

from loguru import logger
from flask import Blueprint, Response, send_file, send_from_directory, current_app, request

from ..db import get_db
from ..config import THUMB_DIR, IMAGE_EXTS

bp = Blueprint("serve", __name__)

_RAW_EXTS = IMAGE_EXTS - {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

MIME_MAP = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska", ".webm": "video/webm", ".m4v": "video/mp4",
    ".mts": "video/mp2t", ".m2ts": "video/mp2t",
    ".flv": "video/x-flv", ".wmv": "video/x-ms-wmv", ".3gp": "video/3gpp",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".heic": "image/heic", ".webp": "image/webp", ".bmp": "image/bmp",
    ".tiff": "image/tiff",
}

# Extensions that browsers can play natively (MP4 H.264, WebM, MOV)
_BROWSER_NATIVE_EXTS = {".mp4", ".m4v", ".webm", ".mov"}


def _media_or_404(media_id):
    db = get_db()
    row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        from flask import abort
        abort(404)
    return row


@bp.route("/media/video/<int:media_id>")
def serve_video(media_id):
    row = _media_or_404(media_id)
    path = Path(row["file_path"])
    if not path.exists():
        from flask import abort
        abort(404)

    ext = path.suffix.lower()

    # Browser-native formats: serve directly with range support
    if ext in _BROWSER_NATIVE_EXTS:
        mime = MIME_MAP.get(ext, "video/mp4")
        return send_file(path, mimetype=mime, conditional=True)

    # Non-native formats (MTS, AVI, MKV, FLV, WMV...): transcode to MP4 on the fly
    return _transcode_to_mp4(path)


def _transcode_to_mp4(path):
    """Transcode a non-native video to MP4/H.264 via ffmpeg and stream the result."""
    if not shutil.which("ffmpeg"):
        return send_file(path, mimetype="video/mp4", conditional=True)

    cmd = [
        "ffmpeg", "-i", str(path),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov",
        "-f", "mp4", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def generate():
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.kill()
            proc.wait()

    return Response(generate(), mimetype="video/mp4")


def _extract_raw_preview(path):
    """Extract embedded JPEG preview via exiftool (for thumbnails)."""
    for tag in ("ThumbnailImage", "JpgFromRaw", "PreviewImage"):
        result = subprocess.run(
            ["exiftool", "-b", f"-{tag}", str(path)],
            capture_output=True, timeout=15,
        )
        if result.returncode == 0 and len(result.stdout) > 100:
            return result.stdout
    return None


def _decode_raw(path):
    """Decode RAW file to full-resolution JPEG in memory using rawpy."""
    import rawpy
    from PIL import Image

    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(use_camera_wb=True, half_size=False)
    img = Image.fromarray(rgb)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    buf.seek(0)
    return buf


def _decode_heif(path):
    """Decode HEIF/HEIC file to full-resolution JPEG in memory using pillow-heif."""
    from pillow_heif import register_heif_opener
    register_heif_opener()
    from PIL import Image

    img = Image.open(str(path))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    buf.seek(0)
    return buf


_HEIC_EXTS = {".heic", ".heif", ".hif", ".avif"}


@bp.route("/media/image/<int:media_id>")
def serve_image(media_id):
    row = _media_or_404(media_id)
    path = Path(row["file_path"])
    if not path.exists():
        from flask import abort
        abort(404)

    ext = path.suffix.lower()

    # RAW formats: full-resolution decode via rawpy
    if ext in _RAW_EXTS and ext not in _HEIC_EXTS:
        try:
            return send_file(_decode_raw(path), mimetype="image/jpeg")
        except Exception as e:
            logger.warning("rawpy decode failed for {}: {}", path, e)

    # HEIC/HIF/AVIF: full-resolution decode via pillow-heif
    if ext in _HEIC_EXTS:
        try:
            return send_file(_decode_heif(path), mimetype="image/jpeg")
        except Exception as e:
            logger.warning("heif decode failed for {}: {}", path, e)

    mime = MIME_MAP.get(ext, "image/jpeg")
    return send_file(path, mimetype=mime)


@bp.route("/media/thumbnail/<int:media_id>")
def serve_thumbnail(media_id):
    from flask import request
    db = get_db()
    row = db.execute("SELECT id, file_path, media_type, thumbnail_path FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        from flask import abort
        abort(404)

    # If ?t= is specified, extract frame at that timestamp via ffmpeg
    t_param = request.args.get("t")
    if t_param is not None:
        try:
            t_sec = float(t_param)
        except (ValueError, TypeError):
            t_sec = 0
        if row["media_type"] == "video" and shutil.which("ffmpeg"):
            import tempfile, subprocess
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            try:
                cmd = [
                    "ffmpeg", "-ss", str(t_sec), "-i", str(row["file_path"]),
                    "-frames:v", "1", "-vf", "scale=320:-1", "-y", tmp.name,
                ]
                subprocess.run(cmd, capture_output=True, timeout=10)
                if Path(tmp.name).exists() and Path(tmp.name).stat().st_size > 0:
                    return send_file(tmp.name, mimetype="image/jpeg")
            except Exception:
                pass
            finally:
                try: Path(tmp.name).unlink()
                except: pass
        # Fallback: return default thumbnail
        t_param = None

    # Try existing thumbnail
    if row["thumbnail_path"]:
        path = THUMB_DIR / row["thumbnail_path"]
        if path.exists():
            return send_file(path, mimetype="image/jpeg")

    # Thumbnail missing — regenerate on the fly
    from pathlib import Path
    from ..services.importer import _generate_thumbnail
    fp = Path(row["file_path"])
    if fp.exists():
        thumb = _generate_thumbnail(fp, row["media_type"])
        if thumb:
            db.execute("UPDATE media SET thumbnail_path = ? WHERE id = ?", (thumb, row["id"]))
            db.commit()
            return send_file(THUMB_DIR / thumb, mimetype="image/jpeg")

    from flask import abort
    abort(404)


@bp.route("/media/filmstrip/<int:media_id>")
def serve_filmstrip(media_id):
    import subprocess, json
    db = get_db()
    row = db.execute("SELECT id, file_path, media_type, duration FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row or row["media_type"] != "video":
        from flask import abort
        abort(404)

    cache_name = f"filmstrip_{media_id}.jpg"
    cache_path = THUMB_DIR / cache_name
    if cache_path.exists():
        return send_file(cache_path, mimetype="image/jpeg")

    dur = row["duration"] or 60
    interval = 1
    frame_w = 160
    frame_count = min(600, max(10, int(dur / interval)))

    try:
        cmd = [
            "ffmpeg", "-i", str(row["file_path"]),
            "-vf", f"fps=1/{interval},scale={frame_w}:-1,tile={frame_count}x1",
            "-frames:v", "1", "-y", str(cache_path),
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode == 0 and cache_path.exists() and cache_path.stat().st_size > 0:
            return send_file(cache_path, mimetype="image/jpeg")
    except Exception:
        pass

    from flask import abort
    abort(404)
