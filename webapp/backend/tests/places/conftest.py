"""
Sensitive-places fixtures: a canned Overpass response served through httpx's
MockTransport, plus the staff app fixtures (client, deps, staff) from tests/staff.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest

from infraalert.places.osm import OverpassClient
from tests.staff.conftest import client, deps, staff  # noqa: F401

OVERPASS_URL = "https://overpass.test/api/interpreter"
BBOX = (-1.45, 36.65, -1.16, 37.10)

# The places the fixture response yields (the bench and residential road are skipped).
FIXTURE_OSM_IDS = {"node/1", "node/2", "node/3", "way/10", "relation/20", "way/30"}


def overpass_response() -> dict[str, Any]:
    """A fresh copy of the fixture response, safe to mutate."""
    raw = json.loads((Path(__file__).parent / "overpass_response.json").read_text())
    return copy.deepcopy(raw)


@dataclass
class FakeOverpass:
    """Serves `body` (or `status`) and records every request."""

    body: dict[str, Any] = field(default_factory=overpass_response)
    status: int = 200
    requests: list[httpx.Request] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json=self.body)

    def client(self) -> OverpassClient:
        return OverpassClient(
            OVERPASS_URL, httpx.Client(transport=httpx.MockTransport(self.handler))
        )

    def keep(self, osm_ids: set[str]) -> None:
        """Drop every element whose osm_id isn't in `osm_ids`."""
        self.body["elements"] = [
            e for e in self.body["elements"] if f"{e['type']}/{e['id']}" in osm_ids
        ]


@pytest.fixture()
def overpass() -> FakeOverpass:
    return FakeOverpass()


def element(body: dict[str, Any], osm_id: str) -> dict[str, Any]:
    kind, ident = osm_id.split("/")
    return next(e for e in body["elements"] if e["type"] == kind and str(e["id"]) == ident)
