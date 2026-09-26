"""The dispatch API: the queue, incident detail, and dispatcher actions (ADR 0005)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from infraalert.db.models import IssueType
from infraalert.deps import Deps, get_deps, get_session
from infraalert.staff import dispatch, views
from infraalert.staff.auth import Dispatcher

router = APIRouter(prefix="/api/staff", tags=["dispatch"])

SessionDep = Annotated[Session, Depends(get_session)]
DepsDep = Annotated[Deps, Depends(get_deps)]


def _act(session: Session, action: Callable[[], object]) -> object:
    """Run one dispatch action as a single transaction."""
    try:
        result = action()
        session.commit()
        return result
    except dispatch.DispatchError as exc:
        session.rollback()
        raise HTTPException(exc.status, detail=exc.code) from exc


# Reading


@router.get("/queue")
def get_queue(
    session: SessionDep,
    _staff: Dispatcher,
    tab: Literal["triage", "open", "closed"] = "open",
    issue_type: IssueType | None = None,
) -> list[views.QueueItem]:
    return views.queue(session, tab, issue_type)


class IncidentResponse(BaseModel):
    incident: views.IncidentDetail
    candidate_teams: list[views.CandidateTeam]
    nearby_incidents: list[views.NearbyIncident]


@router.get("/incidents/{incident_id}")
def get_incident(
    incident_id: uuid.UUID, session: SessionDep, deps: DepsDep, _staff: Dispatcher
) -> IncidentResponse:
    detail = views.incident_detail(session, deps.storage, incident_id)
    if detail is None:
        raise HTTPException(404, detail="incident_not_found")
    return IncidentResponse(
        incident=detail,
        candidate_teams=views.candidate_teams(session, incident_id),
        nearby_incidents=views.nearby_incidents(session, incident_id),
    )


# Acting


class TriageRequest(BaseModel):
    issue_type: IssueType


class AssignRequest(BaseModel):
    team_id: uuid.UUID


class ResolveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class CloseRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class MergeRequest(BaseModel):
    into_incident_id: uuid.UUID


class SplitRequest(BaseModel):
    report_ids: list[uuid.UUID] = Field(min_length=1)


class SplitResponse(BaseModel):
    new_incident_id: uuid.UUID


@router.post("/incidents/{incident_id}/triage", status_code=204)
def post_triage(
    incident_id: uuid.UUID, body: TriageRequest, session: SessionDep, staff: Dispatcher
) -> None:
    _act(session, lambda: dispatch.triage(session, staff, incident_id, body.issue_type))


@router.post("/incidents/{incident_id}/assign", status_code=204)
def post_assign(
    incident_id: uuid.UUID, body: AssignRequest, session: SessionDep, staff: Dispatcher
) -> None:
    _act(session, lambda: dispatch.assign(session, staff, incident_id, body.team_id))


@router.post("/incidents/{incident_id}/on-site", status_code=204)
def post_on_site(incident_id: uuid.UUID, session: SessionDep, staff: Dispatcher) -> None:
    _act(session, lambda: dispatch.mark_on_site(session, staff, incident_id))


@router.post("/incidents/{incident_id}/resolve", status_code=204)
def post_resolve(
    incident_id: uuid.UUID, body: ResolveRequest, session: SessionDep, staff: Dispatcher
) -> None:
    _act(session, lambda: dispatch.resolve(session, staff, incident_id, body.note))


@router.post("/incidents/{incident_id}/close", status_code=204)
def post_close(
    incident_id: uuid.UUID, body: CloseRequest, session: SessionDep, staff: Dispatcher
) -> None:
    _act(session, lambda: dispatch.close_invalid(session, staff, incident_id, body.reason))


@router.post("/incidents/{incident_id}/merge", status_code=204)
def post_merge(
    incident_id: uuid.UUID, body: MergeRequest, session: SessionDep, staff: Dispatcher
) -> None:
    _act(session, lambda: dispatch.merge(session, staff, incident_id, body.into_incident_id))


@router.post("/incidents/{incident_id}/split", status_code=201)
def post_split(
    incident_id: uuid.UUID, body: SplitRequest, session: SessionDep, staff: Dispatcher
) -> SplitResponse:
    new_id = _act(session, lambda: dispatch.split(session, staff, incident_id, body.report_ids))
    assert isinstance(new_id, uuid.UUID)
    return SplitResponse(new_incident_id=new_id)
