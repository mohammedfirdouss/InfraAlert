"""
InfraAlert MCP Server

Exposes infrastructure management tools via the Model Context Protocol (MCP)
using the FastMCP SDK. AI agents connect to this server to read/write reports,
manage repair teams, query analytics, and queue notifications.
"""

from __future__ import annotations

import logging
import os
import warnings
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("infra_alert.mcp_server")

# FastMCP instance

mcp = FastMCP("InfraAlert MCP Server")

# Lazy Firestore / BigQuery clients

_firestore_client: Any = None
_bigquery_client: Any = None


def _get_firestore() -> Any:
    """Return a cached Firestore client, initialising it on first call.

    If GCP credentials are unavailable a warning is logged and ``None`` is
    returned so callers can fall back to mock behaviour in tests.
    """
    global _firestore_client
    if _firestore_client is not None:
        return _firestore_client

    try:
        from google.cloud import firestore  # type: ignore[import-untyped]

        project_id = os.getenv("GCP_PROJECT_ID")
        _firestore_client = (
            firestore.Client(project=project_id) if project_id else firestore.Client()
        )
        logger.info("Firestore client initialised (project=%s)", project_id or "default")
    except Exception as exc:  # noqa: BLE001
        warnings.warn(
            f"Firestore client could not be initialised: {exc}. "
            "Tools that require Firestore will return errors.",
            RuntimeWarning,
            stacklevel=2,
        )
        _firestore_client = None

    return _firestore_client


def _get_bigquery() -> Any:
    """Return a cached BigQuery client, initialising it on first call."""
    global _bigquery_client
    if _bigquery_client is not None:
        return _bigquery_client

    try:
        from google.cloud import bigquery  # type: ignore[import-untyped]

        project_id = os.getenv("GCP_PROJECT_ID")
        _bigquery_client = (
            bigquery.Client(project=project_id) if project_id else bigquery.Client()
        )
        logger.info("BigQuery client initialised (project=%s)", project_id or "default")
    except Exception as exc:  # noqa: BLE001
        warnings.warn(
            f"BigQuery client could not be initialised: {exc}. "
            "Stats tool will return mock data.",
            RuntimeWarning,
            stacklevel=2,
        )
        _bigquery_client = None

    return _bigquery_client


# Helper

_VALID_STATUSES = frozenset(
    {"pending", "analyzing", "dispatched", "in_progress", "resolved"}
)


def _utcnow_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


# Tool: store_report


