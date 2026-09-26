from __future__ import annotations

import json
import math
import uuid

import pytest
from sqlalchemy import func
from sqlalchemy.orm import Session

from infraalert.db.models import (
    Assignment,
    Incident,
    IssueType,
    PlaceSource,
    SensitivePlace,
    Staff,
    StaffRole,
    Team,
)
from infraalert.processing import priority
from infraalert.processing.extraction import HazardFlag
from infraalert.processing.priority import (
    FORMULA_VERSION,
    NearbyPlace,
    PriorityInputs,
    nearby_sensitive_places,
    score,
    severity,
    suggest_team,
)


def inputs(
    issue_type: IssueType = IssueType.OTHER,
    flags: set[HazardFlag] | None = None,
    report_count: int = 1,
    places: list[NearbyPlace] | None = None,
) -> PriorityInputs:
    return PriorityInputs(
        issue_type=issue_type,
        hazard_flags=frozenset(flags or set()),
        report_count=report_count,
        nearby_places=places or [],
    )


def component(inp: PriorityInputs, name: str) -> float:
    value: float = score(inp).inputs["components"][name]["value"]
    return value


# Components


def test_weights_sum_to_one() -> None:
    total = priority.W_HAZARD + priority.W_TYPE + priority.W_PLACE + priority.W_VOLUME
    assert total == pytest.approx(1.0)
    weights = {k: v["weight"] for k, v in score(inputs()).inputs["components"].items()}
    assert sum(weights.values()) == pytest.approx(1.0)


@pytest.mark.parametrize(
    ("issue_type", "expected"),
    [
        (IssueType.SEWAGE, 0.80),
        (IssueType.WATER_LEAK, 0.75),
        (IssueType.POWER_OUTAGE, 0.75),
        (IssueType.ROAD_DAMAGE, 0.55),
        (IssueType.POTHOLE, 0.50),
        (IssueType.BROKEN_STREETLIGHT, 0.40),
        (IssueType.OTHER, 0.30),
    ],
)
def test_type_component(issue_type: IssueType, expected: float) -> None:
    result = score(inputs(issue_type))
    assert component(inputs(issue_type), "type") == expected
    # Alone (no hazard, no place, one report), the score is just the type's contribution.
    assert result.score == round(0.30 * expected, 4)


def test_every_issue_type_has_an_urgency() -> None:
    assert set(priority.TYPE_URGENCY) == set(IssueType)


@pytest.mark.parametrize(
    ("flags", "expected"),
    [
        (set(), 0.0),
        ({HazardFlag.INJURY}, 1.0),
        ({HazardFlag.GAS_LEAK}, 1.0),
        ({HazardFlag.EXPOSED_WIRES}, 1.0),
        ({HazardFlag.FIRE}, 1.0),
        ({HazardFlag.SEWAGE_OVERFLOW}, 0.80),
        ({HazardFlag.WATER_CONTAMINATION}, 0.80),
        ({HazardFlag.FLOODING}, 0.75),
        ({HazardFlag.STRUCTURAL_DAMAGE}, 0.70),
        ({HazardFlag.BLOCKING_TRAFFIC}, 0.60),
        ({HazardFlag.BLOCKING_TRAFFIC, HazardFlag.FLOODING}, 0.75),  # max, not sum
    ],
)
def test_hazard_component(flags: set[HazardFlag], expected: float) -> None:
    assert component(inputs(flags=flags), "hazard") == expected


def test_every_hazard_flag_has_a_weight() -> None:
    assert set(priority.HAZARD_WEIGHTS) == set(HazardFlag)


@pytest.mark.parametrize(
    ("category", "expected"),
    [
        ("hospital", 1.0),
        ("school", 0.9),
        ("fire_station", 0.9),
        ("clinic", 0.85),
        ("police", 0.8),
        ("major_road", 0.7),
        ("market", 0.6),
        ("stadium", 0.5),  # unknown category
    ],
)
def test_place_component_by_category(category: str, expected: float) -> None:
    assert component(inputs(places=[NearbyPlace(category, 0.0)]), "place") == expected


@pytest.mark.parametrize(
    ("distance_m", "expected"),
    [(0.0, 1.0), (75.0, 0.75), (150.0, 0.5), (225.0, 0.25), (300.0, 0.0), (450.0, 0.0)],
)
def test_place_decays_linearly_to_zero_at_radius(distance_m: float, expected: float) -> None:
    assert component(inputs(places=[NearbyPlace("hospital", distance_m)]), "place") == expected


def test_place_takes_the_max_over_places() -> None:
    places = [NearbyPlace("market", 0.0), NearbyPlace("hospital", 150.0)]  # 0.6 vs 0.5
    assert component(inputs(places=places), "place") == 0.6


