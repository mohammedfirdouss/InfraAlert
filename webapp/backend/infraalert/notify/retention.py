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
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.orm import Session

from infraalert.db.models import Contact, ContactVerification, Incident, IncidentStatus, Report

SUBMITTER_KEY_TTL = timedelta(hours=24)
CONTACT_TTL_AFTER_CLOSE = timedelta(days=90)
OPEN_STATUSES = (
    IncidentStatus.NEW,
    IncidentStatus.TRIAGED,
    IncidentStatus.ASSIGNED,
    IncidentStatus.ON_SITE,
)


@dataclass(frozen=True)
class RetentionResult:
    submitter_keys_cleared: int
    verifications_deleted: int
    contacts_deleted: int


def run_retention(session: Session) -> RetentionResult:
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
        delete(Contact)
        .where(~needed_by_report, ~verification_pending)
        .returning(Contact.id)
    ).all()

    return RetentionResult(
        submitter_keys_cleared=len(keys),
        verifications_deleted=len(verifications),
        contacts_deleted=len(contacts),
    )
