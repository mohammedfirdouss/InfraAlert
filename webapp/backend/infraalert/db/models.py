"""
Database schema. Terms follow CONTEXT.md; see docs/adr/ for the decisions behind it.

Things that are derived rather than stored, so they can never drift:
- A team is available when it has no open assignment (ended_at IS NULL).
- An incident's report count is the number of reports pointing at it.
- Severity is a band computed from the priority score.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    MetaData,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# Enums


class IssueType(enum.StrEnum):
    POTHOLE = "pothole"
    WATER_LEAK = "water_leak"
    POWER_OUTAGE = "power_outage"
    BROKEN_STREETLIGHT = "broken_streetlight"
    SEWAGE = "sewage"
    ROAD_DAMAGE = "road_damage"
    OTHER = "other"


class ReportProcessing(enum.StrEnum):
    RECEIVED = "received"
    PROCESSED = "processed"
    NEEDS_TRIAGE = "needs_triage"


class IncidentStatus(enum.StrEnum):
    NEW = "new"
    TRIAGED = "triaged"
    ASSIGNED = "assigned"
    ON_SITE = "on_site"
    RESOLVED = "resolved"
    CLOSED_DUPLICATE = "closed_duplicate"
    CLOSED_INVALID = "closed_invalid"


class StaffRole(enum.StrEnum):
    DISPATCHER = "dispatcher"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"


class ContactKind(enum.StrEnum):
    EMAIL = "email"
    SMS = "sms"


class PlaceSource(enum.StrEnum):
    OSM = "osm"
    MANUAL = "manual"


def _pg_enum(py_enum: type[enum.StrEnum], name: str) -> SAEnum:
    return SAEnum(
        py_enum,
        name=name,
        values_callable=lambda e: [m.value for m in e],
        create_type=False,  # created explicitly in migrations
    )


issue_type_enum = _pg_enum(IssueType, "issue_type")
report_processing_enum = _pg_enum(ReportProcessing, "report_processing")
incident_status_enum = _pg_enum(IncidentStatus, "incident_status")
staff_role_enum = _pg_enum(StaffRole, "staff_role")
contact_kind_enum = _pg_enum(ContactKind, "contact_kind")
place_source_enum = _pg_enum(PlaceSource, "place_source")


def _point() -> Geography:
    return Geography(geometry_type="POINT", srid=4326, spatial_index=False)


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# Tables


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    skills: Mapped[list[IssueType]] = mapped_column(
        ARRAY(issue_type_enum), nullable=False, server_default=text("'{}'")
    )
    base_location: Mapped[Any] = mapped_column(_point(), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (Index("ix_teams_base_location", "base_location", postgresql_using="gist"),)


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[uuid.UUID] = _uuid_pk()
    oidc_subject: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[StaffRole] = mapped_column(staff_role_enum, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = _created_at()


class Contact(Base):
    """A citizen's email or phone. Personal data: kept apart from reports (ADR 0007)."""

    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = _uuid_pk()
    kind: Mapped[ContactKind] = mapped_column(contact_kind_enum, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (UniqueConstraint("kind", "address", name="uq_contacts_kind_address"),)


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[uuid.UUID] = _uuid_pk()
    # NULL until extraction or a dispatcher classifies it.
    issue_type: Mapped[IssueType | None] = mapped_column(issue_type_enum)
    status: Mapped[IncidentStatus] = mapped_column(
        incident_status_enum, nullable=False, server_default=IncidentStatus.NEW.value
    )
    location: Mapped[Any] = mapped_column(_point(), nullable=False)
    priority_score: Mapped[float | None] = mapped_column(Float)
    formula_version: Mapped[str | None] = mapped_column(Text)
    priority_inputs: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    suggested_team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id"))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reports: Mapped[list[Report]] = relationship(back_populates="incident")

    __table_args__ = (
        CheckConstraint(
            "(status = 'closed_duplicate') = (merged_into_id IS NOT NULL)",
            name="duplicate_has_target",
        ),
        CheckConstraint(
            "(priority_score IS NULL) = (formula_version IS NULL)"
            " AND (priority_score IS NULL) = (priority_inputs IS NULL)",
            name="score_has_provenance",
        ),
        CheckConstraint("(status = 'resolved') = (resolved_at IS NOT NULL)", name="resolved_at"),
        Index("ix_incidents_location", "location", postgresql_using="gist"),
        Index("ix_incidents_status", "status"),
    )


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = _uuid_pk()
    description: Mapped[str] = mapped_column(Text, nullable=False)
    address_text: Mapped[str | None] = mapped_column(Text)
    location: Mapped[Any] = mapped_column(_point(), nullable=False)
    processing: Mapped[ReportProcessing] = mapped_column(
        report_processing_enum, nullable=False, server_default=ReportProcessing.RECEIVED.value
    )
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id"))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("contacts.id", ondelete="SET NULL")
    )

    # Extraction output (ADR 0004): facts only, never decisions.
    issue_type: Mapped[IssueType | None] = mapped_column(issue_type_enum)
    hazard_flags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    summary: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)
    extraction_model: Mapped[str | None] = mapped_column(Text)

    submitted_at: Mapped[datetime] = _created_at()

    incident: Mapped[Incident | None] = relationship(back_populates="reports")
    photos: Mapped[list[ReportPhoto]] = relationship(
        back_populates="report", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Processing always ends with the report attached to an incident,
        # even when it needs triage, so dispatchers see it in the queue.
        CheckConstraint(
            "(processing = 'received') = (incident_id IS NULL)", name="processed_has_incident"
        ),
        CheckConstraint("confidence BETWEEN 0 AND 1", name="confidence_range"),
        Index("ix_reports_incident_id", "incident_id"),
        Index("ix_reports_location", "location", postgresql_using="gist"),
    )


