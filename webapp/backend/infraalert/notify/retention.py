"""
Deleting citizen personal data once it has served its purpose (ADR 0007). Run daily
by POST /tasks/retention.

1. `reports.submitter_key` (an HMAC of the submitter's IP) is only for the one-hour
   rate limit, so it is cleared once the report is 24 hours old.
2. Verification links are deleted once expired (24 hours), used or not.
3. A contact is deleted unless it is still needed, i.e. unless either
   - it has a verification link that hasn't expired (someone is mid-subscribe), or
   - a report is subscribed with it whose incident is still open (or that has no
     incident yet), or was resolved or closed less than 90 days ago.
   "Closed at" is the incident's last change (`updated_at`, or `resolved_at` if later).
   Deleting a contact unsubscribes its reports (ON DELETE SET NULL) and deletes its
   verification links and notifications (ON DELETE CASCADE).
4. Photos (ADR 0008) are deleted, from storage and then from the database, once
   their report's incident was resolved or closed 90 days ago. A photo whose file
   couldn't be deleted keeps its row, so the next run tries again.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.orm import Session

from infraalert.db.models import (
    OPEN_STATUSES,
    Contact,
    ContactVerification,
    Incident,
    Report,
    ReportPhoto,
)
from infraalert.storage import PhotoStorage

logger = logging.getLogger(__name__)

SUBMITTER_KEY_TTL = timedelta(hours=24)
CONTACT_TTL_AFTER_CLOSE = timedelta(days=90)
PHOTO_TTL_AFTER_CLOSE = timedelta(days=90)
# Photos deleted per run; a backlog drains over the following days.
PHOTO_BATCH = 500


@dataclass(frozen=True)
class RetentionResult:
    submitter_keys_cleared: int
    verifications_deleted: int
    contacts_deleted: int
    photos_deleted: int = 0


def run_retention(session: Session, storage: PhotoStorage | None = None) -> RetentionResult:
    """Apply every rule. Photos are only expired when `storage` is given."""
    now = func.now()
    keys = session.execute(
        update(Report)
        .where(Report.submitter_key.is_not(None), Report.submitted_at < now - SUBMITTER_KEY_TTL)
        .values(submitter_key=None)
        .returning(Report.id)
    ).all()

    verifications = session.execute(
        delete(ContactVerification)
        .where(ContactVerification.expires_at <= now)
        .returning(ContactVerification.id)
    ).all()

    incident_still_relevant = exists(
        select(Incident.id).where(
            Incident.id == Report.incident_id,
            or_(
                Incident.status.in_(OPEN_STATUSES),
                func.greatest(Incident.updated_at, Incident.resolved_at)
                > now - CONTACT_TTL_AFTER_CLOSE,
            ),
        )
    )
    needed_by_report = exists(
        select(Report.id).where(
            Report.contact_id == Contact.id,
            or_(Report.incident_id.is_(None), incident_still_relevant),
        )
    )
    # Expired ones were deleted above, so any left are live.
    verification_pending = exists(
        select(ContactVerification.id).where(ContactVerification.contact_id == Contact.id)
    )
    contacts = session.execute(
        delete(Contact).where(~needed_by_report, ~verification_pending).returning(Contact.id)
    ).all()

    return RetentionResult(
        submitter_keys_cleared=len(keys),
        verifications_deleted=len(verifications),
        contacts_deleted=len(contacts),
        photos_deleted=expire_photos(session, storage) if storage is not None else 0,
    )


def expire_photos(session: Session, storage: PhotoStorage) -> int:
    """Delete up to PHOTO_BATCH photos of long-closed incidents. Returns how many."""
    expired = session.execute(
        select(ReportPhoto.id, ReportPhoto.object_name)
        .join(Report, Report.id == ReportPhoto.report_id)
        .join(Incident, Incident.id == Report.incident_id)
        .where(
            Incident.status.not_in(OPEN_STATUSES),
            func.greatest(Incident.updated_at, Incident.resolved_at)
            <= func.now() - PHOTO_TTL_AFTER_CLOSE,
        )
        .order_by(ReportPhoto.uploaded_at)
        .limit(PHOTO_BATCH)
    ).all()
    removed = []
    for photo_id, object_name in expired:
        try:
            storage.delete(object_name)
        except Exception:
            logger.exception("Could not delete expired photo %s; will retry", photo_id)
            continue
        removed.append(photo_id)
    if removed:
        session.execute(delete(ReportPhoto).where(ReportPhoto.id.in_(removed)))
    return len(removed)
