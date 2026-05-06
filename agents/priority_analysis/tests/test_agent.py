"""
Tests for PriorityAnalysisAgent.
Gemini calls are mocked; heuristic logic is tested directly.
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
sys.path.insert(0, os.path.join(AGENTS_DIR, "priority_analysis"))

# Stub google.generativeai
def _make_genai_stub(time_sensitivity: float = 0.5):
    stub = types.ModuleType("google.generativeai")

    class _FakeModel:
        def generate_content(self, prompt: str):
            class _Resp:
                text = json.dumps({"time_sensitivity": time_sensitivity})
            return _Resp()

    stub.GenerativeModel = lambda model_name: _FakeModel()
    stub.configure = lambda **kw: None
    return stub


google_stub = types.ModuleType("google")
genai_stub = _make_genai_stub(time_sensitivity=0.5)
google_stub.generativeai = genai_stub
sys.modules.setdefault("google", google_stub)
sys.modules["google.generativeai"] = genai_stub

from agent import PriorityAnalysisAgent, _RESPONSE_TIME, _TYPE_URGENCY  # noqa: E402


# Fixtures
@pytest.fixture()
def agent():
    return PriorityAnalysisAgent()


# Tests — priority score calculation


class TestScoring:
    def test_returns_all_required_keys(self, agent):
        result = agent.analyze(
            report_type="pothole",
            description="There is a pothole near the junction.",
            location="Zone B",
        )
        assert "severity" in result
        assert "priority_score" in result
        assert "urgency_factors" in result
        assert "recommended_response_time_hours" in result

    def test_priority_score_bounded(self, agent):
        result = agent.analyze(
            report_type="water_leak",
            description="Flooding and burst pipe near hospital",
            location="hospital road",
        )
        assert 0.0 <= result["priority_score"] <= 1.0

    def test_critical_keywords_raise_severity(self, agent):
        result = agent.analyze(
            report_type="sewage",
            description="Critical sewage overflow causing flooding near school",
            location="school",
        )
        assert result["severity"] in ("HIGH", "CRITICAL")

    def test_low_urgency_report(self, agent):
        result = agent.analyze(
            report_type="other",
            description="Minor cosmetic issue with road markings",
            location="residential street",
        )
        # Should not be critical
        assert result["severity"] in ("LOW", "MEDIUM")

    def test_hospital_location_raises_score(self, agent):
        base = agent.analyze(
            report_type="pothole",
            description="Small pothole",
            location="industrial zone",
        )
        hospital = agent.analyze(
            report_type="pothole",
            description="Small pothole",
            location="hospital entrance",
        )
        assert hospital["priority_score"] > base["priority_score"]

    def test_severity_maps_to_response_time(self, agent):
        result = agent.analyze(
            report_type="power_outage",
            description="No power in the entire district",
            location="main road",
        )
        severity = result["severity"]
        assert result["recommended_response_time_hours"] == _RESPONSE_TIME[severity]

    def test_urgency_factors_list(self, agent):
        result = agent.analyze(
            report_type="water_leak",
            description="burst pipe flooding the area",
            location="main road near hospital",
        )
        assert isinstance(result["urgency_factors"], list)

    @pytest.mark.parametrize("report_type", list(_TYPE_URGENCY.keys()))
    def test_all_report_types_accepted(self, agent, report_type):
        result = agent.analyze(
            report_type=report_type,
            description="Test description for " + report_type,
            location="Zone A",
        )
        assert result["priority_score"] >= 0.0


class TestSeverityKeywords:
    @pytest.mark.parametrize(
        "keyword",
        ["flooding", "no power", "sewage overflow", "burst pipe", "dangerous"],
    )
    def test_keyword_detected(self, agent, keyword):
        score, factors = agent._score_severity_keywords(keyword)
        assert score > 0.0
        assert any(keyword in f for f in factors)

    def test_no_keywords(self, agent):
        score, factors = agent._score_severity_keywords("minor road issue")
        assert score == 0.0
        assert factors == []


class TestGeminiFallback:
    def test_gemini_failure_falls_back_gracefully(self, agent, mocker):
        fake_model = mocker.MagicMock()
        fake_model.generate_content.side_effect = Exception("API down")
        agent._model = fake_model

        result = agent.analyze(
            report_type="pothole",
            description="There is a pothole on the road.",
            location="Zone C",
        )
        # Should still return a valid result
        assert 0.0 <= result["priority_score"] <= 1.0
        assert result["severity"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
