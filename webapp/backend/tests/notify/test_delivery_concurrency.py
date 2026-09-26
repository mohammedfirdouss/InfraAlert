"""
Two deliverers at once, each on its own connection with real commits. A barrier in the
mailer holds both mid-send, so each must have claimed a different row: without
SKIP LOCKED the second would block on the first's row lock and the barrier time out.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from infraalert.db.models import (
    Contact,
    ContactKind,
    Incident,
    IncidentStatus,
    Notification,
    NotificationEvent,
    NotificationStatus,
    Report,
    ReportProcessing,
)
from infraalert.notify.mailer import Email
from infraalert.notify.outbox import DeliveryResult, deliver_pending
from tests.notify.conftest import settings

ROWS = 6


class BarrierMailer:
    """Each thread's first send waits for the other thread's first send."""

    def __init__(self) -> None:
        self._barrier = threading.Barrier(2, timeout=10)
        self._local = threading.local()
        self._lock = threading.Lock()
        self.sent: list[str] = []

    def send(self, email: Email) -> None:
        if not getattr(self._local, "waited", False):
            self._local.waited = True
            self._barrier.wait()
        with self._lock:
            self.sent.append(email.to)


@pytest.fixture()
def committed(engine: Engine) -> Iterator[tuple[sessionmaker[Session], uuid.UUID]]:
    """ROWS pending updates on one incident, really committed, cleaned up afterwards."""
    sessions = sessionmaker(engine, expire_on_commit=False)
    contact_ids: list[uuid.UUID] = []
    with sessions() as session:
        incident = Incident(
            location="SRID=4326;POINT(0 0)",
            status=IncidentStatus.RESOLVED,
            resolved_at=func.now(),
        )
        session.add(incident)
        session.flush()
        for n in range(ROWS):
            contact = Contact(
                kind=ContactKind.EMAIL,
                address=f"c{n}-{uuid.uuid4().hex}@x.test",
                verified_at=func.now(),
            )
            session.add(contact)
            session.flush()
            report = Report(
                description=f"Problem {n}",
                location="SRID=4326;POINT(0 0)",
                processing=ReportProcessing.PROCESSED,
                incident_id=incident.id,
                contact_id=contact.id,
            )
            session.add(report)
            session.flush()
            session.add(
                Notification(
                    report_id=report.id, contact_id=contact.id, event=NotificationEvent.RESOLVED
                )
            )
            contact_ids.append(contact.id)
        session.commit()
        incident_id = incident.id
    yield sessions, incident_id
    with sessions() as session:
        # Notifications go with their reports and contacts (ON DELETE CASCADE).
        session.execute(delete(Report).where(Report.incident_id == incident_id))
        session.execute(delete(Contact).where(Contact.id.in_(contact_ids)))
        session.execute(delete(Incident).where(Incident.id == incident_id))
        session.commit()


def test_two_deliverers_never_send_the_same_notification(
    committed: tuple[sessionmaker[Session], uuid.UUID],
) -> None:
    sessions, incident_id = committed
    mailer = BarrierMailer()

    def run(_: int) -> DeliveryResult:
        return deliver_pending(sessions, mailer, settings(), limit=ROWS)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(run, range(2)))

    assert sum(r.sent for r in results) == ROWS
    assert all(r.sent >= 1 for r in results)  # both really worked at the same time
    assert all(r.retrying == 0 for r in results)  # nobody timed out waiting on a lock
    assert len(mailer.sent) == len(set(mailer.sent)) == ROWS
    with sessions() as session:
        statuses = session.scalars(
            select(Notification.status).join(Report).where(Report.incident_id == incident_id)
        ).all()
    assert statuses == [NotificationStatus.SENT] * ROWS
