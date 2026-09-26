"""Admin API for sensitive places. OWNER: agent "places-backend". Mounted by infraalert.app."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/staff", tags=["places"])
