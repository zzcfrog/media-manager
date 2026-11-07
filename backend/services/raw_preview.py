"""Camera previews for display and face input; originals are always read-only."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageOps

from ..config import DATA_DIR

PREVIEW_DIR = DATA_DIR / 'raw-previews'
MAX_EDGE = 2560
MIN_EDGE = 1600


def cache_path(path, size, mtime):
    key = json.dumps([str(path), int(size), repr(float(mtime))])
    return PREVIEW_DIR / (hashlib.sha256(key.encode()).hexdigest() + '.jpg')


def cached_preview(row):
    if 'file_size' not in row.keys() or 'file_mtime' not in row.keys() or row['file_size'] is None or row['file_mtime'] is None:
        return None
    path = cache_path(row['file_path'], row['file_size'], row['file_mtime'])
    if path.is_symlink() or not path.is_file():
        return None
    try:
        with Image.open(path) as image:
            if max(image.size) >= MIN_EDGE:
                return path
    except (OSError, ValueError):
        pass
    return None


def orient(image, orientation):
    operations = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
                  4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
                  6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
                  8: Image.Transpose.ROTATE_90}
    return image.transpose(operations[orientation]) if orientation in operations else image.copy()


def save_preview(path, image, orientation=1, stamp=None):
    """Keep a bounded, oriented preview, without upscaling a small thumbnail."""
    if max(image.size) < MIN_EDGE:
        return None
    stamp = stamp or path.stat()
    output = cache_path(path, stamp.st_size, stamp.st_mtime)
    picture = orient(image, orientation).convert('RGB')
    picture.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=PREVIEW_DIR, suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            picture.save(stream, format='JPEG', quality=93)
        current = path.stat()
        if (current.st_size, current.st_mtime_ns) != (stamp.st_size, stamp.st_mtime_ns):
            raise FileNotFoundError('RAW 原文件已变化，请重新读取')
        os.replace(temporary, output)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return picture


def read_preview(path):
    path = Path(path)
    stamp = path.stat()
    cached = cached_preview({'file_path': str(path), 'file_size': stamp.st_size, 'file_mtime': stamp.st_mtime})
    if cached:
        try:
            with Image.open(cached) as image:
                return image.convert('RGB')
        except (OSError,ValueError):
            pass
    try:
        result = subprocess.run(['exiftool', '-n', '-s3', '-Orientation', str(path)], capture_output=True, timeout=15)
        orientation = int(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip() else None
    except (OSError, ValueError, subprocess.SubprocessError):
        orientation = None
    for tag in ('JpgFromRaw', 'PreviewImage'):
        try:
            result = subprocess.run(['exiftool', '-b', '-'+tag, str(path)], capture_output=True, timeout=15)
            if result.returncode != 0:
                continue
            with Image.open(io.BytesIO(result.stdout)) as image:
                if max(image.size) < MIN_EDGE:
                    continue
                image.draft('RGB', (MAX_EDGE, MAX_EDGE))
                picture = orient(image, orientation) if orientation is not None else ImageOps.exif_transpose(image)
                return save_preview(path, picture, stamp=stamp)
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
    # Small/absent/corrupt camera JPEGs must not become the identity input.
    import rawpy
    try:
        with rawpy.imread(str(path)) as raw:
            pixels = raw.postprocess(use_camera_wb=True, half_size=False, output_color=rawpy.ColorSpace.sRGB)
        picture = save_preview(path, Image.fromarray(pixels), stamp=stamp)
        if picture is not None:
            return picture
    except (OSError, ValueError, RuntimeError, rawpy.LibRawError) as exc:
        raise FileNotFoundError('RAW 高清预览解码失败，等待可用原片') from exc
    raise FileNotFoundError('RAW 没有足够清晰的预览，等待可用原片')
