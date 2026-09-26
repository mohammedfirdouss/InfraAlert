from __future__ import annotations

import urllib.parse

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from infraalert.db.models import AuditLog, Incident, PlaceSource, SensitivePlace
from infraalert.places import osm
from infraalert.processing.priority import PLACE_WEIGHTS, nearby_sensitive_places
from tests.places.conftest import BBOX, FIXTURE_OSM_IDS, FakeOverpass, element, overpass_response

# Query


def test_query_covers_the_bbox_and_every_category() -> None:
    query = osm.build_query(BBOX)

    assert query.startswith("[out:json][timeout:180][bbox:-1.45,36.65,-1.16,37.1];")
    for tag in ("hospital", "clinic", "doctors", "school", "fire_station", "police"):
        assert tag in query
    assert "marketplace" in query
    assert 'nwr["amenity"~"^(' in query
    assert 'way["highway"~"^(trunk|primary)$"];' in query
    assert "out center;" in query and "out geom;" in query


def test_every_mapped_category_is_a_priority_category() -> None:
    mapped = set(osm.AMENITY_CATEGORIES.values()) | set(osm.HIGHWAY_CATEGORIES.values())
    assert mapped == set(PLACE_WEIGHTS)


def test_fetch_posts_the_query_with_a_user_agent(overpass: FakeOverpass) -> None:
    overpass.client().fetch(BBOX)

    [request] = overpass.requests
    assert request.method == "POST"
    assert str(request.url) == "https://overpass.test/api/interpreter"
    assert request.headers["user-agent"].startswith("InfraAlert/")
    form = urllib.parse.parse_qs(request.content.decode())
    assert form["data"] == [osm.build_query(BBOX)]


# Parsing


def test_parse_each_element_kind() -> None:
    places = {p.osm_id: p for p in osm.parse_elements(overpass_response()["elements"])}

    assert set(places) == FIXTURE_OSM_IDS  # the bench and the residential road are skipped
    assert places["node/1"] == osm.OsmPlace(
        "node/1", "Kenyatta National Hospital", "hospital", "POINT(36.807 -1.3009)"
    )
    assert places["node/2"].category == "clinic"  # amenity=doctors
    assert places["node/3"].name is None
    assert places["way/10"].wkt == "POINT(36.7836 -1.2707)"  # an area's center
    assert (places["relation/20"].category, places["relation/20"].wkt) == (
        "market",
        "POINT(36.8283 -1.2833)",
    )
    assert places["way/30"].category == "major_road"
    assert places["way/30"].wkt == (
        "LINESTRING(36.8138 -1.278, 36.8203 -1.2921, 36.826 -1.305)"
    )


def test_parse_skips_elements_without_geometry() -> None:
    elements = [
        {"type": "way", "id": 1, "tags": {"amenity": "school"}},  # no center
        {"type": "way", "id": 2, "tags": {"highway": "trunk"}, "geometry": [{"lat": 1, "lon": 2}]},
        {"type": "area", "id": 3, "tags": {"amenity": "school"}, "lat": 1, "lon": 2},
    ]
    assert osm.parse_elements(elements) == []


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (504, {"elements": []}),
        (200, {"remark": "whatever"}),
        (200, {"elements": [], "remark": "runtime error: Query timed out in \"query\""}),
    ],
)
def test_fetch_errors(status: int, body: dict[str, object]) -> None:
    fake = FakeOverpass(body=dict(body), status=status)
    with pytest.raises(osm.OverpassError):
        fake.client().fetch(BBOX)


# Upsert


def _osm_places(session: Session) -> dict[str, SensitivePlace]:
    rows = session.scalars(select(SensitivePlace).where(SensitivePlace.source == PlaceSource.OSM))
    return {p.osm_id: p for p in rows if p.osm_id}


def _wkt(session: Session, place: SensitivePlace) -> str:
    return str(session.scalar(select(func.ST_AsText(SensitivePlace.geom)).where(
        SensitivePlace.id == place.id
    )))


def _manual(session: Session) -> SensitivePlace:
    place = SensitivePlace(
        name="Hand-drawn school",
        category="school",
        geom="SRID=4326;POINT(36.8 -1.3)",
        source=PlaceSource.MANUAL,
    )
    session.add(place)
    session.flush()
    return place


