"""
Tests for PlatformIntegrationAgent.
External services are fully mocked.
"""
from __future__ import annotations

import sys
import os
from unittest.mock import MagicMock

import pytest

# Path setup
AGENTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, os.path.join(AGENTS_DIR, "platform_integration"))

from agent import PlatformIntegrationAgent, _SMS_TEMPLATES  # noqa: E402


# Fixtures
@pytest.fixture()
def agent():
    return PlatformIntegrationAgent()


SAMPLE_REPORT = {
    "report_id": "test001",
    "report_type": "pothole",
    "description": "Large pothole on main road.",
    "location": "Zone B",
    "status": "pending",
    "citizen_phone": "+254700000000",
    "assigned_team": {"name": "Beta Roads", "type": "roads"},
    "estimated_arrival_minutes": 30,
    "severity": "HIGH",
    "priority_score": 0.72,
}


# Tests — send_sms


class TestSendSms:
    def test_empty_message_returns_false(self, agent):
        assert agent.send_sms("+254700000000", "") is False

    def test_message_logged_with_phone(self, agent):
        result = agent.send_sms("+254700000000", "Test message")
        assert result is True

    def test_message_logged_without_phone(self, agent):
        result = agent.send_sms("", "Test message")
        assert result is True


# Tests — notify_citizen


class TestNotifyCitizen:
    def test_no_phone_still_returns_true(self, agent):
        report = dict(SAMPLE_REPORT, citizen_phone=None)
        assert agent.notify_citizen(report, "received") is True

    def test_unknown_event_returns_false(self, agent):
        assert agent.notify_citizen(SAMPLE_REPORT, "unknown_event") is False

    @pytest.mark.parametrize("event", list(_SMS_TEMPLATES.keys()))
    def test_all_valid_events_build_message(self, agent, monkeypatch, event):
        mock_send = MagicMock(return_value=True)
        monkeypatch.setattr(agent, "send_sms", mock_send)
        agent.notify_citizen(SAMPLE_REPORT, event)
        mock_send.assert_called_once()
        # Just assert it was called with a non-empty message
        call_args = mock_send.call_args[0]
        assert len(call_args[1]) > 0

    def test_dispatched_includes_team_name(self, agent, monkeypatch):
        mock_send = MagicMock(return_value=True)
        monkeypatch.setattr(agent, "send_sms", mock_send)
        agent.notify_citizen(SAMPLE_REPORT, "dispatched")
        message = mock_send.call_args[0][1]
        assert "Beta Roads" in message

    def test_dispatched_includes_eta(self, agent, monkeypatch):
        mock_send = MagicMock(return_value=True)
        monkeypatch.setattr(agent, "send_sms", mock_send)
        agent.notify_citizen(SAMPLE_REPORT, "dispatched")
        message = mock_send.call_args[0][1]
        assert "30" in message

    def test_received_includes_report_id(self, agent, monkeypatch):
        mock_send = MagicMock(return_value=True)
        monkeypatch.setattr(agent, "send_sms", mock_send)
        agent.notify_citizen(SAMPLE_REPORT, "received")
        message = mock_send.call_args[0][1]
        assert "test001" in message


# Tests — update_firestore


class TestUpdateFirestore:
    def test_no_firestore_returns_false(self, agent):
        agent._db = None
        # Force Firestore to be unavailable
        agent._firestore_client = lambda: None  # type: ignore
        result = agent.update_firestore("test001", {"status": "dispatched"})
        assert result is False

    def test_firestore_update_succeeds(self, agent):
        mock_db = MagicMock()
        agent._db = mock_db

        result = agent.update_firestore("test001", {"status": "dispatched"})
        assert result is True
        mock_db.collection.assert_called_with("reports")

    def test_firestore_exception_returns_false(self, agent):
        mock_db = MagicMock()
        mock_db.collection.side_effect = Exception("Firestore error")
        agent._db = mock_db

        result = agent.update_firestore("test001", {"status": "dispatched"})
        assert result is False


# Tests — process_event


class TestProcessEvent:
    def test_process_dispatched_event(self, agent, monkeypatch):
        monkeypatch.setattr(agent, "notify_citizen", MagicMock(return_value=True))
        monkeypatch.setattr(agent, "update_firestore", MagicMock(return_value=True))

        result = agent.process_event(SAMPLE_REPORT, "dispatched")
        assert result["notified"] is True
        assert result["firestore_updated"] is True
        assert result["new_status"] == "dispatched"
        assert result["bq_logged"] is False  # Only logged on resolved

    def test_process_resolved_triggers_bigquery(self, agent, monkeypatch):
        monkeypatch.setattr(agent, "notify_citizen", MagicMock(return_value=True))
        monkeypatch.setattr(agent, "update_firestore", MagicMock(return_value=True))
        mock_bq = MagicMock(return_value=True)
        monkeypatch.setattr(agent, "log_to_bigquery", mock_bq)

        result = agent.process_event(SAMPLE_REPORT, "resolved")
        assert result["bq_logged"] is True
        mock_bq.assert_called_once()

    def test_process_received_event(self, agent, monkeypatch):
        monkeypatch.setattr(agent, "notify_citizen", MagicMock(return_value=False))
        monkeypatch.setattr(agent, "update_firestore", MagicMock(return_value=False))

        result = agent.process_event(SAMPLE_REPORT, "received")
        assert result["new_status"] == "analyzing"
