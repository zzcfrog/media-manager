import subprocess
import shutil
from datetime import datetime
from pathlib import Path


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
