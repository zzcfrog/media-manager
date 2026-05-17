import logging

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .config import DB_PATH, DATA_DIR, THUMB_DIR
from .db import init_db
from .compressor import cleanup_temp

logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__, static_folder="../frontend", static_url_path="/static")
    app.config["DATABASE"] = str(DB_PATH)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    cleanup_temp()
    init_db(app)

    from .blueprints.serve import bp as serve_bp
    from .blueprints.library import bp as library_bp
    from .blueprints.analysis import bp as analysis_bp
    from .blueprints.collections import bp as collections_bp
    from .blueprints.tags import bp as tags_bp
    from .blueprints.settings import bp as settings_bp

    app.register_blueprint(serve_bp)
    app.register_blueprint(library_bp, url_prefix="/api/library")
    app.register_blueprint(analysis_bp, url_prefix="/api/analysis")
    app.register_blueprint(collections_bp, url_prefix="/api/collections")
    app.register_blueprint(tags_bp, url_prefix="/api/tags")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")

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
