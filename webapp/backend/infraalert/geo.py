"""Latitude/longitude as the API takes and returns it, and as PostGIS stores it."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


def point_ewkt(lat: float, lng: float) -> str:
    """A WGS84 point for a geography column. PostGIS wants longitude first."""
    return f"SRID=4326;POINT({lng} {lat})"
