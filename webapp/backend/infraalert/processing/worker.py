"""
Processes one accepted report (ADR 0002, 0004, 0006):

    claim photos → extract facts → attach to an incident → score it → suggest a team

Safe to run more than once for the same report: Cloud Tasks delivers at least
once, and the sweep re-enqueues stuck reports. The slow, external steps (photo
moves, the model call) happen before the write transaction; the write
transaction re-checks the report under a row lock and does nothing if another
run got there first.
"""

from __future__ import annotations

import enum
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import any_, exists, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from infraalert.db.models import (
    OPEN_STATUSES,
    Assignment,
    AuditLog,
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    ReportProcessing,
    Team,
)
from infraalert.processing.extraction import (
    Extraction,
    ExtractionFailed,
    ExtractionUnavailable,
    Extractor,
    HazardFlag,
)
from infraalert.processing.priority import (
    PriorityInputs,
    nearby_sensitive_places,
    score,
    suggest_team,
)
from infraalert.storage import PhotoStorage

logger = logging.getLogger(__name__)

# A new report joins an open incident of the same type this close by (ADR 0006).
MATCH_RADIUS_M = 75
# Below this, the extracted issue type isn't trusted: a human triages the report.
MIN_CONFIDENCE = 0.6
# Model outages are retried by the queue this many times before triage.
MAX_EXTRACTION_ATTEMPTS = 3

# Once a dispatcher has assigned a team, the system stops re-suggesting one.
SUGGESTABLE_STATUSES = (IncidentStatus.NEW, IncidentStatus.TRIAGED)


class Outcome(enum.StrEnum):
    PROCESSED = "processed"
    NEEDS_TRIAGE = "needs_triage"
    ALREADY_DONE = "already_done"
    NOT_FOUND = "not_found"


class RetryLater(Exception):
    """The model is unavailable; the queue should redeliver the task."""


@dataclass
class Processor:
    sessions: sessionmaker[Session]
    storage: PhotoStorage
    extractor: Extractor

    def process(self, report_id: uuid.UUID, attempt: int = 0) -> Outcome:
        """`attempt` counts earlier deliveries of this task (0 on the first)."""
        with self.sessions() as session:
            report = session.get(Report, report_id)
            if report is None:
                return Outcome.NOT_FOUND
            if report.processing is not ReportProcessing.RECEIVED:
                return Outcome.ALREADY_DONE
            description, address_text = report.description, report.address_text
            photos = [(p.id, p.object_name, p.content_type) for p in report.photos]

        claimed = self._claim_photos(report_id, photos)
        extraction, failure = self._extract(description, address_text, claimed, attempt)

        with self.sessions() as session, session.begin():
            return self._record(session, report_id, claimed, extraction, failure)

    def give_up(self, report_id: uuid.UUID, reason: str) -> Outcome:
        """
        Send a report that keeps failing to process to human triage, without the
        model, so it can't sit in `received` (and be re-enqueued) forever.
        """
        with self.sessions() as session:
            report = session.get(Report, report_id)
            if report is None:
                return Outcome.NOT_FOUND
            if report.processing is not ReportProcessing.RECEIVED:
                return Outcome.ALREADY_DONE
            photos = [(p.id, p.object_name, p.content_type) for p in report.photos]
        claimed: dict[uuid.UUID, tuple[str, str] | None]
        try:
            claimed = self._claim_photos(report_id, photos)
        except Exception:
            # Storage may be what keeps failing: keep the photos as they are.
            logger.exception("Could not claim photos while giving up on report %s", report_id)
            claimed = {photo_id: (name, content_type) for photo_id, name, content_type in photos}
        with self.sessions() as session, session.begin():
            return self._record(session, report_id, claimed, None, reason)

    # Slow, external steps

    def _claim_photos(
        self, report_id: uuid.UUID, photos: list[tuple[uuid.UUID, str, str]]
    ) -> dict[uuid.UUID, tuple[str, str] | None]:
        """Photo id → (claimed object name, content type), or None if never uploaded."""
        claimed: dict[uuid.UUID, tuple[str, str] | None] = {}
        for photo_id, object_name, content_type in photos:
            if object_name.startswith("uploads/"):
                new_name = self.storage.claim(object_name, report_id)
            else:
                new_name = object_name  # claimed by an earlier run
            claimed[photo_id] = (new_name, content_type) if new_name else None
        return claimed

    def _extract(
        self,
        description: str,
        address_text: str | None,
        claimed: dict[uuid.UUID, tuple[str, str] | None],
        attempt: int,
    ) -> tuple[Extraction | None, str | None]:
        refs = [self.storage.photo_ref(name, ct) for name, ct in filter(None, claimed.values())]
        try:
            return self.extractor.extract(description, address_text, refs), None
        except ExtractionUnavailable as exc:
            if attempt + 1 < MAX_EXTRACTION_ATTEMPTS:
                raise RetryLater(str(exc)) from exc
            logger.warning("Extraction still unavailable after %d attempts", attempt + 1)
            return None, f"unavailable: {exc}"
        except ExtractionFailed as exc:
            return None, f"failed: {exc}"

    # The write transaction

    def _record(
        self,
        session: Session,
        report_id: uuid.UUID,
        claimed: dict[uuid.UUID, tuple[str, str] | None],
        extraction: Extraction | None,
        failure: str | None,
    ) -> Outcome:
        report = session.execute(
            select(Report).where(Report.id == report_id).with_for_update()
        ).scalar_one()
        if report.processing is not ReportProcessing.RECEIVED:
            return Outcome.ALREADY_DONE  # a concurrent run finished first

        for photo in list(report.photos):
            result = claimed.get(photo.id)
            if result is None:
                session.delete(photo)
            else:
                photo.object_name = result[0]

        if extraction is not None:
            report.issue_type = extraction.issue_type
            report.hazard_flags = sorted(extraction.hazard_flags)
            report.summary = extraction.summary
            report.confidence = extraction.confidence
            report.extraction_model = extraction.model
        confident = extraction is not None and extraction.confidence >= MIN_CONFIDENCE

        matched = False
        if confident:
            assert extraction is not None
            incident = _match_incident(session, report.id, extraction.issue_type)
            matched = incident is not None
            if incident is None:
                incident = _new_incident(session, report.id, extraction.issue_type)
        else:
            # Unclassified reports never auto-merge: a dispatcher decides (ADR 0006).
            incident = _new_incident(session, report.id, None)

        report.incident_id = incident.id
        report.processing = (
            ReportProcessing.PROCESSED if confident else ReportProcessing.NEEDS_TRIAGE
        )
        session.flush()
        if confident:
            rescore(session, incident)

        outcome = Outcome.PROCESSED if confident else Outcome.NEEDS_TRIAGE
        detail: dict[str, Any] = {
            "incident_id": str(incident.id),
            "matched_existing_incident": matched,
            "photos_missing": sum(1 for v in claimed.values() if v is None),
        }
        if extraction is not None:
            detail["confidence"] = extraction.confidence
        if failure is not None:
            detail["extraction_error"] = failure
        session.add(
            AuditLog(
                staff_id=None,
                action=f"report.{outcome}",
                entity_type="report",
                entity_id=report.id,
                detail=detail,
            )
        )
        return outcome


