"""
What staff see: the queue, an incident's full picture, and the options for acting
on it. Read-only; every change goes through infraalert.staff.dispatch.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from geoalchemy2 import Geometry
from sqlalchemy import Float, and_, case, cast, func, literal, select
from sqlalchemy.orm import Session, aliased

from infraalert.db.models import (
    Assignment,
    AuditLog,
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    ReportPhoto,
    ReportProcessing,
    Staff,
    Team,
)
from infraalert.processing.priority import severity
from infraalert.staff.dispatch import OPEN
from infraalert.storage import PhotoStorage

# Queue order (ADR 0004): priority first, plus a small bonus per day waiting so
# old LOW items still surface. Applied only when sorting; never stored in the score.
AGE_BOOST_PER_DAY = 0.02
AGE_BOOST_MAX_DAYS = 7
# Unscored incidents (untriaged) sort as if they were MEDIUM.
UNSCORED_RANK = 0.45
# How far to look for merge candidates.
NEARBY_RADIUS_M = 150
RECENTLY_CLOSED_DAYS = 7

Tab = Literal["triage", "open", "closed"]


@dataclass(frozen=True)
class LatLng:
    lat: float
    lng: float


@dataclass(frozen=True)
class TeamRef:
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class QueueItem:
    id: uuid.UUID
    status: IncidentStatus
    issue_type: IssueType | None
    priority_score: float | None
    severity: str | None
    report_count: int
    hazard_flags: list[str]
    headline: str  # the latest summary, or the first description
    address_text: str | None
    location: LatLng
    created_at: datetime
    suggested_team: TeamRef | None
    assigned_team: TeamRef | None


def _latlng(column: Any) -> tuple[Any, Any]:
    point = cast(column, Geometry)
    return func.ST_Y(point), func.ST_X(point)


def _age_days(column: Any) -> Any:
    return func.extract("epoch", func.now() - column) / 86400.0


def queue(session: Session, tab: Tab, issue_type: IssueType | None = None) -> list[QueueItem]:
    suggested, assigned_team = aliased(Team), aliased(Team)
    open_assignment = aliased(Assignment)
    rank = func.coalesce(Incident.priority_score, UNSCORED_RANK) + func.least(
        _age_days(Incident.created_at), AGE_BOOST_MAX_DAYS
    ) * literal(AGE_BOOST_PER_DAY, Float)

    report_count = (
        select(func.count())
        .where(Report.incident_id == Incident.id)
        .correlate(Incident)
        .scalar_subquery()
    )
    latest = (
        select(Report)
        .where(Report.incident_id == Incident.id)
        .order_by(Report.submitted_at.desc())
        .limit(1)
        .correlate(Incident)
        .subquery()
        .lateral()
    )
    lat, lng = _latlng(Incident.location)

    stmt = (
        select(
            Incident,
            report_count,
            latest.c.summary,
            latest.c.description,
            latest.c.address_text,
            lat,
            lng,
            suggested.id,
            suggested.name,
            assigned_team.id,
            assigned_team.name,
        )
        .select_from(Incident)
        .join(latest, literal(True))
        .outerjoin(suggested, suggested.id == Incident.suggested_team_id)
        .outerjoin(
            open_assignment,
            and_(open_assignment.incident_id == Incident.id, open_assignment.ended_at.is_(None)),
        )
        .outerjoin(assigned_team, assigned_team.id == open_assignment.team_id)
    )
    if tab == "triage":
        stmt = stmt.where(Incident.status.in_(OPEN), Incident.issue_type.is_(None))
    elif tab == "open":
        stmt = stmt.where(Incident.status.in_(OPEN), Incident.issue_type.is_not(None))
    else:
        stmt = stmt.where(
            Incident.status.in_([IncidentStatus.RESOLVED, IncidentStatus.CLOSED_INVALID]),
            Incident.updated_at > func.now() - func.make_interval(0, 0, 0, RECENTLY_CLOSED_DAYS),
        )
    if issue_type is not None:
        stmt = stmt.where(Incident.issue_type == issue_type)
    if tab == "closed":
        stmt = stmt.order_by(Incident.updated_at.desc())
    else:
        # Assigned work sinks below work still waiting for a team.
        waiting = case((Incident.status.in_([IncidentStatus.NEW, IncidentStatus.TRIAGED]), 0), else_=1)
        stmt = stmt.order_by(waiting, rank.desc(), Incident.created_at)

    rows = session.execute(stmt.limit(500)).all()
    flags = _hazard_flags(session, [row[0].id for row in rows])
    items = []
    for row in rows:
        incident: Incident = row[0]
        items.append(
            QueueItem(
                id=incident.id,
                status=incident.status,
                issue_type=incident.issue_type,
                priority_score=incident.priority_score,
                severity=severity(incident.priority_score)
                if incident.priority_score is not None
                else None,
                report_count=row[1],
                hazard_flags=flags.get(incident.id, []),
                headline=row[2] or row[3],
                address_text=row[4],
                location=LatLng(row[5], row[6]),
                created_at=incident.created_at,
                suggested_team=TeamRef(row[7], row[8]) if row[7] else None,
                assigned_team=TeamRef(row[9], row[10]) if row[9] else None,
            )
        )
    return items


def _hazard_flags(
    session: Session, incident_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    """The union of hazard flags across each incident's reports."""
    if not incident_ids:
        return {}
    flag = func.unnest(Report.hazard_flags).table_valued("flag").render_derived()
    stmt = (
        select(Report.incident_id, flag.c.flag)
        .select_from(Report)
        .join(flag, literal(True))
        .where(Report.incident_id.in_(incident_ids))
        .distinct()
    )
    result: dict[uuid.UUID, list[str]] = {}
    for inc_id, value in session.execute(stmt):
        result.setdefault(inc_id, []).append(value)
    return {k: sorted(v) for k, v in result.items()}


