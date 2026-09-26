"""
CAPTCHA verification for anonymous submissions (ADR 0007), via Cloudflare Turnstile.

If Turnstile itself is unreachable we accept the submission (rate limits still
apply) rather than fail it: accepting a report must not depend on an external
API being up (ADR 0002). An explicit rejection from Turnstile is always final.
"""

from __future__ import annotations

import enum
import logging
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


class CaptchaResult(enum.Enum):
    PASSED = "passed"
    FAILED = "failed"
    UNAVAILABLE = "unavailable"


class CaptchaVerifier(Protocol):
    def verify(self, token: str, remote_ip: str | None) -> CaptchaResult: ...


class TurnstileVerifier:
    def __init__(self, secret_key: str, client: httpx.Client | None = None) -> None:
        self._secret_key = secret_key
        self._client = client or httpx.Client(timeout=5.0)

    def verify(self, token: str, remote_ip: str | None) -> CaptchaResult:
        data = {"secret": self._secret_key, "response": token}
        if remote_ip:
            data["remoteip"] = remote_ip
        try:
            response = self._client.post(TURNSTILE_VERIFY_URL, data=data)
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Turnstile unavailable, accepting submission: %s", exc)
            return CaptchaResult.UNAVAILABLE
        if body.get("success") is True:
            return CaptchaResult.PASSED
        logger.info("Turnstile rejected token: %s", body.get("error-codes"))
        return CaptchaResult.FAILED