@pytest.mark.parametrize(
    ("count", "expected"),
    [(1, 0.0), (2, 0.25), (4, 0.5), (16, 1.0), (100, 1.0)],
)
def test_volume_component(count: int, expected: float) -> None:
    assert component(inputs(report_count=count), "volume") == expected


def test_contributions_add_up_to_the_score() -> None:
    result = score(
        inputs(
            IssueType.WATER_LEAK,
            {HazardFlag.FLOODING},
            report_count=4,
            places=[NearbyPlace("school", 150.0)],
        )
    )
    comps = result.inputs["components"]
    # 0.35*0.75 + 0.30*0.75 + 0.20*0.45 + 0.15*0.5
    assert comps["hazard"]["contribution"] == 0.2625
    assert comps["type"]["contribution"] == 0.225
    assert comps["place"]["contribution"] == 0.09
    assert comps["volume"]["contribution"] == 0.075
    assert result.score == 0.6525
    assert result.score == pytest.approx(sum(c["contribution"] for c in comps.values()))


# Floor, clamping, rounding


@pytest.mark.parametrize(
    "flag",
    [HazardFlag.INJURY, HazardFlag.GAS_LEAK, HazardFlag.EXPOSED_WIRES, HazardFlag.FIRE],
)
def test_life_safety_floor(flag: HazardFlag) -> None:
    result = score(inputs(IssueType.OTHER, {flag}))  # additive: 0.35 + 0.09 = 0.44
    assert result.score == 0.75
    assert result.inputs["floor_applied"] is True
    assert severity(result.score) == "CRITICAL"


def test_floor_not_applied_when_score_is_already_higher() -> None:
    result = score(
        inputs(
            IssueType.SEWAGE,
            {HazardFlag.GAS_LEAK},
            report_count=16,
            places=[NearbyPlace("hospital", 0.0)],
        )
    )
    assert result.score == 0.94  # 0.35 + 0.24 + 0.20 + 0.15
    assert result.inputs["floor_applied"] is False


def test_floor_not_applied_without_life_safety_flag() -> None:
    result = score(inputs(IssueType.OTHER, {HazardFlag.SEWAGE_OVERFLOW}))
    assert result.score == 0.37  # 0.35*0.8 + 0.30*0.3
    assert result.inputs["floor_applied"] is False


def test_score_is_clamped_to_one() -> None:
    # A negative distance is nonsense, but shows the clamp holds if an input goes out of range.
    result = score(
        inputs(
            IssueType.SEWAGE,
            {HazardFlag.FIRE},
            report_count=100,
            places=[NearbyPlace("hospital", -600.0)],
        )
    )
    assert result.score == 1.0


def test_score_is_rounded_to_four_places() -> None:
    result = score(inputs(IssueType.POTHOLE, report_count=3))
    raw = 0.30 * 0.5 + 0.15 * math.log2(3) / 4  # 0.209436...
    assert result.score == round(raw, 4) == 0.2094


# Severity bands


@pytest.mark.parametrize(
    ("value", "band"),
    [
        (0.0, "LOW"),
        (0.3499, "LOW"),
        (0.35, "MEDIUM"),
        (0.5499, "MEDIUM"),
        (0.55, "HIGH"),
        (0.7499, "HIGH"),
        (0.75, "CRITICAL"),
        (1.0, "CRITICAL"),
    ],
)
def test_severity_bands(value: float, band: str) -> None:
    assert severity(value) == band


# Provenance


def test_inputs_are_recorded_and_json_safe() -> None:
    result = score(
        inputs(
            IssueType.POTHOLE,
            {HazardFlag.FLOODING, HazardFlag.BLOCKING_TRAFFIC},
            report_count=2,
            places=[NearbyPlace("school", 12.3456), NearbyPlace("market", 200.04)],
        )
    )
    assert result.formula_version == FORMULA_VERSION == "v1"
    assert json.loads(json.dumps(result.inputs)) == result.inputs
    assert result.inputs["issue_type"] == "pothole"
    assert result.inputs["hazard_flags"] == ["blocking_traffic", "flooding"]
    assert result.inputs["report_count"] == 2
    assert result.inputs["nearby_places"] == [
        {"category": "school", "distance_m": 12.3},
        {"category": "market", "distance_m": 200.0},
    ]
    assert set(result.inputs["components"]) == {"hazard", "type", "place", "volume"}
    for comp in result.inputs["components"].values():
        assert set(comp) == {"value", "weight", "contribution"}
    assert result.inputs["floor_applied"] is False


