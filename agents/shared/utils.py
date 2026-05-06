import os
import uuid
import logging


def get_env(key: str, default: str = "") -> str:
    """Retrieve an environment variable with an optional default."""
    return os.getenv(key, default)


def generate_report_id() -> str:
    """Generate a short unique report identifier (first 8 hex chars of uuid4)."""
    return uuid.uuid4().hex[:8]


def setup_logging(name: str) -> logging.Logger:
    """Create and configure a named logger with a standard format."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))
    return logger
