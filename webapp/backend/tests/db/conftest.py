"""
Database tests run against a real PostGIS, never a mock (the constraints are the point).

Set TEST_DATABASE_URL to a server where the user may create databases, e.g.
    TEST_DATABASE_URL=postgresql+psycopg://infraalert:infraalert@localhost:5433/infraalert
(`make db-up` starts one). Each test session gets its own throwaway database.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import URL, Engine, create_engine, make_url, text
from sqlalchemy.orm import Session

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _admin_url() -> URL:
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("TEST_DATABASE_URL not set; run `make db-up` and export it")
    return make_url(raw)


@contextmanager
def fresh_database() -> Iterator[URL]:
    """Create an empty database, yield its URL, then drop it."""
    admin_url = _admin_url()
    name = f"infraalert_test_{uuid.uuid4().hex[:8]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield admin_url.set(database=name)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def alembic_config(url: URL) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    # configparser treats % as interpolation, so escape it.
    cfg.set_main_option(
        "sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%")
    )
    return cfg


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    with fresh_database() as url:
        command.upgrade(alembic_config(url), "head")
        eng = create_engine(url)
        yield eng
        eng.dispose()


@pytest.fixture()
def session(engine: Engine) -> Iterator[Session]:
    """A session whose work is rolled back after each test."""
    with engine.connect() as conn:
        trans = conn.begin()
        with Session(bind=conn, join_transaction_mode="create_savepoint") as s:
            yield s
        trans.rollback()
