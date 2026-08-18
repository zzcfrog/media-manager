from flask import Blueprint, jsonify, request

from loguru import logger

from .. import local_vlm

bp = Blueprint("local_vlm", __name__)


@bp.route("/status")
def get_status():
    return jsonify(local_vlm.status())


@bp.route("/models")
def get_models():
    return jsonify(local_vlm.installed_models())


@bp.route("/start", methods=["POST"])
def start_engine():
    data = request.get_json(silent=True) or {}
    model_id = data.get("model_id", "qwen3-vl-8b")
    try:
        return jsonify(local_vlm.ensure(model_id))
    except Exception as e:
        logger.error("local VLM start failed: {}", e)
        return jsonify({"error": str(e)}), 400


@bp.route("/stop", methods=["POST"])
def stop_engine():
    return jsonify(local_vlm.stop())


@bp.route("/download", methods=["POST"])
def start_download():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(local_vlm.start_download(data.get("model_id", "")))
    except Exception as e:
        logger.error("model download start failed: {}", e)
        return jsonify({"error": str(e)}), 400


@bp.route("/download")
def download_status():
    return jsonify(local_vlm.download_status())


@bp.route("/delete", methods=["POST"])
def delete_model():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(local_vlm.delete_model(data.get("model_id", "")))
    except Exception as e:
        logger.error("model delete failed: {}", e)
        return jsonify({"error": str(e)}), 400
