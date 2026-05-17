import subprocess
import shutil
from datetime import datetime
from pathlib import Path
from PIL import Image


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


def compress_video(input_path: str | Path, resolution: str = "480", fps: str = "30") -> tuple[Path, float]:
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

    cmd = [
        "ffmpeg", "-i", str(input_path),
        "-vf", f"scale={w}:{h},fps={fps}",
        "-c:v", "libx264", "-crf", "28", "-preset", "fast",
        "-c:a", "aac", "-b:a", "64k",
        "-y",
        str(output_path),
    ]

    print(f"Compressing video to {resolution}p {fps}fps: {input_path.name} -> {output_path.name}")
    import time
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - t0
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Compressed: {size_mb:.1f}MB")

    return output_path, elapsed, w, h, fps


RAW_EXTENSIONS = {".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw", ".nrw", ".kdc", ".sr2", ".3fr", ".meF", ".iiq", ".erf", ".mef"}


def compress_image(input_path: str | Path, max_long_edge: int = 1920) -> tuple[Path, float]:
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Image file not found: {input_path}")

    import time
    t0 = time.time()

    ext = input_path.suffix.lower()
    if ext in RAW_EXTENSIONS:
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
