"""
Resource Coordination Agent — matches the best available team to an
infrastructure report using Firestore (with a mock fallback) and Gemini.
"""
from __future__ import annotations

import json
import sys
import os
import random

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import google.generativeai as genai

from shared.utils import get_env, setup_logging

logger = setup_logging("resource_coordination.agent")

_GEMINI_MODEL = get_env("GEMINI_MODEL", "gemini-flash-latest")

# Mock teams (used when Firestore is unavailable)
MOCK_TEAMS: list[dict] = [
    {
        "id": "T001",
        "name": "Alpha Electrical",
        "type": "electrical",
        "available": True,
        "location": "Zone A",
    },
    {
        "id": "T002",
        "name": "Beta Roads",
        "type": "roads",
        "available": True,
        "location": "Zone B",
    },
    {
        "id": "T003",
        "name": "Gamma Plumbing",
        "type": "plumbing",
        "available": True,
        "location": "Zone C",
    },
    {
        "id": "T004",
        "name": "Delta Emergency",
        "type": "emergency",
        "available": True,
        "location": "Central",
    },
]

# Equipment suggestions per team type
_EQUIPMENT_BY_TYPE: dict[str, list[str]] = {
    "electrical": ["voltage testers", "insulated gloves", "cable repair kit", "generator"],
    "roads": ["asphalt filler", "traffic cones", "compactor", "safety barriers"],
    "plumbing": ["pipe wrench", "sealant", "water pump", "pipe sections"],
    "emergency": ["first aid kit", "emergency lights", "barriers", "communication radios"],
}

# Arrival time estimates (minutes) by severity
_ARRIVAL_BY_SEVERITY: dict[str, int] = {
    "CRITICAL": 15,
    "HIGH": 30,
    "MEDIUM": 60,
    "LOW": 120,
}


# ResourceCoordinationAgent


