"""
Hands submitted reports to the processing worker (ADR 0002).

Enqueueing happens after the report is committed. If it fails, the report is
still accepted; reports left in `received` are picked up again by the sweep
(POST /tasks/sweep, see infraalert.processing.api) or, with the inline queue, the
next time the app starts (infraalert.deps).
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any, Protocol

from google.cloud import tasks_v2

logger = logging.getLogger(__name__)


class TaskQueue(Protocol):
    def enqueue_report_processing(self, report_id: uuid.UUID) -> None: ...


class InlineTaskQueue:
    """
    Local development: process reports on a fixed set of background threads in
    this process, retrying a model outage a few times like the real queue would.

    The worker count is the inline equivalent of Cloud Tasks' max concurrent
    dispatches. It used to be one new thread per report, which under load put
    dozens of threads in line for the same per-issue-type matching lock, each
    holding a database connection, until the pool ran dry and requests failed
    (scripts/loadtest/README.md). A queue holds the backlog instead.
    """

    def __init__(
        self,
        process: Callable[[uuid.UUID, int], object],
        retry_delay: float = 5.0,
        workers: int = 4,
    ) -> None:
        self._process = process
        self._retry_delay = retry_delay
        self._pending: queue.SimpleQueue[uuid.UUID] = queue.SimpleQueue()
        for _ in range(workers):
            threading.Thread(target=self._work, daemon=True).start()

    def enqueue_report_processing(self, report_id: uuid.UUID) -> None:
        self._pending.put(report_id)

    def _work(self) -> None:
        while True:
            self._run(self._pending.get())

    def _run(self, report_id: uuid.UUID) -> None:
        from infraalert.processing.worker import MAX_EXTRACTION_ATTEMPTS, RetryLater

        for attempt in range(MAX_EXTRACTION_ATTEMPTS):
            try:
                self._process(report_id, attempt)
                return
            except RetryLater:
                time.sleep(self._retry_delay)
            except Exception:
                logger.exception("Inline processing failed for report %s", report_id)
                return


class CloudTasksQueue:
    def __init__(
        self, queue: str, service_url: str, service_account: str, client: Any = None
    ) -> None:
        self._client = client or tasks_v2.CloudTasksClient()
        self._queue = queue
        self._target_url = f"{service_url}/tasks/process-report"
        self._service_account = service_account

    def enqueue_report_processing(self, report_id: uuid.UUID) -> None:
        task = tasks_v2.Task(
            http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST,
                url=self._target_url,
                headers={"Content-Type": "application/json"},
                body=json.dumps({"report_id": str(report_id)}).encode(),
                oidc_token=tasks_v2.OidcToken(
                    service_account_email=self._service_account,
                    audience=self._target_url,
                ),
            )
        )
        self._client.create_task(parent=self._queue, task=task)
