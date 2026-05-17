"""Migrate legacy output/*_analysis.json files into SQLite media_segment table."""

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from backend.config import DB_PATH, OUTPUT_DIR


def migrate():
    if not OUTPUT_DIR.exists():
        print("No output/ directory found.")
        return

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    json_files = sorted(OUTPUT_DIR.glob("*_analysis*.json"))
    if not json_files:
        print("No analysis JSON files found.")
        return

    migrated = 0
    for jf in json_files:
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  SKIP {jf.name}: parse error ({e})")
            continue

        source = data.get("source_video", "")
        segments = data.get("segments", [])
        if not source:
            print(f"  SKIP {jf.name}: no source_video")
            continue

        source_path = Path(source)
        file_name = source_path.name

        existing = db.execute("SELECT id FROM media WHERE file_path = ?", (source,)).fetchone()
        if existing:
            media_id = existing["id"]
            print(f"  FOUND {file_name} (id={media_id})")
        else:
            media_type = "video"
            ext = source_path.suffix.lower()
            if ext in {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".bmp", ".tiff"}:
                media_type = "image"

            cur = db.execute(
                "INSERT INTO media (file_path, file_name, media_type, file_size, analysis_status) VALUES (?, ?, ?, 0, 'done')",
                (source, file_name, media_type),
            )
            media_id = cur.lastrowid
            print(f"  IMPORT {file_name} (id={media_id})")

        # Clear old segments and insert new
        db.execute("DELETE FROM media_segment WHERE media_id = ?", (media_id,))
        for i, seg in enumerate(segments):
            db.execute(
                "INSERT INTO media_segment (media_id, time_start, time_end, visual, asr, subtitle, dominant_colors, main_subjects, shot_type, focal_length, camera_angle, camera_movement, perspective, scene_type, mood, lighting, weather, seq) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    media_id,
                    seg.get("time_start", ""),
                    seg.get("time_end", ""),
                    seg.get("visual", ""),
                    seg.get("asr", "") or seg.get("dialogue", ""),
                    seg.get("subtitle", ""),
                    json.dumps(seg.get("dominant_colors", []), ensure_ascii=False),
                    json.dumps(seg.get("main_subjects", []), ensure_ascii=False),
                    seg.get("shot_type", ""),
                    seg.get("focal_length", ""),
                    seg.get("camera_angle", ""),
                    seg.get("camera_movement", ""),
                    seg.get("perspective", ""),
                    seg.get("scene_type", ""),
                    seg.get("mood", ""),
                    seg.get("lighting", ""),
                    seg.get("weather", ""),
                    i,
                ),
            )

        db.execute(
            "UPDATE media SET analysis_status = 'done', updated_at = datetime('now') WHERE id = ?",
            (media_id,),
        )
        _refresh_fts(db, media_id, file_name, segments)
        migrated += 1

    db.commit()
    db.close()
    print(f"\nDone: {migrated} files migrated.")


def _refresh_fts(db, media_id, file_name, segments):
    visual, asr, subtitle = [], [], []
    subjects, colors = set(), set()
    for seg in segments:
        if seg.get("visual"):
            visual.append(seg["visual"])
        _asr = seg.get("asr", "") or seg.get("dialogue", "")
        if _asr and _asr != "无":
            asr.append(_asr)
        if seg.get("subtitle") and seg["subtitle"] != "无":
            subtitle.append(seg["subtitle"])
        for s in seg.get("main_subjects", []):
            subjects.add(s)
        for c in seg.get("dominant_colors", []):
            colors.add(c)

    tag_rows = db.execute(
        "SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_id = ?",
        (media_id,),
    ).fetchall()
    tags_str = " ".join(r["name"] for r in tag_rows)

    db.execute("DELETE FROM media_fts WHERE media_id = ?", (media_id,))
    db.execute(
        "INSERT INTO media_fts (media_id, file_name, visual, asr, subtitle, subjects, colors, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (media_id, file_name, " ".join(visual), " ".join(asr), " ".join(subtitle), " ".join(subjects), " ".join(colors), tags_str),
    )


if __name__ == "__main__":
    migrate()
