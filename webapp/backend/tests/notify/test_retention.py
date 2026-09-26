from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from infraalert.db.models import (
    Contact,
    ContactKind,
    ContactVerification,
    Incident,
    IncidentStatus,
    Notification,
    NotificationEvent,
    Report,
    ReportProcessing,
)
from infraalert.notify.retention import run_retention

POINT = "SRID=4326;POINT(36.8219 -1.2921)"
DAY = timedelta(days=1)


def contact(session: Session) -> uuid.UUID:
    c = Contact(
        kind=ContactKind.EMAIL, address=f"{uuid.uuid4().hex}@example.com", verified_at=func.now()
    )
    session.add(c)
    session.flush()
    return c.id


def report(
    session: Session,
    contact_id: uuid.UUID | None = None,
    status: IncidentStatus | None = IncidentStatus.NEW,
    closed_ago: timedelta = timedelta(0),
    submitted_ago: timedelta = timedelta(0),
    submitter_key: str | None = None,
) -> uuid.UUID:
    """A report, on an incident in `status` (None: not processed yet)."""
    incident_id = None
    if status is not None:
        closed_at = func.now() - closed_ago
        incident = Incident(
            location=POINT,
            status=status,
            resolved_at=closed_at if status is IncidentStatus.RESOLVED else None,
            updated_at=closed_at,
        )
        session.add(incident)
        session.flush()
        incident_id = incident.id
    r = Report(
        description="Something is broken here",
        location=POINT,
        processing=ReportProcessing.RECEIVED if status is None else ReportProcessing.PROCESSED,
        incident_id=incident_id,
        contact_id=contact_id,
        submitted_at=func.now() - submitted_ago,
        submitter_key=submitter_key,
    )
    session.add(r)
    session.flush()
    return r.id


def verification(session: Session, contact_id: uuid.UUID, expires_in: timedelta) -> uuid.UUID:
    r = report(session)
    v = ContactVerification(
        contact_id=contact_id,
        report_id=r,
        token_hash=uuid.uuid4().hex,
        expires_at=func.now() + expires_in,
    )
    session.add(v)
    session.flush()
    return v.id


def exists(session: Session, model: type, id_: object) -> bool:
    return session.get(model, id_, populate_existing=True) is not None


def test_submitter_keys_are_cleared_after_a_day(session: Session) -> None:
    old = report(session, submitted_ago=25 * timedelta(hours=1), submitter_key="old")
    recent = report(session, submitted_ago=timedelta(hours=23), submitter_key="recent")

    result = run_retention(session)

    assert result.submitter_keys_cleared >= 1
    keys = dict(session.execute(select(Report.id, Report.submitter_key)).tuples().all())
    assert keys[old] is None
    assert keys[recent] == "recent"


def test_expired_verifications_are_deleted(session: Session) -> None:
    c = contact(session)
    expired = verification(session, c, expires_in=-timedelta(minutes=1))
    live = verification(session, c, expires_in=timedelta(hours=1))

    result = run_retention(session)

    assert result.verifications_deleted >= 1
    assert not exists(session, ContactVerification, expired)
    assert exists(session, ContactVerification, live)


def test_contacts_are_kept_while_needed_and_deleted_after(session: Session) -> None:
    kept = {
        "open incident": contact(session),
        "not processed yet": contact(session),
        "resolved 89 days ago": contact(session),
        "closed 89 days ago": contact(session),
        "mid-subscribe": contact(session),
        "one old, one open": contact(session),
    }
    deleted = {
        "resolved 91 days ago": contact(session),
        "closed invalid 91 days ago": contact(session),
        "unsubscribed": contact(session),
        "verification expired": contact(session),
    }
    report(session, kept["open incident"], IncidentStatus.ASSIGNED, closed_ago=400 * DAY)
    report(session, kept["not processed yet"], status=None)
    report(session, kept["resolved 89 days ago"], IncidentStatus.RESOLVED, closed_ago=89 * DAY)
    report(session, kept["closed 89 days ago"], IncidentStatus.CLOSED_INVALID, closed_ago=89 * DAY)
    verification(session, kept["mid-subscribe"], expires_in=timedelta(hours=2))
    report(session, kept["one old, one open"], IncidentStatus.RESOLVED, closed_ago=200 * DAY)
    report(session, kept["one old, one open"], IncidentStatus.ON_SITE)
    old_report = report(
        session, deleted["resolved 91 days ago"], IncidentStatus.RESOLVED, closed_ago=91 * DAY
    )
    session.add(
        Notification(
            report_id=old_report,
            contact_id=deleted["resolved 91 days ago"],
            event=NotificationEvent.RESOLVED,
        )
    )
    report(
        session,
        deleted["closed invalid 91 days ago"],
        IncidentStatus.CLOSED_INVALID,
        closed_ago=91 * DAY,
    )
    verification(session, deleted["verification expired"], expires_in=-timedelta(minutes=1))
    session.flush()

    result = run_retention(session)

    assert result.contacts_deleted >= len(deleted)
    for why, contact_id in kept.items():
        assert exists(session, Contact, contact_id), why
    for why, contact_id in deleted.items():
        assert not exists(session, Contact, contact_id), why
    # The report stays, unsubscribed; its sent notifications go with the contact.
    assert session.scalar(select(Report.contact_id).where(Report.id == old_report)) is None
    assert (
        session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.report_id == old_report)
        )
        == 0
    )
