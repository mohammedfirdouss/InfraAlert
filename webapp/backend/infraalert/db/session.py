from __future__ import annotations

import os

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker


def database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


# Sized to what can use a connection at once: MAX_CONCURRENT_REQUESTS (30,
# see infraalert.concurrency) plus the inline processing workers (4). Keep them
# all open: overflow connections are closed when returned, and with only 10
# kept open, Postgres saw 10x more new connections under load and POST p95 was
# 89ms instead of 22ms (scripts/loadtest/README.md). Fail fast rather than
# queue for SQLAlchemy's default 30s if the pool is ever exhausted anyway.
DEFAULT_POOL_SIZE = 34
DEFAULT_MAX_OVERFLOW = 6
DEFAULT_POOL_TIMEOUT_SECONDS = 10.0


def make_engine(
    url: str | None = None,
    *,
    pool_size: int = DEFAULT_POOL_SIZE,
    max_overflow: int = DEFAULT_MAX_OVERFLOW,
    pool_timeout: float = DEFAULT_POOL_TIMEOUT_SECONDS,
) -> Engine:
    """
    The web app passes its settings (DB_POOL_SIZE, DB_MAX_OVERFLOW, DB_POOL_TIMEOUT);
    the CLI and migrations use the defaults, and only ever open one connection.
    """
    return create_engine(
        url or database_url(),
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=pool_timeout,
    )


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(engine, expire_on_commit=False)