# Incident detail


@dataclass(frozen=True)
class PhotoView:
    id: uuid.UUID
    url: str
    content_type: str


@dataclass(frozen=True)
class ReportView:
    id: uuid.UUID
    description: str
    address_text: str | None
    location: LatLng
    submitted_at: datetime
    processing: ReportProcessing
    # The extraction's view (ADR 0004): hints for the dispatcher, not decisions.
    issue_type: IssueType | None
    hazard_flags: list[str]
    summary: str | None
    confidence: float | None
    photos: list[PhotoView]


@dataclass(frozen=True)
class AssignmentView:
    team: TeamRef
    assigned_by: str
    assigned_at: datetime
    ended_at: datetime | None
    overridden: bool


@dataclass(frozen=True)
class AuditView:
    at: datetime
    action: str
    staff_name: str | None  # None: the system
    detail: dict[str, Any]


@dataclass(frozen=True)
class IncidentDetail:
    item: QueueItem
    formula_version: str | None
    priority_inputs: dict[str, Any] | None
    merged_into_id: uuid.UUID | None
    resolved_at: datetime | None
    reports: list[ReportView]
    assignments: list[AssignmentView]
    audit: list[AuditView]


def incident_detail(
    session: Session, storage: PhotoStorage, incident_id: uuid.UUID
) -> IncidentDetail | None:
    incident = session.get(Incident, incident_id)
    if incident is None:
        return None
    item = _item(session, incident)

    lat, lng = _latlng(Report.location)
    report_rows = session.execute(
        select(Report, lat, lng)
        .where(Report.incident_id == incident.id)
        .order_by(Report.submitted_at)
    ).all()
    photos: dict[uuid.UUID, list[PhotoView]] = {}
    for photo in session.scalars(
        select(ReportPhoto)
        .join(Report, Report.id == ReportPhoto.report_id)
        .where(Report.incident_id == incident.id)
        .order_by(ReportPhoto.uploaded_at)
    ):
        photos.setdefault(photo.report_id, []).append(
            PhotoView(photo.id, storage.view_url(photo.object_name), photo.content_type)
        )
    reports = [
        ReportView(
            id=r.id,
            description=r.description,
            address_text=r.address_text,
            location=LatLng(rlat, rlng),
            submitted_at=r.submitted_at,
            processing=r.processing,
            issue_type=r.issue_type,
            hazard_flags=list(r.hazard_flags),
            summary=r.summary,
            confidence=r.confidence,
            photos=photos.get(r.id, []),
        )
        for r, rlat, rlng in report_rows
    ]

    assignments = [
        AssignmentView(
            team=TeamRef(team.id, team.name),
            assigned_by=staff.display_name,
            assigned_at=a.assigned_at,
            ended_at=a.ended_at,
            overridden=a.overridden,
        )
        for a, team, staff in session.execute(
            select(Assignment, Team, Staff)
            .join(Team, Team.id == Assignment.team_id)
            .join(Staff, Staff.id == Assignment.assigned_by)
            .where(Assignment.incident_id == incident.id)
            .order_by(Assignment.assigned_at.desc())
        ).all()
    ]

    report_ids = [r.id for r in reports]
    audit = [
        AuditView(at=log.at, action=log.action, staff_name=name, detail=log.detail)
        for log, name in session.execute(
            select(AuditLog, Staff.display_name)
            .outerjoin(Staff, Staff.id == AuditLog.staff_id)
            .where(
                (AuditLog.entity_id == incident.id)
                | (AuditLog.entity_type == "report") & AuditLog.entity_id.in_(report_ids)
            )
            .order_by(AuditLog.at.desc(), AuditLog.id.desc())
            .limit(200)
        ).all()
    ]
    return IncidentDetail(
        item=item,
        formula_version=incident.formula_version,
        priority_inputs=incident.priority_inputs,
        merged_into_id=incident.merged_into_id,
        resolved_at=incident.resolved_at,
        reports=reports,
        assignments=assignments,
        audit=audit,
    )


