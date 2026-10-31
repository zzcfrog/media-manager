import io
import shutil
import subprocess
import threading
from pathlib import Path

from loguru import logger
import numpy as np
import onnxruntime as ort
from PIL import Image
from ..config import RAW_EXTS, MODELS_ROOT

_ort_session = None
_session_lock = threading.Lock()
_MODEL_PATH = MODELS_ROOT / "resnet50.onnx"
_FFMPEG_TIMEOUT = 60

_IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
_IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]


def _preprocess_image(image):
    """Match the previous PIL-based torchvision pipeline, including crop rounding."""
    width, height = image.size
    size = (256, int(256 * height / width)) if width <= height else (int(256 * width / height), 256)
    image = image.resize(size, Image.Resampling.BILINEAR)
    left = int(round((size[0] - 224) / 2.0))
    top = int(round((size[1] - 224) / 2.0))
    image = image.crop((left, top, left + 224, top + 224))
    tensor = np.asarray(image, dtype=np.float32).transpose(2, 0, 1).copy()
    tensor /= np.float32(255)
    tensor -= _IMAGE_MEAN
    tensor /= _IMAGE_STD
    return tensor[None]

_HEIF_EXTS = {".heic", ".heif", ".hif", ".avif"}

_UNUSUAL_MODES = ("I", "I;16", "I;16L", "I;16B", "CMYK", "YCbCr")


def _get_session():
    global _ort_session
    if _ort_session is None:
        with _session_lock:
            if _ort_session is None:
                providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
                _ort_session = ort.InferenceSession(str(_MODEL_PATH), providers=providers)
    return _ort_session


def _load_image(filepath: Path, media_type: str, duration: float = None):
    """Load a PIL Image from any supported media file."""
    img = None
    try:
        if media_type == "video" and shutil.which("ffmpeg"):
            ss = str(duration / 2) if duration else "1"
            cmd = ["ffmpeg", "-i", str(filepath), "-ss", ss, "-frames:v", "1",
                   "-vf", "scale=224:-1", "-f", "image2pipe", "-vcodec", "png", "-"]
            result = subprocess.run(cmd, capture_output=True, timeout=_FFMPEG_TIMEOUT)
            if result.returncode == 0 and result.stdout:
                img = Image.open(io.BytesIO(result.stdout))
        elif media_type == "image":
            ext = filepath.suffix.lower()
            try:
                if ext in RAW_EXTS:
                    import rawpy
                    with rawpy.imread(str(filepath)) as raw:
                        rgb = raw.postprocess(use_camera_wb=True, output_color=rawpy.ColorSpace.sRGB)
                        img = Image.fromarray(rgb)
                elif ext in _HEIF_EXTS:
                    try:
                        from pillow_heif import register_heif_opener
                        register_heif_opener()
                    except ImportError:
                        pass
                    img = Image.open(filepath)
                else:
                    img = Image.open(filepath)
                if img and img.mode in _UNUSUAL_MODES:
                    img = img.convert("RGB")
            except Exception:
                if shutil.which("ffmpeg"):
                    cmd = ["ffmpeg", "-i", str(filepath), "-vf", "scale=224:-1",
                           "-f", "image2pipe", "-vcodec", "png", "-"]
                    result = subprocess.run(cmd, capture_output=True, timeout=_FFMPEG_TIMEOUT)
                    if result.returncode == 0 and result.stdout:
                        img = Image.open(io.BytesIO(result.stdout))
    except Exception as e:
        logger.error("Failed to load image: {}", filepath)
    return img


def compute_embedding(filepath, media_type: str = "image", duration: float = None, image=None) -> bytes | None:
    """Extract ResNet50 feature vector (2048-d, L2-normalized) as bytes."""
    filepath = Path(filepath)
    if not filepath.exists():
        return None
    img = image if image is not None else _load_image(filepath, media_type, duration)
    if img is None:
        return None
    try:
        tensor = _preprocess_image(img.convert("RGB"))
        output = _get_session().run(None, {"input": tensor})[0]
        vec = output.flatten()
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.astype(np.float32).tobytes()
    except Exception as e:
        logger.error("Embedding computation failed: {}", e)
        return None
