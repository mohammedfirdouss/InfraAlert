"""citizen email updates

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-26 11:44:54.054800
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Enum types are created and dropped explicitly (models use create_type=False).
notification_event = postgresql.ENUM(
    "assigned", "resolved", "closed", name="notification_event", create_type=False
)
notification_status = postgresql.ENUM(
    "pending", "sent", "failed", "cancelled", name="notification_status", create_type=False
)
ENUMS = [notification_event, notification_status]


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in ENUMS:
        enum_type.create(bind)

    op.create_table(
        "contact_verifications",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("contact_id", sa.UUID(), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("requester_key", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            name=op.f("fk_contact_verifications_contact_id_contacts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["reports.id"],
            name=op.f("fk_contact_verifications_report_id_reports"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contact_verifications")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_contact_verifications_token_hash")),
    )
    op.create_index("ix_contact_verifications_contact_id", "contact_verifications", ["contact_id"])
    op.create_index(
        "ix_contact_verifications_report_id_created_at",
        "contact_verifications",
        ["report_id", "created_at"],
    )
    op.create_index(
        "ix_contact_verifications_requester_key_created_at",
        "contact_verifications",
        ["requester_key", "created_at"],
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("contact_id", sa.UUID(), nullable=False),
        sa.Column("event", notification_event, nullable=False),
        sa.Column("status", notification_status, server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(status = 'sent') = (sent_at IS NOT NULL)", name=op.f("ck_notifications_sent_at")
        ),
        sa.ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            name=op.f("fk_notifications_contact_id_contacts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["reports.id"],
            name=op.f("fk_notifications_report_id_reports"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        sa.UniqueConstraint("report_id", "event", name="uq_notifications_report_id_event"),
    )
    op.create_index("ix_notifications_contact_id", "notifications", ["contact_id"])
    op.create_index(
        "ix_notifications_pending",
        "notifications",
        ["next_attempt_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index("ix_reports_contact_id", "reports", ["contact_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_contact_id", table_name="reports")
    op.drop_table("notifications")  # drops its indexes too
    op.drop_table("contact_verifications")
    bind = op.get_bind()
    for enum_type in reversed(ENUMS):
        enum_type.drop(bind)
