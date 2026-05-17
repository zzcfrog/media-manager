from flask import Blueprint, request, jsonify

from ..db import get_db

bp = Blueprint("settings", __name__)


@bp.route("/")
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    return jsonify({r["key"]: r["value"] for r in rows})


@bp.route("/", methods=["POST"])
def save_settings():
    db = get_db()
    data = request.get_json(silent=True) or {}
    for k, v in data.items():
        db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?",
                   (k, v, v))
    db.commit()
    return jsonify({"ok": True})
