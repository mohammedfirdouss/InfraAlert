from __future__ import annotations

import pytest

from infraalert.citizen.status import ReportStatus, report_status
from infraalert.db.models import IncidentStatus, ReportProcessing


@pytest.mark.parametrize(
    ("incident_status", "expected"),
    [
        (IncidentStatus.NEW, ReportStatus.UNDER_REVIEW),
        (IncidentStatus.TRIAGED, ReportStatus.UNDER_REVIEW),
        (IncidentStatus.ASSIGNED, ReportStatus.TEAM_ASSIGNED),
        (IncidentStatus.ON_SITE, ReportStatus.IN_PROGRESS),
        (IncidentStatus.RESOLVED, ReportStatus.RESOLVED),
        (IncidentStatus.CLOSED_INVALID, ReportStatus.CLOSED),
    ],
)
def test_processed_report_follows_incident(
    incident_status: IncidentStatus, expected: ReportStatus
) -> None:
    assert report_status(ReportProcessing.PROCESSED, incident_status) is expected


def test_triage_is_hidden_from_citizens() -> None:
    assert (
        report_status(ReportProcessing.NEEDS_TRIAGE, IncidentStatus.NEW)
        is ReportStatus.UNDER_REVIEW
    )


def test_unprocessed_report_is_received() -> None:
    assert report_status(ReportProcessing.RECEIVED, None) is ReportStatus.RECEIVED


def test_duplicate_must_be_resolved_to_its_survivor_first() -> None:
    with pytest.raises(ValueError):
        report_status(ReportProcessing.PROCESSED, IncidentStatus.CLOSED_DUPLICATE)
