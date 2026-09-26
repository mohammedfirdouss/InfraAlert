from __future__ import annotations

import enum

from infraalert.db.models import IncidentStatus, ReportProcessing


class ReportStatus(enum.StrEnum):
    """What a citizen sees. See "Report status" in CONTEXT.md."""

    RECEIVED = "received"
    UNDER_REVIEW = "under_review"
    TEAM_ASSIGNED = "team_assigned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


_FROM_INCIDENT = {
    IncidentStatus.NEW: ReportStatus.UNDER_REVIEW,
    IncidentStatus.TRIAGED: ReportStatus.UNDER_REVIEW,
    IncidentStatus.ASSIGNED: ReportStatus.TEAM_ASSIGNED,
    IncidentStatus.ON_SITE: ReportStatus.IN_PROGRESS,
    IncidentStatus.RESOLVED: ReportStatus.RESOLVED,
    IncidentStatus.CLOSED_INVALID: ReportStatus.CLOSED,
}


def report_status(
    processing: ReportProcessing, incident_status: IncidentStatus | None
) -> ReportStatus:
    """
    `incident_status` must be that of the incident the report ultimately belongs
    to, i.e. after following any merges, so it is never CLOSED_DUPLICATE.
    """
    if processing is ReportProcessing.RECEIVED or incident_status is None:
        return ReportStatus.RECEIVED
    if incident_status is IncidentStatus.CLOSED_DUPLICATE:
        raise ValueError("follow merged_into_id to the surviving incident first")
    return _FROM_INCIDENT[incident_status]
