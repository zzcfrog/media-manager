from flask import Blueprint, request, jsonify

from loguru import logger

from ..db import get_db

bp = Blueprint("tags", __name__)


@bp.route("/")
def list_tags():
    db = get_db()
    rows = db.execute(
        "SELECT t.id, t.name, COUNT(mt.media_id) AS usage_count FROM tags t LEFT JOIN media_tags mt ON t.id = mt.tag_id GROUP BY t.id ORDER BY t.name"
    ).fetchall()
    return jsonify({"data": [dict(r) for r in rows]})


@bp.route("/", methods=["POST"])
def create_tag():
    db = get_db()
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    try:
        cur = db.execute("INSERT INTO tags (name) VALUES (?)", (name,))
        db.commit()
        return jsonify({"id": cur.lastrowid, "name": name}), 201
    except Exception as e:
        logger.warning("Tag creation failed (duplicate?): {}", e)
        return jsonify({"error": "Tag already exists"}), 409


@bp.route("/<int:tag_id>", methods=["DELETE"])
def delete_tag(tag_id):
    db = get_db()
    db.execute("DELETE FROM media_tags WHERE tag_id = ?", (tag_id,))
    db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/assign", methods=["POST"])
def assign_tags():
    db = get_db()
    data = request.get_json(silent=True) or {}
    media_id = data.get("media_id")
    tag_names = data.get("tags", [])
    if not media_id:
        return jsonify({"error": "media_id required"}), 400

    for name in tag_names:
        name = name.strip()
        if not name:
            continue
        row = db.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()
        if not row:
            cur = db.execute("INSERT INTO tags (name) VALUES (?)", (name,))
            tag_id = cur.lastrowid
        else:
            tag_id = row["id"]
        db.execute("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)", (media_id, tag_id))
    db.commit()
    return jsonify({"ok": True})
