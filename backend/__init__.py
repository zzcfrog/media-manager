from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException
from loguru import logger

from .config import DB_PATH, DATA_DIR, THUMB_DIR
from .db import init_db, get_setting
from .compressor import cleanup_temp
from .logger import setup_logging


def create_app() -> Flask:
    setup_logging()

    app = Flask(__name__, static_folder="../frontend", static_url_path="/static")
    app.config["DATABASE"] = str(DB_PATH)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    cleanup_temp()
    init_db(app)

    from .blueprints.serve import bp as serve_bp
    from .blueprints.library import bp as library_bp
    from .blueprints.analysis import bp as analysis_bp
    from .blueprints.tags import bp as tags_bp
    from .blueprints.settings import bp as settings_bp

    app.register_blueprint(serve_bp)
    app.register_blueprint(library_bp, url_prefix="/api/library")
    app.register_blueprint(analysis_bp, url_prefix="/api/analysis")
    app.register_blueprint(tags_bp, url_prefix="/api/tags")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")

    # Preload local ASR model in background (only for local engines like whisper)
    with app.app_context():
        from .asr import preload_all, available_engines
        from .db import get_db
        db = get_db()
        asr_engine_name = get_setting(db, "asr_engine", "whisper")
        if asr_engine_name in available_engines():
            asr_model_name = get_setting(db, "asr_model", "large-v3")
            preload_all(asr_engine_name, asr_model_name)

    @app.route("/")
    def index():
        return app.send_static_file("index.html")

    @app.errorhandler(HTTPException)
    def handle_http_error(exc):
        if request.path.startswith("/api/") or request.path.startswith("/media/"):
            return jsonify({"error": exc.description}), exc.code
        return exc

    @app.errorhandler(Exception)
    def handle_unexpected_error(exc):
        logger.exception("Unhandled exception")
        if request.path.startswith("/api/") or request.path.startswith("/media/"):
            return jsonify({"error": "服务器内部错误"}), 500
        return jsonify({"error": "服务器内部错误"}), 500

    return app
