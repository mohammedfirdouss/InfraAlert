"""
Tests for IssueDetectionAgent.
Gemini and Vision API are fully mocked.
"""
from __future__ import annotations

import json
import sys
import os
import types

import pytest

# Path setup so imports resolve without an installed package.
AGENTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, os.path.join(AGENTS_DIR, "issue_detection"))


# Stub google.generativeai before importing the agent so no real network
# calls are made.
def _make_genai_stub():
    stub = types.ModuleType("google.generativeai")

    class _FakeModel:
        def generate_content(self, prompt: str):
            class _Resp:
                text = json.dumps(
                    {
                        "report_type": "pothole",
                        "confidence": 0.92,
                        "analysis": "A large pothole was identified.",
                        "keywords": ["pothole", "road", "damage"],
                    }
                )
            return _Resp()

    stub.GenerativeModel = lambda model_name: _FakeModel()
    stub.configure = lambda **kw: None
    return stub


# Patch before any import of the agent module.
google_stub = types.ModuleType("google")
genai_stub = _make_genai_stub()
google_stub.generativeai = genai_stub
sys.modules.setdefault("google", google_stub)
sys.modules["google.generativeai"] = genai_stub

from agent import IssueDetectionAgent  # noqa: E402


# Fixtures
@pytest.fixture()
def agent():
    return IssueDetectionAgent()


# Tests


class TestAnalyze:
    def test_happy_path_returns_expected_keys(self, agent):
        result = agent.analyze(
            description="There is a large pothole on the main road.",
            location="123 Main St",
            report_id="abc123",
        )
        assert "report_type" in result
        assert "confidence" in result
        assert "analysis" in result
        assert "keywords" in result

    def test_report_type_is_valid(self, agent):
        from agent import VALID_REPORT_TYPES

        result = agent.analyze(
            description="Burst pipe flooding the street.",
            location="Zone B",
        )
        assert result["report_type"] in VALID_REPORT_TYPES

    def test_confidence_bounded(self, agent):
        result = agent.analyze(
            description="Power is out in our entire block.",
            location="Zone A",
        )
        assert 0.0 <= result["confidence"] <= 1.0

    def test_no_media_urls(self, agent):
        """Should succeed without any media URLs."""
        result = agent.analyze(
            description="Broken street light at corner of Oak Ave.",
            location="Oak Ave",
        )
        assert result["report_type"] is not None

    def test_missing_description_uses_fallback(self, agent, mocker):
        """When Gemini raises an exception, fallback analysis is used."""
        mocker.patch.object(
            agent._model_instance().__class__,
            "generate_content",
            side_effect=Exception("API error"),
        )
        # Force the model instance to already be cached and patched.
        fake_model = mocker.MagicMock()
        fake_model.generate_content.side_effect = Exception("API error")
        agent._model = fake_model

        result = agent.analyze(
            description="pothole near the school entrance",
            location="School Rd",
        )
        assert result["report_type"] == "pothole"
        assert result["confidence"] > 0.0

    def test_gemini_json_parse_error_uses_fallback(self, agent, mocker):
        """Non-JSON Gemini response triggers fallback."""
        fake_model = mocker.MagicMock()
        fake_model.generate_content.return_value.text = "not json at all"
        agent._model = fake_model

        result = agent.analyze(
            description="sewage overflow near the market",
            location="Market St",
        )
        assert result["report_type"] in ("sewage", "other")

    def test_vision_api_unavailable_skips_gracefully(self, agent, mocker):
        """If Vision API raises, analysis still returns a result."""
        mocker.patch.object(agent, "_analyze_images_with_vision", return_value="")

        result = agent.analyze(
            description="Large pothole on highway.",
            location="Highway 1",
            media_urls=["https://example.com/image.jpg"],
        )
        assert "report_type" in result


class TestFallbackAnalysis:
    @pytest.mark.parametrize(
        "description,expected_type",
        [
            ("There is a pothole on the road", "pothole"),
            ("water leak from a burst pipe", "water_leak"),
            ("power outage in our area", "power_outage"),
            ("streetlight is broken near park", "broken_streetlight"),
            ("sewage overflow near drain", "sewage"),
            ("road damage on the highway surface", "road_damage"),
            ("something unusual happened", "other"),
        ],
    )
    def test_fallback_classification(self, agent, description, expected_type):
        result = agent._fallback_analysis(description)
        assert result["report_type"] == expected_type
