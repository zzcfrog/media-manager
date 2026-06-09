"""
重新分析指定项目的所有视频素材（使用新的 highlights 字段）。
用法: python scripts/reanalyze_project.py [项目名或ID]

示例:
  python scripts/reanalyze_project.py 青海
  python scripts/reanalyze_project.py 62
"""

import sys
import os
import json
import time
import sqlite3

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.db import get_setting
from backend.config import DATA_DIR


def _normalize_timestamp(ts: str) -> str:
    """Normalize timestamp to HH:MM:SS.ss format."""
    if not ts:
        return "00:00:00.00"
    ts = ts.strip()
    parts = ts.replace(",", ".").split(":")
    if len(parts) == 3:
        h, m, s = parts
        ss = float(s)
        mm = int(float(m)) + int(ss // 60)
        ss = ss % 60
        hh = int(float(h)) + mm // 60
        mm = mm % 60
        return f"{hh:02d}:{mm:02d}:{ss:05.2f}"
    elif len(parts) == 2:
        m, s = parts
        ss = float(s)
        mm = int(float(m)) + int(ss // 60)
        ss = ss % 60
        return f"00:{mm:02d}:{ss:05.2f}"
    return ts


def _ts_to_seconds(ts: str) -> float:
    parts = ts.strip().split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return float(ts)


def _fix_segment_overlaps(segments):
    segments.sort(key=lambda s: _ts_to_seconds(s.get("time_start", "0")))
    for i in range(1, len(segments)):
        prev_end = _ts_to_seconds(segments[i - 1]["time_end"])
        cur_start = _ts_to_seconds(segments[i]["time_start"])
        if cur_start < prev_end:
            segments[i]["time_start"] = segments[i - 1]["time_end"]


def main():
    if len(sys.argv) < 2:
        print("用法: python scripts/reanalyze_project.py [项目名或ID]")
        sys.exit(1)

    target = sys.argv[1]

    db_path = DATA_DIR / "media.db"
    db = sqlite3.connect(str(db_path))
    db.row_factory = sqlite3.Row

    # Find project
    if target.isdigit():
        project = db.execute("SELECT id, name FROM projects WHERE id = ?", (int(target),)).fetchone()
    else:
        project = db.execute("SELECT id, name FROM projects WHERE name LIKE ?", (f"%{target}%",)).fetchone()

    if not project:
        print(f"未找到项目: {target}")
        all_projects = db.execute("SELECT id, name FROM projects ORDER BY id").fetchall()
        print("可用项目:")
        for p in all_projects:
            print(f"  id={p['id']}, name={p['name']}")
        db.close()
        sys.exit(1)

    pid = project["id"]
    pname = project["name"]
    print(f"项目: {pname} (id={pid})")

    # Get all video media in this project
    media_rows = db.execute("""
        SELECT m.id, m.file_path, m.media_type, m.analysis_status, m.analysis_model
        FROM media m
        JOIN project_media pm ON pm.media_id = m.id
        WHERE pm.project_id = ?
        ORDER BY m.id
    """, (pid,)).fetchall()

    videos = [m for m in media_rows if m["media_type"] == "video"]
    images = [m for m in media_rows if m["media_type"] == "image"]

    print(f"素材总数: {len(media_rows)} (视频 {len(videos)}, 图片 {len(images)})")
    print(f"视频状态: 已分析 {sum(1 for v in videos if v['analysis_status']=='done')}, "
          f"其他 {sum(1 for v in videos if v['analysis_status']!='done')}")
    print()

    if not videos:
        print("没有视频素材，无需分析。")
        db.close()
        sys.exit(0)

    # Read settings
    api_key = get_setting(db, "video_api_key", "")
    model = get_setting(db, "model", "glm-4.1v")
    resolution = get_setting(db, "resolution", "480")
    fps = get_setting(db, "fps", "30")
    hw_accel = get_setting(db, "hw_accel", "false") == "true"
    use_multimodal = get_setting(db, "use_multimodal", "true") == "true"

    if not api_key:
        print("错误: 未配置 video_api_key，请在设置中配置 API Key")
        db.close()
        sys.exit(1)

    print(f"分析配置: model={model}, resolution={resolution}, fps={fps}, multimodal={use_multimodal}")
    print()

    # Import analysis modules (after confirming settings are valid)
    from backend.compressor import compress_video
    from backend.analyzer import analyze_video

    total = len(videos)
    success = 0
    failed = 0

    for i, media in enumerate(videos):
        mid = media["id"]
        fpath = media["file_path"]
        status = media["analysis_status"]
        print(f"[{i+1}/{total}] media_id={mid} (当前: {status})")

        if not os.path.exists(fpath):
            print(f"  ⚠ 文件不存在，跳过: {fpath}")
            failed += 1
            continue

        # Set processing status
        db.execute("UPDATE media SET analysis_status = 'processing' WHERE id = ?", (mid,))
        db.commit()

        try:
            # Step 1: Compress
            print(f"  压缩中...", end="", flush=True)
            t0 = time.time()
            compressed_path, _, _, _, _ = compress_video(
                fpath, resolution=resolution, fps=fps, hw_accel=hw_accel
            )
            print(f" {time.time()-t0:.1f}s")

            # Step 2: VLM Analyze
            print(f"  AI 分析中...", end="", flush=True)
            t0 = time.time()
            segments, elapsed, usage = analyze_video(
                str(compressed_path),
                api_key=api_key,
                model=model,
                multimodal=use_multimodal,
            )
            print(f" {time.time()-t0:.1f}s, {len(segments)} 个分片")

            # Step 3: Save
            db.execute("DELETE FROM media_segment WHERE media_id = ?", (mid,))
            _fix_segment_overlaps(segments)

            highlight_count = 0
            for seq, seg in enumerate(segments):
                highlights_data = json.dumps(seg.get("highlights", []), ensure_ascii=False) if seg.get("highlights") else ""
                if seg.get("highlights"):
                    highlight_count += 1
                db.execute(
                    "INSERT INTO media_segment "
                    "(media_id, time_start, time_end, visual, asr, subtitle, "
                    "dominant_colors, main_subjects, shot_type, focal_length, "
                    "camera_angle, camera_movement, perspective, scene_type, "
                    "mood, lighting, weather, color_tone, tone, dof, style, "
                    "composition, highlights, seq) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        mid,
                        _normalize_timestamp(seg.get("time_start", "")),
                        _normalize_timestamp(seg.get("time_end", "")),
                        seg.get("visual", ""),
                        seg.get("asr", ""),
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
                        seg.get("color_tone", ""),
                        seg.get("tone", ""),
                        seg.get("dof", ""),
                        seg.get("style", ""),
                        seg.get("composition", ""),
                        highlights_data,
                        seq,
                    ),
                )

            db.execute(
                "UPDATE media SET analysis_status = 'done', analysis_model = ?, "
                "analysis_date = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                (model, mid),
            )
            db.commit()
            db.execute("PRAGMA optimize")

            print(f"  ✓ 保存完成 (含 highlights: {highlight_count} 个长分片)")

            # Cleanup temp file
            try:
                os.unlink(str(compressed_path))
            except OSError:
                pass

            success += 1

        except Exception as e:
            print(f"  ✗ 分析失败: {e}")
            import traceback
            traceback.print_exc()
            db.execute("UPDATE media SET analysis_status = 'error' WHERE id = ?", (mid,))
            db.commit()
            failed += 1

    print()
    print(f"{'='*40}")
    print(f"分析完成: 成功 {success}, 失败 {failed}, 总计 {total}")
    db.close()


if __name__ == "__main__":
    main()
