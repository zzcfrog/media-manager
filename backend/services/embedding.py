import io
import shutil
import subprocess
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from torchvision import transforms
from ..config import RAW_EXTS

_ort_session = None
_MODEL_PATH = Path(__file__).parent.parent / "models" / "resnet50.onnx"
_FFMPEG_TIMEOUT = 60

_TRANSFORM = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

_HEIF_EXTS = {".heic", ".heif", ".hif", ".avif"}

_UNUSUAL_MODES = ("I", "I;16", "I;16L", "I;16B", "CMYK", "YCbCr")


def _get_session():
    global _ort_session
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
    except Exception:
        pass
    return img


def compute_embedding(filepath, media_type: str = "image", duration: float = None) -> bytes | None:
    """Extract ResNet50 feature vector (2048-d, L2-normalized) as bytes."""
    filepath = Path(filepath)
    if not filepath.exists():
        return None
    img = _load_image(filepath, media_type, duration)
    if img is None:
        return None
    try:
        tensor = _TRANSFORM(img.convert("RGB")).unsqueeze(0).numpy()
        output = _get_session().run(None, {"input": tensor})[0]
        vec = output.flatten()
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.astype(np.float32).tobytes()
    except Exception:
        return None
