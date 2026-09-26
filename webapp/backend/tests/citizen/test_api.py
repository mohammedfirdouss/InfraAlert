from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from infraalert.captcha import CaptchaResult
from infraalert.db.models import (
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    ReportPhoto,
    ReportProcessing,
)
from infraalert.deps import Deps
from tests.citizen.conftest import RATE_LIMIT

PHOTO = "uploads/" + "a" * 32 + ".jpg"


def submission(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "description": "Deep pothole in the left lane outside the school",
        "location": {"lat": -1.2921, "lng": 36.8219},
        "address_text": "Moi Avenue, Nairobi",
        "captcha_token": "token",
    }
    body.update(overrides)
    return body


def submit(client: TestClient, ip: str = "203.0.113.7", **overrides: Any) -> Any:
    return client.post(
        "/api/reports", json=submission(**overrides), headers={"X-Forwarded-For": ip}
    )


# Submitting


def test_submit_saves_the_report_and_enqueues_processing(client: TestClient, deps: Deps) -> None:
    resp = submit(client, photos=[PHOTO])

    assert resp.status_code == 202
    assert resp.json()["status"] == "received"
    report_id = uuid.UUID(resp.json()["report_id"])
    with deps.sessions() as session:
        report = session.get(Report, report_id)
        assert report is not None
        assert report.processing is ReportProcessing.RECEIVED
        assert report.description == "Deep pothole in the left lane outside the school"
        assert report.incident_id is None
        photos = session.scalars(select(ReportPhoto).where(ReportPhoto.report_id == report_id))
        assert [(p.object_name, p.content_type) for p in photos] == [(PHOTO, "image/jpeg")]
    assert deps.tasks.enqueued == [report_id]  # type: ignore[attr-defined]


def test_submit_is_accepted_even_if_enqueueing_fails(client: TestClient, deps: Deps) -> None:
    deps.tasks.fail = True  # type: ignore[attr-defined]

    resp = submit(client)

    assert resp.status_code == 202
    with deps.sessions() as session:
        assert session.get(Report, uuid.UUID(resp.json()["report_id"])) is not None


def test_rejected_captcha_saves_nothing(client: TestClient, deps: Deps) -> None:
    deps.captcha.result = CaptchaResult.FAILED  # type: ignore[attr-defined]

    resp = submit(client)

    assert resp.status_code == 400
    assert resp.json()["detail"] == "captcha_failed"
    with deps.sessions() as session:
        assert session.scalars(select(Report)).first() is None
    assert deps.tasks.enqueued == []  # type: ignore[attr-defined]


def test_unreachable_captcha_service_does_not_block_submission(
    client: TestClient, deps: Deps
) -> None:
    deps.captcha.result = CaptchaResult.UNAVAILABLE  # type: ignore[attr-defined]

    assert submit(client).status_code == 202


def test_captcha_is_checked_against_the_client_ip(client: TestClient, deps: Deps) -> None:
    submit(client, ip="198.51.100.1, 203.0.113.9")

    assert deps.captcha.calls == [("token", "203.0.113.9")]  # type: ignore[attr-defined]


def test_rate_limit_is_per_client(client: TestClient) -> None:
    for _ in range(RATE_LIMIT):
        assert submit(client, ip="203.0.113.7").status_code == 202

    limited = submit(client, ip="203.0.113.7")
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "3600"
    assert submit(client, ip="203.0.113.8").status_code == 202


def test_rate_limit_ignores_forged_forwarded_entries(client: TestClient) -> None:
    for n in range(RATE_LIMIT):
        assert submit(client, ip=f"10.0.0.{n}, 203.0.113.7").status_code == 202

    assert submit(client, ip="10.0.0.99, 203.0.113.7").status_code == 429


def test_client_ip_is_stored_only_as_an_hmac(client: TestClient, deps: Deps) -> None:
    report_id = submit(client, ip="203.0.113.7").json()["report_id"]

    with deps.sessions() as session:
        report = session.get(Report, uuid.UUID(report_id))
        assert report is not None
        assert report.submitter_key is not None
        assert "203.0.113.7" not in report.submitter_key
        assert len(report.submitter_key) == 64


