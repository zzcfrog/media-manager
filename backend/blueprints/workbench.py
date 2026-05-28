from flask import Blueprint, jsonify, request
from ..db import get_db

bp = Blueprint("workbench", __name__)

_SEG_COLS = (
    "ms.id, ms.media_id, ms.time_start, ms.time_end, ms.visual, ms.asr, ms.subtitle, "
    "ms.dominant_colors, ms.main_subjects, ms.shot_type, ms.focal_length, ms.camera_angle, "
    "ms.camera_movement, ms.perspective, ms.scene_type, ms.mood, ms.lighting, ms.weather, "
    "ms.color_tone, ms.tone, ms.dof, ms.style, ms.composition, ms.seq"
)


def _segment_to_dict(r):
    d = dict(r)
    for k in ("dominant_colors", "main_subjects"):
        v = d.get(k, "")
        if v and isinstance(v, str):
            try:
                import json
                d[k] = json.loads(v)
            except (ValueError, TypeError):
                d[k] = v
    return d


# ── Project CRUD ──────────────────────────────────────────────


@bp.route("/")
def list_projects():
    db = get_db()
    rows = db.execute(
        "SELECT p.*, (SELECT COUNT(*) FROM project_media WHERE project_id = p.id) AS media_count "
        "FROM projects p ORDER BY p.updated_at DESC"
    ).fetchall()
    return jsonify({"data": [dict(r) for r in rows]})


@bp.route("/", methods=["POST"])
def create_project():
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    description = data.get("description", "")
    media_ids = data.get("media_ids", [])

    db = get_db()
    cur = db.execute(
        "INSERT INTO projects (name, description) VALUES (?, ?)", (name, description)
    )
    project_id = cur.lastrowid
    for mid in media_ids:
        db.execute(
            "INSERT OR IGNORE INTO project_media (project_id, media_id) VALUES (?, ?)",
            (project_id, mid),
        )
    db.commit()

    row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    result = dict(row)
    result["media_count"] = len(media_ids)
    return jsonify({"data": result}), 201


@bp.route("/<int:pid>")
def get_project(pid):
    db = get_db()
    proj = db.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    result = dict(proj)
    q = request.args.get("q", "").strip()
    if q:
        from blueprints.library import _segment_query
        seg_q = _segment_query(q)
        media = db.execute(
            "SELECT m.id, m.file_name, m.media_type, m.thumbnail_path, m.duration, m.date_taken "
            "FROM media m JOIN project_media pm ON pm.media_id = m.id "
            "JOIN media_fts fts ON fts.media_id = m.id "
            "WHERE pm.project_id = ? AND media_fts MATCH ?",
            (pid, seg_q),
        ).fetchall()
    else:
        media = db.execute(
            "SELECT m.id, m.file_name, m.media_type, m.thumbnail_path, m.duration, m.date_taken "
            "FROM media m JOIN project_media pm ON pm.media_id = m.id "
            "WHERE pm.project_id = ?",
            (pid,),
        ).fetchall()
    result["media"] = [dict(r) for r in media]
    result["media_count"] = len(media)
    return jsonify({"data": result})


@bp.route("/<int:pid>", methods=["PATCH"])
def update_project(pid):
    data = request.json or {}
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    fields = []
    params = []
    for col in ("name", "description"):
        if col in data:
            fields.append(f"{col} = ?")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "No fields to update"}), 400
    fields.append("updated_at = datetime('now')")
    params.append(pid)
    db.execute(f"UPDATE projects SET {', '.join(fields)} WHERE id = ?", params)
    db.commit()
    return jsonify({"ok": True})


@bp.route("/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    db.execute("DELETE FROM projects WHERE id = ?", (pid,))
    db.commit()
    return jsonify({"ok": True})


# ── Project Segments ──────────────────────────────────────────


@bp.route("/<int:pid>/segments")
def get_project_segments(pid):
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    rows = db.execute(
        f"SELECT {_SEG_COLS}, m.file_name, m.media_type, m.thumbnail_path "
        "FROM media_segment ms "
        "JOIN project_media pm ON pm.media_id = ms.media_id "
        "JOIN media m ON m.id = ms.media_id "
        "WHERE pm.project_id = ? ORDER BY ms.media_id, ms.seq",
        (pid,),
    ).fetchall()
    return jsonify({"data": [_segment_to_dict(r) for r in rows]})


# ── Project Tracks ────────────────────────────────────────────


@bp.route("/<int:pid>/tracks")
def get_project_tracks(pid):
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    rows = db.execute(
        "SELECT * FROM project_tracks WHERE project_id = ? AND version = 1 ORDER BY position",
        (pid,),
    ).fetchall()
    return jsonify({"data": [dict(r) for r in rows]})


@bp.route("/<int:pid>/tracks", methods=["PUT"])
def replace_project_tracks(pid):
    """Atomic batch replace of all tracks for a project."""
    data = request.json or {}
    tracks = data.get("tracks", [])
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    db.execute("DELETE FROM project_tracks WHERE project_id = ? AND version = 1", (pid,))
    for i, tr in enumerate(tracks):
        db.execute(
            "INSERT INTO project_tracks "
            "(project_id, version, position, track_type, segment_id, content, "
            "time_start, time_end, emotion_value, metadata) "
            "VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                pid,
                i,
                tr.get("track_type", "video"),
                tr.get("segment_id"),
                tr.get("content", ""),
                tr.get("time_start", ""),
                tr.get("time_end", ""),
                tr.get("emotion_value", 0.5),
                tr.get("metadata", "{}"),
            ),
        )
    db.execute("UPDATE projects SET updated_at = datetime('now') WHERE id = ?", (pid,))
    db.commit()
    return jsonify({"ok": True})


# ── Project Media ─────────────────────────────────────────────


@bp.route("/<int:pid>/media", methods=["PUT"])
def update_project_media(pid):
    """Replace the media set for a project."""
    data = request.json or {}
    media_ids = data.get("media_ids", [])
    db = get_db()
    proj = db.execute("SELECT id FROM projects WHERE id = ?", (pid,)).fetchone()
    if not proj:
        return jsonify({"error": "Not found"}), 404
    db.execute("DELETE FROM project_media WHERE project_id = ?", (pid,))
    for mid in media_ids:
        db.execute(
            "INSERT OR IGNORE INTO project_media (project_id, media_id) VALUES (?, ?)",
            (pid, mid),
        )
    db.execute("UPDATE projects SET updated_at = datetime('now') WHERE id = ?", (pid,))
    db.commit()
    return jsonify({"ok": True})
