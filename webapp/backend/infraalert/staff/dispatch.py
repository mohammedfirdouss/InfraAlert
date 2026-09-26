"""
Dispatch actions (ADR 0005, 0006): a named staff member moves an incident
through its lifecycle. Every action locks the incident row, checks the
transition, and writes the audit log in the same transaction.

    new ─triage─▶ triaged ─assign─▶ assigned ─on_site─▶ on_site ─resolve─▶ resolved
     │              │                  │ ▲ reassign         │
     └──────────────┴──── close_invalid / merge (closed_duplicate) ──────┘

Team availability is never stored: ending an assignment (resolve, close, merge,
reassign) is what frees a team.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from infraalert.db.models import (
    Assignment,
    AuditLog,
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    Staff,
    Team,
)
from infraalert.processing.worker import rescore

S = IncidentStatus
OPEN = {S.NEW, S.TRIAGED, S.ASSIGNED, S.ON_SITE}
FROM = {
    "triage": {S.NEW, S.TRIAGED},
    "assign": {S.NEW, S.TRIAGED, S.ASSIGNED},
    "on_site": {S.ASSIGNED},
    "resolve": {S.ASSIGNED, S.ON_SITE},
    "close_invalid": OPEN,
    "merge": OPEN,
    "split": OPEN,
}


class DispatchError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def not_found() -> DispatchError:
    return DispatchError(404, "incident_not_found")


def _lock(session: Session, incident_id: uuid.UUID, action: str) -> Incident:
    incident = session.execute(
        select(Incident).where(Incident.id == incident_id).with_for_update()
    ).scalar_one_or_none()
    if incident is None:
        raise not_found()
    if incident.status not in FROM[action]:
        raise DispatchError(409, "invalid_transition")
    return incident


def _audit(
    session: Session, staff: Staff, action: str, incident_id: uuid.UUID, **detail: Any
) -> None:
    session.add(
        AuditLog(
            staff_id=staff.id,
            action=f"incident.{action}",
            entity_type="incident",
            entity_id=incident_id,
            detail={k: str(v) if isinstance(v, uuid.UUID) else v for k, v in detail.items()},
        )
    )


def _end_assignment(session: Session, incident_id: uuid.UUID) -> uuid.UUID | None:
    """End the incident's open assignment, freeing its team. Returns that team."""
    return session.execute(
        update(Assignment)
        .where(Assignment.incident_id == incident_id, Assignment.ended_at.is_(None))
        .values(ended_at=func.now())
        .returning(Assignment.team_id)
    ).scalar_one_or_none()


# Actions


def triage(session: Session, staff: Staff, incident_id: uuid.UUID, issue_type: IssueType) -> None:
    incident = _lock(session, incident_id, "triage")
    previous = incident.issue_type
    incident.issue_type = issue_type
    incident.status = S.TRIAGED
    session.flush()
    rescore(session, incident)
    _audit(session, staff, "triaged", incident.id, issue_type=issue_type, previous=previous)


def assign(session: Session, staff: Staff, incident_id: uuid.UUID, team_id: uuid.UUID) -> None:
    incident = _lock(session, incident_id, "assign")
    if incident.issue_type is None:
        raise DispatchError(409, "classify_first")
    team = session.get(Team, team_id)
    if team is None or not team.active:
        raise DispatchError(409, "team_unavailable")

    current_team = session.scalar(
        select(Assignment.team_id).where(
            Assignment.incident_id == incident.id, Assignment.ended_at.is_(None)
        )
    )
    if current_team == team_id:
        raise DispatchError(409, "already_assigned")
    previous_team = _end_assignment(session, incident.id)
    assignment = Assignment(
        incident_id=incident.id,
        team_id=team_id,
        suggested_team_id=incident.suggested_team_id,
        assigned_by=staff.id,
    )
    try:
        with session.begin_nested():
            session.add(assignment)
            session.flush()
    except IntegrityError as exc:
        # The partial unique index on open assignments: the team is on another job.
        raise DispatchError(409, "team_busy") from exc

    incident.status = S.ASSIGNED
    _audit(
        session,
        staff,
        "reassigned" if previous_team else "assigned",
        incident.id,
        team_id=team_id,
        previous_team_id=previous_team,
        suggested_team_id=incident.suggested_team_id,
        overridden=incident.suggested_team_id not in (None, team_id),
    )


