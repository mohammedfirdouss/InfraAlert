"""
Priority Analysis Agent — calculates priority score and severity for
an infrastructure report using weighted heuristics and Gemini.
"""
from __future__ import annotations

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import google.generativeai as genai

from shared.utils import get_env, setup_logging

logger = setup_logging("priority_analysis.agent")

_GEMINI_MODEL = get_env("GEMINI_MODEL", "gemini-flash-latest")

# Scoring tables

# Weight: 0.4 — critical severity keywords found in description/analysis
_SEVERITY_KEYWORDS: dict[str, float] = {
    "critical": 1.0,
    "emergency": 1.0,
    "flooding": 0.95,
    "flood": 0.9,
    "no power": 0.9,
    "power outage": 0.85,
    "blackout": 0.85,
    "burst pipe": 0.9,
    "sewage overflow": 0.95,
    "gas leak": 1.0,
    "collapse": 1.0,
    "dangerous": 0.8,
    "blocked road": 0.75,
    "deep pothole": 0.7,
    "major leak": 0.85,
    "no water": 0.8,
    "accident": 0.85,
    "injury": 1.0,
}

# Weight: 0.3 — urgency by report type
_TYPE_URGENCY: dict[str, float] = {
    "water_leak": 0.85,
    "power_outage": 0.85,
    "sewage": 0.9,
    "pothole": 0.5,
    "broken_streetlight": 0.4,
    "road_damage": 0.6,
    "other": 0.3,
}

# Weight: 0.2 — sensitive locations
_LOCATION_KEYWORDS: dict[str, float] = {
    "hospital": 1.0,
    "school": 0.9,
    "clinic": 0.9,
    "fire station": 1.0,
    "police station": 0.95,
    "main road": 0.85,
    "highway": 0.85,
    "market": 0.7,
    "bus station": 0.75,
    "airport": 0.95,
    "government": 0.8,
    "residential": 0.6,
    "industrial": 0.5,
}

# Priority score → severity mapping
_SCORE_TO_SEVERITY: list[tuple[float, str]] = [
    (0.75, "CRITICAL"),
    (0.55, "HIGH"),
    (0.35, "MEDIUM"),
    (0.0, "LOW"),
]

# Severity → recommended response time (hours)
_RESPONSE_TIME: dict[str, int] = {
    "CRITICAL": 1,
    "HIGH": 4,
    "MEDIUM": 24,
    "LOW": 72,
}


# PriorityAnalysisAgent


class PriorityAnalysisAgent:
    """
    Calculates a priority score and severity label for an infrastructure report.

    Scoring formula (all components clamped to [0, 1]):
      priority_score = 0.4 * severity_component
                     + 0.3 * type_component
                     + 0.2 * location_component
                     + 0.1 * gemini_component
    """

    def __init__(self) -> None:
        self._model: genai.GenerativeModel | None = None

    # Internal helpers

    def _model_instance(self) -> genai.GenerativeModel:
        if self._model is None:
            api_key = get_env("GEMINI_API_KEY") or get_env("GOOGLE_API_KEY")
            if api_key:
                genai.configure(api_key=api_key)
            self._model = genai.GenerativeModel(_GEMINI_MODEL)
        return self._model

    def _score_severity_keywords(self, text: str) -> tuple[float, list[str]]:
        """Return (score, matched_factors) based on severity keywords in text."""
        text_lower = text.lower()
        matched: list[str] = []
        max_score = 0.0
        for keyword, weight in _SEVERITY_KEYWORDS.items():
            if keyword in text_lower:
                matched.append(keyword)
                max_score = max(max_score, weight)
        return max_score, matched

    def _score_report_type(self, report_type: str) -> float:
        return _TYPE_URGENCY.get(report_type.lower(), 0.3)

    def _score_location(self, location: str) -> tuple[float, list[str]]:
        location_lower = location.lower()
        matched: list[str] = []
        max_score = 0.0
        for kw, weight in _LOCATION_KEYWORDS.items():
            if kw in location_lower:
                matched.append(kw)
                max_score = max(max_score, weight)
        return max_score, matched

    def _gemini_time_sensitivity(
        self, report_type: str, description: str, analysis: str
    ) -> float:
        """
        Ask Gemini for a 0.0-1.0 time-sensitivity score.
        Falls back to 0.5 on any error.
        """
        prompt = f"""Rate the time sensitivity of the following infrastructure issue on a scale of 0.0 to 1.0,
where 1.0 means it requires immediate attention (within the hour) and 0.0 means it can wait weeks.

Issue type: {report_type}
Description: {description}
Analysis: {analysis}

Return ONLY a JSON object like: {{"time_sensitivity": 0.75}}
No extra text, no markdown."""

        try:
            model = self._model_instance()
            response = model.generate_content(prompt)
            raw = response.text.strip()
            if raw.startswith("```"):
                raw = "\n".join(
                    line for line in raw.splitlines() if not line.startswith("```")
                ).strip()
            data = json.loads(raw)
            score = float(data.get("time_sensitivity", 0.5))
            return max(0.0, min(1.0, score))
        except Exception as exc:
            logger.warning("Gemini time-sensitivity call failed: %s", exc)
            # Fallback: derive from type urgency
            return _TYPE_URGENCY.get(report_type.lower(), 0.3)

    def _map_score_to_severity(self, score: float) -> str:
        for threshold, label in _SCORE_TO_SEVERITY:
            if score >= threshold:
                return label
        return "LOW"

    # Public API

    def analyze(
        self,
        report_type: str,
        description: str,
        location: str,
        analysis: str = "",
    ) -> dict:
        """
        Compute priority and return structured result.

        Returns:
            {
                "severity": str,
                "priority_score": float,
                "urgency_factors": list[str],
                "recommended_response_time_hours": int,
            }
        """
        combined_text = f"{description} {analysis}"

        # Component 1: severity keywords (weight 0.4)
        severity_score, severity_factors = self._score_severity_keywords(combined_text)

        # Component 2: report type urgency (weight 0.3)
        type_score = self._score_report_type(report_type)

        # Component 3: location sensitivity (weight 0.2)
        location_score, location_factors = self._score_location(location)

        # Component 4: Gemini time sensitivity (weight 0.1)
        gemini_score = self._gemini_time_sensitivity(report_type, description, analysis)

        priority_score = (
            0.4 * severity_score
            + 0.3 * type_score
            + 0.2 * location_score
            + 0.1 * gemini_score
        )
        priority_score = round(max(0.0, min(1.0, priority_score)), 4)

        severity = self._map_score_to_severity(priority_score)

        urgency_factors: list[str] = []
        urgency_factors.extend(severity_factors)
        urgency_factors.extend(location_factors)
        if type_score >= 0.75:
            urgency_factors.append(f"high-urgency report type: {report_type}")
        urgency_factors = list(dict.fromkeys(urgency_factors))  # deduplicate, preserve order

        response_time = _RESPONSE_TIME[severity]

        logger.info(
            "Priority analysis — type=%s score=%.4f severity=%s eta=%dh",
            report_type,
            priority_score,
            severity,
            response_time,
        )

        return {
            "severity": severity,
            "priority_score": priority_score,
            "urgency_factors": urgency_factors,
            "recommended_response_time_hours": response_time,
        }
