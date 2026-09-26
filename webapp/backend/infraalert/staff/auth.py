"""
Staff sign-in (ADR 0007). The browser signs in to Google Identity Platform with
the city's identity provider and sends the resulting ID token with every call;
there is no server-side session. Access is decided by our `staff` table, never
by the identity provider alone: a valid token for someone who isn't invited
staff gets 403.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from infraalert.db.models import AuditLog, Staff, StaffRole
from infraalert.deps import get_deps, get_session

ROLE_RANK = {StaffRole.DISPATCHER: 1, StaffRole.SUPERVISOR: 2, StaffRole.ADMIN: 3}


def current_staff(request: Request, session: Annotated[Session, Depends(get_session)]) -> Staff:
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
    verifier = get_deps(request).staff_auth
    identity = verifier.verify(token) if token and verifier else None
    if identity is None:
        raise HTTPException(401, detail="sign_in_required")

    staff = session.scalars(select(Staff).where(Staff.oidc_subject == identity.subject)).first()
    if staff is None:
        # First sign-in of an invited person: link the invitation to this identity.
        staff = session.scalars(
            select(Staff).where(
                func.lower(Staff.email) == identity.email.lower(), Staff.oidc_subject.is_(None)
            )
        ).first()
        if staff is not None:
            staff.oidc_subject = identity.subject
            session.add(
                AuditLog(
                    staff_id=staff.id,
                    action="staff.first_sign_in",
                    entity_type="staff",
                    entity_id=staff.id,
                    detail={"email": identity.email},
                )
            )
            session.commit()
    if staff is None or not staff.active:
        raise HTTPException(403, detail="not_staff")
    return staff


def require_role(minimum: StaffRole):  # type: ignore[no-untyped-def]
    def dependency(staff: Annotated[Staff, Depends(current_staff)]) -> Staff:
        if ROLE_RANK[staff.role] < ROLE_RANK[minimum]:
            raise HTTPException(403, detail="insufficient_role")
        return staff

    return dependency


Dispatcher = Annotated[Staff, Depends(require_role(StaffRole.DISPATCHER))]
Supervisor = Annotated[Staff, Depends(require_role(StaffRole.SUPERVISOR))]
Admin = Annotated[Staff, Depends(require_role(StaffRole.ADMIN))]
