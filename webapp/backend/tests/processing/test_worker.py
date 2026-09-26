from __future__ import annotations

import uuid
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from infraalert.db.models import (
    AuditLog,
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    ReportPhoto,
    ReportProcessing,
)
from infraalert.processing.extraction import ExtractionFailed, ExtractionUnavailable, HazardFlag
from infraalert.processing.worker import (
    MAX_EXTRACTION_ATTEMPTS,
    Outcome,
    Processor,
    RetryLater,
)
from tests.processing.conftest import FAR, NEAR, FakeExtractor, extraction

Submit = Callable[..., uuid.UUID]


def load(sessions: sessionmaker[Session], report_id: uuid.UUID) -> tuple[Report, Incident | None]:
    with sessions() as session:
        report = session.get(Report, report_id)
        assert report is not None
        incident = session.get(Incident, report.incident_id) if report.incident_id else None
        return report, incident


def audit(sessions: sessionmaker[Session], report_id: uuid.UUID) -> list[AuditLog]:
    with sessions() as session:
        return list(session.scalars(select(AuditLog).where(AuditLog.entity_id == report_id)))


# The happy path


def test_processing_extracts_creates_an_incident_scores_and_suggests(
    processor: Processor,
    sessions: sessionmaker[Session],
    submit: Submit,
    team: Callable[..., uuid.UUID],
    tmp_path: Path,
) -> None:
    roads = team("Roads 1", [IssueType.POTHOLE], NEAR)
    team("Lights 1", [IssueType.BROKEN_STREETLIGHT])  # closer, but wrong skill
    report_id = submit(photos=1)

    assert processor.process(report_id) is Outcome.PROCESSED

    report, incident = load(sessions, report_id)
    assert report.processing is ReportProcessing.PROCESSED
    assert (report.issue_type, report.confidence, report.extraction_model) == (
        IssueType.POTHOLE,
        0.9,
        "fake-model",
    )
    assert incident is not None
    assert incident.issue_type is IssueType.POTHOLE
    assert incident.status is IncidentStatus.NEW
    assert incident.formula_version == "v1"
    assert incident.priority_score is not None
    assert incident.priority_inputs is not None
    assert incident.priority_inputs["report_count"] == 1
    assert incident.suggested_team_id == roads

    [log] = audit(sessions, report_id)
    assert log.action == "report.processed" and log.staff_id is None
    assert log.detail["matched_existing_incident"] is False


def test_photos_are_claimed_and_shown_to_the_model(
    processor: Processor,
    sessions: sessionmaker[Session],
    submit: Submit,
    extractor: FakeExtractor,
    tmp_path: Path,
) -> None:
    report_id = submit(photos=2)

    processor.process(report_id)

    with sessions() as session:
        names = session.scalars(
            select(ReportPhoto.object_name).where(ReportPhoto.report_id == report_id)
        ).all()
    assert len(names) == 2
    assert all(n.startswith(f"reports/{report_id}/") for n in names)
    assert all((tmp_path / n).is_file() for n in names)
    assert not any((tmp_path / "uploads").iterdir())
    [(_, _, refs)] = extractor.calls
    assert [r.data for r in refs] == [b"jpeg-bytes", b"jpeg-bytes"]


def test_photos_never_uploaded_are_dropped(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit
) -> None:
    report_id = submit(photos=1, uploaded=False)

    processor.process(report_id)

    with sessions() as session:
        count = session.scalar(
            select(func.count()).select_from(ReportPhoto).where(ReportPhoto.report_id == report_id)
        )
    assert count == 0
    assert audit(sessions, report_id)[0].detail["photos_missing"] == 1


# Grouping into incidents (ADR 0006)


def test_nearby_report_of_the_same_type_joins_the_incident(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit
) -> None:
    first, second = submit(), submit(where=NEAR)
    processor.process(first)
    processor.process(second)

    (_, a), (_, b) = load(sessions, first), load(sessions, second)
    assert a is not None and b is not None
    assert a.id == b.id
    assert b.priority_inputs is not None and b.priority_inputs["report_count"] == 2
    assert audit(sessions, second)[0].detail["matched_existing_incident"] is True


@pytest.mark.parametrize(
    "setup",
    ["different_type", "too_far", "first_incident_resolved"],
)
def test_reports_that_must_not_be_grouped(
    setup: str,
    processor: Processor,
    sessions: sessionmaker[Session],
    submit: Submit,
    extractor: FakeExtractor,
) -> None:
    first = submit()
    processor.process(first)
    if setup == "first_incident_resolved":
        with sessions() as session:
            _, incident = load(sessions, first)
            assert incident is not None
            session.get(Incident, incident.id).status = IncidentStatus.RESOLVED  # type: ignore[union-attr]
            session.get(Incident, incident.id).resolved_at = func.now()  # type: ignore[union-attr]
            session.commit()
    if setup == "different_type":
        extractor.result = extraction(IssueType.WATER_LEAK)

    second = submit(where=FAR if setup == "too_far" else NEAR)
    processor.process(second)

    (_, a), (_, b) = load(sessions, first), load(sessions, second)
    assert a is not None and b is not None and a.id != b.id


