import io
import hashlib
import threading
import tempfile
import shutil
import subprocess
from pathlib import Path

from loguru import logger
from flask import Blueprint, Response, send_file, send_from_directory, current_app, request, jsonify

from ..db import get_db
from ..config import THUMB_DIR, IMAGE_EXTS, DATA_DIR

bp = Blueprint("serve", __name__)


@bp.record_once
def register_background_tasks(state):
    from ..services.background_tasks import install
    install(state.app)

_RAW_EXTS = IMAGE_EXTS - {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

MIME_MAP = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska", ".webm": "video/webm", ".m4v": "video/mp4",
    ".mts": "video/mp2t", ".m2ts": "video/mp2t",
    ".flv": "video/x-flv", ".wmv": "video/x-ms-wmv", ".3gp": "video/3gpp",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".heic": "image/heic", ".webp": "image/webp", ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
    ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
    ".aac": "audio/aac", ".wma": "audio/x-ms-wma", ".aiff": "audio/aiff", ".aif": "audio/aiff",
}

# Extensions that browsers can play natively (MP4 H.264, WebM, MOV)
_BROWSER_NATIVE_EXTS = {".mp4", ".m4v", ".webm", ".mov"}

# 浏览器（Electron/Chromium）原生可播的音频：直接 send_file 支持 Range（可拖动进度条）。
# .mp4 = 纯音轨的 mp4（此路由仅 media_type=audio 走到，容器即 AAC，无需转码）
_AUDIO_NATIVE_EXTS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".oga", ".aac", ".mp4"}


def _media_or_404(media_id):
    db = get_db()
    row = db.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        from flask import abort
        abort(404)
    return row


@bp.route("/api/media/<int:media_id>/exists")
def media_exists(media_id):
    """轻量文件存在性检查（播放出错时区分「文件不存在」与「格式不支持」）。"""
    row = _media_or_404(media_id)
    return jsonify({"exists": Path(row["file_path"]).exists()})


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


_preview_lock = threading.Lock()
_PREVIEW_CACHE_LIMIT = 2 * 1024 ** 3


def _transcode_to_mp4(path):
    """Complete a seekable MP4 before serving it with normal HTTP Range support."""
    if not shutil.which("ffmpeg"):
        return send_file(path, mimetype="video/mp4", conditional=True)
    stat = path.stat()
    key = hashlib.sha256(f"{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()
    directory = DATA_DIR / "preview-cache"
    cached = directory / (key + ".mp4")
    if request.method == "HEAD" and not cached.exists():
        return Response(mimetype="video/mp4", headers={"Cache-Control": "no-store"})
    with _preview_lock:
        if not cached.exists():
            directory.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="transcode-", dir=directory) as scratch:
                output = Path(scratch) / "preview.mp4"
                result = subprocess.run([
                    "ffmpeg", "-v", "error", "-i", str(path),
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                    "-c:a", "aac", "-movflags", "+faststart", "-y", str(output),
                ], capture_output=True, timeout=600)
                if result.returncode or not output.exists() or not output.stat().st_size:
                    return jsonify({"error": "视频预览转码失败"}), 422
                current = path.stat()
                if (current.st_size, current.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                    return jsonify({"error": "源文件已变化，请重试"}), 409
                output.replace(cached)
        cached.touch()
        # Bound retained previews; an individual large active preview may exceed the limit.
        others = sorted((f for f in directory.glob("*.mp4") if f != cached), key=lambda f: f.stat().st_mtime)
        total = cached.stat().st_size + sum(f.stat().st_size for f in others)
        for file in others:
            if total <= _PREVIEW_CACHE_LIMIT:
                break
            size = file.stat().st_size
            file.unlink(missing_ok=True)
            total -= size
        return send_file(cached, mimetype="video/mp4", conditional=True, etag=key, last_modified=stat.st_mtime)


@bp.route("/media/audio/<int:media_id>")
def serve_audio(media_id):
    row = _media_or_404(media_id)
    path = Path(row["file_path"])
    if not path.exists():
        from flask import abort
        abort(404)

    ext = path.suffix.lower()
    # 原生可播（Electron/Chromium）：Range 支持 = 可拖动进度条
    if ext in _AUDIO_NATIVE_EXTS:
        mime = "audio/mp4" if ext in (".mp4", ".m4a") else MIME_MAP.get(ext, "audio/mpeg")
        return send_file(path, mimetype=mime, conditional=True)

    # wma/aiff：流式转码 AAC ADTS（不可 seek）
    return _transcode_to_aac(path)


def _transcode_to_aac(path):
    if not shutil.which("ffmpeg"):
        return send_file(path, mimetype="audio/mpeg", conditional=True)

    cmd = [
        "ffmpeg", "-i", str(path),
        "-c:a", "aac", "-b:a", "192k", "-f", "adts", "-",
    ]
    return _stream_ffmpeg(cmd, "audio/aac")


def _stream_ffmpeg(cmd, mimetype):
    def generate():
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.kill()
            proc.wait()

    return Response(generate(), mimetype=mimetype)


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

    stamp = path.stat()
    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(use_camera_wb=True, half_size=False)
    img = Image.fromarray(rgb)
    from ..services.raw_preview import save_preview
    try:save_preview(path, img, stamp=stamp)
    except OSError:pass
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
        if path.suffix.lower() in _RAW_EXTS:
            from ..services.raw_preview import cached_preview
            cached = cached_preview(row)
            if cached is not None:
                response = send_file(cached, mimetype="image/jpeg", conditional=True)
                response.headers['X-Luminisle-Preview'] = 'cached'
                return response
        from flask import abort
        abort(404)

    ext = path.suffix.lower()

    # RAW formats: full-resolution decode via rawpy
    if ext in _RAW_EXTS and ext not in _HEIC_EXTS:
        try:
            return send_file(_decode_raw(path), mimetype="image/jpeg")
        except Exception as e:
            logger.warning("rawpy decode failed for {}: {}", path, e)
            from ..services.raw_preview import read_preview
            try:
                preview = read_preview(path)
                output = io.BytesIO();preview.save(output, format='JPEG', quality=93);output.seek(0)
                return send_file(output, mimetype='image/jpeg')
            except (OSError,ValueError):
                return jsonify({'error':'RAW 预览解码失败，请检查原片是否可用'}),422

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
    cache_only = request.args.get("cached") == "1"
    t_param = None if cache_only else request.args.get("t")
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
                    return send_file(io.BytesIO(Path(tmp.name).read_bytes()), mimetype="image/jpeg")
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

    if cache_only:
        from flask import abort
        abort(404)

    # Thumbnail missing — regenerate on the fly
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


@bp.route("/media/cover/<int:media_id>")
def serve_cover(media_id):
    """音频内嵌封面。优先已提取文件；缺失且源文件在 → 懒提取落库（历史音频自动回填）。"""
    db = get_db()
    row = db.execute(
        "SELECT id, file_path, media_type, cover_art_path FROM media WHERE id = ?",
        (media_id,),
    ).fetchone()
    if not row or row["media_type"] != "audio":
        from flask import abort
        abort(404)

    if row["cover_art_path"]:
        path = THUMB_DIR / row["cover_art_path"]
        if path.exists():
            return send_file(path, mimetype="image/jpeg")

    from ..services.importer import _extract_cover_art
    fp = Path(row["file_path"])
    if fp.exists():
        cover = _extract_cover_art(fp)
        if cover:
            db.execute("UPDATE media SET cover_art_path = ? WHERE id = ?", (cover, row["id"]))
            db.commit()
            return send_file(THUMB_DIR / cover, mimetype="image/jpeg")

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