def test_import_inserts_and_records_the_run(session: Session, overpass: FakeOverpass) -> None:
    result = osm.import_osm(session, overpass.client(), BBOX)

    assert result == osm.ImportResult(
        fetched=6, inserted=6, updated=0, unchanged=0, deleted=0, deletions_skipped=False
    )
    places = _osm_places(session)
    assert set(places) == FIXTURE_OSM_IDS
    assert all(p.enabled for p in places.values())
    assert _wkt(session, places["way/30"]).startswith("LINESTRING(")
    assert _wkt(session, places["node/1"]) == "POINT(36.807 -1.3009)"

    [run] = session.scalars(select(AuditLog).where(AuditLog.entity_type == "places_import"))
    assert run.action == "places.imported" and run.staff_id is None
    assert run.detail["inserted"] == 6
    assert osm.last_import_at(session) == run.at


def test_reimport_is_idempotent(session: Session, overpass: FakeOverpass) -> None:
    osm.import_osm(session, overpass.client(), BBOX)
    again = osm.import_osm(session, overpass.client(), BBOX)

    assert again == osm.ImportResult(
        fetched=6, inserted=0, updated=0, unchanged=6, deleted=0, deletions_skipped=False
    )
    assert len(_osm_places(session)) == 6


def test_update_changes_osm_fields_but_keeps_a_disabled_place_disabled(
    session: Session, overpass: FakeOverpass
) -> None:
    osm.import_osm(session, overpass.client(), BBOX)
    hospital = _osm_places(session)["node/1"]
    hospital.enabled = False
    session.commit()

    node = element(overpass.body, "node/1")
    node["tags"]["name"] = "KNH"
    node["lat"] = -1.3
    road = element(overpass.body, "way/30")
    road["tags"]["highway"] = "trunk"  # same category: no change
    result = osm.import_osm(session, overpass.client(), BBOX)

    assert (result.inserted, result.updated, result.unchanged) == (0, 1, 5)
    session.expire_all()
    hospital = _osm_places(session)["node/1"]
    assert (hospital.name, hospital.enabled) == ("KNH", False)
    assert _wkt(session, hospital) == "POINT(36.807 -1.3)"


def test_category_change_is_applied(session: Session, overpass: FakeOverpass) -> None:
    osm.import_osm(session, overpass.client(), BBOX)
    element(overpass.body, "node/2")["tags"]["amenity"] = "hospital"

    assert osm.import_osm(session, overpass.client(), BBOX).updated == 1
    session.expire_all()
    assert _osm_places(session)["node/2"].category == "hospital"


def test_vanished_osm_places_are_deleted_and_manual_ones_untouched(
    session: Session, overpass: FakeOverpass
) -> None:
    manual = _manual(session)
    osm.import_osm(session, overpass.client(), BBOX)

    overpass.keep(FIXTURE_OSM_IDS - {"node/3"})
    result = osm.import_osm(session, overpass.client(), BBOX)

    assert (result.deleted, result.deletions_skipped) == (1, False)
    assert set(_osm_places(session)) == FIXTURE_OSM_IDS - {"node/3"}
    session.expire_all()
    kept = session.get(SensitivePlace, manual.id)
    assert kept is not None and kept.name == "Hand-drawn school"


def test_empty_response_changes_nothing(session: Session, overpass: FakeOverpass) -> None:
    manual = _manual(session)
    osm.import_osm(session, overpass.client(), BBOX)

    overpass.body["elements"] = []
    with pytest.raises(osm.ImportRefused):
        osm.import_osm(session, overpass.client(), BBOX)
    session.rollback()

    assert set(_osm_places(session)) == FIXTURE_OSM_IDS
    assert session.get(SensitivePlace, manual.id) is not None
    runs = session.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.entity_type == "places_import")
    )
    assert runs == 1


def test_tiny_response_refuses_mass_deletion(session: Session, overpass: FakeOverpass) -> None:
    osm.import_osm(session, overpass.client(), BBOX)

    overpass.keep({"node/1", "node/2"})  # 2 of 6: looks truncated
    result = osm.import_osm(session, overpass.client(), BBOX)

    assert (result.deleted, result.deletions_skipped) == (0, True)
    assert set(_osm_places(session)) == FIXTURE_OSM_IDS


def test_nearby_places_ignore_places_disabled_after_an_import(
    session: Session, overpass: FakeOverpass
) -> None:
    osm.import_osm(session, overpass.client(), BBOX)
    # 50 m or so from the hospital (node/1), far from everything else.
    incident = Incident(location="SRID=4326;POINT(36.8074 -1.3009)")
    session.add(incident)
    session.flush()

    assert [p.category for p in nearby_sensitive_places(session, incident.id)] == ["hospital"]

    _osm_places(session)["node/1"].enabled = False
    session.commit()
    osm.import_osm(session, overpass.client(), BBOX)  # the refresh keeps it disabled

    assert nearby_sensitive_places(session, incident.id) == []
