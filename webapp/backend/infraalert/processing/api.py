"""
Endpoints for Cloud Tasks (processing) and Cloud Scheduler (the sweep).

The sweep re-enqueues reports whose task was lost, and sends reports that are
still unprocessed after GIVE_UP_AFTER to human triage.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from infraalert.db.models import Report, ReportProcessing
from infraalert.deps import DepsDep
from infraalert.processing.worker import Outcome, RetryLater

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", include_in_schema=False)

# A report still `received` after this long missed its task (e.g. enqueue failed).
SWEEP_AFTER = timedelta(minutes=5)
SWEEP_BATCH = 100
# A report still `received` after this long has used up its task's retries and
# several sweeps: something about it keeps failing, so a person takes it.
GIVE_UP_AFTER = timedelta(hours=1)


def require_task_caller(request: Request, deps: DepsDep) -> None:
    settings = deps.settings
    assert settings.service_url and deps.task_auth
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
    audience = f"{settings.service_url}{request.url.path}"
    if not token or not deps.task_auth.verify(token, audience):
        raise HTTPException(403, detail="forbidden")


CallerDep = Annotated[None, Depends(require_task_caller)]


class ProcessReportRequest(BaseModel):
    report_id: uuid.UUID


class ProcessReportResponse(BaseModel):
    outcome: Outcome


class SweepResponse(BaseModel):
    enqueued: int
    gave_up: int


@router.post("/process-report")
def process_report(
    body: ProcessReportRequest,
    deps: DepsDep,
    _caller: CallerDep,
    retry_count: Annotated[int, Header(alias="X-CloudTasks-TaskRetryCount")] = 0,
) -> ProcessReportResponse:
    assert deps.processor
    try:
        outcome = deps.processor.process(body.report_id, attempt=retry_count)
    except RetryLater as exc:
        # Cloud Tasks redelivers non-2xx responses with backoff.
        logger.info("Report %s: retrying later (%s)", body.report_id, exc)
        raise HTTPException(503, detail="retry_later") from exc
    return ProcessReportResponse(outcome=outcome)


@router.post("/sweep")
def sweep(deps: DepsDep, _caller: CallerDep) -> SweepResponse:
    with deps.sessions() as session:
        stuck = session.execute(
            select(Report.id, Report.submitted_at < func.now() - GIVE_UP_AFTER)
            .where(
                Report.processing == ReportProcessing.RECEIVED,
                Report.submitted_at < func.now() - SWEEP_AFTER,
            )
            .order_by(Report.submitted_at)
            .limit(SWEEP_BATCH)
        ).all()
    assert deps.processor
    enqueued = gave_up = 0
    for report_id, hopeless in stuck:
        if not hopeless:
            deps.tasks.enqueue_report_processing(report_id)
            enqueued += 1
            continue
        try:
            deps.processor.give_up(report_id, "gave up: processing kept failing")
            gave_up += 1
        except Exception:
            logger.exception("Sweep could not send report %s to triage", report_id)
    if enqueued:
        logger.warning("Sweep re-enqueued %d stuck report(s)", enqueued)
    if gave_up:
        logger.error("Sweep sent %d report(s) that kept failing to triage", gave_up)
    return SweepResponse(enqueued=enqueued, gave_up=gave_up)
