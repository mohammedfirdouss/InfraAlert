# mypy: disable-error-code="attr-defined"
# (GeoAlchemy2 attaches the op.*_geospatial_* helpers at runtime.)
"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-26 10:10:31.407265
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Enum types are created and dropped explicitly (models use create_type=False).
issue_type = postgresql.ENUM(
    "pothole",
    "water_leak",
    "power_outage",
    "broken_streetlight",
    "sewage",
    "road_damage",
    "other",
    name="issue_type",
    create_type=False,
)
report_processing = postgresql.ENUM(
    "received", "processed", "needs_triage", name="report_processing", create_type=False
)
incident_status = postgresql.ENUM(
    "new",
    "triaged",
    "assigned",
    "on_site",
    "resolved",
    "closed_duplicate",
    "closed_invalid",
    name="incident_status",
    create_type=False,
)
staff_role = postgresql.ENUM(
    "dispatcher", "supervisor", "admin", name="staff_role", create_type=False
)
contact_kind = postgresql.ENUM("email", "sms", name="contact_kind", create_type=False)
place_source = postgresql.ENUM("osm", "manual", name="place_source", create_type=False)

ENUMS = [issue_type, report_processing, incident_status, staff_role, contact_kind, place_source]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    bind = op.get_bind()
    for enum_type in ENUMS:
        enum_type.create(bind)

    op.create_table(
        "contacts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("kind", contact_kind, nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contacts")),
        sa.UniqueConstraint("kind", "address", name="uq_contacts_kind_address"),
    )
    op.create_geospatial_table(
        "sensitive_places",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column(
            "geom",
            Geography(
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
                nullable=False,
            ),
            nullable=False,
        ),
        sa.Column("source", place_source, nullable=False),
        sa.Column("osm_id", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(source = 'osm') = (osm_id IS NOT NULL)", name=op.f("ck_sensitive_places_osm_has_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sensitive_places")),
    )
    op.create_geospatial_index(
        "ix_sensitive_places_geom",
        "sensitive_places",
        ["geom"],
        unique=False,
        postgresql_using="gist",
        postgresql_ops={},
    )
    op.create_index("uq_sensitive_places_osm_id", "sensitive_places", ["osm_id"], unique=True)
    op.create_table(
        "staff",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("oidc_subject", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("role", staff_role, nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staff")),
        sa.UniqueConstraint("oidc_subject", name=op.f("uq_staff_oidc_subject")),
    )
    op.create_geospatial_table(
        "teams",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "skills", postgresql.ARRAY(issue_type), server_default=sa.text("'{}'"), nullable=False
        ),
        sa.Column(
            "base_location",
            Geography(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
                nullable=False,
            ),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teams")),
        sa.UniqueConstraint("name", name=op.f("uq_teams_name")),
    )
    op.create_geospatial_index(
        "ix_teams_base_location",
        "teams",
        ["base_location"],
        unique=False,
        postgresql_using="gist",
        postgresql_ops={},
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("staff_id", sa.UUID(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=False),
        sa.Column(
            "detail",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["staff_id"], ["staff.id"], name=op.f("fk_audit_log_staff_id_staff")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index("ix_audit_log_entity", "audit_log", ["entity_type", "entity_id"], unique=False)
    op.create_geospatial_table(
        "incidents",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("issue_type", issue_type, nullable=True),
        sa.Column("status", incident_status, server_default="new", nullable=False),
        sa.Column(
            "location",
            Geography(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
                nullable=False,
            ),
            nullable=False,
        ),
        sa.Column("priority_score", sa.Float(), nullable=True),
        sa.Column("formula_version", sa.Text(), nullable=True),
        sa.Column("priority_inputs", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("suggested_team_id", sa.UUID(), nullable=True),
        sa.Column("merged_into_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(status = 'closed_duplicate') = (merged_into_id IS NOT NULL)",
            name=op.f("ck_incidents_duplicate_has_target"),
        ),
        sa.CheckConstraint(
            "(status = 'resolved') = (resolved_at IS NOT NULL)",
            name=op.f("ck_incidents_resolved_at"),
        ),
        sa.CheckConstraint(
            "(priority_score IS NULL) = (formula_version IS NULL)"
            " AND (priority_score IS NULL) = (priority_inputs IS NULL)",
            name=op.f("ck_incidents_score_has_provenance"),
        ),
        sa.ForeignKeyConstraint(
            ["merged_into_id"], ["incidents.id"], name=op.f("fk_incidents_merged_into_id_incidents")
        ),
        sa.ForeignKeyConstraint(
            ["suggested_team_id"], ["teams.id"], name=op.f("fk_incidents_suggested_team_id_teams")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_incidents")),
    )
    op.create_geospatial_index(
        "ix_incidents_location",
        "incidents",
        ["location"],
        unique=False,
        postgresql_using="gist",
        postgresql_ops={},
    )
    op.create_index("ix_incidents_status", "incidents", ["status"], unique=False)
    op.create_table(
        "assignments",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("incident_id", sa.UUID(), nullable=False),
        sa.Column("team_id", sa.UUID(), nullable=False),
        sa.Column("suggested_team_id", sa.UUID(), nullable=True),
        sa.Column(
            "overridden",
            sa.Boolean(),
            sa.Computed("COALESCE(suggested_team_id <> team_id, false)", persisted=True),
            nullable=False,
        ),
        sa.Column("assigned_by", sa.UUID(), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_by"], ["staff.id"], name=op.f("fk_assignments_assigned_by_staff")
        ),
        sa.ForeignKeyConstraint(
            ["incident_id"], ["incidents.id"], name=op.f("fk_assignments_incident_id_incidents")
        ),
        sa.ForeignKeyConstraint(
            ["suggested_team_id"], ["teams.id"], name=op.f("fk_assignments_suggested_team_id_teams")
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["teams.id"], name=op.f("fk_assignments_team_id_teams")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assignments")),
    )
    op.create_index(
        "uq_assignments_open_incident",
        "assignments",
        ["incident_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_index(
        "uq_assignments_open_team",
        "assignments",
        ["team_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_geospatial_table(
        "reports",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("address_text", sa.Text(), nullable=True),
        sa.Column(
            "location",
            Geography(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
                nullable=False,
            ),
            nullable=False,
        ),
        sa.Column("processing", report_processing, server_default="received", nullable=False),
        sa.Column("incident_id", sa.UUID(), nullable=True),
        sa.Column("contact_id", sa.UUID(), nullable=True),
        sa.Column("issue_type", issue_type, nullable=True),
        sa.Column(
            "hazard_flags",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("extraction_model", sa.Text(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(processing = 'received') = (incident_id IS NULL)",
            name=op.f("ck_reports_processed_has_incident"),
        ),
        sa.CheckConstraint("confidence BETWEEN 0 AND 1", name=op.f("ck_reports_confidence_range")),
        sa.ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            name=op.f("fk_reports_contact_id_contacts"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["incident_id"], ["incidents.id"], name=op.f("fk_reports_incident_id_incidents")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reports")),
    )
    op.create_index("ix_reports_incident_id", "reports", ["incident_id"], unique=False)
    op.create_geospatial_index(
        "ix_reports_location",
        "reports",
        ["location"],
        unique=False,
        postgresql_using="gist",
        postgresql_ops={},
    )
    op.create_table(
        "report_photos",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("object_name", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["reports.id"],
            name=op.f("fk_report_photos_report_id_reports"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_photos")),
        sa.UniqueConstraint("object_name", name=op.f("uq_report_photos_object_name")),
    )


def downgrade() -> None:
    op.drop_table("report_photos")
    op.drop_geospatial_index(
        "ix_reports_location", table_name="reports", postgresql_using="gist", column_name="location"
    )
    op.drop_index("ix_reports_incident_id", table_name="reports")
    op.drop_geospatial_table("reports")
    op.drop_index(
        "uq_assignments_open_team",
        table_name="assignments",
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.drop_index(
        "uq_assignments_open_incident",
        table_name="assignments",
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.drop_table("assignments")
    op.drop_index("ix_incidents_status", table_name="incidents")
    op.drop_geospatial_index(
        "ix_incidents_location",
        table_name="incidents",
        postgresql_using="gist",
        column_name="location",
    )
    op.drop_geospatial_table("incidents")
    op.drop_index("ix_audit_log_entity", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_geospatial_index(
        "ix_teams_base_location",
        table_name="teams",
        postgresql_using="gist",
        column_name="base_location",
    )
    op.drop_geospatial_table("teams")
    op.drop_table("staff")
    op.drop_index("uq_sensitive_places_osm_id", table_name="sensitive_places")
    op.drop_geospatial_index(
        "ix_sensitive_places_geom",
        table_name="sensitive_places",
        postgresql_using="gist",
        column_name="geom",
    )
    op.drop_geospatial_table("sensitive_places")
    op.drop_table("contacts")
    bind = op.get_bind()
    for enum_type in reversed(ENUMS):
        enum_type.drop(bind)
    # The postgis extension is left installed; other database objects may depend on it.
