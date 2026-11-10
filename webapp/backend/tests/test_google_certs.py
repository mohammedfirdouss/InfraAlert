from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from infraalert.google_certs import CachingRequest


@dataclass
class FakeResponse:
    status: int = 200
    data: bytes = b"{}"


class FakeTransport:
    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.calls: list[tuple[str, str]] = []

    def __call__(self, url: str, method: str = "GET", **kwargs: Any) -> FakeResponse:
        self.calls.append((method, url))
        return FakeResponse(status=self.status)


def test_certificates_are_fetched_once_within_the_ttl() -> None:
    transport = FakeTransport()
    request = CachingRequest(transport)
    first = request("https://certs.example/a")
    assert request("https://certs.example/a") is first
    request("https://certs.example/b")
    assert transport.calls == [
        ("GET", "https://certs.example/a"),
        ("GET", "https://certs.example/b"),
    ]


def test_certificates_are_fetched_again_after_the_ttl() -> None:
    transport = FakeTransport()
    request = CachingRequest(transport, ttl=0)
    request("https://certs.example/a")
    request("https://certs.example/a")
    assert len(transport.calls) == 2


def test_failures_and_other_methods_are_never_cached() -> None:
    failing = FakeTransport(status=503)
    request = CachingRequest(failing)
    request("https://certs.example/a")
    request("https://certs.example/a")
    assert len(failing.calls) == 2

    transport = FakeTransport()
    request = CachingRequest(transport)
    request("https://iam.example/sign", method="POST")
    request("https://iam.example/sign", method="POST")
    assert len(transport.calls) == 2
