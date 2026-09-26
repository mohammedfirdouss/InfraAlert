from __future__ import annotations

import httpx

from infraalert.captcha import TURNSTILE_VERIFY_URL, CaptchaResult, TurnstileVerifier


def verifier(handler) -> TurnstileVerifier:  # type: ignore[no-untyped-def]
    return TurnstileVerifier("secret", httpx.Client(transport=httpx.MockTransport(handler)))


def test_passes_token_secret_and_ip_to_turnstile() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"success": True})

    assert verifier(handler).verify("tok", "203.0.113.7") is CaptchaResult.PASSED
    assert str(seen[0].url) == TURNSTILE_VERIFY_URL
    assert seen[0].content == b"secret=secret&response=tok&remoteip=203.0.113.7"


def test_rejection_fails() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": False, "error-codes": ["invalid-input"]})

    assert verifier(handler).verify("tok", None) is CaptchaResult.FAILED


def test_outage_is_reported_as_unavailable() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable")

    def error(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    def garbage(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>")

    for handler in (down, error, garbage):
        assert verifier(handler).verify("tok", None) is CaptchaResult.UNAVAILABLE
