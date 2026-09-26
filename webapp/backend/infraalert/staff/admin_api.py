"""
Team and staff administration (ADR 0005, 0007). Supervisors manage teams; admins
manage staff. Every change is written to the audit log with the person who made it.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2 import Geometry
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from infraalert.db.models import Assignment, AuditLog, IssueType, Staff, StaffRole, Team
from infraalert.deps import get_session
from infraalert.staff.auth import ROLE_RANK, Admin, Dispatcher, Supervisor, current_staff

router = APIRouter(prefix="/api/staff", tags=["staff-admin"])

SessionDep = Annotated[Session, Depends(get_session)]
AnyStaff = Annotated[Staff, Depends(current_staff)]

# Deliberately loose: the identity provider is the real check on an address.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# Models


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class TeamCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    skills: list[IssueType] = Field(default_factory=list)
    base_location: Location
    active: bool = True

    @field_validator("skills")
    @classmethod
    def _unique_skills(cls, skills: list[IssueType]) -> list[IssueType]:
        return list(dict.fromkeys(skills))


class TeamPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    skills: list[IssueType] | None = None
    base_location: Location | None = None
    active: bool | None = None

    @field_validator("skills")
    @classmethod
    def _unique_skills(cls, skills: list[IssueType] | None) -> list[IssueType] | None:
        return None if skills is None else list(dict.fromkeys(skills))

    @model_validator(mode="after")
    def _no_nulls(self) -> TeamPatch:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class TeamResponse(BaseModel):
    id: uuid.UUID
    name: str
    skills: list[IssueType]
    base_location: Location
    active: bool
    busy_with_incident_id: uuid.UUID | None


class TeamUpdateResponse(TeamResponse):
    # Set when a busy team was deactivated: it stays busy until its assignment ends.
    warning: Literal["team_busy_until_assignment_ends"] | None = None


class MeResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: StaffRole


class MemberResponse(MeResponse):
    status: Literal["invited", "active", "deactivated"]
    created_at: datetime


class InviteRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    email: str = Field(max_length=320)
    display_name: str = Field(min_length=1, max_length=200)
    role: StaffRole

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, email: str) -> str:
        if not _EMAIL.match(email):
            raise ValueError("not an email address")
        return email.lower()


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: StaffRole | None = None
    active: bool | None = None

    @model_validator(mode="after")
    def _no_nulls(self) -> MemberPatch:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


# Teams


def _team_rows(session: Session, team_id: uuid.UUID | None = None) -> list[TeamResponse]:
    point = cast(Team.base_location, Geometry)
    busy = (
        select(Assignment.incident_id)
        .where(Assignment.team_id == Team.id, Assignment.ended_at.is_(None))
        .scalar_subquery()
    )
    query = select(Team, func.ST_Y(point), func.ST_X(point), busy).order_by(Team.name)
    if team_id is not None:
        query = query.where(Team.id == team_id)
    return [
        TeamResponse(
            id=team.id,
            name=team.name,
            skills=list(team.skills),
            base_location=Location(lat=lat, lng=lng),
            active=team.active,
            busy_with_incident_id=incident_id,
        )
        for team, lat, lng, incident_id in session.execute(query).all()
    ]


def _wkt(location: Location) -> str:
    return f"SRID=4326;POINT({location.lng} {location.lat})"


def _name_taken(session: Session, name: str, excluding: uuid.UUID | None = None) -> bool:
    query = select(Team.id).where(func.lower(Team.name) == name.lower())
    if excluding is not None:
        query = query.where(Team.id != excluding)
    return session.scalars(query).first() is not None


def _audit(
    session: Session, actor: Staff, action: str, entity: str, entity_id: uuid.UUID, detail: Any
) -> None:
    session.add(
        AuditLog(
            staff_id=actor.id,
            action=action,
            entity_type=entity,
            entity_id=entity_id,
            detail=detail,
        )
    )


def _commit_or_conflict(session: Session, detail: str) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        # Lost a race with a concurrent create or rename.
        session.rollback()
        raise HTTPException(409, detail=detail) from exc


@router.get("/teams")
def list_teams(_: Dispatcher, session: SessionDep) -> list[TeamResponse]:
    return _team_rows(session)


@router.post("/teams", status_code=201)
def create_team(body: TeamCreate, actor: Supervisor, session: SessionDep) -> TeamResponse:
    if _name_taken(session, body.name):
        raise HTTPException(409, detail="team_name_taken")
    team = Team(
        id=uuid.uuid4(),
        name=body.name,
        skills=body.skills,
        base_location=_wkt(body.base_location),
        active=body.active,
    )
    session.add(team)
    _audit(session, actor, "team.created", "team", team.id, body.model_dump(mode="json"))
    _commit_or_conflict(session, "team_name_taken")
    return _team_rows(session, team.id)[0]


@router.patch("/teams/{team_id}")
def update_team(
    team_id: uuid.UUID, body: TeamPatch, actor: Supervisor, session: SessionDep
) -> TeamUpdateResponse:
    team = session.get(Team, team_id, with_for_update=True)
    if team is None:
        raise HTTPException(404, detail="team_not_found")
    before = _team_rows(session, team_id)[0]

    if body.name is not None and body.name != before.name:
        if _name_taken(session, body.name, excluding=team_id):
            raise HTTPException(409, detail="team_name_taken")

    old = before.model_dump(mode="json", include=body.model_fields_set)
    new = body.model_dump(mode="json", include=body.model_fields_set)
    changed = {f: {"from": old[f], "to": new[f]} for f in new if new[f] != old[f]}

    if body.name is not None and "name" in changed:
        team.name = body.name
    if body.skills is not None and "skills" in changed:
        team.skills = body.skills
    if body.base_location is not None and "base_location" in changed:
        team.base_location = _wkt(body.base_location)
    if body.active is not None and "active" in changed:
        team.active = body.active

    if changed:
        _audit(session, actor, "team.updated", "team", team_id, changed)
        _commit_or_conflict(session, "team_name_taken")

    after = _team_rows(session, team_id)[0]
    warning = None
    if not after.active and after.busy_with_incident_id is not None:
        warning = "team_busy_until_assignment_ends"
    return TeamUpdateResponse(**after.model_dump(), warning=warning)


# Staff


def _status(staff: Staff) -> Literal["invited", "active", "deactivated"]:
    if not staff.active:
        return "deactivated"
    return "invited" if staff.oidc_subject is None else "active"


def _member(staff: Staff) -> MemberResponse:
    return MemberResponse(
        id=staff.id,
        email=staff.email,
        display_name=staff.display_name,
        role=staff.role,
        status=_status(staff),
        created_at=staff.created_at,
    )


@router.get("/me")
def me(staff: AnyStaff) -> MeResponse:
    return MeResponse(
        id=staff.id, email=staff.email, display_name=staff.display_name, role=staff.role
    )


@router.get("/members")
def list_members(_: Admin, session: SessionDep) -> list[MemberResponse]:
    staff = session.scalars(select(Staff).order_by(func.lower(Staff.email))).all()
    return [_member(s) for s in staff]


@router.post("/members", status_code=201)
def invite_member(body: InviteRequest, actor: Admin, session: SessionDep) -> MemberResponse:
    exists = session.scalars(select(Staff.id).where(func.lower(Staff.email) == body.email))
    if exists.first() is not None:
        raise HTTPException(409, detail="already_staff")
    staff = Staff(
        id=uuid.uuid4(), email=body.email, display_name=body.display_name, role=body.role
    )
    session.add(staff)
    _audit(session, actor, "staff.invited", "staff", staff.id, body.model_dump(mode="json"))
    _commit_or_conflict(session, "already_staff")
    session.refresh(staff)
    return _member(staff)


@router.patch("/members/{staff_id}")
def update_member(
    staff_id: uuid.UUID, body: MemberPatch, actor: Admin, session: SessionDep
) -> MemberResponse:
    # Lock every active admin first, so two admins can't demote each other at once
    # and leave nobody able to manage staff.
    admin_ids = set(
        session.scalars(
            select(Staff.id)
            .where(
                Staff.role == StaffRole.ADMIN,
                Staff.active.is_(True),
                Staff.oidc_subject.is_not(None),  # an unaccepted invitation can't manage staff
            )
            .with_for_update()
        ).all()
    )
    target = session.get(Staff, staff_id, with_for_update=True)
    if target is None:
        raise HTTPException(404, detail="staff_not_found")

    new_role = body.role if body.role is not None else target.role
    new_active = body.active if body.active is not None else target.active
    loses_access = not new_active or ROLE_RANK[new_role] < ROLE_RANK[target.role]
    loses_admin = target.id in admin_ids and (not new_active or new_role != StaffRole.ADMIN)

    if loses_admin and not (admin_ids - {target.id}):
        raise HTTPException(409, detail="last_admin")
    if target.id == actor.id and loses_access:
        raise HTTPException(409, detail="cannot_change_own_access")

    changed: dict[str, Any] = {}
    if new_role != target.role:
        changed["role"] = {"from": target.role.value, "to": new_role.value}
        target.role = new_role
    if new_active != target.active:
        changed["active"] = {"from": target.active, "to": new_active}
        target.active = new_active
    if changed:
        _audit(session, actor, "staff.updated", "staff", target.id, changed)
    session.commit()
    return _member(target)
