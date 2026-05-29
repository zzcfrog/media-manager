import os
import sys
from pathlib import Path

# Paths and file-extension constants used across the backend.
BASE_DIR = Path(__file__).parent.parent

# User data directory: use ~/.media-manager/ when packaged, local data/ in dev
if os.environ.get("MEDIA_MANAGER_HOME"):
    DATA_DIR = Path(os.environ["MEDIA_MANAGER_HOME"])
elif getattr(sys, "frozen", False):
    DATA_DIR = Path.home() / ".media-manager"
else:
    DATA_DIR = BASE_DIR / "data"
THUMB_DIR = DATA_DIR / "thumbnails"
DB_PATH = DATA_DIR / "media.db"
LOG_DIR = DATA_DIR / "logs"

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv", ".wmv", ".3gp", ".mts", ".m2ts"}
IMAGE_EXTS = {
    # Common
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif",
    # HEIC/HEIF (Apple, modern cameras)
    ".heic", ".heif", ".hif",
    # AVIF
    ".avif",
    # Adobe DNG / Leica
    ".dng",
    # Canon
    ".cr2", ".cr3", ".crw",
    # Nikon
    ".nef", ".nrw",
    # Sony
    ".arw", ".srf", ".sr2",
    # Fujifilm
    ".raf",
    # Olympus/OM System
    ".orf",
    # Panasonic/Leica
    ".raw", ".rw2", ".rwl",
    # Hasselblad
    ".3fr", ".fff",
    # Phase One
    ".iiq",
    # Pentax/Ricoh
    ".pef",
    # Sigma
    ".x3f",
    # Samsung
    ".srw",
    # Mamiya/Leaf
    ".mef", ".mos",
    # Kodak
    ".kdc", ".dcr",
    # Minolta
    ".mrw",
    # Apple ProRAW
    ".proraw",
}

# RAW formats = everything except common non-RAW image formats
HEIF_EXTS = {".heic", ".heif", ".hif", ".avif"}
RAW_EXTS = IMAGE_EXTS - {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif"} - HEIF_EXTS

# ── Analysis concurrency ──────────────────────────────────────
# Max concurrent VLM (visual-language model) API calls during batch analysis.
# Increase only if your model API supports parallel requests without rate-limiting.
ANALYSIS_API_CONCURRENCY = 1

# Thread pool size for batch analysis. Each worker handles one media item through
# the full pipeline (compress → VLM → ASR → save). I/O tasks (compress, ASR) can
# run in parallel across workers; VLM calls are gated by ANALYSIS_API_CONCURRENCY.
ANALYSIS_THREAD_POOL_SIZE = 5
