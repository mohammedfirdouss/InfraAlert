"""The app wired to a real test database and fakes for everything external."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from infraalert.app import create_app
from infraalert.captcha import CaptchaResult
from infraalert.config import Settings
from infraalert.deps import Deps
from infraalert.storage import UploadTarget


@dataclass
class FakeCaptcha:
    result: CaptchaResult = CaptchaResult.PASSED
    calls: list[tuple[str, str | None]] = field(default_factory=list)

    def verify(self, token: str, remote_ip: str | None) -> CaptchaResult:
        self.calls.append((token, remote_ip))
        return self.result


class FakeStorage:
    def upload_target(self, object_name: str, content_type: str) -> UploadTarget:
        return UploadTarget(
            object_name=object_name,
            url=f"https://storage.test/{object_name}?signed",
            headers={"Content-Type": content_type},
        )


@dataclass
class FakeTasks:
    fail: bool = False
    enqueued: list[uuid.UUID] = field(default_factory=list)

    def enqueue_report_processing(self, report_id: uuid.UUID) -> None:
        if self.fail:
            raise ConnectionError("queue unavailable")
        self.enqueued.append(report_id)


RATE_LIMIT = 3


@pytest.fixture()
def deps(engine: Engine) -> Iterator[Deps]:
    """Everything the app writes is rolled back after each test."""
    with engine.connect() as conn:
        trans = conn.begin()
        yield Deps(
            settings=Settings(
                database_url="unused",
                turnstile_secret_key="unused",
                rate_limit_secret="test-secret",
                rate_limit_per_hour=RATE_LIMIT,
            ),
            sessions=sessionmaker(
                bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
            ),
            captcha=FakeCaptcha(),
            storage=FakeStorage(),
            tasks=FakeTasks(),
        )
        trans.rollback()


@pytest.fixture()
def client(deps: Deps) -> Iterator[TestClient]:
    with TestClient(create_app(deps)) as c:
        yield c
