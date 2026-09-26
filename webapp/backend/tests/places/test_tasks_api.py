from __future__ import annotations

import dataclasses
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from infraalert.app import create_app
from infraalert.db.models import SensitivePlace
from infraalert.deps import Deps
from infraalert.places.tasks_api import get_overpass
from tests.places.conftest import FIXTURE_OSM_IDS, FakeOverpass
from tests.processing.test_tasks_api import SERVICE_URL, FakeTaskAuth

AUTH = {"Authorization": "Bearer good-token"}


@pytest.fixture()
def task_app(deps: Deps, overpass: FakeOverpass) -> FastAPI:
    deps.settings = dataclasses.replace(
        deps.settings, tasks_backend="cloud_tasks", service_url=SERVICE_URL
    )
    deps.task_auth = FakeTaskAuth()
    app = create_app(deps)
    app.dependency_overrides[get_overpass] = overpass.client
    return app


@pytest.fixture()
def task_client(task_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(task_app) as c:
        yield c


def _count(deps: Deps) -> int:
    with deps.sessions() as session:
        return int(session.scalar(select(func.count()).select_from(SensitivePlace)) or 0)


def test_import_requires_the_scheduler_identity(
    task_client: TestClient, deps: Deps, overpass: FakeOverpass
) -> None:
    assert task_client.post("/tasks/import-osm").status_code == 403
    forged = task_client.post("/tasks/import-osm", headers={"Authorization": "Bearer forged"})
    assert forged.status_code == 403
    assert deps.task_auth.calls[-1] == ("forged", f"{SERVICE_URL}/tasks/import-osm")  # type: ignore[union-attr]
    assert overpass.requests == []


def test_import_endpoint_runs_the_import(
    task_client: TestClient, deps: Deps, overpass: FakeOverpass
) -> None:
    resp = task_client.post("/tasks/import-osm", headers=AUTH)

    assert resp.status_code == 200
    assert resp.json() == {
        "fetched": len(FIXTURE_OSM_IDS),
        "inserted": len(FIXTURE_OSM_IDS),
        "updated": 0,
        "unchanged": 0,
        "deleted": 0,
        "deletions_skipped": False,
    }
    assert _count(deps) == len(FIXTURE_OSM_IDS)


@pytest.mark.parametrize("failure", ["http", "empty"])
def test_failed_import_answers_502(
    task_client: TestClient, deps: Deps, overpass: FakeOverpass, failure: str
) -> None:
    if failure == "http":
        overpass.status = 504
    else:
        overpass.body["elements"] = []

    resp = task_client.post("/tasks/import-osm", headers=AUTH)

    assert (resp.status_code, resp.json()["detail"]) == (502, "osm_import_failed")
    assert _count(deps) == 0