@pytest.mark.parametrize(
    "overrides",
    [
        {"description": "too short"},
        {"description": " " * 20},
        {"location": {"lat": 91, "lng": 0}},
        {"location": {"lat": 0, "lng": -181}},
        {"location": None},
        {"captcha_token": ""},
        {"photos": ["https://evil.example/x.jpg"]},
        {"photos": ["uploads/../../etc/passwd"]},
        {"photos": [PHOTO, PHOTO]},
        {"photos": ["uploads/" + c * 32 + ".jpg" for c in "abcd"]},
        {"citizen_phone": "+254700000000"},
    ],
)
def test_invalid_submissions_are_rejected(client: TestClient, overrides: dict[str, Any]) -> None:
    assert submit(client, **overrides).status_code == 422


def test_a_photo_cannot_be_attached_to_two_reports(client: TestClient) -> None:
    assert submit(client, photos=[PHOTO]).status_code == 202

    resp = submit(client, photos=[PHOTO])
    assert resp.status_code == 409
    assert resp.json()["detail"] == "photo_already_used"


# Uploads


def test_upload_returns_a_fresh_signed_target(client: TestClient) -> None:
    first = client.post("/api/uploads", json={"content_type": "image/png"})
    second = client.post("/api/uploads", json={"content_type": "image/png"})

    assert first.status_code == 201
    body = first.json()
    assert body["object_name"].startswith("uploads/") and body["object_name"].endswith(".png")
    assert body["upload_url"] == f"https://storage.test/{body['object_name']}?signed"
    assert body["method"] == "PUT"
    assert body["headers"] == {"Content-Type": "image/png"}
    assert second.json()["object_name"] != body["object_name"]


def test_upload_rejects_non_images(client: TestClient) -> None:
    assert client.post("/api/uploads", json={"content_type": "text/html"}).status_code == 422


# Following a report


def test_new_report_shows_as_received(client: TestClient) -> None:
    report_id = submit(client, photos=[PHOTO]).json()["report_id"]

    resp = client.get(f"/api/reports/{report_id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "received"
    assert body["location"] == {"lat": -1.2921, "lng": 36.8219}
    assert body["address_text"] == "Moi Avenue, Nairobi"
    assert body["photo_count"] == 1
    assert body["issue_type"] is None


def _attach_to_incident(deps: Deps, report_id: str, **incident: Any) -> uuid.UUID:
    with deps.sessions() as session:
        inc = Incident(location="SRID=4326;POINT(36.8219 -1.2921)", **incident)
        session.add(inc)
        session.flush()
        report = session.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.processing = ReportProcessing.PROCESSED
        report.issue_type = IssueType.ROAD_DAMAGE
        report.incident_id = inc.id
        session.commit()
        return inc.id


def test_report_status_follows_its_incident(client: TestClient, deps: Deps) -> None:
    report_id = submit(client).json()["report_id"]
    _attach_to_incident(
        deps, report_id, status=IncidentStatus.ASSIGNED, issue_type=IssueType.POTHOLE
    )

    body = client.get(f"/api/reports/{report_id}").json()

    assert body["status"] == "team_assigned"
    assert body["issue_type"] == "pothole"  # the incident's type wins over the extraction


def test_merged_report_shows_the_surviving_incident(client: TestClient, deps: Deps) -> None:
    report_id = submit(client).json()["report_id"]
    with deps.sessions() as session:
        survivor = Incident(
            location="SRID=4326;POINT(36.8219 -1.2921)", status=IncidentStatus.ON_SITE
        )
        session.add(survivor)
        session.commit()
        survivor_id = survivor.id
    _attach_to_incident(
        deps, report_id, status=IncidentStatus.CLOSED_DUPLICATE, merged_into_id=survivor_id
    )

    assert client.get(f"/api/reports/{report_id}").json()["status"] == "in_progress"


def test_unknown_report_is_not_found(client: TestClient) -> None:
    assert client.get(f"/api/reports/{uuid.uuid4()}").status_code == 404
    assert client.get("/api/reports/RPT-001").status_code == 422


def test_health_checks_the_database(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}
