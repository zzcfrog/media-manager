"""导出工程为 FCPXML（Final Cut Pro XML）。

FCPXML 是苹果文档化的开放交换格式，可被 剪映专业版（导入工程）、DaVinci Resolve、
Final Cut Pro 直接导入。本模块把工程的时间线（分镜视频片段，带 src 入出点）展开成
一条 sequence/spine 上的 asset-clip。字幕/旁白文字暂以独立 SRT 导出（见 build_srt），
避免 FCPXML title 的 effect 引用在各编辑器间兼容性不稳。

时间采用微秒有理数 "N/1000000s"（FCPXML time 为有理秒数）。
"""
import json
import os
import re
import subprocess
from urllib.parse import quote

from .db import get_db


def _parse_time(s):
    """'MM:SS.ss' 或 'HH:MM:SS.ss' → 秒。与 creative._parse_time 一致。"""
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


def _r(seconds):
    """秒 → FCPXML 有理时间 "N/1000000s"。"""
    return f"{int(round(seconds * 1_000_000))}/1000000s"


def _safe_name(name):
    name = (name or "").strip() or "draft"
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def _esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _file_url(path):
    """绝对路径 → file:// URL（空格等做百分号编码）。"""
    return "file://" + quote(path)


def _probe_dims(path):
    """ffprobe 取首个视频流的 width/height；失败回退 1920×1080。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        w, h = out.split(",")
        return int(w), int(h)
    except Exception:
        return 1920, 1080


def build_fcpxml(pid, name):
    """把工程 pid 的分镜时间线导出为 FCPXML 字符串。

    返回 ``{"ok", "name", "xml", "warnings"}``。
    """
    db = get_db()
    proj = db.execute("SELECT id, name FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        raise ValueError("project not found")
    name = _safe_name(name or proj["name"])

    seg2media = {
        r["id"]: r["media_id"]
        for r in db.execute(
            "SELECT ms.id, ms.media_id FROM media_segment ms "
            "JOIN project_media pm ON pm.media_id = ms.media_id WHERE pm.project_id = ?",
            (pid,),
        )
    }
    media = {
        r["id"]: dict(r)
        for r in db.execute("SELECT id, file_path, file_name, duration, media_type FROM media")
    }

    rows = db.execute(
        "SELECT track_type, segment_id, content, time_start, time_end, metadata "
        "FROM project_tracks WHERE project_id = ? AND version = 1 ORDER BY position",
        (pid,),
    ).fetchall()

    videos = []
    for r in rows:
        if r["track_type"] != "video":
            continue
        meta = {}
        try:
            meta = json.loads(r["metadata"] or "{}")
        except (ValueError, TypeError):
            meta = {}
        videos.append((r, meta))

    warnings = []
    # 预扫：取首个可读素材的尺寸定画布比例，并登记用到的 asset。
    canvas_w, canvas_h = 1920, 1080
    canvas_set = False
    asset_entries = []  # (media_id, path, name, duration_str, uid)
    seen_media = {}
    clips = []  # (asset_index, name, offset_s, src_start_s, dur_s)
    for r, meta in videos:
        media_id = seg2media.get(r["segment_id"]) or meta.get("srcMediaId")
        m = media.get(media_id)
        if not m or not m.get("file_path") or not os.path.exists(m["file_path"]):
            warnings.append(f"视频片段缺失素材文件（segment {r['segment_id']}），已跳过")
            continue
        path = m["file_path"]
        src_s = _parse_time(meta.get("srcStart"))
        src_e = _parse_time(meta.get("srcEnd"))
        if src_e <= src_s:
            src_s, src_e = _parse_time(r["time_start"]), _parse_time(r["time_end"])
        dur = max(src_e - src_s, 0.1)
        offset_s = max(_parse_time(r["time_start"]), 0.0)
        if media_id not in seen_media:
            idx = len(asset_entries)
            seen_media[media_id] = idx
            asset_dur = _parse_time(m.get("duration")) or src_e
            asset_entries.append((media_id, path, m.get("file_name") or os.path.basename(path), asset_dur))
            if not canvas_set:
                w, h = _probe_dims(path)
                canvas_w, canvas_h = w, h
                canvas_set = True
        clips.append((seen_media[media_id], m.get("file_name") or os.path.basename(path),
                      offset_s, src_s, dur))

    # ── 组装 FCPXML ──
    frame_dur = "100/3000s"  # 30fps timebase
    rid = 1
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE fcpxml>', '<fcpxml version="1.10">']
    lines.append("  <resources>")
    fmt_id = f"r{rid}"; rid += 1
    lines.append(f'    <format id="{fmt_id}" name="FFVideoFormatCustom" '
                 f'frameDuration="{frame_dur}" width="{canvas_w}" height="{canvas_h}"/>')
    asset_ids = []
    for media_id, path, aname, adur in asset_entries:
        aid = f"r{rid}"; rid += 1
        asset_ids.append(aid)
        uid = f"asset-{media_id}"
        lines.append(f'    <asset id="{aid}" name="{_esc(aname)}" uid="{uid}" start="0s" '
                     f'duration="{_r(adur)}" hasVideo="1" hasAudio="1">'
                     f'<media-rep kind="original-media" sig="{uid}" src="{_file_url(path)}"/></asset>')
    lines.append("  </resources>")

    lines.append('  <library>')
    lines.append(f'    <event name="{_esc(name)}">')
    lines.append(f'      <project name="{_esc(name)}">')
    lines.append(f'        <sequence format="{fmt_id}" tcStart="0s" tcFormat="NDF" '
                 f'frameDuration="{frame_dur}" renderColorSpace="rec709">')
    lines.append("          <spine>")
    for aidx, cname, offset_s, src_s, dur in clips:
        lines.append(
            f'            <asset-clip ref="{asset_ids[aidx]}" name="{_esc(cname)}" '
            f'offset="{_r(offset_s)}" start="{_r(src_s)}" duration="{_r(dur)}" '
            f'format="{fmt_id}" tcFormat="NDF"/>'
        )
    lines.append("          </spine>")
    lines.append("        </sequence>")
    lines.append("      </project>")
    lines.append("    </event>")
    lines.append("  </library>")
    lines.append("</fcpxml>")
    xml = "\n".join(lines)
    return {"ok": True, "name": name, "xml": xml, "warnings": warnings}


def build_srt(pid):
    """把字幕 + 旁白文字导出为 SRT（剪映/Resolve/FCP 均可导入字幕）。"""
    db = get_db()
    rows = db.execute(
        "SELECT track_type, content, time_start, time_end "
        "FROM project_tracks WHERE project_id = ? AND version = 1 ORDER BY position",
        (pid,),
    ).fetchall()
    entries = []
    for r in rows:
        if r["track_type"] not in ("subtitle", "narration"):
            continue
        txt = (r["content"] or "").strip()
        if not txt:
            continue
        entries.append((_parse_time(r["time_start"]), _parse_time(r["time_end"]),
                        ("旁白" if r["track_type"] == "narration" else "") + txt))
    entries.sort(key=lambda e: e[0])

    def _hhmmss(t):
        if t < 0:
            t = 0
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3600000)
        m_, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m_:02d}:{s:02d},{ms:03d}"

    out = []
    for i, (s, e, txt) in enumerate(entries, 1):
        out.append(str(i))
        out.append(f"{_hhmmss(s)} --> {_hhmmss(e)}")
        out.append(txt)
        out.append("")
    return "\n".join(out)
