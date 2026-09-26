"""
Only Google's task queue and scheduler may call /tasks/*: each request carries
an OIDC ID token for our service account, with the endpoint URL as audience.
"""

from __future__ import annotations

import logging
from typing import Protocol

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

logger = logging.getLogger(__name__)


class TaskCallerVerifier(Protocol):
    def verify(self, token: str, audience: str) -> bool: ...


class GoogleOidcVerifier:
    def __init__(self, service_account: str) -> None:
        self._service_account = service_account
        self._request = google_requests.Request()

    def verify(self, token: str, audience: str) -> bool:
        try:
            claims = id_token.verify_oauth2_token(token, self._request, audience=audience)
        except ValueError as exc:  # bad signature, expired, wrong audience
            logger.warning("Rejected task token: %s", exc)
            return False
        return claims.get("email") == self._service_account and bool(
            claims.get("email_verified")
        )
