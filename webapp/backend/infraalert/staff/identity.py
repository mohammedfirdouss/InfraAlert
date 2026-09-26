"""
Verifying staff ID tokens (ADR 0007). Separate from the FastAPI dependencies in
infraalert.staff.auth so the app's wiring (infraalert.deps) can import it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Identity:
    subject: str
    email: str
    name: str | None = None


class StaffTokenVerifier(Protocol):
    def verify(self, token: str) -> Identity | None: ...


class IdentityPlatformVerifier:
    def __init__(self, project_id: str, sign_in_provider: str | None = None) -> None:
        self._project_id = project_id
        self._issuer = f"https://securetoken.google.com/{project_id}"
        # e.g. "oidc.city-sso": only accept sign-ins through the city's provider.
        self._sign_in_provider = sign_in_provider
        self._request = google_requests.Request()

    def verify(self, token: str) -> Identity | None:
        try:
            claims = id_token.verify_firebase_token(
                token, self._request, audience=self._project_id
            )
        except ValueError as exc:
            logger.info("Rejected staff token: %s", exc)
            return None
        if not claims or claims.get("iss") != self._issuer:
            return None
        if not claims.get("email") or not claims.get("email_verified"):
            return None
        provider = (claims.get("firebase") or {}).get("sign_in_provider")
        if self._sign_in_provider and provider != self._sign_in_provider:
            return None
        return Identity(subject=claims["sub"], email=claims["email"], name=claims.get("name"))


class DevVerifier:
    """
    Local development only: the token "dev:<email>" signs in as that staff member.
    Settings refuse to combine this with production task handling.
    """

    def verify(self, token: str) -> Identity | None:
        if not token.startswith("dev:") or "@" not in token:
            return None
        email = token.removeprefix("dev:")
        return Identity(subject=f"dev:{email.lower()}", email=email)
