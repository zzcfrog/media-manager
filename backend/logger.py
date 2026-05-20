"""Centralized loguru logging setup: file rotation + terminal output."""

import logging

from loguru import logger
from .config import LOG_DIR


def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger.add(
        str(LOG_DIR / "app.log"),
        rotation="1 day",
        retention="7 days",
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level:<8} | {name}:{function}:{line} - {message}",
        encoding="utf-8",
    )
    # Suppress Werkzeug request logs (the "GET /path HTTP/1.1" lines)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logger.info("logging initialized, log_dir={}", LOG_DIR)
