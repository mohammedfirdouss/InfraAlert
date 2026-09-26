"""
The app with a fake mailer and dev staff sign-in, wired to a rolled-back test database.
Background delivery (development) is captured instead of started: see `kicks`.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, update
from sqlalchemy.orm import sessionmaker

from infraalert.app import create_app
from infraalert.config import Settings
from infraalert.db.models import Contact, ContactKind, Report
from infraalert.deps import Deps
from infraalert.notify import outbox
from infraalert.notify.mailer import Email
from infraalert.staff.identity import DevVerifier
from tests.citizen import conftest as citizen
from tests.staff.conftest import staff  # noqa: F401  (fixture)

BASE_URL = "https://infraalert.test"
SECRET = "test-secret"
RATE_LIMIT = 3


@dataclass
class FakeMailer:
    sent: list[Email] = field(default_factory=list)
    failures: int = 0  # the next this-many sends raise

    def send(self, email: Email) -> None:
        if self.failures:
            self.failures -= 1
            raise ConnectionError("smtp unavailable")
        self.sent.append(email)


@pytest.fixture()
def mailer() -> FakeMailer:
    return FakeMailer()


@pytest.fixture(autouse=True)
def kicks(monkeypatch: pytest.MonkeyPatch) -> list[Callable[[], None]]:
    """Background deliveries that would have started; call one to run it."""
    started: list[Callable[[], None]] = []
    monkeypatch.setattr(outbox, "_start_thread", started.append)
    return started


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = dict(
        database_url="unused",
        turnstile_secret_key="unused",
        rate_limit_secret=SECRET,
        rate_limit_per_hour=RATE_LIMIT,
        public_base_url=BASE_URL,
    )
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


@pytest.fixture()
def deps(engine: Engine, mailer: FakeMailer) -> Iterator[Deps]:
    """Everything the app writes is rolled back after each test."""
    with engine.connect() as conn:
        trans = conn.begin()
        yield Deps(
            settings=settings(),
            sessions=sessionmaker(
                bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
            ),
            captcha=citizen.FakeCaptcha(),
            storage=citizen.FakeStorage(),
            tasks=citizen.FakeTasks(),
            staff_auth=DevVerifier(),
            mailer=mailer,
        )
        trans.rollback()


@pytest.fixture()
def client(deps: Deps) -> Iterator[TestClient]:
    with TestClient(create_app(deps)) as c:
        yield c


# Helpers


def make_report(deps: Deps, description: str = "Deep pothole outside the school gate") -> uuid.UUID:
    """A report that hasn't been processed yet."""
    with deps.sessions() as session:
        report = Report(description=description, location="SRID=4326;POINT(36.8219 -1.2921)")
        session.add(report)
        session.commit()
        return report.id


def attach_contact(
    deps: Deps, report_id: uuid.UUID, address: str, verified: bool = True
) -> uuid.UUID:
    """Subscribe the report directly in the database."""
    with deps.sessions() as session:
        contact = Contact(
            kind=ContactKind.EMAIL,
            address=address,
            verified_at=func.now() if verified else None,
        )
        session.add(contact)
        session.flush()
        session.execute(update(Report).where(Report.id == report_id).values(contact_id=contact.id))
        session.commit()
        return contact.id


VERIFY_LINK = re.compile(r"(https://infraalert\.test/reports/([0-9a-f-]+)/verify)#token=(\S+)")


def verify_link(email: Email) -> tuple[str, str]:
    """(the link before the fragment, the token) from a verification email."""
    match = VERIFY_LINK.search(email.text)
    assert match, email.text
    return match.group(1), match.group(3)


def subscribe(client: TestClient, report_id: uuid.UUID, email: str, ip: str = "203.0.113.1") -> int:
    resp = client.post(
        f"/api/reports/{report_id}/subscribe",
        json={"email": email, "captcha_token": "ok"},
        headers={"X-Forwarded-For": ip},
    )
    return resp.status_code


def subscribe_and_verify(
    client: TestClient, mailer: FakeMailer, report_id: uuid.UUID, email: str
) -> None:
    assert subscribe(client, report_id, email) == 202
    _, token = verify_link(mailer.sent[-1])
    resp = client.post(f"/api/reports/{report_id}/verify", json={"token": token})
    assert resp.status_code == 200, resp.text
