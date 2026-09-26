from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from infraalert.captcha import CaptchaResult
from infraalert.db.models import AuditLog, Contact, ContactVerification, Report
from infraalert.deps import Deps
from infraalert.notify.subscriptions import MAX_REQUESTS_PER_REPORT_PER_HOUR
from tests.citizen.conftest import FakeCaptcha
from tests.notify.conftest import (
    RATE_LIMIT,
    FakeMailer,
    make_report,
    subscribe,
    subscribe_and_verify,
    verify_link,
)


def _verify(client: TestClient, report_id: uuid.UUID, token: str) -> tuple[int, object]:
    resp = client.post(f"/api/reports/{report_id}/verify", json={"token": token})
    return resp.status_code, resp.json()


# Subscribing


def test_subscribe_sends_a_verification_link_with_the_token_in_the_fragment(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id = make_report(deps)

    resp = client.post(
        f"/api/reports/{report_id}/subscribe",
        json={"email": "  Alice@Example.COM ", "captcha_token": "ok"},
    )

    assert resp.status_code == 202
    assert resp.json() == {"status": "verification_sent"}
    [email] = mailer.sent
    assert email.to == "alice@example.com"
    assert "Confirm" in email.subject
    link, token = verify_link(email)
    assert link == f"https://infraalert.test/reports/{report_id}/verify"
    assert token not in link  # only ever after the '#'
    assert email.html and f"verify#token={token}" in email.html

    with deps.sessions() as session:
        verification = session.scalars(select(ContactVerification)).one()
        contact = session.get_one(Contact, verification.contact_id)
        report = session.get_one(Report, report_id)
    # Only the hash is stored, and nothing is subscribed until the link is used.
    assert verification.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in verification.token_hash
    assert contact.address == "alice@example.com" and contact.verified_at is None
    assert report.contact_id is None


def test_subscribe_to_an_unknown_report_is_404(client: TestClient, mailer: FakeMailer) -> None:
    assert subscribe(client, uuid.uuid4(), "a@example.com") == 404
    assert mailer.sent == []


def test_subscribe_rejects_an_invalid_email(client: TestClient, deps: Deps) -> None:
    report_id = make_report(deps)
    for bad in ["", "not-an-email", "a@b", "a b@example.com", "@example.com"]:
        assert subscribe(client, report_id, bad) == 422, bad


def test_subscribe_needs_the_captcha(client: TestClient, deps: Deps, mailer: FakeMailer) -> None:
    report_id = make_report(deps)
    assert isinstance(deps.captcha, FakeCaptcha)
    deps.captcha.result = CaptchaResult.FAILED

    resp = client.post(
        f"/api/reports/{report_id}/subscribe",
        json={"email": "a@example.com", "captcha_token": "bad"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "captcha_failed"
    assert mailer.sent == []


def test_subscribe_is_accepted_when_turnstile_is_unavailable(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    assert isinstance(deps.captcha, FakeCaptcha)
    deps.captcha.result = CaptchaResult.UNAVAILABLE
    assert subscribe(client, make_report(deps), "a@example.com") == 202
    assert len(mailer.sent) == 1


def test_subscribe_is_rate_limited_per_client(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    reports = [make_report(deps) for _ in range(RATE_LIMIT + 1)]
    for report_id in reports[:RATE_LIMIT]:
        assert subscribe(client, report_id, "a@example.com", ip="198.51.100.7") == 202

    resp = client.post(
        f"/api/reports/{reports[-1]}/subscribe",
        json={"email": "a@example.com", "captcha_token": "ok"},
        headers={"X-Forwarded-For": "198.51.100.7"},
    )
    assert resp.status_code == 429
    assert resp.json()["detail"] == "rate_limited"
    assert len(mailer.sent) == RATE_LIMIT
    # Another client is unaffected.
    assert subscribe(client, reports[-1], "a@example.com", ip="198.51.100.8") == 202


def test_subscribe_is_capped_per_report_across_clients(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id = make_report(deps)
    for n in range(MAX_REQUESTS_PER_REPORT_PER_HOUR):
        assert subscribe(client, report_id, f"p{n}@example.com", ip=f"192.0.2.{n}") == 202
    assert subscribe(client, report_id, "late@example.com", ip="192.0.2.200") == 429
    assert len(mailer.sent) == MAX_REQUESTS_PER_REPORT_PER_HOUR
    # Other reports are unaffected.
    assert subscribe(client, make_report(deps), "late@example.com", ip="192.0.2.200") == 202


def test_subscribing_never_reveals_an_existing_subscription(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id = make_report(deps)
    subscribe_and_verify(client, mailer, report_id, "alice@example.com")

    known = client.post(
        f"/api/reports/{report_id}/subscribe",
        json={"email": "alice@example.com", "captcha_token": "ok"},
        headers={"X-Forwarded-For": "203.0.113.50"},
    )
    unknown = client.post(
        f"/api/reports/{report_id}/subscribe",
        json={"email": "bob@example.com", "captcha_token": "ok"},
        headers={"X-Forwarded-For": "203.0.113.51"},
    )

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert [e.to for e in mailer.sent[-2:]] == ["alice@example.com", "bob@example.com"]
    assert mailer.sent[-2].subject == mailer.sent[-1].subject


def test_subscribe_reports_a_mail_outage(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    mailer.failures = 1
    resp = client.post(
        f"/api/reports/{make_report(deps)}/subscribe",
        json={"email": "a@example.com", "captcha_token": "ok"},
    )
    assert resp.status_code == 503


# Verifying


def test_verify_subscribes_the_report_and_shows_the_masked_address(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id = make_report(deps)
    assert client.get(f"/api/reports/{report_id}").json()["updates_email_masked"] is None
    assert subscribe(client, report_id, "alice@gmail.com") == 202
    _, token = verify_link(mailer.sent[-1])

    status, body = _verify(client, report_id, token)

    assert status == 200
    assert body == {"status": "subscribed", "email_masked": "a•••@gmail.com"}
    assert client.get(f"/api/reports/{report_id}").json()["updates_email_masked"] == (
        "a•••@gmail.com"
    )
    with deps.sessions() as session:
        report = session.get_one(Report, report_id)
        assert report.contact_id is not None
        contact = session.get_one(Contact, report.contact_id)
        assert contact.verified_at is not None
        audit = session.scalars(select(AuditLog).where(AuditLog.entity_id == report_id)).one()
    assert audit.action == "report.updates_subscribed" and audit.staff_id is None
    assert "alice" not in str(audit.detail)


def test_a_verification_token_works_once(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id = make_report(deps)
    subscribe(client, report_id, "a@example.com")
    _, token = verify_link(mailer.sent[-1])

    assert _verify(client, report_id, token)[0] == 200
    status, body = _verify(client, report_id, token)
    assert status == 400
    assert body == {"detail": "invalid_or_expired_token"}


def test_an_expired_verification_token_is_rejected(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id = make_report(deps)
    subscribe(client, report_id, "a@example.com")
    _, token = verify_link(mailer.sent[-1])
    with deps.sessions() as session:
        session.execute(
            update(ContactVerification).values(expires_at=func.now() - timedelta(seconds=1))
        )
        session.commit()

    assert _verify(client, report_id, token) == (400, {"detail": "invalid_or_expired_token"})
    assert client.get(f"/api/reports/{report_id}").json()["updates_email_masked"] is None


def test_a_wrong_token_or_another_reports_token_is_rejected(
    client: TestClient, deps: Deps, mailer: FakeMailer
) -> None:
    report_id, other_id = make_report(deps), make_report(deps)
    subscribe(client, report_id, "a@example.com")
    _, token = verify_link(mailer.sent[-1])

    assert _verify(client, report_id, "not-the-token")[0] == 400
    assert _verify(client, other_id, token)[0] == 400
    assert _verify(client, report_id, token)[0] == 200


def test_an_unverified_address_is_never_shown(client: TestClient, deps: Deps) -> None:
    report_id = make_report(deps)
    subscribe(client, report_id, "a@example.com")
    assert client.get(f"/api/reports/{report_id}").json()["updates_email_masked"] is None
