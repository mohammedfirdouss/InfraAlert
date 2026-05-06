"""
Platform Integration Agent — sends citizen notifications via logs,
updates Firestore report documents, and logs completed reports to BigQuery.
"""
from __future__ import annotations

import datetime
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.utils import get_env, setup_logging

logger = setup_logging("platform_integration.agent")

_SMS_TEMPLATES: dict[str, str] = {
    "received": (
        "Your report #{report_id} has been received and is being analyzed. "
        "Thank you for reporting this infrastructure issue."
    ),
    "dispatched": (
        "Team {team_name} has been dispatched for your report #{report_id}. "
        "ETA: {eta} minutes. We are working to resolve this issue."
    ),
    "resolved": (
        "Your report #{report_id} has been resolved. "
        "Thank you for helping improve our infrastructure!"
    ),
    "in_progress": (
        "Update on your report #{report_id}: our team is currently on site "
        "working to resolve the issue."
    ),
}


class PlatformIntegrationAgent:
    """Handles citizen notifications, Firestore updates, and BigQuery logging."""

    def __init__(self) -> None:
        self._db = None
        self._bq_client = None

    def send_sms(self, phone: str, message: str) -> bool:
        """
        Log outbound notifications instead of sending real SMS messages.
        Returns True when a message is logged.
        """
        if not message:
            logger.warning("Empty notification message; skipping.")
            return False

        if phone:
            logger.info("Notification for %s: %s", phone, message)
        else:
            logger.info("Notification (no phone): %s", message)
        return True

    def notify_citizen(self, report: dict, event: str) -> bool:
        """
        Build a notification message for the citizen based on the event type
        and log it through send_sms. Returns True if successful.
        """
        phone = report.get("citizen_phone", "")
        template = _SMS_TEMPLATES.get(event)
        if not template:
            logger.warning("Unknown notification event '%s'; skipping.", event)
            return False

        assigned_team = report.get("assigned_team", {})
        message = template.format(
            report_id=report.get("report_id", "unknown"),
            team_name=assigned_team.get("name", "a field team") if assigned_team else "a field team",
            eta=report.get("estimated_arrival_minutes", "TBD"),
        )

        return self.send_sms(phone, message)

    def _firestore_client(self):
        if self._db is not None:
            return self._db
        try:
            from google.cloud import firestore  # type: ignore

            project = get_env("GCP_PROJECT_ID") or get_env("GOOGLE_CLOUD_PROJECT")
            self._db = firestore.Client(project=project) if project else firestore.Client()
            logger.info("Firestore client ready.")
        except Exception as exc:
            logger.warning("Firestore unavailable: %s", exc)
            self._db = None
        return self._db

    def update_firestore(self, report_id: str, updates: dict) -> bool:
        db = self._firestore_client()
        if db is None:
            logger.warning("Firestore unavailable; skipping update for report %s.", report_id)
            return False

        try:
            updates["updated_at"] = datetime.datetime.utcnow().isoformat()
            db.collection("reports").document(report_id).set(updates, merge=True)
            logger.info("Firestore updated for report %s.", report_id)
            return True
        except Exception as exc:
            logger.error("Firestore update failed for report %s: %s", report_id, exc)
            return False

    def _bq(self):
        if self._bq_client is not None:
            return self._bq_client
        try:
            from google.cloud import bigquery  # type: ignore

            project = get_env("GCP_PROJECT_ID") or get_env("GOOGLE_CLOUD_PROJECT")
            self._bq_client = (
                bigquery.Client(project=project) if project else bigquery.Client()
            )
        except Exception as exc:
            logger.warning("BigQuery client init failed: %s", exc)
            self._bq_client = None
        return self._bq_client

    def log_to_bigquery(self, report: dict) -> bool:
        bq = self._bq()
        if bq is None:
            logger.warning("BigQuery unavailable; skipping log for report %s.", report.get("report_id"))
            return False

        table_id = f"{bq.project}.infraalert.reports"
        row = {
            "report_id": report.get("report_id", ""),
            "report_type": report.get("report_type", ""),
            "description": report.get("description", ""),
            "location": report.get("location", ""),
            "severity": report.get("severity", ""),
            "priority_score": report.get("priority_score"),
            "status": report.get("status", ""),
            "assigned_team_id": report.get("assigned_team_id", ""),
            "created_at": datetime.datetime.utcnow().isoformat(),
        }

        try:
            errors = bq.insert_rows_json(table_id, [row])
            if errors:
                logger.error("BigQuery insert errors for report %s: %s", report.get("report_id"), errors)
                return False
            logger.info("Report %s logged to BigQuery.", report.get("report_id"))
            return True
        except Exception as exc:
            logger.error("BigQuery insert failed for report %s: %s", report.get("report_id"), exc)
            return False

    def process_event(self, report: dict, event: str) -> dict:
        notified = self.notify_citizen(report, event)

        status_map = {
            "received": "analyzing",
            "dispatched": "dispatched",
            "in_progress": "in_progress",
            "resolved": "resolved",
        }
        new_status = status_map.get(event, report.get("status", "pending"))
        report_id = report.get("report_id", "unknown")

        firestore_updated = self.update_firestore(
            report_id,
            {"status": new_status, "last_event": event},
        )

        bq_logged = False
        if event == "resolved":
            bq_logged = self.log_to_bigquery(report)

        return {
            "notified": notified,
            "firestore_updated": firestore_updated,
            "bq_logged": bq_logged,
            "new_status": new_status,
        }
