from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

from infraalert.app import create_app
from infraalert.db.models import Notification, NotificationEvent, Report
from infraalert.deps import Deps
from tests.citizen import conftest as citizen
from tests.notify.conftest import FakeMailer, attach_contact, settings
from tests.processing.test_tasks_api import SERVICE_URL, FakeTaskAuth
from tests.staff.test_dispatch import make_incident

GOOD = {"Authorization": "Bearer good-token"}


@pytest.fixture()
def deps(engine: Engine, mailer: FakeMailer) -> Iterator[Deps]:
    """Production-like: tasks arrive over HTTP from Cloud Scheduler."""
    with engine.connect() as conn:
        trans = conn.begin()
        yield Deps(
            settings=settings(tasks_backend="cloud_tasks", service_url=SERVICE_URL),
            sessions=sessionmaker(
                bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
            ),
            captcha=citizen.FakeCaptcha(),
            storage=citizen.FakeStorage(),
            tasks=citizen.FakeTasks(),
            task_auth=FakeTaskAuth(),
            mailer=mailer,
        )
        trans.rollback()


@pytest.fixture()
def client(deps: Deps) -> Iterator[TestClient]:
    with TestClient(create_app(deps)) as c:
        yield c


@pytest.mark.parametrize("path", ["/tasks/notifications", "/tasks/retention"])
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer forged"}])
def test_tasks_need_the_scheduler_token(
    client: TestClient, path: str, headers: dict[str, str]
) -> None:
    assert client.post(path, headers=headers).status_code == 403


def test_the_token_audience_is_the_endpoint(client: TestClient, deps: Deps) -> None:
    client.post("/tasks/retention", headers=GOOD)
    assert isinstance(deps.task_auth, FakeTaskAuth)
    assert deps.task_auth.calls == [("good-token", f"{SERVICE_URL}/tasks/retention")]


def test_notifications_task_delivers_the_outbox(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    incident = make_incident(deps)
    with deps.sessions() as session:
        report = session.scalars(select(Report.id).where(Report.incident_id == incident)).one()
    contact = attach_contact(deps, report, "a@example.com")
    with deps.sessions() as session:
        session.add(
            Notification(report_id=report, contact_id=contact, event=NotificationEvent.RESOLVED)
        )
        session.commit()

    resp = client.post("/tasks/notifications", headers=GOOD)

    assert resp.status_code == 200
    assert resp.json() == {"sent": 1, "retrying": 0, "failed": 0, "cancelled": 0}
    assert [e.to for e in mailer.sent] == ["a@example.com"]


def test_retention_task_returns_counts(client: TestClient) -> None:
    resp = client.post("/tasks/retention", headers=GOOD)
    assert resp.status_code == 200
    assert set(resp.json()) == {
        "submitter_keys_cleared",
        "verifications_deleted",
        "contacts_deleted",
    }