def _item(session: Session, incident: Incident) -> QueueItem:
    """A single incident's summary, whichever queue tab (if any) it would be in."""
    lat, lng = session.execute(
        select(*_latlng(Incident.location)).where(Incident.id == incident.id)
    ).one()
    count = session.scalar(select(func.count()).where(Report.incident_id == incident.id)) or 0
    latest = session.scalars(
        select(Report)
        .where(Report.incident_id == incident.id)
        .order_by(Report.submitted_at.desc())
    ).first()
    suggested = session.get(Team, incident.suggested_team_id) if incident.suggested_team_id else None
    assigned = session.execute(
        select(Team)
        .join(Assignment, Assignment.team_id == Team.id)
        .where(Assignment.incident_id == incident.id, Assignment.ended_at.is_(None))
    ).scalar_one_or_none()
    return QueueItem(
        id=incident.id,
        status=incident.status,
        issue_type=incident.issue_type,
        priority_score=incident.priority_score,
        severity=severity(incident.priority_score) if incident.priority_score is not None else None,
        report_count=count,
        hazard_flags=_hazard_flags(session, [incident.id]).get(incident.id, []),
        headline=(latest.summary or latest.description) if latest else "",
        address_text=latest.address_text if latest else None,
        location=LatLng(lat, lng),
        created_at=incident.created_at,
        suggested_team=TeamRef(suggested.id, suggested.name) if suggested else None,
        assigned_team=TeamRef(assigned.id, assigned.name) if assigned else None,
    )


# Options for acting


@dataclass(frozen=True)
class CandidateTeam:
    id: uuid.UUID
    name: str
    skilled: bool
    busy_with_incident_id: uuid.UUID | None
    distance_m: float
    suggested: bool


def candidate_teams(session: Session, incident_id: uuid.UUID) -> list[CandidateTeam]:
    """Every active team: skilled and free ones first, nearest first."""
    incident = session.get(Incident, incident_id)
    if incident is None:
        return []
    here = select(Incident.location).where(Incident.id == incident_id).scalar_subquery()
    busy = aliased(Assignment)
    skilled = (
        Team.skills.contains([incident.issue_type]) if incident.issue_type else literal(False)
    )
    distance = func.ST_Distance(Team.base_location, here)
    rows = session.execute(
        select(Team.id, Team.name, skilled, busy.incident_id, distance)
        .outerjoin(busy, and_(busy.team_id == Team.id, busy.ended_at.is_(None)))
        .where(Team.active)
        .order_by(skilled.desc(), busy.incident_id.is_not(None), distance, Team.name)
    ).all()
    return [
        CandidateTeam(
            id=r[0],
            name=r[1],
            skilled=bool(r[2]),
            busy_with_incident_id=r[3],
            distance_m=round(float(r[4]), 1),
            suggested=r[0] == incident.suggested_team_id,
        )
        for r in rows
    ]


@dataclass(frozen=True)
class NearbyIncident:
    id: uuid.UUID
    issue_type: IssueType | None
    status: IncidentStatus
    distance_m: float
    report_count: int
    headline: str


def nearby_incidents(session: Session, incident_id: uuid.UUID) -> list[NearbyIncident]:
    """Other open incidents close by: candidates for merging (ADR 0006)."""
    here = select(Incident.location).where(Incident.id == incident_id).scalar_subquery()
    distance = func.ST_Distance(Incident.location, here)
    count = (
        select(func.count()).where(Report.incident_id == Incident.id).correlate(Incident).scalar_subquery()
    )
    headline = (
        select(func.coalesce(Report.summary, Report.description))
        .where(Report.incident_id == Incident.id)
        .order_by(Report.submitted_at.desc())
        .limit(1)
        .correlate(Incident)
        .scalar_subquery()
    )
    rows = session.execute(
        select(Incident.id, Incident.issue_type, Incident.status, distance, count, headline)
        .where(
            Incident.id != incident_id,
            Incident.status.in_(OPEN),
            func.ST_DWithin(Incident.location, here, NEARBY_RADIUS_M),
        )
        .order_by(distance)
        .limit(20)
    ).all()
    return [
        NearbyIncident(r[0], r[1], r[2], round(float(r[3]), 1), r[4], r[5] or "") for r in rows
    ]