def _report_location(report_id: uuid.UUID) -> Any:
    return select(Report.location).where(Report.id == report_id).scalar_subquery()


def _match_incident(
    session: Session, report_id: uuid.UUID, issue_type: IssueType
) -> Incident | None:
    # Serialise matching per issue type, so two reports of the same burst main
    # processed at the same moment can't both create an incident.
    session.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"match:{issue_type}"))))
    here = _report_location(report_id)
    return session.scalars(
        select(Incident)
        .where(
            Incident.issue_type == issue_type,
            Incident.status.in_(OPEN_STATUSES),
            func.ST_DWithin(Incident.location, here, MATCH_RADIUS_M),
        )
        .order_by(func.ST_Distance(Incident.location, here), Incident.created_at)
        .limit(1)
    ).first()


def _new_incident(session: Session, report_id: uuid.UUID, issue_type: IssueType | None) -> Incident:
    incident = Incident(issue_type=issue_type, location=_report_location(report_id))
    session.add(incident)
    session.flush()
    return incident


def rescore(session: Session, incident: Incident) -> None:
    """Recompute an incident's priority and suggested team from all its reports."""
    if incident.issue_type is None:
        return
    rows = session.execute(
        select(Report.hazard_flags).where(Report.incident_id == incident.id)
    ).all()
    known = {flag.value for flag in HazardFlag}
    flags = frozenset(
        HazardFlag(flag) for (report_flags,) in rows for flag in report_flags if flag in known
    )
    priority = score(
        PriorityInputs(
            issue_type=incident.issue_type,
            hazard_flags=flags,
            report_count=len(rows),
            nearby_places=nearby_sensitive_places(session, incident.id),
        )
    )
    incident.priority_score = priority.score
    incident.formula_version = priority.formula_version
    incident.priority_inputs = priority.inputs
    if incident.status in SUGGESTABLE_STATUSES:
        incident.suggested_team_id = suggest_team(session, incident.id)


# Keeping the other open incidents current


def lock_dispatch(session: Session) -> None:
    """
    Serialise, until the transaction ends, everything that changes which teams are
    free or how incidents score: dispatch actions, team and sensitive-place edits,
    the OSM import. Each of them updates other incidents' suggestions or scores, so
    two running at once could deadlock on each other's rows. Take it first.
    """
    session.execute(select(func.pg_advisory_xact_lock(func.hashtext("dispatch"))))


def refresh_suggested_teams(session: Session) -> None:
    """
    Re-suggest a team for every incident still waiting for one (same rule as
    priority.suggest_team). Call after a team is taken, freed or edited: otherwise
    the queue keeps suggesting a team that has just gone to another job.
    """
    open_assignment = exists().where(Assignment.team_id == Team.id, Assignment.ended_at.is_(None))
    best = (
        select(Team.id)
        .where(
            Team.active.is_(True),
            ~open_assignment,
            Incident.issue_type == any_(Team.skills),
        )
        .order_by(func.ST_Distance(Team.base_location, Incident.location), Team.name)
        .limit(1)
        .correlate(Incident)
        .scalar_subquery()
    )
    session.flush()
    session.execute(
        update(Incident)
        .where(
            Incident.status.in_(SUGGESTABLE_STATUSES),
            Incident.issue_type.is_not(None),
            Incident.suggested_team_id.is_distinct_from(best),
        )
        .values(suggested_team_id=best)
        .execution_options(synchronize_session=False)
    )
    for loaded in session.identity_map.values():
        if isinstance(loaded, Incident):
            session.expire(loaded, ["suggested_team_id", "updated_at"])


def rescore_open_incidents(session: Session) -> int:
    """
    Recompute priority (and suggestion) for every open, classified incident. Call
    after sensitive places change. Returns how many were looked at.
    """
    incidents = session.scalars(
        select(Incident).where(Incident.status.in_(OPEN_STATUSES), Incident.issue_type.is_not(None))
    ).all()
    for incident in incidents:
        rescore(session, incident)
    session.flush()
    return len(incidents)
