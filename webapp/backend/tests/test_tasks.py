from __future__ import annotations

import threading
import uuid

from infraalert.processing.worker import MAX_EXTRACTION_ATTEMPTS, RetryLater
from infraalert.tasks import InlineTaskQueue


def test_inline_queue_processes_in_the_background_and_retries_outages() -> None:
    attempts: list[int] = []
    done = threading.Event()

    def process(report_id: uuid.UUID, attempt: int) -> None:
        attempts.append(attempt)
        if attempt < MAX_EXTRACTION_ATTEMPTS - 1:
            raise RetryLater("model down")
        done.set()

    InlineTaskQueue(process, retry_delay=0).enqueue_report_processing(uuid.uuid4())

    assert done.wait(timeout=5)
    assert attempts == list(range(MAX_EXTRACTION_ATTEMPTS))


def test_inline_queue_survives_unexpected_errors() -> None:
    finished = threading.Event()

    def process(report_id: uuid.UUID, attempt: int) -> None:
        finished.set()
        raise RuntimeError("boom")

    InlineTaskQueue(process, retry_delay=0).enqueue_report_processing(uuid.uuid4())

    assert finished.wait(timeout=5)