class ResourceCoordinationAgent:
    """Assigns the best available field team to an infrastructure report."""

    def __init__(self, use_mock: bool = False) -> None:
        self._use_mock = use_mock
        self._model: genai.GenerativeModel | None = None
        self._db = None  # Firestore client, lazy-initialised

    # Internal helpers

    def _model_instance(self) -> genai.GenerativeModel:
        if self._model is None:
            api_key = get_env("GEMINI_API_KEY") or get_env("GOOGLE_API_KEY")
            if api_key:
                genai.configure(api_key=api_key)
            self._model = genai.GenerativeModel(_GEMINI_MODEL)
        return self._model

    def _firestore_client(self):
        if self._db is not None:
            return self._db
        try:
            from google.cloud import firestore  # type: ignore

            project = get_env("GCP_PROJECT_ID") or get_env("GOOGLE_CLOUD_PROJECT")
            self._db = firestore.Client(project=project) if project else firestore.Client()
            logger.info("Connected to Firestore.")
        except Exception as exc:
            logger.warning("Firestore unavailable (%s); will use mock teams.", exc)
            self._db = None
        return self._db

    def get_available_teams(self) -> list[dict]:
        """Fetch available teams from Firestore or fall back to MOCK_TEAMS."""
        if self._use_mock:
            return [t for t in MOCK_TEAMS if t["available"]]

        db = self._firestore_client()
        if db is None:
            return [t for t in MOCK_TEAMS if t["available"]]

        try:
            teams_ref = db.collection("teams").where("available", "==", True).stream()
            teams = [doc.to_dict() | {"id": doc.id} for doc in teams_ref]
            if not teams:
                logger.warning("No teams found in Firestore; using mock teams.")
                return [t for t in MOCK_TEAMS if t["available"]]
            return teams
        except Exception as exc:
            logger.warning("Firestore query failed (%s); using mock teams.", exc)
            return [t for t in MOCK_TEAMS if t["available"]]

    def _mark_team_dispatched(self, team_id: str) -> None:
        """Update team availability in Firestore if available."""
        db = self._firestore_client()
        if db is None:
            return
        try:
            db.collection("teams").document(team_id).update({"available": False})
        except Exception as exc:
            logger.warning("Could not update team %s in Firestore: %s", team_id, exc)

    def _select_team_with_gemini(
        self,
        report: dict,
        teams: list[dict],
        severity: str,
    ) -> dict:
        """
        Ask Gemini to pick the best team from the available list.
        Returns the selected team dict or falls back to rule-based selection.
        """
        teams_json = json.dumps(teams, indent=2)
        prompt = f"""You are a dispatch coordinator for a city infrastructure management system.

Choose the single best team to handle the following infrastructure issue.

Report details:
  Type: {report.get('report_type', 'other')}
  Description: {report.get('description', '')}
  Location: {report.get('location', '')}
  Severity: {severity}

Available teams:
{teams_json}

Rules:
- Prefer the team whose type best matches the issue.
- Prefer teams in the same zone as the location when possible.
- Always select exactly one team.

Return ONLY a JSON object with the team id:
{{"selected_team_id": "<team id>"}}
No extra text."""

        try:
            model = self._model_instance()
            response = model.generate_content(prompt)
            raw = response.text.strip()
            if raw.startswith("```"):
                raw = "\n".join(
                    line for line in raw.splitlines() if not line.startswith("```")
                ).strip()
            data = json.loads(raw)
            selected_id = data.get("selected_team_id", "")
            team = next((t for t in teams if t["id"] == selected_id), None)
            if team:
                return team
            logger.warning("Gemini returned unknown team id '%s'; falling back.", selected_id)
        except Exception as exc:
            logger.warning("Gemini team selection failed (%s); using rule-based fallback.", exc)

        return self._select_team_rule_based(report.get("report_type", "other"), teams, severity)

    def _select_team_rule_based(
        self, report_type: str, teams: list[dict], severity: str
    ) -> dict:
        """Rule-based team selection used as fallback."""
        type_map: dict[str, str] = {
            "power_outage": "electrical",
            "broken_streetlight": "electrical",
            "water_leak": "plumbing",
            "sewage": "plumbing",
            "pothole": "roads",
            "road_damage": "roads",
        }
        preferred_type = type_map.get(report_type, "emergency")

        if severity == "CRITICAL":
            emergency = next((t for t in teams if t["type"] == "emergency"), None)
            if emergency:
                return emergency

        match = next((t for t in teams if t["type"] == preferred_type), None)
        return match or teams[0]

    def _generate_notes(self, report: dict, team: dict, severity: str) -> str:
        return (
            f"Team '{team['name']}' ({team['type']}) assigned to {severity} priority "
            f"{report.get('report_type', 'issue')} at {report.get('location', 'unknown location')}. "
            f"Team base: {team.get('location', 'unknown')}."
        )

    # Public API

    def coordinate(
        self,
        report: dict,
        priority_score: float,
        severity: str,
    ) -> dict:
        """
        Assign a team and return coordination details.

        Returns:
            {
                "assigned_team": dict,
                "estimated_arrival_minutes": int,
                "equipment_needed": list[str],
                "assignment_notes": str,
            }
        """
        severity = severity.upper()
        teams = self.get_available_teams()

        if not teams:
            logger.error("No available teams found!")
            return {
                "assigned_team": {},
                "estimated_arrival_minutes": -1,
                "equipment_needed": [],
                "assignment_notes": "No teams available.",
            }

        selected_team = self._select_team_with_gemini(report, teams, severity)

        # Mark as dispatched in Firestore (best-effort).
        self._mark_team_dispatched(selected_team["id"])

        eta = _ARRIVAL_BY_SEVERITY.get(severity, 60)
        # Add small random jitter ±10 min
        eta += random.randint(-10, 10)
        eta = max(5, eta)

        equipment = _EQUIPMENT_BY_TYPE.get(selected_team.get("type", "emergency"), [])
        notes = self._generate_notes(report, selected_team, severity)

        logger.info(
            "Assigned team '%s' (%s) to report — ETA %d min",
            selected_team["name"],
            severity,
            eta,
        )

        return {
            "assigned_team": selected_team,
            "estimated_arrival_minutes": eta,
            "equipment_needed": equipment,
            "assignment_notes": notes,
        }
