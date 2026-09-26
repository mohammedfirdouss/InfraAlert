"""
Priority formula and team suggestion (ADR 0004): deterministic, versioned, explainable.

The score is a weighted sum of four components (hazard, issue type, nearby sensitive
places, report volume) plus a life-safety floor. Every input and each component's
contribution is stored in `Priority.inputs`, so "why is this ranked here?" can always be
answered. The incident's age is applied only when sorting the queue, never here.

Changing any constant below changes rankings: bump FORMULA_VERSION when you do.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from infraalert.db.models import Assignment, Incident, IssueType, SensitivePlace, Team
from infraalert.processing.extraction import HazardFlag

FORMULA_VERSION = "v1"

# How urgent each issue type is on its own, before hazards or location (0..1).
TYPE_URGENCY: dict[IssueType, float] = {
    IssueType.SEWAGE: 0.80,
    IssueType.WATER_LEAK: 0.75,
    IssueType.POWER_OUTAGE: 0.75,
    IssueType.ROAD_DAMAGE: 0.55,
    IssueType.POTHOLE: 0.50,
    IssueType.BROKEN_STREETLIGHT: 0.40,
    IssueType.OTHER: 0.30,
}

# Severity of each hazard flag (0..1). The hazard component is the max over the flags.
HAZARD_WEIGHTS: dict[HazardFlag, float] = {
    HazardFlag.INJURY: 1.0,
    HazardFlag.GAS_LEAK: 1.0,
    HazardFlag.EXPOSED_WIRES: 1.0,
    HazardFlag.FIRE: 1.0,
    HazardFlag.SEWAGE_OVERFLOW: 0.80,
    HazardFlag.WATER_CONTAMINATION: 0.80,
    HazardFlag.FLOODING: 0.75,
    HazardFlag.STRUCTURAL_DAMAGE: 0.70,
    HazardFlag.BLOCKING_TRAFFIC: 0.60,
}

# Hazards that threaten life: any of them lifts the score to at least LIFE_SAFETY_FLOOR.
LIFE_SAFETY_FLAGS: frozenset[HazardFlag] = frozenset(
    {HazardFlag.INJURY, HazardFlag.GAS_LEAK, HazardFlag.EXPOSED_WIRES, HazardFlag.FIRE}
)

# Minimum score for a life-safety hazard, so the additive formula can never bury one.
LIFE_SAFETY_FLOOR = 0.75

# Weight of each sensitive-place category at distance 0 (0..1).
PLACE_WEIGHTS: dict[str, float] = {
    "hospital": 1.0,
    "school": 0.9,
    "fire_station": 0.9,
    "clinic": 0.85,
    "police": 0.8,
    "major_road": 0.7,
    "market": 0.6,
}

# Weight for a sensitive-place category missing from PLACE_WEIGHTS.
UNKNOWN_PLACE_WEIGHT = 0.5

# A place's weight decays linearly to 0 at this distance (metres); farther places don't count.
SENSITIVE_RADIUS_M = 300.0

# Report count at which the volume component saturates at 1 (log2(16) / 4 == 1).
VOLUME_LOG2_DIVISOR = 4.0

# Component weights in the final score. They sum to 1.
W_HAZARD = 0.35
W_TYPE = 0.30
W_PLACE = 0.20
W_VOLUME = 0.15

# Severity bands: the lowest score that falls in each band, highest first.
SEVERITY_BANDS: tuple[tuple[float, str], ...] = (
    (0.75, "CRITICAL"),
    (0.55, "HIGH"),
    (0.35, "MEDIUM"),
)
LOWEST_SEVERITY = "LOW"

# Decimal places kept in the score and in the stored breakdown.
SCORE_DECIMALS = 4


@dataclass(frozen=True)
class NearbyPlace:
    category: str
    distance_m: float


@dataclass(frozen=True)
class PriorityInputs:
    issue_type: IssueType
    hazard_flags: frozenset[HazardFlag]
    report_count: int
    nearby_places: list[NearbyPlace] = field(default_factory=list)


@dataclass(frozen=True)
class Priority:
    score: float  # 0..1
    formula_version: str
    inputs: dict[str, Any]  # JSON-safe breakdown: every input and its contribution


def _hazard(flags: frozenset[HazardFlag]) -> float:
    return max((HAZARD_WEIGHTS[f] for f in flags), default=0.0)


def _place_value(place: NearbyPlace) -> float:
    weight = PLACE_WEIGHTS.get(place.category, UNKNOWN_PLACE_WEIGHT)
    return weight * max(0.0, 1.0 - place.distance_m / SENSITIVE_RADIUS_M)


def _place(places: list[NearbyPlace]) -> float:
    return max((_place_value(p) for p in places), default=0.0)


def _volume(report_count: int) -> float:
    # A count below 1 shouldn't happen (an incident has at least one report); treat it as 1.
    return min(1.0, math.log2(max(1, report_count)) / VOLUME_LOG2_DIVISOR)


def score(inputs: PriorityInputs) -> Priority:
    """Score an incident. Pure and deterministic: the same inputs always give the same output."""
    values = {
        "hazard": (_hazard(inputs.hazard_flags), W_HAZARD),
        "type": (TYPE_URGENCY[inputs.issue_type], W_TYPE),
        "place": (_place(inputs.nearby_places), W_PLACE),
        "volume": (_volume(inputs.report_count), W_VOLUME),
    }
    raw = sum(value * weight for value, weight in values.values())
    result = round(min(1.0, max(0.0, raw)), SCORE_DECIMALS)

    floor_applied = bool(inputs.hazard_flags & LIFE_SAFETY_FLAGS) and result < LIFE_SAFETY_FLOOR
    if floor_applied:
        result = LIFE_SAFETY_FLOOR

    breakdown: dict[str, Any] = {
        "issue_type": inputs.issue_type.value,
        "hazard_flags": sorted(f.value for f in inputs.hazard_flags),
        "report_count": inputs.report_count,
        "nearby_places": [
            {"category": p.category, "distance_m": round(p.distance_m, 1)}
            for p in inputs.nearby_places
        ],
        "components": {
            name: {
                "value": round(value, SCORE_DECIMALS),
                "weight": weight,
                "contribution": round(value * weight, SCORE_DECIMALS),
            }
            for name, (value, weight) in values.items()
        },
        "floor_applied": floor_applied,
    }
    return Priority(score=result, formula_version=FORMULA_VERSION, inputs=breakdown)


def severity(score: float) -> str:
    """The band a score falls into: LOW | MEDIUM | HIGH | CRITICAL (see CONTEXT.md)."""
    for threshold, band in SEVERITY_BANDS:
        if score >= threshold:
            return band
    return LOWEST_SEVERITY


def _incident_location(incident_id: uuid.UUID) -> Any:
    return select(Incident.location).where(Incident.id == incident_id).scalar_subquery()


def nearby_sensitive_places(session: Session, incident_id: uuid.UUID) -> list[NearbyPlace]:
    """Enabled sensitive places within SENSITIVE_RADIUS_M of the incident, nearest first."""
    location = _incident_location(incident_id)
    distance = func.ST_Distance(SensitivePlace.geom, location)
    rows = session.execute(
        select(SensitivePlace.category, distance)
        .where(
            SensitivePlace.enabled.is_(True),
            func.ST_DWithin(SensitivePlace.geom, location, SENSITIVE_RADIUS_M),
        )
        .order_by(distance, SensitivePlace.id)
    ).all()
    return [NearbyPlace(category=category, distance_m=float(d)) for category, d in rows]


def suggest_team(session: Session, incident_id: uuid.UUID) -> uuid.UUID | None:
    """
    The nearest available team skilled for the incident's issue type (ADR 0005: a
    suggestion only; a dispatcher decides). Available means active with no open
    assignment. Ties break by name. None if the incident has no type or no team fits.
    """
    issue_type = session.scalar(select(Incident.issue_type).where(Incident.id == incident_id))
    if issue_type is None:
        return None
    open_assignment = exists().where(Assignment.team_id == Team.id, Assignment.ended_at.is_(None))
    return session.scalar(
        select(Team.id)
        .where(Team.active.is_(True), ~open_assignment, Team.skills.contains([issue_type]))
        .order_by(func.ST_Distance(Team.base_location, _incident_location(incident_id)), Team.name)
        .limit(1)
    )
