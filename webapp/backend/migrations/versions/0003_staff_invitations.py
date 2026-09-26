"""staff invitations

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26 11:03:20.097737
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("staff", "oidc_subject", existing_type=sa.TEXT(), nullable=True)
    op.create_index("uq_staff_email", "staff", [sa.literal_column("lower(email)")], unique=True)


def downgrade() -> None:
    # Invitations nobody accepted have no subject and can't survive NOT NULL.
    op.execute("DELETE FROM staff WHERE oidc_subject IS NULL")
    op.drop_index("uq_staff_email", table_name="staff")
    op.alter_column("staff", "oidc_subject", existing_type=sa.TEXT(), nullable=False)