def test_assigned_incident_keeps_its_team_when_new_reports_arrive(
    processor: Processor,
    sessions: sessionmaker[Session],
    submit: Submit,
    team: Callable[..., uuid.UUID],
) -> None:
    first = submit()
    processor.process(first)
    _, incident = load(sessions, first)
    assert incident is not None
    with sessions() as session:
        inc = session.get(Incident, incident.id)
        assert inc is not None
        inc.status, inc.suggested_team_id = IncidentStatus.ASSIGNED, None
        session.commit()
    team("Roads 1", [IssueType.POTHOLE])

    processor.process(submit(where=NEAR))

    _, after = load(sessions, first)
    assert after is not None
    assert after.suggested_team_id is None  # no re-suggestion once assigned
    assert after.priority_inputs is not None and after.priority_inputs["report_count"] == 2


def test_life_safety_hazard_is_critical(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit, extractor: FakeExtractor
) -> None:
    extractor.result = extraction(IssueType.OTHER, flags=frozenset({HazardFlag.GAS_LEAK}))
    report_id = submit()

    processor.process(report_id)

    report, incident = load(sessions, report_id)
    assert report.hazard_flags == ["gas_leak"]
    assert incident is not None and incident.priority_score is not None
    assert incident.priority_score >= 0.75


# Triage (ADR 0004)


def test_low_confidence_goes_to_triage_but_keeps_the_facts(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit, extractor: FakeExtractor
) -> None:
    extractor.result = extraction(IssueType.SEWAGE, confidence=0.4)
    report_id = submit()

    assert processor.process(report_id) is Outcome.NEEDS_TRIAGE

    report, incident = load(sessions, report_id)
    assert report.processing is ReportProcessing.NEEDS_TRIAGE
    assert report.issue_type is IssueType.SEWAGE  # shown to the dispatcher as a hint
    assert incident is not None
    assert incident.issue_type is None
    assert incident.priority_score is None and incident.suggested_team_id is None


def test_unclassified_reports_never_merge(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit, extractor: FakeExtractor
) -> None:
    extractor.result = ExtractionFailed("blocked")
    first, second = submit(), submit(where=NEAR)
    processor.process(first)
    processor.process(second)

    (_, a), (_, b) = load(sessions, first), load(sessions, second)
    assert a is not None and b is not None and a.id != b.id


def test_extraction_failure_goes_straight_to_triage(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit, extractor: FakeExtractor
) -> None:
    extractor.result = ExtractionFailed("unusable output")
    report_id = submit()

    assert processor.process(report_id) is Outcome.NEEDS_TRIAGE

    report, _ = load(sessions, report_id)
    assert report.issue_type is None
    [log] = audit(sessions, report_id)
    assert log.action == "report.needs_triage"
    assert log.detail["extraction_error"] == "failed: unusable output"


def test_model_outage_is_retried_then_triaged(
    processor: Processor,
    sessions: sessionmaker[Session],
    submit: Submit,
    extractor: FakeExtractor,
    tmp_path: Path,
) -> None:
    extractor.result = ExtractionUnavailable("503")
    report_id = submit(photos=1)

    for attempt in range(MAX_EXTRACTION_ATTEMPTS - 1):
        with pytest.raises(RetryLater):
            processor.process(report_id, attempt=attempt)
        report, _ = load(sessions, report_id)
        assert report.processing is ReportProcessing.RECEIVED  # nothing half-written
    # The photo was claimed on the first attempt; later attempts reuse it.
    assert not any((tmp_path / "uploads").iterdir())

    assert processor.process(report_id, attempt=MAX_EXTRACTION_ATTEMPTS - 1) is (
        Outcome.NEEDS_TRIAGE
    )
    assert audit(sessions, report_id)[0].detail["extraction_error"].startswith("unavailable")


# Idempotency


def test_processing_twice_changes_nothing(
    processor: Processor, sessions: sessionmaker[Session], submit: Submit, extractor: FakeExtractor
) -> None:
    report_id = submit()
    processor.process(report_id)

    assert processor.process(report_id) is Outcome.ALREADY_DONE
    assert len(extractor.calls) == 1
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Incident)) == 1
    assert len(audit(sessions, report_id)) == 1


def test_unknown_report(processor: Processor) -> None:
    assert processor.process(uuid.uuid4()) is Outcome.NOT_FOUND
