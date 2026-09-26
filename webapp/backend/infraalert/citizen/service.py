from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session

from infraalert.citizen.status import ReportStatus, report_status
from infraalert.db.models import Incident, IncidentStatus, IssueType, Report, ReportPhoto
from infraalert.storage import CONTENT_TYPE_EXTENSIONS

# Guards against a merge cycle; real chains are one or two hops.
MAX_MERGE_HOPS = 20


@dataclass(frozen=True)
class NewReport:
    description: str
    lat: float
    lng: float
    address_text: str | None
    photo_object_names: list[str]


@dataclass(frozen=True)
class ReportView:
    id: uuid.UUID
    status: ReportStatus
    issue_type: IssueType | None
    description: str
    address_text: str | None
    lat: float
    lng: float
    photo_count: int
    submitted_at: datetime


def create_report(session: Session, new: NewReport, submitter_key: str | None) -> uuid.UUID:
    report = Report(
        description=new.description,
        address_text=new.address_text,
        location=f"SRID=4326;POINT({new.lng} {new.lat})",
        submitter_key=submitter_key,
        photos=[
            ReportPhoto(object_name=name, content_type=_content_type(name))
            for name in new.photo_object_names
        ],
    )
    session.add(report)
    session.flush()
    return report.id


def get_report_view(session: Session, report_id: uuid.UUID) -> ReportView | None:
    point = cast(Report.location, Geometry)
    row = session.execute(
        select(Report, func.ST_Y(point), func.ST_X(point)).where(Report.id == report_id)
    ).one_or_none()
    if row is None:
        return None
    report, lat, lng = row

    incident_status, incident_issue_type = _surviving_incident(session, report.incident_id)
    photo_count = session.scalar(
        select(func.count()).select_from(ReportPhoto).where(ReportPhoto.report_id == report.id)
    )
    return ReportView(
        id=report.id,
        status=report_status(report.processing, incident_status),
        # A dispatcher's correction on the incident wins over the extraction.
        issue_type=incident_issue_type or report.issue_type,
        description=report.description,
        address_text=report.address_text,
        lat=lat,
        lng=lng,
        photo_count=photo_count or 0,
        submitted_at=report.submitted_at,
    )


def _surviving_incident(
    session: Session, incident_id: uuid.UUID | None
) -> tuple[IncidentStatus | None, IssueType | None]:
    """Follow merges from the report's incident to the one still open for it."""
    for _ in range(MAX_MERGE_HOPS):
        if incident_id is None:
            return None, None
        status, issue_type, merged_into_id = session.execute(
            select(Incident.status, Incident.issue_type, Incident.merged_into_id).where(
                Incident.id == incident_id
            )
        ).one()
        if status is not IncidentStatus.CLOSED_DUPLICATE:
            return status, issue_type
        incident_id = merged_into_id
    raise RuntimeError(f"incident merge chain longer than {MAX_MERGE_HOPS} hops")


def _content_type(object_name: str) -> str:
    extension = object_name.rsplit(".", 1)[-1]
    return next(ct for ct, ext in CONTENT_TYPE_EXTENSIONS.items() if ext == extension)