class ReportPhoto(Base):
    """A photo in the private bucket (ADR 0008). Only the object name is stored."""

    __tablename__ = "report_photos"

    id: Mapped[uuid.UUID] = _uuid_pk()
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), nullable=False
    )
    object_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_at: Mapped[datetime] = _created_at()

    report: Mapped[Report] = relationship(back_populates="photos")


class Assignment(Base):
    """A dispatcher sending a team to an incident (ADR 0005)."""

    __tablename__ = "assignments"

    id: Mapped[uuid.UUID] = _uuid_pk()
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id"), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    suggested_team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id"))
    overridden: Mapped[bool] = mapped_column(
        Boolean,
        Computed("COALESCE(suggested_team_id <> team_id, false)", persisted=True),
    )
    assigned_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id"), nullable=False)
    assigned_at: Mapped[datetime] = _created_at()
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # No double-booking: a team has at most one open assignment,
        # and an incident has at most one open team.
        Index(
            "uq_assignments_open_team",
            "team_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
        Index(
            "uq_assignments_open_incident",
            "incident_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # NULL means the system acted (e.g. the processing worker).
    staff_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id"))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    detail: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )

    __table_args__ = (Index("ix_audit_log_entity", "entity_type", "entity_id"),)


class SensitivePlace(Base):
    """
    A place whose nearness raises priority. Category weights live in the
    priority formula, not here. The OSM refresh upserts by osm_id and must
    never overwrite `enabled`, so admin overrides survive (ADR 0004).
    """

    __tablename__ = "sensitive_places"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    geom: Mapped[Any] = mapped_column(
        Geography(geometry_type="GEOMETRY", srid=4326, spatial_index=False), nullable=False
    )
    source: Mapped[PlaceSource] = mapped_column(place_source_enum, nullable=False)
    osm_id: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        CheckConstraint("(source = 'osm') = (osm_id IS NOT NULL)", name="osm_has_id"),
        Index("uq_sensitive_places_osm_id", "osm_id", unique=True),
        Index("ix_sensitive_places_geom", "geom", postgresql_using="gist"),
    )
