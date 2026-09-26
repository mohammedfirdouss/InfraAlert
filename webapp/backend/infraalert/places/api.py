"""
Sensitive places for admins (ADR 0004). OSM places come from the monthly import and
are read-only here except `enabled`, which the import never overwrites. Manual places
are points that admins add and edit. Every change is audited.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from infraalert.db.models import AuditLog, PlaceSource, SensitivePlace, Staff
from infraalert.deps import get_session
from infraalert.places.osm import last_import_at
from infraalert.processing.priority import PLACE_WEIGHTS
from infraalert.staff.auth import Admin

router = APIRouter(prefix="/api/staff", tags=["places"])

SessionDep = Annotated[Session, Depends(get_session)]

# Fields an admin may change only on manual places.
_MANUAL_ONLY = frozenset({"name", "category", "location"})


# Models


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


def _known_category(category: str) -> str:
    if category not in PLACE_WEIGHTS:
        raise ValueError(f"unknown category; expected one of {sorted(PLACE_WEIGHTS)}")
    return category


class PlaceCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    category: str
    location: Location

    @field_validator("category")
    @classmethod
    def _category(cls, category: str) -> str:
        return _known_category(category)


class PlacePatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = None
    location: Location | None = None
    enabled: bool | None = None

    @field_validator("category")
    @classmethod
    def _category(cls, category: str | None) -> str | None:
        return None if category is None else _known_category(category)

    @model_validator(mode="after")
    def _no_nulls(self) -> PlacePatch:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class Geometry(BaseModel):
    """GeoJSON, [lng, lat] order."""

    type: str
    coordinates: Any


class PlaceResponse(BaseModel):
    id: uuid.UUID
    name: str | None
    category: str
    geometry: Geometry
    source: Literal["osm", "manual"]
    osm_id: str | None
    enabled: bool


class PlaceCategory(BaseModel):
    id: str
    weight: float  # the priority weight at distance 0 (formula v1)


class PlacesResponse(BaseModel):
    places: list[PlaceResponse]
    categories: list[PlaceCategory]
    last_import_at: datetime | None


# Helpers


def _rows(session: Session, place_id: uuid.UUID | None = None) -> list[PlaceResponse]:
    query = select(SensitivePlace, func.ST_AsGeoJSON(SensitivePlace.geom)).order_by(
        SensitivePlace.category, SensitivePlace.name.nulls_last(), SensitivePlace.id
    )
    if place_id is not None:
        query = query.where(SensitivePlace.id == place_id)
    return [
        PlaceResponse(
            id=place.id,
            name=place.name,
            category=place.category,
            geometry=Geometry.model_validate(json.loads(geojson)),
            source=place.source.value,
            osm_id=place.osm_id,
            enabled=place.enabled,
        )
        for place, geojson in session.execute(query).all()
    ]


def _wkt(location: Location) -> str:
    return f"SRID=4326;POINT({location.lng} {location.lat})"


def _audit(
    session: Session, actor: Staff, action: str, place_id: uuid.UUID, detail: dict[str, Any]
) -> None:
    session.add(
        AuditLog(
            staff_id=actor.id,
            action=action,
            entity_type="sensitive_place",
            entity_id=place_id,
            detail=detail,
        )
    )


# Endpoints


@router.get("/places")
def list_places(_: Admin, session: SessionDep) -> PlacesResponse:
    return PlacesResponse(
        places=_rows(session),
        categories=[PlaceCategory(id=c, weight=w) for c, w in PLACE_WEIGHTS.items()],
        last_import_at=last_import_at(session),
    )


@router.post("/places", status_code=201)
def create_place(body: PlaceCreate, actor: Admin, session: SessionDep) -> PlaceResponse:
    place = SensitivePlace(
        id=uuid.uuid4(),
        name=body.name,
        category=body.category,
        geom=_wkt(body.location),
        source=PlaceSource.MANUAL,
    )
    session.add(place)
    _audit(session, actor, "place.created", place.id, body.model_dump(mode="json"))
    session.commit()
    return _rows(session, place.id)[0]


@router.patch("/places/{place_id}")
def update_place(
    place_id: uuid.UUID, body: PlacePatch, actor: Admin, session: SessionDep
) -> PlaceResponse:
    place = session.get(SensitivePlace, place_id, with_for_update=True)
    if place is None:
        raise HTTPException(404, detail="place_not_found")
    if place.source == PlaceSource.OSM and body.model_fields_set & _MANUAL_ONLY:
        raise HTTPException(409, detail="osm_place_read_only")
    before = _rows(session, place_id)[0]

    changed: dict[str, Any] = {}
    if body.name is not None and body.name != place.name:
        changed["name"] = {"from": place.name, "to": body.name}
        place.name = body.name
    if body.category is not None and body.category != place.category:
        changed["category"] = {"from": place.category, "to": body.category}
        place.category = body.category
    if body.location is not None:
        new = Geometry(type="Point", coordinates=[body.location.lng, body.location.lat])
        if new != before.geometry:
            changed["geometry"] = {
                "from": before.geometry.model_dump(),
                "to": new.model_dump(),
            }
            place.geom = _wkt(body.location)
    if body.enabled is not None and body.enabled != place.enabled:
        changed["enabled"] = {"from": place.enabled, "to": body.enabled}
        place.enabled = body.enabled

    if changed:
        if place.osm_id is not None:
            changed["osm_id"] = place.osm_id
        _audit(session, actor, "place.updated", place_id, changed)
    session.commit()
    return _rows(session, place_id)[0]