@mcp.tool()
def store_report(
    report_id: str,
    report_type: str,
    location: str,
    description: str,
    severity: str,
    media_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Store a new infrastructure report in Firestore.

    Args:
        report_id: Unique identifier for the report (caller-generated).
        report_type: Category of issue (e.g. pothole, flood, power_outage).
        location: Human-readable or coordinate-based location string.
        description: Free-text description of the infrastructure issue.
        severity: Issue severity — one of: low, medium, high, critical.
        media_urls: Optional list of image/video URLs attached to the report.

    Returns:
        {"success": True, "report_id": "<id>"} on success.
    """
    if not report_id:
        return {"success": False, "error": "report_id must not be empty"}

    db = _get_firestore()
    if db is None:
        return {"success": False, "error": "Firestore unavailable"}

    doc_data: dict[str, Any] = {
        "report_id": report_id,
        "report_type": report_type,
        "location": location,
        "description": description,
        "severity": severity,
        "media_urls": media_urls or [],
        "status": "pending",
        "created_at": _utcnow_iso(),
        "updated_at": _utcnow_iso(),
        "assigned_team": None,
        "notes": None,
    }

    try:
        db.collection("reports").document(report_id).set(doc_data)
        logger.info("Report stored: %s (type=%s, severity=%s)", report_id, report_type, severity)
        return {"success": True, "report_id": report_id}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to store report %s", report_id)
        return {"success": False, "error": str(exc)}


# Tool: get_report


@mcp.tool()
def get_report(report_id: str) -> dict[str, Any]:
    """Retrieve a single infrastructure report from Firestore.

    Args:
        report_id: The unique report identifier.

    Returns:
        Full report document dict, or {"error": "not found"} if absent.
    """
    if not report_id:
        return {"error": "report_id must not be empty"}

    db = _get_firestore()
    if db is None:
        return {"error": "Firestore unavailable"}

    try:
        doc = db.collection("reports").document(report_id).get()
        if not doc.exists:
            logger.info("Report not found: %s", report_id)
            return {"error": "not found"}
        data: dict[str, Any] = doc.to_dict()
        return data
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to retrieve report %s", report_id)
        return {"error": str(exc)}


# Tool: update_report_status


@mcp.tool()
def update_report_status(
    report_id: str,
    status: str,
    assigned_team: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Update the lifecycle status of an existing report.

    Args:
        report_id: The unique report identifier.
        status: New status — must be one of: pending, analyzing, dispatched,
                in_progress, resolved.
        assigned_team: Optional team identifier to associate with this report.
        notes: Optional free-text notes to append to the report record.

    Returns:
        {"success": True} on success.
    """
    if not report_id:
        return {"success": False, "error": "report_id must not be empty"}

    if status not in _VALID_STATUSES:
        return {
            "success": False,
            "error": f"Invalid status '{status}'. Must be one of: {sorted(_VALID_STATUSES)}",
        }

    db = _get_firestore()
    if db is None:
        return {"success": False, "error": "Firestore unavailable"}

    updates: dict[str, Any] = {
        "status": status,
        "updated_at": _utcnow_iso(),
    }
    if assigned_team is not None:
        updates["assigned_team"] = assigned_team
    if notes is not None:
        updates["notes"] = notes

    try:
        ref = db.collection("reports").document(report_id)
        if not ref.get().exists:
            return {"success": False, "error": "not found"}
        ref.update(updates)
        logger.info("Report %s status -> %s", report_id, status)
        return {"success": True}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to update report %s", report_id)
        return {"success": False, "error": str(exc)}


# Tool: list_available_teams


@mcp.tool()
def list_available_teams(
    team_type: str | None = None,
    available_only: bool = True,
) -> list[dict[str, Any]]:
    """List repair/response teams stored in Firestore.

    Args:
        team_type: Optional filter — e.g. electrical, plumbing, roads, flood.
                   When omitted all team types are returned.
        available_only: When True (default) only teams with available=True are
                        included.

    Returns:
        List of team dicts, each containing: id, name, type, location, available.
        Returns an empty list if no teams match.
    """
    db = _get_firestore()
    if db is None:
        return []

    try:
        query = db.collection("teams")

        if team_type:
            query = query.where("type", "==", team_type)
        if available_only:
            query = query.where("available", "==", True)

        docs = query.stream()
        teams: list[dict[str, Any]] = []
        for doc in docs:
            data: dict[str, Any] = doc.to_dict()
            teams.append(
                {
                    "id": doc.id,
                    "name": data.get("name", ""),
                    "type": data.get("type", ""),
                    "location": data.get("location", ""),
                    "available": data.get("available", False),
                }
            )
        logger.info(
            "list_available_teams returned %d team(s) (type=%s, available_only=%s)",
            len(teams),
            team_type,
            available_only,
        )
        return teams
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to list teams")
        return [{"error": str(exc)}]


# Tool: assign_team_to_report


@mcp.tool()
def assign_team_to_report(
    report_id: str,
    team_id: str,
    estimated_arrival_minutes: int,
) -> dict[str, Any]:
    """Assign a repair team to an infrastructure report.

    Updates the report document to record the assignment and marks the team as
    unavailable until the job is complete.

    Args:
        report_id: The unique report identifier.
        team_id: The unique team identifier.
        estimated_arrival_minutes: Estimated travel time in minutes.

    Returns:
        {"success": True, "team_id": "<id>", "report_id": "<id>"} on success.
    """
    if not report_id:
        return {"success": False, "error": "report_id must not be empty"}
    if not team_id:
        return {"success": False, "error": "team_id must not be empty"}
    if estimated_arrival_minutes < 0:
        return {"success": False, "error": "estimated_arrival_minutes must be non-negative"}

    db = _get_firestore()
    if db is None:
        return {"success": False, "error": "Firestore unavailable"}

    now = _utcnow_iso()

    try:
        report_ref = db.collection("reports").document(report_id)
        team_ref = db.collection("teams").document(team_id)

        if not report_ref.get().exists:
            return {"success": False, "error": f"Report '{report_id}' not found"}
        if not team_ref.get().exists:
            return {"success": False, "error": f"Team '{team_id}' not found"}

        report_ref.update(
            {
                "assigned_team": team_id,
                "status": "dispatched",
                "estimated_arrival_minutes": estimated_arrival_minutes,
                "updated_at": now,
            }
        )

        team_ref.update(
            {
                "available": False,
                "current_report": report_id,
                "updated_at": now,
            }
        )

        logger.info(
            "Team %s assigned to report %s (ETA %d min)",
            team_id,
            report_id,
            estimated_arrival_minutes,
        )
        return {"success": True, "team_id": team_id, "report_id": report_id}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to assign team %s to report %s", team_id, report_id)
        return {"success": False, "error": str(exc)}


# Tool: get_infrastructure_stats

_MOCK_STATS: dict[str, Any] = {
    "total_reports": 0,
    "by_type": {},
    "by_severity": {"low": 0, "medium": 0, "high": 0, "critical": 0},
    "avg_resolution_hours": 0.0,
    "source": "mock",
}


@mcp.tool()
def get_infrastructure_stats(days: int = 7) -> dict[str, Any]:
    """Retrieve aggregated infrastructure report statistics from BigQuery.

    Queries the ``infraalert.reports`` BigQuery table for the requested look-back
    window and aggregates counts by type, by severity, and average resolution time.

    Args:
        days: Number of days to look back (default 7). Must be between 1 and 365.

    Returns:
        Dict with keys: total_reports (int), by_type (dict), by_severity (dict),
        avg_resolution_hours (float). If BigQuery is unavailable, a mock result
        with ``source="mock"`` is returned instead of raising an error.
    """
    if days < 1 or days > 365:
        return {"error": "days must be between 1 and 365"}

    bq = _get_bigquery()
    if bq is None:
        logger.warning("BigQuery unavailable — returning mock stats")
        return {**_MOCK_STATS, "days": days}

    project_id = os.getenv("GCP_PROJECT_ID", bq.project)
    dataset = os.getenv("BIGQUERY_DATASET", "infraalert")
    table = os.getenv("BIGQUERY_TABLE", "reports")
    full_table = f"`{project_id}.{dataset}.{table}`"

    query = f"""
        SELECT
            COUNT(*)                                          AS total_reports,
            report_type,
            severity,
            AVG(
                TIMESTAMP_DIFF(resolved_at, created_at, MINUTE) / 60.0
            )                                                 AS avg_resolution_hours
        FROM {full_table}
        WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY)
        GROUP BY report_type, severity
    """

    try:
        rows = list(bq.query(query).result())
    except Exception as exc:  # noqa: BLE001
        logger.warning("BigQuery query failed (%s) — returning mock stats", exc)
        return {**_MOCK_STATS, "days": days, "source": "mock", "bq_error": str(exc)}

    total = 0
    by_type: dict[str, int] = {}
    by_severity: dict[str, int] = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    resolution_hours: list[float] = []

    for row in rows:
        count = int(row["total_reports"])
        rtype = row["report_type"] or "unknown"
        sev = row["severity"] or "unknown"
        avg_h = row["avg_resolution_hours"]

        total += count
        by_type[rtype] = by_type.get(rtype, 0) + count
        by_severity[sev] = by_severity.get(sev, 0) + count
        if avg_h is not None:
            resolution_hours.append(float(avg_h))

    avg_resolution = (
        round(sum(resolution_hours) / len(resolution_hours), 2) if resolution_hours else 0.0
    )

    return {
        "total_reports": total,
        "by_type": by_type,
        "by_severity": by_severity,
        "avg_resolution_hours": avg_resolution,
        "days": days,
        "source": "bigquery",
    }


# Tool: send_notification


@mcp.tool()
def send_notification(
    recipient: str,
    message: str,
    channel: str = "sms",
) -> dict[str, Any]:
    """Queue a notification to a recipient (SMS, push, or email).

    Actual delivery is handled by the platform-integration agent. This tool
    logs the notification request and returns a confirmation that it has been
    queued. It also stores the notification in Firestore when available so the
    platform-integration agent can pick it up asynchronously.

    Args:
        recipient: Phone number, device token, or email address of the recipient.
        message: Notification body text.
        channel: Delivery channel — one of: sms, push, email (default: sms).

    Returns:
        {"queued": True, "recipient": "<recipient>"}
    """
    _VALID_CHANNELS = {"sms", "push", "email"}
    if channel not in _VALID_CHANNELS:
        return {
            "queued": False,
            "error": f"Invalid channel '{channel}'. Must be one of: {sorted(_VALID_CHANNELS)}",
        }

    if not recipient:
        return {"queued": False, "error": "recipient must not be empty"}
    if not message:
        return {"queued": False, "error": "message must not be empty"}

    logger.info(
        "Notification queued | channel=%s | recipient=%s | message=%.80s%s",
        channel,
        recipient,
        message,
        "..." if len(message) > 80 else "",
    )

    # Persist to Firestore so the platform-integration agent can deliver it.
    db = _get_firestore()
    if db is not None:
        try:
            db.collection("notifications").add(
                {
                    "recipient": recipient,
                    "message": message,
                    "channel": channel,
                    "status": "queued",
                    "created_at": _utcnow_iso(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            # Non-fatal — the notification intent is still logged.
            logger.warning("Could not persist notification to Firestore: %s", exc)

    return {"queued": True, "recipient": recipient}


# Health endpoint


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Any) -> Any:  # type: ignore[return]
    """Liveness probe for container orchestrators and load balancers."""
    from starlette.responses import JSONResponse  # type: ignore[import-untyped]

    return JSONResponse({"status": "ok", "service": "mcp-server"})
