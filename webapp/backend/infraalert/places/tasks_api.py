"""/tasks/import-osm (Cloud Scheduler, monthly). OWNER: agent "places-backend"."""

from fastapi import APIRouter

router = APIRouter(prefix="/tasks", include_in_schema=False)
