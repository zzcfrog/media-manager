"""导出工程为剪映（JianYing）草稿。

依赖开源库 pyJianYingDraft（`pip install pyjianyingdraft`），由它在剪映草稿目录下生成
`draft_content.json` 等文件。VideoMaterial 经 pymediainfo 读取素材时长/尺寸，故运行环境
需装有 MediaInfo 库（macOS: `brew install mediainfo`）。
"""
import json
import os
import re

from .db import get_db

try:
    import pyJianYingDraft as J
    _HAS_JY = True
    _JY_IMPORT_ERR = ""
except Exception as e:  # pragma: no cover - 环境缺依赖时的兜底
    J = None
    _HAS_JY = False
    _JY_IMPORT_ERR = str(e)

SEC = 1_000_000  # 微秒/秒（== pyJianYingDraft.SEC）

# macOS 剪映 Pro 草稿默认目录
MAC_DRAFTS_DEFAULT = os.path.expanduser(
    "~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
)


def _parse_time(s):
    """'MM:SS.ss' 或 'HH:MM:SS.ss' → 秒。与 backend.blueprints.creative._parse_time 一致。"""
    if not s:
        return 0.0
    parts = str(s).split(":")
    try:
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    except (ValueError, TypeError):
        return 0.0
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def _us(sec):
    """秒 → 微秒（int）。"""
    return int(round(sec * SEC))


def resolve_drafts_dir(db=None):
    """剪映草稿目录解析：settings 表 jianying_drafts_dir > 环境变量 JIANYING_DRAFTS_DIR > macOS 默认。"""
    if db is not None:
        try:
            row = db.execute("SELECT value FROM settings WHERE key='jianying_drafts_dir'").fetchone()
            if row and row["value"]:
                return os.path.expanduser(row["value"])
        except Exception:
            pass
    env = os.environ.get("JIANYING_DRAFTS_DIR")
    if env:
        return os.path.expanduser(env)
    return MAC_DRAFTS_DEFAULT


def _safe_name(name):
    """草稿名 → 合法文件夹名。"""
    name = (name or "").strip() or "draft"
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def build_draft(pid, name, drafts_dir):
    """把工程 pid 展开成剪映草稿，写入 drafts_dir/<name>/。

    返回 ``{"ok", "name", "path", "warnings"}``；缺素材的分镜计入 warnings 并跳过。
    """
    if not _HAS_JY:
        raise RuntimeError(f"pyJianYingDraft 不可用：{_JY_IMPORT_ERR}")

    db = get_db()
    proj = db.execute("SELECT id, name FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        raise ValueError("project not found")
    name = _safe_name(name or proj["name"])

    # segment_id → media_id → file_path 映射
    seg2media = {
        r["id"]: r["media_id"]
        for r in db.execute(
            "SELECT ms.id, ms.media_id FROM media_segment ms "
            "JOIN project_media pm ON pm.media_id = ms.media_id WHERE pm.project_id = ?",
            (pid,),
        )
    }
    media2path = {r["id"]: r["file_path"] for r in db.execute("SELECT id, file_path FROM media")}

    rows = db.execute(
        "SELECT track_type, segment_id, content, time_start, time_end, metadata "
        "FROM project_tracks WHERE project_id = ? AND version = 1 ORDER BY position",
        (pid,),
    ).fetchall()

    videos, subtitles, narrations = [], [], []
    for r in rows:
        if r["track_type"] == "video":
            meta = {}
            try:
                meta = json.loads(r["metadata"] or "{}")
            except (ValueError, TypeError):
                meta = {}
            videos.append((r, meta))
        elif r["track_type"] == "subtitle":
            subtitles.append(r)
        elif r["track_type"] == "narration":
            narrations.append(r)

    folder = J.DraftFolder(drafts_dir)
    script = folder.create_draft(name, 1920, 1080, fps=30, allow_replace=True)
    script.add_track(J.TrackType.video)  # 主视频轨（首段须从 0s 起）

    warnings = []
    for r, meta in videos:
        media_id = seg2media.get(r["segment_id"]) or meta.get("srcMediaId")
        path = media2path.get(media_id)
        if not path or not os.path.exists(path):
            warnings.append(f"视频片段缺失素材文件（segment {r['segment_id']}），已跳过")
            continue
        # 源入/出点 = 绝对媒体时间戳（与 segment.time_start 同坐标系）
        src_s = _parse_time(meta.get("srcStart"))
        src_e = _parse_time(meta.get("srcEnd"))
        if src_e <= src_s:  # 退化：用片段自身区间
            src_s, src_e = _parse_time(r["time_start"]), _parse_time(r["time_end"])
        dur = max(src_e - src_s, 0.1)
        target_s = max(_parse_time(r["time_start"]), 0.0)
        try:
            mat = J.VideoMaterial(path)  # 经 pymediainfo 读时长/尺寸
        except Exception as e:
            warnings.append(f"读取素材失败 {os.path.basename(path)}：{e}，已跳过")
            continue
        src_dur_us = min(_us(dur), max(mat.duration - _us(src_s), 1))  # 钳到素材时长，避免越界
        src_tr = J.Timerange(_us(src_s), src_dur_us)
        tgt_tr = J.Timerange(_us(target_s), src_dur_us)
        script.add_segment(J.VideoSegment(mat, tgt_tr, source_timerange=src_tr))

    _add_text_track(script, "subtitle", subtitles)
    _add_text_track(script, "narration", narrations)

    script.save()
    return {"ok": True, "name": name, "path": os.path.join(drafts_dir, name), "warnings": warnings}


def _add_text_track(script, track_name, rows):
    """把字幕/旁白文字段加到一条 text 轨。空内容跳过。"""
    if not rows:
        return
    script.add_track(J.TrackType.text, track_name)
    for r in rows:
        txt = (r["content"] or "").strip()
        if not txt:
            continue
        s = _parse_time(r["time_start"])
        dur = max(_parse_time(r["time_end"]) - s, 0.1)
        script.add_segment(J.TextSegment(txt, J.Timerange(_us(s), _us(dur))), track_name)
