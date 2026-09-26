from __future__ import annotations

import pytest
from starlette.requests import Request

from infraalert.ratelimit import client_ip, submitter_key


def request(forwarded: str | None, peer: str = "169.254.1.1") -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


@pytest.mark.parametrize(
    ("forwarded", "hops", "expected"),
    [
        (None, 0, "169.254.1.1"),  # no proxy: the TCP peer
        ("203.0.113.7", 0, "203.0.113.7"),  # Cloud Run appends the client
        ("1.2.3.4, 203.0.113.7", 0, "203.0.113.7"),  # client-forged entry ignored
        ("203.0.113.7, 35.191.0.1", 1, "203.0.113.7"),  # behind a load balancer
        ("35.191.0.1", 1, "169.254.1.1"),  # fewer entries than trusted hops
    ],
)
def test_client_ip(forwarded: str | None, hops: int, expected: str) -> None:
    assert client_ip(request(forwarded), hops) == expected


def test_submitter_key_is_stable_and_secret_dependent() -> None:
    assert submitter_key("203.0.113.7", "a") == submitter_key("203.0.113.7", "a")
    assert submitter_key("203.0.113.7", "a") != submitter_key("203.0.113.7", "b")
    assert submitter_key(None, "a") is None
