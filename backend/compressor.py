import re
import subprocess
import shutil
from datetime import datetime
from pathlib import Path
from PIL import Image
from .config import RAW_EXTS

# Video/image compression for analysis: reduces media before sending to VLM.


def check_ffmpeg() -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not found. Please install ffmpeg first.")


def cleanup_temp() -> None:
    temp_dir = Path("temp_video")
    if not temp_dir.exists():
        return
    for f in temp_dir.iterdir():
        if f.is_file():
            try:
                f.unlink()
            except OSError:
                pass


RES_MAP = {"480": 854, "320": 640, "240": 426}

_HW_ENCODER = None


def detect_hw_encoder() -> str | None:
    """Detect the best available hardware H.264 encoder. Returns name or None."""
    global _HW_ENCODER
    if _HW_ENCODER is not None:
        return _HW_ENCODER if _HW_ENCODER else None
    try:
        r = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True,
        )
        output = r.stdout
        for enc in ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_vaapi"]:
            if enc in output:
                _HW_ENCODER = enc
                return enc
    except Exception:
        pass
    _HW_ENCODER = ""
    return None

_FFMPEG_TIME_RE = re.compile(r"time=(\d+:\d+:\d+\.\d+)")


def _get_duration(path: Path) -> float | None:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True,
        )
        return float(r.stdout.strip())
    except (ValueError, subprocess.CalledProcessError):
        return None


def _parse_ffmpeg_time(line: str) -> float | None:
    m = _FFMPEG_TIME_RE.search(line)
    if not m:
        return None
    parts = m.group(1).split(":")
    return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])


_BASE_BITRATE = 2_000_000  # 480P 30fps 基准码率 2Mbps
_BASE_PIXELS = 854 * 480
_BASE_FPS = 30


def _calc_bitrate(resolution: str, fps: str) -> int:
    w = RES_MAP.get(resolution, 854)
    h = int(w * 9 / 16)
    return int(_BASE_BITRATE * (w * h / _BASE_PIXELS) * (int(fps) / _BASE_FPS))


def compress_video(input_path: str | Path, resolution: str = "480", fps: str = "30",
                    on_progress=None, hw_accel=False) -> tuple[Path, float, int, int, float]:
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Video file not found: {input_path}")

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    temp_dir = Path("temp_video")
    temp_dir.mkdir(exist_ok=True)
    output_path = temp_dir / f"{input_path.stem}_{suffix}.mp4"

    check_ffmpeg()

    w = RES_MAP.get(resolution, 854)
    h = int(w * 9 / 16)
    h = h + (h % 2)

    hw_enc = hw_accel and detect_hw_encoder()
    if hw_enc:
        cmd = [
            "ffmpeg", "-hwaccel", "videotoolbox",
            "-i", str(input_path),
            "-vf", f"scale={w}:{h},fps={fps}",
            "-c:v", "libx264", "-crf", "28", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "64k",
            "-y",
            str(output_path),
        ]
    else:
        cmd = [
            "ffmpeg", "-i", str(input_path),
            "-vf", f"scale={w}:{h},fps={fps}",
            "-c:v", "libx264", "-crf", "28", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "64k",
            "-y",
            str(output_path),
        ]

    print(f"Compressing video to {resolution}p {fps}fps: {input_path.name} -> {output_path.name}")
    import time
    t0 = time.time()

    duration = _get_duration(input_path)
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, text=True)
    for line in proc.stderr:
        if duration and on_progress:
            t = _parse_ffmpeg_time(line)
            if t is not None:
                on_progress(min(t / duration * 100, 99.9))
    proc.wait()
    elapsed = time.time() - t0

    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode})")

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Compressed: {size_mb:.1f}MB")

    return output_path, elapsed, w, h, fps


def compress_image(input_path: str | Path, max_long_edge: int = 1920) -> tuple[Path, float]:
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Image file not found: {input_path}")

    import time
    t0 = time.time()

    ext = input_path.suffix.lower()
    if ext in RAW_EXTS:
        import rawpy
        with rawpy.imread(str(input_path)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB)
            img = Image.fromarray(rgb)
    else:
        img = Image.open(input_path)
        if img.mode in ("I", "I;16", "I;16L", "I;16B", "CMYK", "YCbCr"):
            img = img.convert("RGB")

    w, h = img.size
    long_edge = max(w, h)
    if long_edge > max_long_edge:
        scale = max_long_edge / long_edge
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    else:
        new_w, new_h = w, h

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    temp_dir = Path("temp_video")
    temp_dir.mkdir(exist_ok=True)
    output_path = temp_dir / f"{input_path.stem}_{suffix}.jpg"

    img.save(output_path, "JPEG", quality=85)

    elapsed = time.time() - t0
    size_kb = output_path.stat().st_size / 1024
    print(f"Compressed image: {w}x{h} -> {new_w}x{new_h}, {size_kb:.0f}KB")

    return output_path, elapsed
