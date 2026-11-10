"""
A google-auth HTTP transport that remembers Google's public signing certificates.

google-auth downloads the certificates again for every token it verifies. Every
staff API call and every /tasks/* call verifies a token, so without this each of
them makes an extra HTTPS request to Google before doing any work.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from google.auth.transport import requests as google_requests

# Google rotates signing keys over days and publishes a new key well before
# using it, so a short cache never misses one that is in use.
CERTS_TTL_SECONDS = 600.0


class CachingRequest:
    """Wraps a google-auth `Request`, reusing successful GET responses for a while."""

    def __init__(self, request: Any = None, ttl: float = CERTS_TTL_SECONDS) -> None:
        self._request = request or google_requests.Request()
        self._ttl = ttl
        self._lock = threading.Lock()
        self._cached: dict[str, tuple[float, Any]] = {}

    def __call__(self, url: str, method: str = "GET", **kwargs: Any) -> Any:
        if method != "GET":
            return self._request(url, method=method, **kwargs)
        now = time.monotonic()
        with self._lock:
            hit = self._cached.get(url)
            if hit is not None and now - hit[0] < self._ttl:
                return hit[1]
        response = self._request(url, method=method, **kwargs)
        if response.status == 200:
            with self._lock:
                self._cached[url] = (now, response)
        return response
