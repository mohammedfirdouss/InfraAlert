"""
Citizen subscribe / verify / unsubscribe endpoints. OWNER: agent "notify-backend".
Mounted by infraalert.app. Contract: see webapp/frontend/src/api/client.js.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["citizen-updates"])
