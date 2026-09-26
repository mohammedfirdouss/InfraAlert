from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.orm import Session, sessionmaker

from infraalert.app import create_app
from infraalert.captcha import CaptchaResult
from infraalert.config import Settings
from infraalert.db.models import Report
from infraalert.deps import Deps
from infraalert.processing.extraction import ExtractionUnavailable
from infraalert.processing.worker import Processor
from infraalert.storage import LocalPhotoStorage
from tests.processing.conftest import FakeExtractor

SERVICE_URL = "https://infraalert.test"


@dataclass
class FakeTaskAuth:
    calls: list[tuple[str, str]] = field(default_factory=list)

    def verify(self, token: str, audience: str) -> bool:
        self.calls.append((token, audience))
        return token == "good-token"


@dataclass
class RecordingQueue:
    enqueued: list[uuid.UUID] = field(default_factory=list)

    def enqueue_report_processing(self, report_id: uuid.UUID) -> None:
        self.enqueued.append(report_id)


class PassCaptcha:
    def verify(self, token: str, remote_ip: str | None) -> CaptchaResult:
        return CaptchaResult.PASSED


@pytest.fixture()
def deps(
    sessions: sessionmaker[Session], storage: LocalPhotoStorage, extractor: FakeExtractor
) -> Deps:
    return Deps(
        settings=Settings(
            database_url="unused",
            turnstile_secret_key="unused",
            rate_limit_secret="unused",
            tasks_backend="cloud_tasks",
            service_url=SERVICE_URL,
        ),
        sessions=sessions,
        captcha=PassCaptcha(),
        storage=storage,
        tasks=RecordingQueue(),
        processor=Processor(sessions=sessions, storage=storage, extractor=extractor),
        task_auth=FakeTaskAuth(),
    )


@pytest.fixture()
def client(deps: Deps) -> Iterator[TestClient]:
    with TestClient(create_app(deps)) as c:
        yield c


AUTH = {"Authorization": "Bearer good-token"}


def test_task_endpoints_require_the_queue_identity(client: TestClient, deps: Deps) -> None:
    body = {"report_id": str(uuid.uuid4())}
    assert client.post("/tasks/process-report", json=body).status_code == 403
    assert (
        client.post(
            "/tasks/process-report", json=body, headers={"Authorization": "Bearer forged"}
        ).status_code
        == 403
    )
    assert client.post("/tasks/sweep").status_code == 403
    # The token must be minted for this exact endpoint.
    assert deps.task_auth.calls[-1] == ("forged", f"{SERVICE_URL}/tasks/process-report")  # type: ignore[union-attr]


def test_task_endpoints_are_absent_without_cloud_tasks(deps: Deps) -> None:
    deps.task_auth = None
    with TestClient(create_app(deps)) as c:
        # 405 when the built frontend's catch-all GET route is mounted; never handled.
        assert c.post("/tasks/sweep", headers=AUTH).status_code in (404, 405)
        assert c.get("/tasks/sweep").status_code == 404


def test_process_report(client: TestClient, submit: Callable[..., uuid.UUID]) -> None:
    report_id = submit()

    resp = client.post("/tasks/process-report", json={"report_id": str(report_id)}, headers=AUTH)

    assert resp.status_code == 200
    assert resp.json() == {"outcome": "processed"}


def test_model_outage_asks_the_queue_to_retry(
    client: TestClient, submit: Callable[..., uuid.UUID], extractor: FakeExtractor
) -> None:
    extractor.result = ExtractionUnavailable("503")
    report_id = submit()
    body = {"report_id": str(report_id)}

    first = client.post("/tasks/process-report", json=body, headers=AUTH)
    last = client.post(
        "/tasks/process-report",
        json=body,
        headers={**AUTH, "X-CloudTasks-TaskRetryCount": "2"},
    )

    assert first.status_code == 503
    assert last.status_code == 200 and last.json() == {"outcome": "needs_triage"}


def test_sweep_requeues_only_reports_stuck_in_received(
    client: TestClient,
    deps: Deps,
    sessions: sessionmaker[Session],
    submit: Callable[..., uuid.UUID],
) -> None:
    stuck, fresh, done = submit(), submit(), submit()
    deps.processor.process(done)  # type: ignore[union-attr]
    with sessions() as session:
        for report_id in (stuck, done):
            report = session.get(Report, report_id)
            assert report is not None
            report.submitted_at = func.now() - timedelta(minutes=10)
        session.commit()

    resp = client.post("/tasks/sweep", headers=AUTH)

    assert resp.json() == {"enqueued": 1}
    assert deps.tasks.enqueued == [stuck]  # type: ignore[attr-defined]
    assert fresh not in deps.tasks.enqueued  # type: ignore[attr-defined]
