"""
Tests for InfraAlertPipeline.
All HTTP calls to sub-agents are mocked using pytest-mock and responses.
"""
from __future__ import annotations

import json
import sys
import os
import types

import pytest

# Path setup
AGENTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, os.path.join(AGENTS_DIR, "orchestrator"))

# Stub google.adk so the import in pipeline.py doesn't fail.
adk_stub = types.ModuleType("google.adk")
adk_agents_stub = types.ModuleType("google.adk.agents")


class _FakeSequentialAgent:
    def __init__(self, **kwargs):
        pass


class _FakeLlmAgent:
    def __init__(self, **kwargs):
        pass


adk_agents_stub.SequentialAgent = _FakeSequentialAgent
adk_agents_stub.LlmAgent = _FakeLlmAgent
adk_stub.agents = adk_agents_stub

google_stub = types.ModuleType("google")
google_stub.adk = adk_stub
sys.modules.setdefault("google", google_stub)
sys.modules["google.adk"] = adk_stub
sys.modules["google.adk.agents"] = adk_agents_stub

from pipeline import InfraAlertPipeline, _post  # noqa: E402


# Mock HTTP response payloads

DETECTION_RESPONSE = {
    "report_type": "pothole",
    "confidence": 0.88,
    "analysis": "A pothole was identified on the road surface.",
    "keywords": ["pothole", "road"],
}

PRIORITY_RESPONSE = {
    "severity": "HIGH",
    "priority_score": 0.72,
    "urgency_factors": ["main road"],
    "recommended_response_time_hours": 4,
}

COORDINATION_RESPONSE = {
    "assigned_team": {
        "id": "T002",
        "name": "Beta Roads",
        "type": "roads",
        "available": True,
        "location": "Zone B",
    },
    "estimated_arrival_minutes": 25,
    "equipment_needed": ["asphalt filler", "traffic cones"],
    "assignment_notes": "Team Beta Roads assigned to HIGH priority pothole.",
}

NOTIFICATION_RESPONSE = {
    "sms_sent": False,
    "firestore_updated": False,
    "bq_logged": False,
    "new_status": "dispatched",
}


# Fixtures


@pytest.fixture()
def pipeline():
    return InfraAlertPipeline()


@pytest.fixture()
def mock_all_steps(mocker):
    """
    Mock InfraAlertPipeline step methods so no real HTTP calls are made.
    """
    def _detection(client, report):
        report.update(
            report_type="pothole",
            analysis_notes="A pothole was identified.",
            status="analyzing",
            _detection_confidence=0.88,
            _keywords=["pothole"],
        )
        return report

    def _priority(client, report):
        report.update(
            severity="HIGH",
            priority_score=0.72,
            _urgency_factors=["main road"],
            _response_time_hours=4,
        )
        return report

    def _coordination(client, report):
        report.update(
            assigned_team_id="T002",
            assigned_team={"id": "T002", "name": "Beta Roads", "type": "roads"},
            estimated_arrival_minutes=25,
            _equipment_needed=["asphalt filler"],
            _coordination_notes="Beta Roads assigned.",
            status="dispatched",
        )
        return report

    def _platform(client, report, event="dispatched"):
        report["_notification"] = {"sms_sent": False}
        return report

    mocker.patch.object(InfraAlertPipeline, "_step_issue_detection", side_effect=_detection)
    mocker.patch.object(InfraAlertPipeline, "_step_priority_analysis", side_effect=_priority)
    mocker.patch.object(
        InfraAlertPipeline, "_step_resource_coordination", side_effect=_coordination
    )
    mocker.patch.object(
        InfraAlertPipeline, "_step_platform_integration", side_effect=_platform
    )


# Tests — InfraAlertPipeline.run


class TestPipelineRun:
    def test_run_returns_report_dict(self, pipeline, mock_all_steps):
        result = pipeline.run(
            description="Large pothole at the junction.",
            location="Main Road, Zone B",
        )
        assert isinstance(result, dict)

    def test_report_id_generated_if_not_provided(self, pipeline, mock_all_steps):
        result = pipeline.run(
            description="Pothole on street.",
            location="Zone A",
        )
        assert "report_id" in result
        assert len(result["report_id"]) == 8

    def test_report_id_preserved_if_provided(self, pipeline, mock_all_steps):
        result = pipeline.run(
            description="Water leak.",
            location="Zone C",
            report_id="custom01",
        )
        assert result["report_id"] == "custom01"

    def test_report_type_populated(self, pipeline, mock_all_steps):
        result = pipeline.run(description="Pothole.", location="Zone B")
        assert result.get("report_type") == "pothole"

    def test_severity_populated(self, pipeline, mock_all_steps):
        result = pipeline.run(description="Pothole.", location="Zone B")
        assert result.get("severity") == "HIGH"

    def test_priority_score_populated(self, pipeline, mock_all_steps):
        result = pipeline.run(description="Pothole.", location="Zone B")
        assert result.get("priority_score") == 0.72

    def test_assigned_team_id_populated(self, pipeline, mock_all_steps):
        result = pipeline.run(description="Pothole.", location="Zone B")
        assert result.get("assigned_team_id") == "T002"

    def test_status_dispatched_after_coordination(self, pipeline, mock_all_steps):
        result = pipeline.run(description="Pothole.", location="Zone B")
        assert result.get("status") == "dispatched"

    def test_platform_integration_called_with_phone(self, pipeline, mocker, mock_all_steps):
        platform_mock = mocker.patch.object(
            InfraAlertPipeline,
            "_step_platform_integration",
            side_effect=lambda client, report, event="dispatched": report,
        )
        pipeline.run(
            description="Pothole.",
            location="Zone B",
            citizen_phone="+254700000000",
        )
        platform_mock.assert_called_once()

    def test_platform_integration_skipped_without_phone(self, pipeline, mocker, mock_all_steps):
        platform_mock = mocker.patch.object(
            InfraAlertPipeline,
            "_step_platform_integration",
            side_effect=lambda client, report, event="dispatched": report,
        )
        pipeline.run(description="Pothole.", location="Zone B", citizen_phone=None)
        platform_mock.assert_not_called()


