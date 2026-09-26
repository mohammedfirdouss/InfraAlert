"""/tasks/notifications and /tasks/retention (Cloud Scheduler). OWNER: agent "notify-backend"."""

from fastapi import APIRouter

router = APIRouter(prefix="/tasks", include_in_schema=False)
