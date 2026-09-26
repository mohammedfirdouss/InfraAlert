"""/tasks/import-osm: the monthly OpenStreetMap refresh, called by Cloud Scheduler."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from infraalert.deps import Deps, get_deps
from infraalert.places.osm import ImportRefused, OverpassClient, OverpassError, import_osm
from infraalert.processing.api import CallerDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", include_in_schema=False)

DepsDep = Annotated[Deps, Depends(get_deps)]


def get_overpass(deps: DepsDep) -> OverpassClient:
    return OverpassClient(deps.settings.overpass_url)


class ImportResponse(BaseModel):
    fetched: int
    inserted: int
    updated: int
    unchanged: int
    deleted: int
    deletions_skipped: bool


@router.post("/import-osm")
def import_osm_task(
    deps: DepsDep,
    _caller: CallerDep,
    overpass: Annotated[OverpassClient, Depends(get_overpass)],
) -> ImportResponse:
    try:
        with deps.sessions() as session:
            result = import_osm(session, overpass, deps.settings.city_bbox)
    except (OverpassError, ImportRefused) as exc:
        # Non-2xx so Cloud Scheduler records the failure (and retries, if configured).
        logger.error("OSM import failed: %s", exc)
        raise HTTPException(502, detail="osm_import_failed") from exc
    return ImportResponse(**result.__dict__)
