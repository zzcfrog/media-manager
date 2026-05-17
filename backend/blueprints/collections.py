from flask import Blueprint, request, jsonify

from ..db import get_db

bp = Blueprint("collections", __name__)


@bp.route("/")
def list_collections():
    db = get_db()
    rows = db.execute(
        "SELECT c.*, (SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id) AS item_count FROM collections c ORDER BY c.created_at DESC"
    ).fetchall()
    return jsonify({"data": [dict(r) for r in rows]})


@bp.route("/", methods=["POST"])
def create_collection():
    db = get_db()
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    cur = db.execute("INSERT INTO collections (name) VALUES (?)", (name,))
    db.commit()
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@bp.route("/<int:cid>", methods=["DELETE"])
def delete_collection(cid):
    db = get_db()
    db.execute("DELETE FROM collection_items WHERE collection_id = ?", (cid,))
    db.execute("DELETE FROM collections WHERE id = ?", (cid,))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/<int:cid>/items", methods=["POST"])
def add_items(cid):
    db = get_db()
    data = request.get_json(silent=True) or {}
    media_ids = data.get("media_ids", [])
    for mid in media_ids:
        db.execute("INSERT OR IGNORE INTO collection_items (collection_id, media_id) VALUES (?, ?)", (cid, mid))
    db.execute("UPDATE collections SET cover_id = (SELECT media_id FROM collection_items WHERE collection_id = ? LIMIT 1) WHERE id = ? AND cover_id IS NULL", (cid, cid))
    db.commit()
    return jsonify({"ok": True})


@bp.route("/<int:cid>/media")
def collection_media(cid):
    db = get_db()
    rows = db.execute(
        "SELECT m.* FROM media m JOIN collection_items ci ON m.id = ci.media_id WHERE ci.collection_id = ? ORDER BY m.imported_at DESC",
        (cid,),
    ).fetchall()
    return jsonify({"data": [dict(r) for r in rows]})
