import json
import shutil
import subprocess
from pathlib import Path

from loguru import logger


def xmp_path(filepath: Path) -> Path:
    # Adobe/Lightroom standard: photo.xmp (replaces extension)
    return filepath.with_suffix(".xmp")


def has_xmp(filepath: Path) -> bool:
    return xmp_path(filepath).exists()


def _read_xmp_fields(xp: Path) -> dict:
    r = subprocess.run(
        ["exiftool", "-json", "-XMP-dc:Subject", "-XMP-dc:Description", str(xp)],
        capture_output=True, text=True, timeout=10,
    )
    if r.returncode != 0:
        return {}
    try:
        data = json.loads(r.stdout)
        if data and isinstance(data, list):
            return data[0]
    except (json.JSONDecodeError, IndexError) as e:
        logger.error("Failed to parse exiftool output: {}", e)
    return {}


def write_xmp(filepath: Path, rating: int = 0, tags: list[str] | None = None,
               description: str = "", color_label: str | None = None) -> bool:
    if not shutil.which("exiftool"):
        raise RuntimeError("exiftool not found")

    xp = xmp_path(filepath)

    if not xp.exists():
        r = subprocess.run(
            ["exiftool", "-o", str(xp), str(filepath)],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0 or not xp.exists():
            return False

    # Read existing XMP tags and description to merge
    existing = _read_xmp_fields(xp) if xp.exists() else {}

    # Merge tags: existing + new, dedup (preserve order, new tags first)
    existing_tags = existing.get("Subject") or []
    if isinstance(existing_tags, str):
        existing_tags = [existing_tags]
    existing_set = {t.lower() for t in existing_tags}
    merged_tags = list(tags) if tags else []
    for t in existing_tags:
        if t.lower() not in {x.lower() for x in merged_tags}:
            merged_tags.append(t)

    # Merge description: if existing is empty, use ours; otherwise append ours
    existing_desc = (existing.get("Description") or "").strip()
    if description and existing_desc:
        if description.lower() not in existing_desc.lower():
            merged_desc = existing_desc + "\n" + description
        else:
            merged_desc = existing_desc
    elif description:
        merged_desc = description
    else:
        merged_desc = existing_desc

    # Clear old tags, then write merged
    subprocess.run(
        ["exiftool", "-overwrite_original", "-XMP-dc:Subject=", str(xp)],
        capture_output=True, text=True, timeout=15,
    )

    cmd = ["exiftool", "-overwrite_original"]

    if rating and rating > 0:
        cmd.append(f"-xmp:Rating={rating}")
    else:
        cmd.append("-xmp:Rating=")

    for t in merged_tags:
        cmd.append(f"-XMP-dc:Subject={t}")

    if merged_desc:
        cmd.append(f"-XMP-dc:Description={merged_desc}")
    else:
        cmd.append("-XMP-dc:Description=")

    if color_label:
        label_map = {"red": "红色", "yellow": "黄色", "green": "绿色", "blue": "蓝色", "purple": "紫色"}
        label_val = label_map.get(color_label.lower(), color_label.capitalize())
        cmd.append(f"-xmp:Label={label_val}")
    else:
        cmd.append("-xmp:Label=")

    cmd.append(str(xp))

    r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    return r.returncode == 0
