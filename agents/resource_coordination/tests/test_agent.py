"""
Tests for ResourceCoordinationAgent using mock teams.
Gemini and Firestore are mocked.
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
sys.path.insert(0, os.path.join(AGENTS_DIR, "resource_coordination"))


# Stub google.generativeai
def _make_genai_stub(selected_team_id: str = "T002"):
    stub = types.ModuleType("google.generativeai")

    class _FakeModel:
        def generate_content(self, prompt: str):
            class _Resp:
                text = json.dumps({"selected_team_id": selected_team_id})
            return _Resp()

    stub.GenerativeModel = lambda model_name: _FakeModel()
    stub.configure = lambda **kw: None
    return stub


google_stub = types.ModuleType("google")
genai_stub = _make_genai_stub("T002")
google_stub.generativeai = genai_stub
sys.modules.setdefault("google", google_stub)
sys.modules["google.generativeai"] = genai_stub

from agent import ResourceCoordinationAgent, MOCK_TEAMS  # noqa: E402


# Fixtures
@pytest.fixture()
def agent():
    """Agent with mock teams forced (no Firestore)."""
    return ResourceCoordinationAgent(use_mock=True)


SAMPLE_REPORT = {
    "report_id": "abc123",
    "report_type": "road_damage",
    "description": "Large cracks on the road surface.",
    "location": "Zone B",
    "status": "pending",
}


# Tests


class TestGetAvailableTeams:
    def test_returns_mock_teams_when_use_mock(self, agent):
        teams = agent.get_available_teams()
        assert len(teams) > 0

    def test_all_returned_teams_available(self, agent):
        teams = agent.get_available_teams()
        assert all(t["available"] for t in teams)

    def test_teams_have_required_fields(self, agent):
        teams = agent.get_available_teams()
        for team in teams:
            assert "id" in team
            assert "name" in team
            assert "type" in team


class TestCoordinate:
    def test_returns_all_required_keys(self, agent):
        result = agent.coordinate(SAMPLE_REPORT, priority_score=0.6, severity="HIGH")
        assert "assigned_team" in result
        assert "estimated_arrival_minutes" in result
        assert "equipment_needed" in result
        assert "assignment_notes" in result

    def test_assigned_team_is_dict(self, agent):
        result = agent.coordinate(SAMPLE_REPORT, priority_score=0.6, severity="HIGH")
        assert isinstance(result["assigned_team"], dict)

    def test_eta_positive(self, agent):
        result = agent.coordinate(SAMPLE_REPORT, priority_score=0.6, severity="HIGH")
        assert result["estimated_arrival_minutes"] > 0

    def test_critical_severity_lower_eta(self, agent):
        critical = agent.coordinate(SAMPLE_REPORT, priority_score=0.95, severity="CRITICAL")
        low = agent.coordinate(SAMPLE_REPORT, priority_score=0.1, severity="LOW")
        # Critical ETA (15 ± 10) should be well below LOW ETA (120 ± 10)
        assert critical["estimated_arrival_minutes"] < low["estimated_arrival_minutes"]

    def test_equipment_list_is_list(self, agent):
        result = agent.coordinate(SAMPLE_REPORT, priority_score=0.5, severity="MEDIUM")
        assert isinstance(result["equipment_needed"], list)

    def test_assignment_notes_non_empty(self, agent):
        result = agent.coordinate(SAMPLE_REPORT, priority_score=0.5, severity="MEDIUM")
        assert len(result["assignment_notes"]) > 0

    def test_no_teams_returns_gracefully(self, agent, mocker):
        mocker.patch.object(agent, "get_available_teams", return_value=[])
        result = agent.coordinate(SAMPLE_REPORT, priority_score=0.5, severity="MEDIUM")
        assert result["assigned_team"] == {}
        assert result["estimated_arrival_minutes"] == -1


class TestRuleBasedSelection:
    @pytest.mark.parametrize(
        "report_type,expected_team_type",
        [
            ("power_outage", "electrical"),
            ("broken_streetlight", "electrical"),
            ("water_leak", "plumbing"),
            ("sewage", "plumbing"),
            ("pothole", "roads"),
            ("road_damage", "roads"),
        ],
    )
    def test_rule_based_selects_correct_type(self, agent, report_type, expected_team_type):
        teams = [t for t in MOCK_TEAMS if t["available"]]
        report = dict(SAMPLE_REPORT, report_type=report_type)
        selected = agent._select_team_rule_based(report_type, teams, "MEDIUM")
        assert selected["type"] == expected_team_type

    def test_critical_severity_prefers_emergency(self, agent):
        teams = [t for t in MOCK_TEAMS if t["available"]]
        selected = agent._select_team_rule_based("other", teams, "CRITICAL")
        assert selected["type"] == "emergency"

    def test_gemini_fallback_on_api_error(self, agent, mocker):
        """When Gemini fails, rule-based selection is used instead."""
        fake_model = mocker.MagicMock()
        fake_model.generate_content.side_effect = Exception("API error")
        agent._model = fake_model

        result = agent.coordinate(
            dict(SAMPLE_REPORT, report_type="water_leak"),
            priority_score=0.7,
            severity="HIGH",
        )
        assert result["assigned_team"].get("type") == "plumbing"