def test_same_inputs_give_same_output() -> None:
    def make() -> PriorityInputs:
        return inputs(
            IssueType.ROAD_DAMAGE,
            {HazardFlag.STRUCTURAL_DAMAGE, HazardFlag.BLOCKING_TRAFFIC, HazardFlag.FLOODING},
            report_count=7,
            places=[NearbyPlace("clinic", 42.0), NearbyPlace("police", 10.0)],
        )

    first = score(make())
    for _ in range(5):
        again = score(make())
        assert again == first
        assert json.dumps(again.inputs, sort_keys=True) == json.dumps(first.inputs, sort_keys=True)


# Database: sensitive places and team suggestion


def point(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon} {lat})"


# At the equator, 0.001 degrees of latitude is about 110.6 m.
DEG_PER_100M = 0.001 / 1.106


def make_incident(session: Session, issue_type: IssueType | None = IssueType.POTHOLE) -> Incident:
    incident = Incident(location=point(0.0, 0.0), issue_type=issue_type)
    session.add(incident)
    session.flush()
    return incident


def make_place(
    session: Session, category: str, metres_north: float, enabled: bool = True
) -> SensitivePlace:
    place = SensitivePlace(
        category=category,
        geom=point(0.0, metres_north / 100 * DEG_PER_100M),
        source=PlaceSource.MANUAL,
        enabled=enabled,
    )
    session.add(place)
    session.flush()
    return place


def make_team(
    session: Session,
    name: str,
    metres_north: float = 0.0,
    skills: list[IssueType] | None = None,
    active: bool = True,
) -> Team:
    team = Team(
        name=name,
        skills=[IssueType.POTHOLE] if skills is None else skills,
        base_location=point(0.0, metres_north / 100 * DEG_PER_100M),
        active=active,
    )
    session.add(team)
    session.flush()
    return team


def make_busy(session: Session, team: Team) -> None:
    staff = Staff(
        oidc_subject=uuid.uuid4().hex,
        email="d@example.org",
        display_name="Dispatcher",
        role=StaffRole.DISPATCHER,
    )
    session.add(staff)
    session.flush()
    other = make_incident(session)
    session.add(Assignment(incident_id=other.id, team_id=team.id, assigned_by=staff.id))
    session.flush()


def test_nearby_places_within_radius_nearest_first(session: Session) -> None:
    make_place(session, "market", 250)
    make_place(session, "hospital", 50)
    make_place(session, "school", 150)
    make_place(session, "clinic", 350)  # outside 300 m
    make_place(session, "police", 20, enabled=False)
    incident = make_incident(session)

    places = nearby_sensitive_places(session, incident.id)

    assert [p.category for p in places] == ["hospital", "school", "market"]
    assert [p.distance_m for p in places] == pytest.approx([50, 150, 250], abs=1.0)


def test_nearby_places_empty(session: Session) -> None:
    make_place(session, "hospital", 1000)
    assert nearby_sensitive_places(session, make_incident(session).id) == []


def test_suggest_team_picks_nearest_skilled_free_team(session: Session) -> None:
    busy = make_team(session, "Busy", 10)
    make_busy(session, busy)
    make_team(session, "Inactive", 20, active=False)
    make_team(session, "Unskilled", 30, skills=[IssueType.WATER_LEAK])
    make_team(session, "No skills", 35, skills=[])
    far = make_team(session, "Far", 5000)
    near = make_team(session, "Near", 400, skills=[IssueType.WATER_LEAK, IssueType.POTHOLE])
    incident = make_incident(session)

    assert suggest_team(session, incident.id) == near.id

    near.active = False
    session.flush()
    assert suggest_team(session, incident.id) == far.id


def test_suggest_team_counts_ended_assignments_as_free(session: Session) -> None:
    team = make_team(session, "Roads")
    make_busy(session, team)
    incident = make_incident(session)
    assert suggest_team(session, incident.id) is None

    for a in session.query(Assignment).filter(Assignment.team_id == team.id):
        a.ended_at = func.now()
    session.flush()
    assert suggest_team(session, incident.id) == team.id


def test_suggest_team_none_without_issue_type(session: Session) -> None:
    make_team(session, "Roads")
    assert suggest_team(session, make_incident(session, issue_type=None).id) is None


def test_suggest_team_none_without_matching_team(session: Session) -> None:
    make_team(session, "Water", skills=[IssueType.WATER_LEAK])
    assert suggest_team(session, make_incident(session).id) is None


def test_suggest_team_breaks_ties_by_name(session: Session) -> None:
    make_team(session, "Bravo", 100)
    alpha = make_team(session, "Alpha", 100)
    make_team(session, "Charlie", 100)
    assert suggest_team(session, make_incident(session).id) == alpha.id
