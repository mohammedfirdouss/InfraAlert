"""Dispatch actions queue citizen updates; deliver_pending sends them; unsubscribe stops them."""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from infraalert.db.models import (
    IssueType,
    Notification,
    NotificationEvent,
    NotificationStatus,
    Report,
    StaffRole,
)
from infraalert.deps import Deps
from infraalert.notify.outbox import MAX_ATTEMPTS, deliver_pending
from infraalert.notify.tokens import read_unsubscribe_token, unsubscribe_token
from tests.notify.conftest import SECRET, FakeMailer, attach_contact, subscribe_and_verify
from tests.staff.conftest import StaffFactory, auth
from tests.staff.test_dispatch import act, make_incident, make_team

E = NotificationEvent


@pytest.fixture()
def dispatcher(staff: StaffFactory) -> dict[str, str]:
    return auth(staff(StaffRole.DISPATCHER).email)


def reports_of(deps: Deps, incident_id: uuid.UUID) -> list[uuid.UUID]:
    with deps.sessions() as session:
        return list(
            session.scalars(
                select(Report.id)
                .where(Report.incident_id == incident_id)
                .order_by(Report.submitted_at)
            )
        )


def outbox(deps: Deps) -> list[tuple[uuid.UUID, NotificationEvent, NotificationStatus]]:
    with deps.sessions() as session:
        rows = session.execute(
            select(Notification.report_id, Notification.event, Notification.status).order_by(
                Notification.id
            )
        ).all()
    return [(r, e, s) for r, e, s in rows]


def deliver(deps: Deps, mailer: FakeMailer) -> dict[str, int]:
    result = deliver_pending(deps.sessions, mailer, deps.settings)
    return {k: v for k, v in vars(result).items() if v}


def make_due(deps: Deps) -> None:
    """Skip the retry backoff (now() is fixed inside the test transaction)."""
    with deps.sessions() as session:
        session.execute(
            update(Notification).values(next_attempt_at=func.now() - timedelta(seconds=1))
        )
        session.commit()


# Recording events


def test_assign_queues_an_update_only_for_verified_contacts(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps, reports=3)
    verified, unverified, anonymous = reports_of(deps, incident)
    attach_contact(deps, verified, "v@example.com")
    attach_contact(deps, unverified, "u@example.com", verified=False)
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])

    assert act(client, dispatcher, incident, "assign", {"team_id": str(team)}).status_code == 204

    assert outbox(deps) == [(verified, E.ASSIGNED, NotificationStatus.PENDING)]


