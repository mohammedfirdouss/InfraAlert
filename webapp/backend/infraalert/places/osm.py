"""
The monthly OpenStreetMap import of sensitive places (ADR 0004).

One Overpass query fetches every place in the city's bounding box; the result is
upserted by `osm_id` in a single transaction. The import owns an OSM place's name,
category and geometry. It never touches `enabled` (an admin's override) and never
touches manual places. Places that vanished from OSM are deleted, but only when the
response looks complete: a failed or partial import must never wipe the table.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import all_, bindparam, delete, func, select, text
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.orm import Session
from sqlalchemy.types import Text

from infraalert.db.models import AuditLog, PlaceSource, SensitivePlace

logger = logging.getLogger(__name__)

# OSM tag value -> sensitive-place category (the keys of priority.PLACE_WEIGHTS).
AMENITY_CATEGORIES: dict[str, str] = {
    "hospital": "hospital",
    "clinic": "clinic",
    "doctors": "clinic",
    "school": "school",
    "fire_station": "fire_station",
    "police": "police",
    "marketplace": "market",
}
HIGHWAY_CATEGORIES: dict[str, str] = {"trunk": "major_road", "primary": "major_road"}

# Seconds Overpass may spend on the query; the HTTP read timeout allows a bit more.
QUERY_TIMEOUT_S = 180
HTTP_TIMEOUT = httpx.Timeout(QUERY_TIMEOUT_S + 30, connect=10.0)
USER_AGENT = "InfraAlert/0.2 (city incident triage; monthly sensitive-places import)"

# Deletions are skipped when the import returns fewer places than this share of the
# OSM places already stored: Overpass can time out or truncate and still answer 200.
MIN_COMPLETE_RATIO = 0.5

AUDIT_ENTITY = "places_import"
AUDIT_ACTION = "places.imported"

_UPSERT_BATCH = 1000
# Serialises concurrent imports (e.g. the scheduler and the CLI at once).
_ADVISORY_LOCK_KEY = 0x0541_1A1E


class OverpassError(RuntimeError):
    """Overpass could not be reached or answered with an error."""


class ImportRefused(RuntimeError):
    """The response contained no places; nothing was changed."""


@dataclass(frozen=True)
class OsmPlace:
    osm_id: str  # "node/123", "way/456" or "relation/789"
    name: str | None
    category: str
    wkt: str  # WGS84, longitude first


@dataclass(frozen=True)
class ImportResult:
    fetched: int
    inserted: int
    updated: int
    unchanged: int
    deleted: int
    # True when the safety threshold kept vanished places instead of deleting them.
    deletions_skipped: bool


def build_query(bbox: tuple[float, float, float, float]) -> str:
    """Overpass QL for every sensitive place in (south, west, north, east)."""
    south, west, north, east = bbox
    amenities = "|".join(AMENITY_CATEGORIES)
    highways = "|".join(HIGHWAY_CATEGORIES)
    return (
        f"[out:json][timeout:{QUERY_TIMEOUT_S}][bbox:{south},{west},{north},{east}];\n"
        f'nwr["amenity"~"^({amenities})$"];\n'
        "out center;\n"
        f'way["highway"~"^({highways})$"];\n'
        "out geom;\n"
    )


def _category(tags: dict[str, str]) -> str | None:
    return AMENITY_CATEGORIES.get(tags.get("amenity", "")) or HIGHWAY_CATEGORIES.get(
        tags.get("highway", "")
    )


def _point(lat: Any, lon: Any) -> str:
    return f"POINT({float(lon)} {float(lat)})"


def _wkt(element: dict[str, Any], category: str) -> str | None:
    geometry = element.get("geometry")
    if category == "major_road" and isinstance(geometry, list):
        points = [p for p in geometry if isinstance(p, dict) and "lat" in p and "lon" in p]
        if len(points) >= 2:
            return "LINESTRING(" + ", ".join(f"{p['lon']} {p['lat']}" for p in points) + ")"
        return None
    if "lat" in element and "lon" in element:  # a node
        return _point(element["lat"], element["lon"])
    center = element.get("center")
    if isinstance(center, dict) and "lat" in center and "lon" in center:  # an area
        return _point(center["lat"], center["lon"])
    return None


def parse_elements(elements: Iterable[dict[str, Any]]) -> list[OsmPlace]:
    """Overpass JSON elements -> places. Unrecognised or geometry-less ones are skipped."""
    places: dict[str, OsmPlace] = {}
    for element in elements:
        kind, ident = element.get("type"), element.get("id")
        if kind not in ("node", "way", "relation") or ident is None:
            continue
        tags = element.get("tags") or {}
        category = _category(tags)
        if category is None:
            continue
        wkt = _wkt(element, category)
        if wkt is None:
            continue
        osm_id = f"{kind}/{ident}"
        name = (tags.get("name") or "").strip() or None
        places.setdefault(osm_id, OsmPlace(osm_id, name, category, wkt))
    return list(places.values())


class OverpassClient:
    def __init__(self, url: str, client: httpx.Client | None = None) -> None:
        self._url = url
        self._client = client or httpx.Client(timeout=HTTP_TIMEOUT)

    def fetch(self, bbox: tuple[float, float, float, float]) -> list[OsmPlace]:
        try:
            response = self._client.post(
                self._url,
                data={"data": build_query(bbox)},
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OverpassError(f"Overpass request failed: {exc}") from exc
        if not isinstance(body, dict) or not isinstance(body.get("elements"), list):
            raise OverpassError("Overpass returned no elements list")
        # A timeout or memory error mid-query still answers 200, with a remark.
        remark = body.get("remark")
        if isinstance(remark, str) and "error" in remark.lower():
            raise OverpassError(f"Overpass reported: {remark}")
        return parse_elements(body["elements"])


def _chunks(items: Sequence[OsmPlace], size: int) -> Iterable[Sequence[OsmPlace]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def upsert_places(session: Session, places: Sequence[OsmPlace]) -> ImportResult:
    """
    Apply an import in the caller's transaction (the caller commits). Raises
    ImportRefused, changing nothing, when `places` is empty.
    """
    if not places:
        raise ImportRefused("the OSM import returned no places; refusing to change anything")
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _ADVISORY_LOCK_KEY})

    stored = session.scalar(
        select(func.count()).select_from(SensitivePlace).where(
            SensitivePlace.source == PlaceSource.OSM
        )
    )
    stored = int(stored or 0)

    inserted = updated = 0
    table = SensitivePlace.__table__
    for chunk in _chunks(places, _UPSERT_BATCH):
        stmt = insert(table).values(
            [
                {
                    "name": p.name,
                    "category": p.category,
                    "geom": f"SRID=4326;{p.wkt}",
                    "source": PlaceSource.OSM,
                    "osm_id": p.osm_id,
                }
                for p in chunk
            ]
        )
        excluded = stmt.excluded
        changed = (
            table.c.name.is_distinct_from(excluded.name)
            | table.c.category.is_distinct_from(excluded.category)
            | func.ST_AsEWKB(table.c.geom).is_distinct_from(func.ST_AsEWKB(excluded.geom))
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[table.c.osm_id],
            # `enabled` is deliberately absent: admin overrides survive every import.
            set_={"name": excluded.name, "category": excluded.category, "geom": excluded.geom},
            where=changed,
        ).returning(text("(xmax = 0) AS inserted"))
        for (was_inserted,) in session.execute(stmt).all():
            if was_inserted:
                inserted += 1
            else:
                updated += 1

    fetched = len(places)
    deleted = 0
    deletions_skipped = fetched < MIN_COMPLETE_RATIO * stored
    if deletions_skipped:
        logger.warning(
            "OSM import returned %d places but %d are stored; not deleting vanished ones",
            fetched,
            stored,
        )
    else:
        ids = bindparam("ids", [p.osm_id for p in places], type_=ARRAY(Text))
        result = session.execute(
            delete(SensitivePlace).where(
                SensitivePlace.source == PlaceSource.OSM,
                SensitivePlace.osm_id != all_(ids),
            )
        )
        deleted = int(result.rowcount or 0)  # type: ignore[attr-defined]

    outcome = ImportResult(
        fetched=fetched,
        inserted=inserted,
        updated=updated,
        unchanged=fetched - inserted - updated,
        deleted=deleted,
        deletions_skipped=deletions_skipped,
    )
    session.add(
        AuditLog(
            staff_id=None,
            action=AUDIT_ACTION,
            entity_type=AUDIT_ENTITY,
            entity_id=uuid.uuid4(),  # one id per import run
            detail=asdict(outcome),
        )
    )
    return outcome


def import_osm(
    session: Session, overpass: OverpassClient, bbox: tuple[float, float, float, float]
) -> ImportResult:
    """Fetch the city's places from Overpass and apply them in one transaction."""
    places = overpass.fetch(bbox)
    result = upsert_places(session, places)
    session.commit()
    logger.info("OSM import: %s", result)
    return result


def last_import_at(session: Session) -> datetime | None:
    """When the last OSM import was applied, or None."""
    return session.scalar(
        select(func.max(AuditLog.at)).where(
            AuditLog.entity_type == AUDIT_ENTITY, AuditLog.action == AUDIT_ACTION
        )
    )
