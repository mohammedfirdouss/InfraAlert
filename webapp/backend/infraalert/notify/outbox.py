"""
The notification outbox (ADR 0007).

Dispatch actions call `record_incident_event` inside their own transaction, so an
update is queued if and only if the status change commits. `deliver_pending` sends
queued rows afterwards: Cloud Scheduler calls POST /tasks/notifications every minute,
and in local development a background thread runs it after each dispatch action.

Each row is claimed with FOR UPDATE SKIP LOCKED and sent while its lock is held, so
concurrent deliverers never send the same row. Delivery is at-least-once: a crash
between sending and committing sends that one email again.
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import func, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from infraalert.config import Settings
from infraalert.db.models import (
    Contact,
    Notification,
    NotificationEvent,
    NotificationStatus,
    Report,
    notification_event_enum,
)
from infraalert.notify.emails import update_email
from infraalert.notify.mailer import Mailer
from infraalert.notify.tokens import unsubscribe_token

if TYPE_CHECKING:
    from infraalert.deps import Deps

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
MAX_ERROR_LENGTH = 500


def record_incident_event(
    session: Session, incident_id: uuid.UUID, event: NotificationEvent
) -> int:
    """
    Queue `event` for every report of the incident that has a verified contact, once
    per (report, event). Merged reports already point at the surviving incident.
    Returns how many were queued.
    """
    subscribed = (
        select(Report.id, Report.contact_id, literal(event, notification_event_enum))
        .join(Contact, Contact.id == Report.contact_id)
        .where(Report.incident_id == incident_id, Contact.verified_at.is_not(None))
    )
    result = session.execute(
        pg_insert(Notification)
        .from_select(["report_id", "contact_id", "event"], subscribed)
        .on_conflict_do_nothing(constraint="uq_notifications_report_id_event")
        .returning(Notification.id)
    )
    return len(result.all())


@dataclass
class DeliveryResult:
    sent: int = 0
    retrying: int = 0
    failed: int = 0
    cancelled: int = 0


def retry_delay(attempts: int) -> timedelta:
    """1, 2, 4, 8 minutes after the 1st, 2nd, 3rd, 4th failure."""
    return timedelta(minutes=2 ** (attempts - 1))


def deliver_pending(
    sessions: sessionmaker[Session], mailer: Mailer, settings: Settings, limit: int = 100
) -> DeliveryResult:
    """Send up to `limit` due notifications, one transaction each."""
    result = DeliveryResult()
    for _ in range(limit):
        with sessions() as session:
            notification = session.execute(
                select(Notification)
                .where(
                    Notification.status == NotificationStatus.PENDING,
                    Notification.next_attempt_at <= func.now(),
                )
                .order_by(Notification.next_attempt_at, Notification.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            ).scalar_one_or_none()
            if notification is None:
                break
            outcome = _deliver(session, notification, mailer, settings)
            session.commit()
        setattr(result, outcome, getattr(result, outcome) + 1)
    return result


def _deliver(
    session: Session, notification: Notification, mailer: Mailer, settings: Settings
) -> str:
    report = session.get_one(Report, notification.report_id)
    contact = session.get_one(Contact, notification.contact_id)
    if report.contact_id != contact.id or contact.verified_at is None:
        # Unsubscribed (or replaced by another address) since this was queued.
        notification.status = NotificationStatus.CANCELLED
        return "cancelled"

    email = update_email(
        to=contact.address,
        base_url=settings.public_base_url,
        report_id=report.id,
        description=report.description,
        event=notification.event,
        unsubscribe_token=unsubscribe_token(settings.rate_limit_secret, report.id, contact.id),
    )
    notification.attempts += 1
    try:
        mailer.send(email)
    except Exception as exc:
        notification.last_error = f"{type(exc).__name__}: {exc}"[:MAX_ERROR_LENGTH]
        # The address is personal data: log the row, not the recipient.
        logger.warning(
            "Notification %s failed (attempt %d): %s",
            notification.id,
            notification.attempts,
            notification.last_error,
        )
        if notification.attempts >= MAX_ATTEMPTS:
            notification.status = NotificationStatus.FAILED
            return "failed"
        notification.next_attempt_at = func.now() + retry_delay(notification.attempts)
        return "retrying"
    notification.status = NotificationStatus.SENT
    notification.sent_at = func.now()
    notification.last_error = None
    return "sent"


# Local development has no Cloud Scheduler: deliver right after a dispatch action.


def _start_thread(target: Callable[[], None]) -> None:
    threading.Thread(target=target, daemon=True, name="notify-delivery").start()


def kick_delivery(deps: Deps) -> None:
    """Deliver in a background thread, only when no scheduler calls /tasks (development)."""
    mailer = deps.mailer
    if deps.task_auth is not None or mailer is None:
        return

    def run() -> None:
        try:
            deliver_pending(deps.sessions, mailer, deps.settings)
        except Exception:
            logger.exception("Background notification delivery failed")

    _start_thread(run)