def test_a_reassign_does_not_send_another_update(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    attach_contact(deps, report, "v@example.com")
    first = make_team(deps, "Roads A", [IssueType.POTHOLE])
    second = make_team(deps, "Roads B", [IssueType.POTHOLE])

    act(client, dispatcher, incident, "assign", {"team_id": str(first)})
    assert act(client, dispatcher, incident, "assign", {"team_id": str(second)}).status_code == 204

    assert outbox(deps) == [(report, E.ASSIGNED, NotificationStatus.PENDING)]


def test_resolve_and_close_queue_their_updates(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    fixed, invalid = make_incident(deps), make_incident(deps)
    [fixed_report], [invalid_report] = reports_of(deps, fixed), reports_of(deps, invalid)
    attach_contact(deps, fixed_report, "f@example.com")
    attach_contact(deps, invalid_report, "i@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])

    act(client, dispatcher, fixed, "assign", {"team_id": str(team)})
    assert act(client, dispatcher, fixed, "resolve", {"note": "Filled"}).status_code == 204
    assert act(client, dispatcher, invalid, "close", {"reason": "Not found"}).status_code == 204

    assert outbox(deps) == [
        (fixed_report, E.ASSIGNED, NotificationStatus.PENDING),
        (fixed_report, E.RESOLVED, NotificationStatus.PENDING),
        (invalid_report, E.CLOSED, NotificationStatus.PENDING),
    ]


def test_a_failed_action_queues_nothing(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    attach_contact(deps, report, "v@example.com")

    # Can't resolve an incident nobody was sent to.
    assert act(client, dispatcher, incident, "resolve", {}).status_code == 409
    assert outbox(deps) == []


def test_a_merged_reports_subscriber_hears_about_the_survivor(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    duplicate, survivor = make_incident(deps), make_incident(deps)
    [merged_report] = reports_of(deps, duplicate)
    attach_contact(deps, merged_report, "m@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])

    act(client, dispatcher, duplicate, "merge", {"into_incident_id": str(survivor)})
    act(client, dispatcher, survivor, "assign", {"team_id": str(team)})
    act(client, dispatcher, survivor, "resolve", {})

    assert outbox(deps) == [
        (merged_report, E.ASSIGNED, NotificationStatus.PENDING),
        (merged_report, E.RESOLVED, NotificationStatus.PENDING),
    ]


# Delivering


def test_delivery_sends_a_plain_update_with_links(
    client: TestClient, deps: Deps, mailer: FakeMailer, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    contact = attach_contact(deps, report, "alice@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})

    assert deliver(deps, mailer) == {"sent": 1}

    [email] = mailer.sent
    assert email.to == "alice@example.com"
    assert email.subject == "Update on your InfraAlert report: a repair team is assigned"
    assert "Report 0 of a problem here" in email.text
    assert f"https://infraalert.test/reports/{report}\n" in email.text
    match = re.search(r"https://infraalert\.test/unsubscribe#token=(\S+)", email.text)
    assert match
    assert read_unsubscribe_token(SECRET, match.group(1)) == (report, contact)
    assert email.html is not None
    assert f'href="https://infraalert.test/reports/{report}"' in email.html
    assert "unsubscribe#token=" in email.html
    assert "Roads A" not in email.text  # no staff-only detail

    with deps.sessions() as session:
        row = session.scalars(select(Notification)).one()
    assert row.status is NotificationStatus.SENT
    assert row.sent_at is not None and row.attempts == 1
    # Nothing left to send.
    assert deliver(deps, mailer) == {}
    assert len(mailer.sent) == 1


@pytest.mark.parametrize(
    ("event", "subject_end", "phrase"),
    [
        (E.RESOLVED, "the problem is fixed", "finished the repair"),
        (E.CLOSED, "closed without a repair", "without sending a team"),
    ],
)
def test_resolved_and_closed_emails_say_so(
    deps: Deps, mailer: FakeMailer, event: NotificationEvent, subject_end: str, phrase: str
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    contact = attach_contact(deps, report, "a@example.com")
    with deps.sessions() as session:
        session.add(Notification(report_id=report, contact_id=contact, event=event))
        session.commit()

    deliver(deps, mailer)

    [email] = mailer.sent
    assert email.subject.endswith(subject_end)
    assert phrase in email.text


def test_a_failed_send_is_retried_later_then_given_up(
    client: TestClient, deps: Deps, mailer: FakeMailer, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    attach_contact(deps, report, "a@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})
    mailer.failures = MAX_ATTEMPTS

    assert deliver(deps, mailer) == {"retrying": 1}
    # Backed off: not retried straight away.
    assert deliver(deps, mailer) == {}
    with deps.sessions() as session:
        row = session.scalars(select(Notification)).one()
        assert row.status is NotificationStatus.PENDING
        assert row.attempts == 1
        assert row.last_error == "ConnectionError: smtp unavailable"
        assert session.scalar(select(Notification.next_attempt_at > func.now()))

    for _ in range(MAX_ATTEMPTS - 2):
        make_due(deps)
        assert deliver(deps, mailer) == {"retrying": 1}
    make_due(deps)
    assert deliver(deps, mailer) == {"failed": 1}
    make_due(deps)
    assert deliver(deps, mailer) == {}

    with deps.sessions() as session:
        row = session.scalars(select(Notification)).one()
    assert row.status is NotificationStatus.FAILED and row.attempts == MAX_ATTEMPTS
    assert mailer.sent == []


def test_a_send_that_succeeds_on_retry_is_sent_once(deps: Deps, mailer: FakeMailer) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    contact = attach_contact(deps, report, "a@example.com")
    with deps.sessions() as session:
        session.add(Notification(report_id=report, contact_id=contact, event=E.RESOLVED))
        session.commit()
    mailer.failures = 1

    assert deliver(deps, mailer) == {"retrying": 1}
    make_due(deps)
    assert deliver(deps, mailer) == {"sent": 1}
    with deps.sessions() as session:
        row = session.scalars(select(Notification)).one()
    assert row.attempts == 2 and row.last_error is None


# Development: delivery right after the action


def test_in_development_a_dispatch_action_delivers_in_the_background(
    client: TestClient,
    deps: Deps,
    mailer: FakeMailer,
    dispatcher: dict[str, str],
    kicks: list[Callable[[], None]],
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    attach_contact(deps, report, "a@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])

    act(client, dispatcher, incident, "assign", {"team_id": str(team)})
    assert len(kicks) == 1
    kicks[0]()

    assert [e.subject for e in mailer.sent] == [
        "Update on your InfraAlert report: a repair team is assigned"
    ]


def test_no_background_delivery_when_a_scheduler_calls_tasks(
    client: TestClient, deps: Deps, dispatcher: dict[str, str], kicks: list[Callable[[], None]]
) -> None:
    deps.task_auth = object()  # type: ignore[assignment]
    incident = make_incident(deps)
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})
    assert kicks == []


# Unsubscribing


def test_unsubscribe_is_idempotent_and_stops_updates(
    client: TestClient, deps: Deps, mailer: FakeMailer, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    subscribe_and_verify(client, mailer, report, "alice@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})
    deliver(deps, mailer)
    match = re.search(r"/unsubscribe#token=(\S+)", mailer.sent[-1].text)
    assert match
    token = match.group(1)

    for _ in range(2):
        resp = client.post("/api/unsubscribe", json={"token": token})
        assert resp.status_code == 200
        assert resp.json() == {"status": "unsubscribed"}

    assert client.get(f"/api/reports/{report}").json()["updates_email_masked"] is None
    act(client, dispatcher, incident, "resolve", {})
    sent_before = len(mailer.sent)
    assert deliver(deps, mailer) == {}
    assert len(mailer.sent) == sent_before
    assert [e for _, e, _ in outbox(deps)] == [E.ASSIGNED]


def test_unsubscribing_cancels_an_update_already_queued(
    client: TestClient, deps: Deps, mailer: FakeMailer, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    contact = attach_contact(deps, report, "a@example.com")
    team = make_team(deps, "Roads A", [IssueType.POTHOLE])
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})

    token = unsubscribe_token(SECRET, report, contact)
    assert client.post("/api/unsubscribe", json={"token": token}).status_code == 200

    assert deliver(deps, mailer) == {}
    assert outbox(deps) == [(report, E.ASSIGNED, NotificationStatus.CANCELLED)]
    assert mailer.sent == []


def test_an_update_for_a_replaced_address_is_cancelled_at_send_time(
    deps: Deps, mailer: FakeMailer
) -> None:
    incident = make_incident(deps)
    [report] = reports_of(deps, incident)
    old = attach_contact(deps, report, "old@example.com")
    with deps.sessions() as session:
        session.add(Notification(report_id=report, contact_id=old, event=E.RESOLVED))
        session.commit()
    attach_contact(deps, report, "new@example.com")

    assert deliver(deps, mailer) == {"cancelled": 1}
    assert mailer.sent == []


@pytest.mark.parametrize(
    "token",
    [
        "garbage",
        f"{uuid.uuid4().hex}.{uuid.uuid4().hex}.AAAA",
        unsubscribe_token("another-secret", uuid.uuid4(), uuid.uuid4()),
    ],
)
def test_unsubscribe_rejects_a_token_that_isnt_ours(client: TestClient, token: str) -> None:
    resp = client.post("/api/unsubscribe", json={"token": token})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "invalid_token"}
