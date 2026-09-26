from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from infraalert.db.models import AuditLog, PlaceSource, SensitivePlace, StaffRole
from infraalert.deps import Deps
from infraalert.places import osm
from infraalert.processing.priority import PLACE_WEIGHTS
from tests.places.conftest import BBOX, FakeOverpass
from tests.staff.conftest import StaffFactory, auth

HOSPITAL = {"name": "Field Hospital", "category": "hospital", "location": {"lat": -1.3, "lng": 36.8}}


@pytest.fixture()
def admin(staff: StaffFactory) -> dict[str, str]:
    return auth(staff(StaffRole.ADMIN).email)


@pytest.fixture()
def imported(deps: Deps, overpass: FakeOverpass) -> dict[str, uuid.UUID]:
    """Run the fixture import; returns {osm_id: place id}."""
    with deps.sessions() as session:
        osm.import_osm(session, overpass.client(), BBOX)
        rows = session.execute(
            select(SensitivePlace.osm_id, SensitivePlace.id).where(
                SensitivePlace.source == PlaceSource.OSM
            )
        ).all()
    return {osm_id: place_id for osm_id, place_id in rows}


def _audit(deps: Deps, place_id: str) -> list[AuditLog]:
    with deps.sessions() as session:
        query = select(AuditLog).where(AuditLog.entity_id == uuid.UUID(place_id)).order_by(
            AuditLog.id
        )
        return list(session.scalars(query))


def _create(client: TestClient, headers: dict[str, str], **changes: Any) -> dict[str, Any]:
    resp = client.post("/api/staff/places", json={**HOSPITAL, **changes}, headers=headers)
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


@pytest.mark.parametrize("role", [StaffRole.DISPATCHER, StaffRole.SUPERVISOR])
def test_places_are_admin_only(client: TestClient, staff: StaffFactory, role: StaffRole) -> None:
    headers = auth(staff(role).email)
    assert client.get("/api/staff/places", headers=headers).status_code == 403
    assert client.post("/api/staff/places", json=HOSPITAL, headers=headers).status_code == 403
    patch = client.patch(f"/api/staff/places/{uuid.uuid4()}", json={}, headers=headers)
    assert patch.status_code == 403
    assert client.get("/api/staff/places").status_code == 401


def test_list_before_any_import(client: TestClient, admin: dict[str, str]) -> None:
    body = client.get("/api/staff/places", headers=admin).json()

    assert body["last_import_at"] is None
    assert body["categories"] == [{"id": c, "weight": w} for c, w in PLACE_WEIGHTS.items()]
    assert "unknown" not in {c["id"] for c in body["categories"]}


def test_list_after_an_import(
    client: TestClient, admin: dict[str, str], imported: dict[str, uuid.UUID]
) -> None:
    body = client.get("/api/staff/places", headers=admin).json()

    assert body["last_import_at"] is not None
    places = {p["osm_id"]: p for p in body["places"]}
    assert set(places) == set(imported)
    assert places["node/1"] == {
        "id": str(imported["node/1"]),
        "name": "Kenyatta National Hospital",
        "category": "hospital",
        "geometry": {"type": "Point", "coordinates": [36.807, -1.3009]},
        "source": "osm",
        "osm_id": "node/1",
        "enabled": True,
    }
    road = places["way/30"]["geometry"]
    assert road["type"] == "LineString"
    assert road["coordinates"][0] == [36.8138, -1.278]


def test_create_a_manual_place(client: TestClient, admin: dict[str, str], deps: Deps) -> None:
    place = _create(client, admin, name="  Field Hospital ")

    assert place["name"] == "Field Hospital"
    assert place["source"] == "manual" and place["osm_id"] is None and place["enabled"]
    assert place["geometry"] == {"type": "Point", "coordinates": [36.8, -1.3]}
    [entry] = _audit(deps, place["id"])
    assert entry.action == "place.created" and entry.entity_type == "sensitive_place"
    assert entry.detail["category"] == "hospital"
    listed = client.get("/api/staff/places", headers=admin).json()["places"]
    assert [p["id"] for p in listed] == [place["id"]]


@pytest.mark.parametrize(
    "changes",
    [
        {"category": "unknown"},
        {"category": "church"},
        {"name": " "},
        {"location": {"lat": 91, "lng": 0}},
        {"source": "osm"},
    ],
)
def test_create_validation(
    client: TestClient, admin: dict[str, str], changes: dict[str, Any]
) -> None:
    resp = client.post("/api/staff/places", json={**HOSPITAL, **changes}, headers=admin)
    assert resp.status_code == 422


def test_edit_a_manual_place(client: TestClient, admin: dict[str, str], deps: Deps) -> None:
    place = _create(client, admin)

    resp = client.patch(
        f"/api/staff/places/{place['id']}",
        json={"name": "Clinic", "category": "clinic", "location": {"lat": -1.31, "lng": 36.81}},
        headers=admin,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert (body["name"], body["category"]) == ("Clinic", "clinic")
    assert body["geometry"] == {"type": "Point", "coordinates": [36.81, -1.31]}
    updated = _audit(deps, place["id"])[-1]
    assert updated.action == "place.updated"
    assert updated.detail["name"] == {"from": "Field Hospital", "to": "Clinic"}
    assert updated.detail["geometry"]["to"] == {"type": "Point", "coordinates": [36.81, -1.31]}


def test_patch_validation_and_missing_place(client: TestClient, admin: dict[str, str]) -> None:
    place = _create(client, admin)
    url = f"/api/staff/places/{place['id']}"
    assert client.patch(url, json={"category": "church"}, headers=admin).status_code == 422
    assert client.patch(url, json={"enabled": None}, headers=admin).status_code == 422
    missing = client.patch(f"/api/staff/places/{uuid.uuid4()}", json={}, headers=admin)
    assert (missing.status_code, missing.json()["detail"]) == (404, "place_not_found")


@pytest.mark.parametrize(
    "changes",
    [{"name": "X"}, {"category": "clinic"}, {"location": {"lat": 0, "lng": 0}}],
)
def test_osm_fields_are_read_only(
    client: TestClient,
    admin: dict[str, str],
    imported: dict[str, uuid.UUID],
    changes: dict[str, Any],
) -> None:
    resp = client.patch(
        f"/api/staff/places/{imported['node/1']}", json={**changes, "enabled": False}, headers=admin
    )
    assert (resp.status_code, resp.json()["detail"]) == (409, "osm_place_read_only")


def test_disable_and_enable_an_osm_place_survives_reimport(
    client: TestClient,
    admin: dict[str, str],
    imported: dict[str, uuid.UUID],
    deps: Deps,
    overpass: FakeOverpass,
) -> None:
    url = f"/api/staff/places/{imported['node/1']}"
    assert client.patch(url, json={"enabled": False}, headers=admin).json()["enabled"] is False

    with deps.sessions() as session:
        osm.import_osm(session, overpass.client(), BBOX)
    listed = client.get("/api/staff/places", headers=admin).json()["places"]
    assert next(p for p in listed if p["osm_id"] == "node/1")["enabled"] is False

    assert client.patch(url, json={"enabled": True}, headers=admin).json()["enabled"] is True
    # An unchanged value is not audited.
    client.patch(url, json={"enabled": True}, headers=admin)

    entries = _audit(deps, str(imported["node/1"]))
    assert [e.detail for e in entries] == [
        {"enabled": {"from": True, "to": False}, "osm_id": "node/1"},
        {"enabled": {"from": False, "to": True}, "osm_id": "node/1"},
    ]
    assert all(e.action == "place.updated" for e in entries)
