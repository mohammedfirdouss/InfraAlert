"""
Tests for InfraAlert FastAPI backend.
All orchestrator HTTP calls are mocked via httpx.MockTransport / respx or
unittest.mock so tests run without a live orchestrator.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Patch ORCHESTRATOR_URL to empty so all tests use mock mode by default
import os

os.environ.setdefault("ORCHESTRATOR_URL", "")

from main import app  # noqa: E402 — must import after env patch


@pytest.fixture()
def client():
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


# Health endpoint


def test_health_no_orchestrator(client: TestClient):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["orchestrator"] == "not_configured"


def test_health_with_orchestrator_reachable(client: TestClient):
    mock_response = MagicMock()
    mock_response.status_code = 200

    with patch("main.ORCHESTRATOR_URL", "http://orchestrator:8085"):
        with patch("httpx.AsyncClient") as mock_cls:
            mock_ctx = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_ctx.get = AsyncMock(return_value=mock_response)

            resp = client.get("/api/health")
            assert resp.status_code == 200
            assert resp.json()["orchestrator"] == "ok"


# Stats endpoint


def test_get_stats_mock(client: TestClient):
    resp = client.get("/api/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert "total_reports" in body
    assert "resolved_today" in body
    assert "active_teams" in body
    assert "avg_response_hours" in body
    assert isinstance(body["total_reports"], int)
    assert isinstance(body["avg_response_hours"], float)


# Reports list endpoint


def test_list_reports_mock(client: TestClient):
    resp = client.get("/api/reports")
    assert resp.status_code == 200
    body = resp.json()
    assert "reports" in body
    reports = body["reports"]
    assert isinstance(reports, list)
    assert len(reports) >= 1
    # Validate shape of first report
    first = reports[0]
    assert "report_id" in first
    assert "status" in first
    assert "location" in first


# Get single report endpoint


def test_get_report_found(client: TestClient):
    resp = client.get("/api/reports/RPT-001")
    assert resp.status_code == 200
    body = resp.json()
    assert body["report_id"] == "RPT-001"
    assert body["status"] == "resolved"


def test_get_report_not_found(client: TestClient):
    resp = client.get("/api/reports/RPT-NONEXISTENT")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


# Submit report endpoint


def test_submit_report_valid(client: TestClient):
    payload = {
        "description": "There is a large pothole on the main road causing damage to vehicles.",
        "location": "123 Main Street, Downtown",
        "media_urls": [],
        "citizen_phone": "+254712345678",
        "issue_type": "pothole",
    }
    resp = client.post("/api/reports", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert "report_id" in body
    assert body["status"] == "pending"
    assert body["location"] == payload["location"]
    assert body["description"] == payload["description"]


def test_submit_report_missing_location(client: TestClient):
    payload = {
        "description": "Something is broken somewhere.",
    }
    resp = client.post("/api/reports", json=payload)
    assert resp.status_code == 422  # Pydantic validation error


def test_submit_report_description_too_short(client: TestClient):
    payload = {
        "description": "short",
        "location": "123 Main St",
    }
    resp = client.post("/api/reports", json=payload)
    assert resp.status_code == 422


def test_submit_report_forwards_to_orchestrator(client: TestClient):
    """When ORCHESTRATOR_URL is set, report is forwarded to orchestrator."""
    orchestrator_response = {
        "success": True,
        "message": "Pipeline complete",
        "report": {
            "report_id": "RPT-ORCH-01",
            "status": "dispatched",
            "message": "Team dispatched.",
            "report_type": "pothole",
            "severity": "high",
            "priority_score": 8.5,
            "assigned_team_id": "TEAM-ROADS-01",
            "analysis_notes": "High priority pothole detected.",
            "location": "456 Elm Street",
            "description": "Very large pothole blocking half the road near the bus stop.",
            "citizen_phone": "",
            "media_urls": [],
            "created_at": "2026-05-06T10:00:00Z",
            "updated_at": "2026-05-06T10:05:00Z",
        },
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = orchestrator_response
    mock_response.raise_for_status = MagicMock()

    with patch("main.ORCHESTRATOR_URL", "http://orchestrator:8085"):
        with patch("httpx.AsyncClient") as mock_cls:
            mock_ctx = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_ctx.post = AsyncMock(return_value=mock_response)

            payload = {
                "description": "Very large pothole blocking half the road near the bus stop.",
                "location": "456 Elm Street",
                "issue_type": "pothole",
            }
            resp = client.post("/api/reports", json=payload)
            assert resp.status_code == 201
            body = resp.json()
            assert body["report_id"] == "RPT-ORCH-01"
            assert body["status"] == "dispatched"


# Voice report endpoint


def test_voice_report_upload(client: TestClient):
    audio_content = b"RIFF" + b"\x00" * 100  # Fake WAV header
    resp = client.post(
        "/api/reports/RPT-001/voice",
        files={"file": ("test_audio.wav", audio_content, "audio/wav")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["report_id"] == "RPT-001"
    assert "transcript" in body
    assert "confidence" in body
    assert body["filename"] == "test_audio.wav"
