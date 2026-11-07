from flask import Blueprint, request, jsonify

from ..db import get_db
from ..compressor import detect_hw_encoder

bp = Blueprint("settings", __name__)


@bp.route("/")
def get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    result = {r["key"]: r["value"] for r in rows}
    result["hw_encoder"] = detect_hw_encoder() or ""
    return jsonify(result)


@bp.route("/", methods=["POST"])
def save_settings():
    db = get_db()
    data = request.get_json(silent=True) or {}
    for key in ('image_analysis_enabled','video_analysis_enabled','music_analysis_enabled'):
        if key in data and data[key] not in ('true','false'):
            return jsonify({'error':'分析启用状态需为开关'}),400
    for k, v in data.items():
        db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?",
                   (k, v, v))
    db.commit()
    return jsonify({"ok": True})
