"""
Caps how many requests run at once in this process; the rest wait their turn.

Why: synchronous endpoints run on FastAPI's 40-thread pool, and after an
endpoint returns, FastAPI validates its response on that same pool while the
request's database session is still open. With more requests in flight than
pooled connections, requests holding a connection waited for a thread while
every thread waited for a connection, until the pool's timeout fired. Under
load, throughput collapsed from about 280 to 35 requests/s with 30-second
stalls (scripts/loadtest/README.md).

Keeping running requests below both the thread count and the connection pool
means that wait can't form. Waiting requests sit in the event loop, which costs
neither a thread nor a connection. This counts requests, not connections:
uvicorn's --limit-concurrency counts idle keep-alive connections too, and so
rejects most traffic from clients that hold connections open.
"""

from __future__ import annotations

import anyio
from starlette.types import ASGIApp, Receive, Scope, Send


class ConcurrencyLimitMiddleware:
    def __init__(self, app: ASGIApp, limit: int) -> None:
        if limit < 1:
            raise ValueError("limit must be at least 1")
        self.app = app
        self.limit = limit
        self._slots: anyio.Semaphore | None = None  # created inside the event loop

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self._slots is None:
            self._slots = anyio.Semaphore(self.limit)
        async with self._slots:
            await self.app(scope, receive, send)
