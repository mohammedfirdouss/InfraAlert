"""
InfraAlert Pipeline — orchestrates the multi-agent workflow.

Uses Google ADK's SequentialAgent pattern when the package is available;
falls back to a plain HTTP pipeline otherwise.
"""
from __future__ import annotations

import os
import sys

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.utils import generate_report_id, get_env, setup_logging

logger = setup_logging("orchestrator.pipeline")

ISSUE_DETECTION_URL = get_env("ISSUE_DETECTION_URL", "http://issue-detection:8081")
PRIORITY_ANALYSIS_URL = get_env("PRIORITY_ANALYSIS_URL", "http://priority-analysis:8082")
RESOURCE_COORDINATION_URL = get_env("RESOURCE_COORDINATION_URL", "http://resource-coordination:8083")
PLATFORM_INTEGRATION_URL = get_env("PLATFORM_INTEGRATION_URL", "http://platform-integration:8084")

_HTTP_TIMEOUT = float(get_env("AGENT_HTTP_TIMEOUT", "30"))
_ADK_GEMINI_MODEL = get_env("GEMINI_MODEL", "gemini-flash-latest")

try:
    from google.adk.agents import LlmAgent, SequentialAgent  # type: ignore

    _ADK_AVAILABLE = True
except ImportError:
    _ADK_AVAILABLE = False


def _post(client: httpx.Client, url: str, payload: dict, step: str) -> dict | None:
    try:
        response = client.post(url, json=payload, timeout=_HTTP_TIMEOUT)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Step '%s' returned HTTP %d: %s", step, exc.response.status_code, exc.response.text
        )
    except httpx.RequestError as exc:
        logger.error("Step '%s' connection error: %s", step, exc)
    except Exception as exc:
        logger.error("Step '%s' unexpected error: %s", step, exc)
    return None


class InfraAlertPipeline:
    def _step_issue_detection(self, client: httpx.Client, report: dict) -> dict:
        payload = {
            "description": report["description"],
            "location": report["location"],
            "media_urls": report.get("media_urls", []),
            "report_id": report["report_id"],
        }
        result = _post(client, f"{ISSUE_DETECTION_URL}/analyze", payload, "issue_detection")
        if result:
            report["report_type"] = result.get("report_type", "other")
            report["analysis_notes"] = result.get("analysis", "")
            report["_detection_confidence"] = result.get("confidence", 0.5)
            report["_keywords"] = result.get("keywords", [])
            report["status"] = "analyzing"
        else:
            report.setdefault("report_type", "other")
            report.setdefault("analysis_notes", "Issue detection unavailable.")
        return report

    def _step_priority_analysis(self, client: httpx.Client, report: dict) -> dict:
        payload = {
            "report_type": report.get("report_type", "other"),
            "description": report["description"],
            "location": report["location"],
            "analysis": report.get("analysis_notes", ""),
        }
        result = _post(client, f"{PRIORITY_ANALYSIS_URL}/analyze", payload, "priority_analysis")
        if result:
            report["severity"] = result.get("severity", "MEDIUM")
            report["priority_score"] = result.get("priority_score", 0.5)
            report["_urgency_factors"] = result.get("urgency_factors", [])
            report["_response_time_hours"] = result.get("recommended_response_time_hours", 24)
        else:
            report.setdefault("severity", "MEDIUM")
            report.setdefault("priority_score", 0.5)
        return report

    def _step_resource_coordination(self, client: httpx.Client, report: dict) -> dict:
        payload = {
            "report": report,
            "priority_score": report.get("priority_score", 0.5),
            "severity": report.get("severity", "MEDIUM"),
        }
        result = _post(
            client, f"{RESOURCE_COORDINATION_URL}/coordinate", payload, "resource_coordination"
        )
        if result:
            team = result.get("assigned_team", {})
            report["assigned_team_id"] = team.get("id", "")
            report["assigned_team"] = team
            report["estimated_arrival_minutes"] = result.get("estimated_arrival_minutes", 60)
            report["_equipment_needed"] = result.get("equipment_needed", [])
            report["_coordination_notes"] = result.get("assignment_notes", "")
            report["status"] = "dispatched"
        else:
            report.setdefault("assigned_team_id", "")
            report.setdefault("status", "analyzing")
        return report

    def _step_platform_integration(
        self, client: httpx.Client, report: dict, event: str = "dispatched"
    ) -> dict:
        payload = {"report": report, "event": event}
        result = _post(
            client, f"{PLATFORM_INTEGRATION_URL}/notify", payload, "platform_integration"
        )
        if result:
            logger.info(
                "Notification sent: notified=%s firestore=%s",
                result.get("notified"),
                result.get("firestore_updated"),
            )
            report["_notification"] = result
        return report

    def run(
        self,
        description: str,
        location: str,
        media_urls: list[str] | None = None,
        citizen_phone: str | None = None,
        report_id: str | None = None,
    ) -> dict:
        if not report_id:
            report_id = generate_report_id()

        report: dict = {
            "report_id": report_id,
            "description": description,
            "location": location,
            "media_urls": media_urls or [],
            "citizen_phone": citizen_phone or "",
            "status": "pending",
        }

        with httpx.Client() as client:
            report = self._step_issue_detection(client, report)
            report = self._step_priority_analysis(client, report)
            report = self._step_resource_coordination(client, report)

            if citizen_phone:
                event = "dispatched" if report.get("assigned_team_id") else "received"
                report = self._step_platform_integration(client, report, event=event)

        return report