def mark_on_site(session: Session, staff: Staff, incident_id: uuid.UUID) -> None:
    incident = _lock(session, incident_id, "on_site")
    incident.status = S.ON_SITE
    _audit(session, staff, "on_site", incident.id)


def resolve(session: Session, staff: Staff, incident_id: uuid.UUID, note: str | None) -> None:
    incident = _lock(session, incident_id, "resolve")
    incident.status = S.RESOLVED
    incident.resolved_at = func.now()
    team = _end_assignment(session, incident.id)
    _audit(session, staff, "resolved", incident.id, team_id=team, note=note)


def close_invalid(session: Session, staff: Staff, incident_id: uuid.UUID, reason: str) -> None:
    incident = _lock(session, incident_id, "close_invalid")
    incident.status = S.CLOSED_INVALID
    team = _end_assignment(session, incident.id)
    _audit(session, staff, "closed_invalid", incident.id, reason=reason, team_id=team)


def merge(
    session: Session, staff: Staff, incident_id: uuid.UUID, into_incident_id: uuid.UUID
) -> None:
    """Close `incident_id` as a duplicate of `into_incident_id`, moving its reports."""
    if incident_id == into_incident_id:
        raise DispatchError(409, "cannot_merge_into_itself")
    # Lock both in a fixed order so two opposite merges can't deadlock.
    first, second = sorted([incident_id, into_incident_id])
    locked = {i: _lock(session, i, "merge") for i in (first, second)}
    source, target = locked[incident_id], locked[into_incident_id]

    moved = (
        session.execute(
            update(Report)
            .where(Report.incident_id == source.id)
            .values(incident_id=target.id)
            .returning(Report.id)
        )
        .scalars()
        .all()
    )
    team = _end_assignment(session, source.id)
    source.status = S.CLOSED_DUPLICATE
    source.merged_into_id = target.id
    session.flush()
    rescore(session, target)
    _audit(session, staff, "merged", source.id, into=target.id, reports=len(moved), team_id=team)
    _audit(session, staff, "absorbed", target.id, source=source.id, reports=len(moved))


def split(
    session: Session, staff: Staff, incident_id: uuid.UUID, report_ids: list[uuid.UUID]
) -> uuid.UUID:
    """Move some of an incident's reports into a new incident. Returns its id."""
    incident = _lock(session, incident_id, "split")
    own = set(session.scalars(select(Report.id).where(Report.incident_id == incident.id)).all())
    chosen = set(report_ids)
    if not chosen or not chosen <= own:
        raise DispatchError(422, "reports_not_in_incident")
    if chosen == own:
        raise DispatchError(409, "cannot_split_all_reports")

    earliest = (
        select(Report.location)
        .where(Report.id.in_(chosen))
        .order_by(Report.submitted_at, Report.id)
        .limit(1)
        .scalar_subquery()
    )
    new = Incident(
        issue_type=incident.issue_type,
        status=S.TRIAGED if incident.issue_type else S.NEW,
        location=earliest,
    )
    session.add(new)
    session.flush()
    session.execute(update(Report).where(Report.id.in_(chosen)).values(incident_id=new.id))
    session.flush()
    rescore(session, incident)
    rescore(session, new)
    _audit(session, staff, "split", incident.id, new_incident=new.id, reports=len(chosen))
    _audit(session, staff, "split_from", new.id, source=incident.id, reports=len(chosen))
    return new.id
