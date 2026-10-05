from __future__ import annotations

import anyio
import pytest

from infraalert.concurrency import ConcurrencyLimitMiddleware


def test_runs_at_most_limit_requests_at_once_and_queues_the_rest() -> None:
    running = 0
    peak = 0
    finished = 0

    async def app(scope: dict, receive: object, send: object) -> None:  # type: ignore[type-arg]
        nonlocal running, peak, finished
        running += 1
        peak = max(peak, running)
        await anyio.sleep(0.01)
        running -= 1
        finished += 1

    limited = ConcurrencyLimitMiddleware(app, limit=3)  # type: ignore[arg-type]

    async def main() -> None:
        async with anyio.create_task_group() as tg:
            for _ in range(20):
                tg.start_soon(limited, {"type": "http"}, None, None)

    anyio.run(main)
    assert peak == 3
    assert finished == 20


def test_lifespan_and_websocket_bypass_the_limit() -> None:
    seen: list[str] = []

    async def app(scope: dict, receive: object, send: object) -> None:  # type: ignore[type-arg]
        seen.append(scope["type"])

    limited = ConcurrencyLimitMiddleware(app, limit=1)  # type: ignore[arg-type]
    anyio.run(limited, {"type": "lifespan"}, None, None)
    assert seen == ["lifespan"] and limited._slots is None


def test_rejects_a_limit_below_one() -> None:
    with pytest.raises(ValueError):
        ConcurrencyLimitMiddleware(lambda s, r, w: None, limit=0)  # type: ignore[arg-type]
