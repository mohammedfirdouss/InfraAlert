"""
Hands submitted reports to the processing worker (ADR 0002).

Enqueueing happens after the report is committed. If it fails, the report is
still accepted; reports left in `received` are picked up again by a sweep
(built with the worker in step 3).
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Protocol

from google.cloud import tasks_v2

logger = logging.getLogger(__name__)


class TaskQueue(Protocol):
    def enqueue_report_processing(self, report_id: uuid.UUID) -> None: ...


class LoggingTaskQueue:
    """Local development: there is no worker yet, so just record the intent."""

    def enqueue_report_processing(self, report_id: uuid.UUID) -> None:
        logger.info("Would enqueue processing for report %s", report_id)


class CloudTasksQueue:
    def __init__(
        self, queue: str, target_url: str, service_account: str, client: Any = None
    ) -> None:
        self._client = client or tasks_v2.CloudTasksClient()
        self._queue = queue
        self._target_url = target_url
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