if _ADK_AVAILABLE:
    class _IssueDetectionStep(LlmAgent):
        def __init__(self):
            super().__init__(name="issue_detection_step", model=_ADK_GEMINI_MODEL)

        def run(self, context):  # type: ignore[override]
            report = context.get("report", {})
            with httpx.Client() as c:
                result = _post(
                    c,
                    f"{ISSUE_DETECTION_URL}/analyze",
                    {
                        "description": report["description"],
                        "location": report["location"],
                        "media_urls": report.get("media_urls", []),
                        "report_id": report["report_id"],
                    },
                    "adk:issue_detection",
                )
            if result:
                report.update(
                    report_type=result.get("report_type", "other"),
                    analysis_notes=result.get("analysis", ""),
                    status="analyzing",
                )
            context["report"] = report
            return context

    class _PriorityAnalysisStep(LlmAgent):
        def __init__(self):
            super().__init__(name="priority_analysis_step", model=_ADK_GEMINI_MODEL)

        def run(self, context):  # type: ignore[override]
            report = context.get("report", {})
            with httpx.Client() as c:
                result = _post(
                    c,
                    f"{PRIORITY_ANALYSIS_URL}/analyze",
                    {
                        "report_type": report.get("report_type", "other"),
                        "description": report["description"],
                        "location": report["location"],
                        "analysis": report.get("analysis_notes", ""),
                    },
                    "adk:priority_analysis",
                )
            if result:
                report.update(
                    severity=result.get("severity", "MEDIUM"),
                    priority_score=result.get("priority_score", 0.5),
                )
            context["report"] = report
            return context

    class _ResourceCoordinationStep(LlmAgent):
        def __init__(self):
            super().__init__(name="resource_coordination_step", model=_ADK_GEMINI_MODEL)

        def run(self, context):  # type: ignore[override]
            report = context.get("report", {})
            with httpx.Client() as c:
                result = _post(
                    c,
                    f"{RESOURCE_COORDINATION_URL}/coordinate",
                    {
                        "report": report,
                        "priority_score": report.get("priority_score", 0.5),
                        "severity": report.get("severity", "MEDIUM"),
                    },
                    "adk:resource_coordination",
                )
            if result:
                team = result.get("assigned_team", {})
                report.update(
                    assigned_team_id=team.get("id", ""),
                    assigned_team=team,
                    estimated_arrival_minutes=result.get("estimated_arrival_minutes", 60),
                    status="dispatched",
                )
            context["report"] = report
            return context

    class _PlatformIntegrationStep(LlmAgent):
        def __init__(self):
            super().__init__(name="platform_integration_step", model=_ADK_GEMINI_MODEL)

        def run(self, context):  # type: ignore[override]
            report = context.get("report", {})
            event = "dispatched" if report.get("assigned_team_id") else "received"
            if report.get("citizen_phone"):
                with httpx.Client() as c:
                    _post(
                        c,
                        f"{PLATFORM_INTEGRATION_URL}/notify",
                        {"report": report, "event": event},
                        "adk:platform_integration",
                    )
            return context

    class InfraAlertADKPipeline(SequentialAgent):
        def __init__(self):
            super().__init__(
                name="infra_alert_pipeline",
                sub_agents=[
                    _IssueDetectionStep(),
                    _PriorityAnalysisStep(),
                    _ResourceCoordinationStep(),
                    _PlatformIntegrationStep(),
                ],
            )
