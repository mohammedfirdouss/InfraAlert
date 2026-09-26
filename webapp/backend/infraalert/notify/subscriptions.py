"""
Subscribing a report to email updates (ADR 0007): ask, verify by magic link, unsubscribe.

A subscription is `reports.contact_id` pointing at a verified contact. The contact row
is shared by every report that address follows; the address itself never leaves the
contacts table except in emails and, masked, on the report's status page.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from infraalert.db.models import (
    AuditLog,
    Contact,
    ContactKind,
    ContactVerification,
    Notification,
    NotificationStatus,
    Report,
)
from infraalert.notify.tokens import (
    hash_token,
    mask_email,
    new_verification_token,
    read_unsubscribe_token,
)
from infraalert.ratelimit import WINDOW

VERIFICATION_TTL = timedelta(hours=24)
# However many clients ask, one report sends at most this many confirmation emails an hour.
MAX_REQUESTS_PER_REPORT_PER_HOUR = 5


def report_exists(session: Session, report_id: uuid.UUID) -> bool:
    return session.scalar(select(Report.id).where(Report.id == report_id)) is not None


def over_limit(
    session: Session, report_id: uuid.UUID, requester_key: str | None, per_client_limit: int
) -> bool:
    recent = ContactVerification.created_at > func.now() - WINDOW
    per_report = session.scalar(
        select(func.count())
        .select_from(ContactVerification)
        .where(ContactVerification.report_id == report_id, recent)
    )
    if (per_report or 0) >= MAX_REQUESTS_PER_REPORT_PER_HOUR:
        return True
    if requester_key is None:
        return False
    per_client = session.scalar(
        select(func.count())
        .select_from(ContactVerification)
        .where(ContactVerification.requester_key == requester_key, recent)
    )
    return (per_client or 0) >= per_client_limit


def start_verification(
    session: Session, report_id: uuid.UUID, email: str, requester_key: str | None
) -> str:
    """
    Record a verification for `email` on the report and return its raw token. Done the
    same way whether or not the address is already known or subscribed, so the response
    can't reveal either.
    """
    contact_id = session.scalar(
        pg_insert(Contact)
        .values(kind=ContactKind.EMAIL, address=email)
        # A no-op update, so RETURNING gives the id of an existing row too.
        .on_conflict_do_update(constraint="uq_contacts_kind_address", set_={"address": email})
        .returning(Contact.id)
    )
    assert contact_id is not None
    token = new_verification_token()
    session.add(
        ContactVerification(
            contact_id=contact_id,
            report_id=report_id,
            token_hash=hash_token(token),
            requester_key=requester_key,
            expires_at=func.now() + VERIFICATION_TTL,
        )
    )
    session.flush()
    return token


def verify(session: Session, report_id: uuid.UUID, token: str) -> str | None:
    """
    Use a verification token: the contact becomes verified and the report's update
    address. Returns the masked address, or None for a wrong, expired or used token.
    """
    verification = session.execute(
        select(ContactVerification)
        .where(
            ContactVerification.token_hash == hash_token(token),
            ContactVerification.report_id == report_id,
            ContactVerification.used_at.is_(None),
            ContactVerification.expires_at > func.now(),
        )
        .with_for_update()
    ).scalar_one_or_none()
    if verification is None:
        return None
    verification.used_at = func.now()

    contact = session.get_one(Contact, verification.contact_id)
    if contact.verified_at is None:
        contact.verified_at = func.now()
    session.execute(update(Report).where(Report.id == report_id).values(contact_id=contact.id))
    # The address is personal data and stays out of the audit log.
    session.add(
        AuditLog(
            staff_id=None,
            action="report.updates_subscribed",
            entity_type="report",
            entity_id=report_id,
            detail={"contact_kind": contact.kind.value},
        )
    )
    session.flush()
    return mask_email(contact.address)


def unsubscribe(session: Session, secret: str, token: str) -> bool:
    """
    Detach the token's contact from its report and cancel anything not yet sent.
    Idempotent. Returns False only when the token isn't genuine.
    """
    ids = read_unsubscribe_token(secret, token)
    if ids is None:
        return False
    report_id, contact_id = ids
    detached = session.execute(
        update(Report)
        .where(Report.id == report_id, Report.contact_id == contact_id)
        .values(contact_id=None)
        .returning(Report.id)
    ).scalar_one_or_none()
    session.execute(
        update(Notification)
        .where(
            Notification.report_id == report_id,
            Notification.contact_id == contact_id,
            Notification.status == NotificationStatus.PENDING,
        )
        .values(status=NotificationStatus.CANCELLED)
    )
    if detached is not None:
        session.add(
            AuditLog(
                staff_id=None,
                action="report.updates_unsubscribed",
                entity_type="report",
                entity_id=report_id,
                detail={},
            )
        )
    session.flush()
    return True


def masked_update_email(session: Session, contact_id: uuid.UUID | None) -> str | None:
    """The report's verified update address, masked, e.g. 'a•••@gmail.com'."""
    if contact_id is None:
        return None
    address = session.scalar(
        select(Contact.address).where(
            Contact.id == contact_id,
            Contact.kind == ContactKind.EMAIL,
            Contact.verified_at.is_not(None),
        )
    )
    return mask_email(address) if address else None