class TestPipelineResiliency:
    def test_issue_detection_failure_continues(self, pipeline, mocker):
        """Pipeline should continue even if issue detection step fails."""
        mocker.patch.object(
            InfraAlertPipeline,
            "_step_issue_detection",
            side_effect=lambda client, report: {**report, "report_type": "other", "status": "pending"},
        )
        mocker.patch.object(
            InfraAlertPipeline,
            "_step_priority_analysis",
            side_effect=lambda client, report: {**report, "severity": "MEDIUM", "priority_score": 0.5},
        )
        mocker.patch.object(
            InfraAlertPipeline,
            "_step_resource_coordination",
            side_effect=lambda client, report: {**report, "assigned_team_id": "T004", "status": "dispatched"},
        )
        mocker.patch.object(
            InfraAlertPipeline,
            "_step_platform_integration",
            side_effect=lambda client, report, event="dispatched": report,
        )

        result = pipeline.run(description="Issue.", location="Zone A")
        assert "report_id" in result

    def test_http_post_returns_none_on_connection_error(self, mocker):
        """_post() should return None on a connection error without raising."""
        import httpx

        mock_client = mocker.MagicMock()
        mock_client.post.side_effect = httpx.ConnectError("refused")

        result = _post(mock_client, "http://nowhere:9999/analyze", {}, "test_step")
        assert result is None

    def test_http_post_returns_none_on_http_error(self, mocker):
        """_post() should return None on HTTP 500 without raising."""
        import httpx

        mock_response = mocker.MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500", request=mocker.MagicMock(), response=mock_response
        )
        mock_client = mocker.MagicMock()
        mock_client.post.return_value = mock_response

        result = _post(mock_client, "http://somewhere:8081/analyze", {}, "test_step")
        assert result is None


class TestPipelineSteps:
    def test_step_issue_detection_merges_fields(self, pipeline, mocker):
        mock_client = mocker.MagicMock()
        mocker.patch(
            "pipeline._post",
            return_value=DETECTION_RESPONSE,
        )
        report = {
            "report_id": "abc",
            "description": "Pothole",
            "location": "Zone A",
            "media_urls": [],
        }
        updated = pipeline._step_issue_detection(mock_client, report)
        assert updated["report_type"] == "pothole"
        assert updated["status"] == "analyzing"

    def test_step_issue_detection_defaults_on_failure(self, pipeline, mocker):
        mock_client = mocker.MagicMock()
        mocker.patch("pipeline._post", return_value=None)
        report = {
            "report_id": "abc",
            "description": "Pothole",
            "location": "Zone A",
            "media_urls": [],
        }
        updated = pipeline._step_issue_detection(mock_client, report)
        assert updated["report_type"] == "other"

    def test_step_priority_analysis_merges_fields(self, pipeline, mocker):
        mock_client = mocker.MagicMock()
        mocker.patch("pipeline._post", return_value=PRIORITY_RESPONSE)
        report = {
            "report_id": "abc",
            "description": "Pothole",
            "location": "Zone A",
            "report_type": "pothole",
        }
        updated = pipeline._step_priority_analysis(mock_client, report)
        assert updated["severity"] == "HIGH"
        assert updated["priority_score"] == 0.72

    def test_step_resource_coordination_merges_fields(self, pipeline, mocker):
        mock_client = mocker.MagicMock()
        mocker.patch("pipeline._post", return_value=COORDINATION_RESPONSE)
        report = {
            "report_id": "abc",
            "description": "Pothole",
            "location": "Zone A",
            "report_type": "pothole",
            "severity": "HIGH",
            "priority_score": 0.72,
        }
        updated = pipeline._step_resource_coordination(mock_client, report)
        assert updated["assigned_team_id"] == "T002"
        assert updated["status"] == "dispatched"
        assert updated["estimated_arrival_minutes"] == 25
