from __future__ import annotations

import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from geoalchemy2 import alembic_helpers
from sqlalchemy import Engine, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from infraalert.db.models import (
    Assignment,
    Base,
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    ReportProcessing,
    Staff,
    StaffRole,
    Team,
)

from .conftest import alembic_config, fresh_database


def point(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon} {lat})"


def make_team(session: Session, name: str, lon: float = 0.0, lat: float = 0.0) -> Team:
    team = Team(name=name, skills=[IssueType.POTHOLE], base_location=point(lon, lat))
    session.add(team)
    session.flush()
    return team


def make_incident(session: Session, **kwargs) -> Incident:
    incident = Incident(location=point(0.0, 0.0), **kwargs)
    session.add(incident)
    session.flush()
    return incident


def make_staff(session: Session) -> Staff:
    staff = Staff(
        oidc_subject=uuid.uuid4().hex,
        email="d@example.org",
        display_name="Dispatcher",
        role=StaffRole.DISPATCHER,
    )
    session.add(staff)
    session.flush()
    return staff


def assign(session: Session, incident: Incident, team: Team, staff: Staff, **kwargs) -> Assignment:
    a = Assignment(incident_id=incident.id, team_id=team.id, assigned_by=staff.id, **kwargs)
    session.add(a)
    session.flush()
    return a


# Migrations


def test_migrations_upgrade_downgrade_upgrade() -> None:
    with fresh_database() as url:
        cfg = alembic_config(url)
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")
        command.upgrade(cfg, "head")


def test_models_match_migrations(engine: Engine) -> None:
    def include(obj, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]
        if type_ == "table" and reflected and compare_to is None:
            return False  # PostGIS's own tables
        return alembic_helpers.include_object(obj, name, type_, reflected, compare_to)

    with engine.connect() as conn:
        ctx = MigrationContext.configure(
            conn, opts={"include_object": include, "compare_type": True}
        )
        assert compare_metadata(ctx, Base.metadata) == []


# Dispatch invariants (ADR 0005)


def test_team_cannot_have_two_open_assignments(session: Session) -> None:
    staff = make_staff(session)
    team = make_team(session, "Roads 1")
    assign(session, make_incident(session), team, staff)
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            assign(session, make_incident(session), team, staff)


def test_incident_cannot_have_two_open_assignments(session: Session) -> None:
    staff = make_staff(session)
    incident = make_incident(session)
    assign(session, incident, make_team(session, "Roads 1"), staff)
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            assign(session, incident, make_team(session, "Roads 2"), staff)


def test_ending_an_assignment_frees_the_team(session: Session) -> None:
    staff = make_staff(session)
    team = make_team(session, "Roads 1")
    first = assign(session, make_incident(session), team, staff)
    first.ended_at = func.now()
    session.flush()
    assign(session, make_incident(session), team, staff)  # no IntegrityError


def test_available_teams_are_derived_from_open_assignments(session: Session) -> None:
    staff = make_staff(session)
    near_busy = make_team(session, "Near busy", lon=0.001)
    far_free = make_team(session, "Far free", lon=0.1)
    near_free = make_team(session, "Near free", lon=0.002)
    assign(session, make_incident(session), near_busy, staff)

    incident = make_incident(session)
    incident_location = (
        select(Incident.location).where(Incident.id == incident.id).scalar_subquery()
    )
    open_assignment = exists().where(Assignment.team_id == Team.id, Assignment.ended_at.is_(None))
    names = session.scalars(
        select(Team.name)
        .where(Team.active.is_(True), ~open_assignment, Team.skills.contains([IssueType.POTHOLE]))
        .order_by(func.ST_Distance(Team.base_location, incident_location))
    ).all()
    assert names == [near_free.name, far_free.name]


def test_overridden_is_computed(session: Session) -> None:
    staff = make_staff(session)
    suggested = make_team(session, "Suggested")
    other = make_team(session, "Other")
    kept = assign(session, make_incident(session), suggested, staff, suggested_team_id=suggested.id)
    changed = assign(session, make_incident(session), other, staff, suggested_team_id=suggested.id)
    no_suggestion = assign(session, make_incident(session), make_team(session, "Third"), staff)
    session.refresh(kept)
    session.refresh(changed)
    session.refresh(no_suggestion)
    assert (kept.overridden, changed.overridden, no_suggestion.overridden) == (False, True, False)


# Incident and report invariants (ADR 0004, 0006)


def test_closed_duplicate_requires_merge_target(session: Session) -> None:
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            make_incident(session, status=IncidentStatus.CLOSED_DUPLICATE)

    target = make_incident(session)
    make_incident(session, status=IncidentStatus.CLOSED_DUPLICATE, merged_into_id=target.id)


def test_priority_score_requires_formula_version_and_inputs(session: Session) -> None:
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            make_incident(session, priority_score=0.7)

    make_incident(
        session, priority_score=0.7, formula_version="v1", priority_inputs={"issue_type": 0.5}
    )


def test_processed_report_must_belong_to_an_incident(session: Session) -> None:
    received = Report(description="Pothole on Main St", location=point(0.0, 0.0))
    session.add(received)
    session.flush()
    assert received.processing is ReportProcessing.RECEIVED

    with pytest.raises(IntegrityError):
        with session.begin_nested():
            received.processing = ReportProcessing.NEEDS_TRIAGE
            session.flush()

    incident = make_incident(session)  # before touching the report: this flushes
    received.processing = ReportProcessing.NEEDS_TRIAGE
    received.incident_id = incident.id
    session.flush()
