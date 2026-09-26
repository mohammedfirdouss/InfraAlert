"""
/tasks/notifications (every minute) and /tasks/retention (daily), called by Cloud
Scheduler with an OIDC token (see infraalert.processing.api.require_task_caller).
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from infraalert.deps import Deps, get_deps
from infraalert.notify.outbox import deliver_pending
from infraalert.notify.retention import run_retention
from infraalert.processing.api import require_task_caller

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", include_in_schema=False)

DepsDep = Annotated[Deps, Depends(get_deps)]
CallerDep = Annotated[None, Depends(require_task_caller)]


class DeliveryResponse(BaseModel):
    sent: int
    retrying: int
    failed: int
    cancelled: int


class RetentionResponse(BaseModel):
    submitter_keys_cleared: int
    verifications_deleted: int
    contacts_deleted: int


@router.post("/notifications")
def deliver_notifications(deps: DepsDep, _caller: CallerDep) -> DeliveryResponse:
    if deps.mailer is None:
        raise HTTPException(503, detail="email_disabled")
    result = deliver_pending(deps.sessions, deps.mailer, deps.settings)
    if result.failed:
        logger.error("%d notification(s) failed permanently", result.failed)
    return DeliveryResponse(
        sent=result.sent,
        retrying=result.retrying,
        failed=result.failed,
        cancelled=result.cancelled,
    )


@router.post("/retention")
def retention(deps: DepsDep, _caller: CallerDep) -> RetentionResponse:
    with deps.sessions() as session:
        result = run_retention(session)
        session.commit()
    logger.info("Retention: %s", result)
    return RetentionResponse(
        submitter_keys_cleared=result.submitter_keys_cleared,
        verifications_deleted=result.verifications_deleted,
        contacts_deleted=result.contacts_deleted,
    )
