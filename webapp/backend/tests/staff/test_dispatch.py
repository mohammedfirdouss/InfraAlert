from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from infraalert.db.models import (
    Assignment,
    AuditLog,
    Incident,
    IncidentStatus,
    IssueType,
    Report,
    ReportPhoto,
    ReportProcessing,
    StaffRole,
    Team,
)
from infraalert.deps import Deps
from tests.staff.conftest import StaffFactory, auth

HERE = (36.82190, -1.29210)
NEAR = (36.82226, -1.29210)  # ~40 m away
FAR = (36.83190, -1.29210)  # ~1.1 km away


def wkt(p: tuple[float, float]) -> str:
    return f"SRID=4326;POINT({p[0]} {p[1]})"


@pytest.fixture()
def dispatcher(staff: StaffFactory) -> dict[str, str]:
    return auth(staff(StaffRole.DISPATCHER, display_name="Dana Dispatcher").email)


def make_team(
    deps: Deps, name: str, skills: list[IssueType], where: tuple[float, float] = HERE
) -> uuid.UUID:
    with deps.sessions() as session:
        team = Team(name=name, skills=skills, base_location=wkt(where))
        session.add(team)
        session.commit()
        return team.id


def make_incident(
    deps: Deps,
    issue_type: IssueType | None = IssueType.POTHOLE,
    where: tuple[float, float] = HERE,
    reports: int = 1,
    score: float | None = 0.5,
    age: timedelta = timedelta(0),
    flags: list[str] | None = None,
    status: IncidentStatus = IncidentStatus.NEW,
    suggested_team_id: uuid.UUID | None = None,
    photos: int = 0,
) -> uuid.UUID:
    with deps.sessions() as session:
        incident = Incident(
            issue_type=issue_type,
            status=status,
            location=wkt(where),
            priority_score=score,
            formula_version="v1" if score is not None else None,
            priority_inputs={"test": True} if score is not None else None,
            suggested_team_id=suggested_team_id,
            created_at=func.now() - age,
            resolved_at=func.now() if status is IncidentStatus.RESOLVED else None,
        )
        session.add(incident)
        session.flush()
        for n in range(reports):
            session.add(
                Report(
                    description=f"Report {n} of a problem here",
                    location=wkt(where),
                    processing=(
                        ReportProcessing.PROCESSED if issue_type else ReportProcessing.NEEDS_TRIAGE
                    ),
                    incident_id=incident.id,
                    issue_type=issue_type,
                    hazard_flags=flags or [],
                    summary=f"Summary {n}",
                    confidence=0.9,
                    # now() is fixed within a transaction; give reports distinct times.
                    submitted_at=func.now() - age + timedelta(seconds=n),
                    photos=[
                        ReportPhoto(
                            object_name=f"reports/x/{uuid.uuid4().hex}.jpg",
                            content_type="image/jpeg",
                        )
                        for _ in range(photos)
                    ],
                )
            )
        session.commit()
        return incident.id


def get(client: TestClient, headers: dict[str, str], incident_id: uuid.UUID) -> dict[str, Any]:
    resp = client.get(f"/api/staff/incidents/{incident_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    return body


def act(
    client: TestClient,
    headers: dict[str, str],
    incident_id: uuid.UUID,
    action: str,
    body: dict[str, Any] | None = None,
) -> Any:
    return client.post(f"/api/staff/incidents/{incident_id}/{action}", json=body, headers=headers)


def queue_ids(client: TestClient, headers: dict[str, str], **params: str) -> list[str]:
    resp = client.get("/api/staff/queue", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return [item["id"] for item in resp.json()]


# Access


def test_dispatch_endpoints_require_staff(client: TestClient, deps: Deps) -> None:
    incident = make_incident(deps)
    assert client.get("/api/staff/queue").status_code == 401
    assert client.get("/api/staff/queue", headers=auth("stranger@example.com")).status_code == 403
    assert act(client, {}, incident, "on-site").status_code == 401


# The queue


def test_queue_tabs_split_triage_open_and_closed(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    untyped = make_incident(deps, issue_type=None, score=None)
    typed = make_incident(deps)
    done = make_incident(deps, status=IncidentStatus.RESOLVED)
    with deps.sessions() as session:
        session.get(Incident, done).resolved_at = func.now()  # type: ignore[union-attr]
        session.commit()

    assert queue_ids(client, dispatcher, tab="triage") == [str(untyped)]
    assert queue_ids(client, dispatcher, tab="open") == [str(typed)]
    assert queue_ids(client, dispatcher, tab="closed") == [str(done)]


def test_queue_ranks_by_priority_with_a_capped_age_bonus(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    urgent = make_incident(deps, score=0.80)
    fresh = make_incident(deps, score=0.50)
    waited = make_incident(deps, score=0.40, age=timedelta(days=7))  # 0.40 + 0.14
    ancient = make_incident(deps, score=0.20, age=timedelta(days=90))  # bonus capped at 0.14
    assigned = make_incident(deps, score=0.95, status=IncidentStatus.ASSIGNED)

    assert queue_ids(client, dispatcher) == [
        str(urgent),
        str(waited),
        str(fresh),
        str(ancient),
        str(assigned),  # work with a team sinks below work waiting for one
    ]
    with deps.sessions() as session:  # the bonus is never written into the score
        assert session.get(Incident, waited).priority_score == 0.40  # type: ignore[union-attr]


def test_queue_item_shape(client: TestClient, deps: Deps, dispatcher: dict[str, str]) -> None:
    team = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    make_incident(deps, reports=3, flags=["blocking_traffic"], suggested_team_id=team, score=0.6)

    [item] = client.get("/api/staff/queue", headers=dispatcher).json()

    assert item["report_count"] == 3
    assert item["hazard_flags"] == ["blocking_traffic"]
    assert item["severity"] == "HIGH"
    assert item["suggested_team"] == {"id": str(team), "name": "Roads 1"}
    assert item["assigned_team"] is None
    assert item["headline"] == "Summary 2"  # the latest report's summary
    assert item["location"] == {"lat": pytest.approx(HERE[1]), "lng": pytest.approx(HERE[0])}


def test_queue_filters_by_issue_type(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    make_incident(deps, IssueType.POTHOLE)
    leak = make_incident(deps, IssueType.WATER_LEAK)
    assert queue_ids(client, dispatcher, issue_type="water_leak") == [str(leak)]


# Triage


def test_triage_classifies_scores_and_suggests(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    team = make_team(deps, "Plumbers", [IssueType.WATER_LEAK])
    incident = make_incident(deps, issue_type=None, score=None)

    assert act(client, dispatcher, incident, "triage", {"issue_type": "water_leak"}).status_code == 204

    item = get(client, dispatcher, incident)["incident"]
    assert item["item"]["status"] == "triaged"
    assert item["item"]["issue_type"] == "water_leak"
    assert item["formula_version"] == "v1" and item["item"]["priority_score"] is not None
    assert item["item"]["suggested_team"]["id"] == str(team)
    assert item["audit"][0]["action"] == "incident.triaged"
    assert item["audit"][0]["staff_name"] == "Dana Dispatcher"


def test_actions_follow_the_state_machine(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps)
    assert act(client, dispatcher, incident, "on-site").json()["detail"] == "invalid_transition"
    assert act(client, dispatcher, incident, "resolve", {}).status_code == 409
    assert act(client, dispatcher, uuid.uuid4(), "on-site").status_code == 404


# Assigning and team availability


def test_assign_marks_the_team_busy_and_records_the_suggestion(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    suggested = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    chosen = make_team(deps, "Roads 2", [IssueType.POTHOLE], FAR)
    incident = make_incident(deps, suggested_team_id=suggested)

    assert act(client, dispatcher, incident, "assign", {"team_id": str(chosen)}).status_code == 204

    body = get(client, dispatcher, incident)
    assert body["incident"]["item"]["status"] == "assigned"
    assert body["incident"]["item"]["assigned_team"]["id"] == str(chosen)
    [assignment] = body["incident"]["assignments"]
    assert assignment["overridden"] is True
    assert assignment["assigned_by"] == "Dana Dispatcher"
    [busy] = [t for t in body["candidate_teams"] if t["id"] == str(chosen)]
    assert busy["busy_with_incident_id"] == str(incident)


def test_a_busy_team_cannot_be_double_booked(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    team = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    first, second = make_incident(deps), make_incident(deps, where=FAR)
    act(client, dispatcher, first, "assign", {"team_id": str(team)})

    resp = act(client, dispatcher, second, "assign", {"team_id": str(team)})

    assert resp.status_code == 409 and resp.json()["detail"] == "team_busy"
    assert get(client, dispatcher, second)["incident"]["item"]["status"] == "new"  # rolled back


def test_untriaged_incidents_must_be_classified_before_assigning(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    team = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    incident = make_incident(deps, issue_type=None, score=None)
    resp = act(client, dispatcher, incident, "assign", {"team_id": str(team)})
    assert resp.json()["detail"] == "classify_first"


def test_reassigning_frees_the_previous_team(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    a, b = make_team(deps, "Roads A", [IssueType.POTHOLE]), make_team(deps, "Roads B", [])
    incident, other = make_incident(deps), make_incident(deps, where=FAR)
    act(client, dispatcher, incident, "assign", {"team_id": str(a)})

    assert act(client, dispatcher, incident, "assign", {"team_id": str(a)}).json()["detail"] == (
        "already_assigned"
    )
    assert act(client, dispatcher, incident, "assign", {"team_id": str(b)}).status_code == 204
    assert act(client, dispatcher, other, "assign", {"team_id": str(a)}).status_code == 204
    assert get(client, dispatcher, incident)["incident"]["audit"][0]["action"] == (
        "incident.reassigned"
    )


def test_resolving_frees_the_team_and_the_citizen_sees_it(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    team = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    incident, next_job = make_incident(deps), make_incident(deps, where=FAR)
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})
    assert act(client, dispatcher, incident, "on-site").status_code == 204

    assert act(client, dispatcher, incident, "resolve", {"note": "Patched"}).status_code == 204

    detail = get(client, dispatcher, incident)["incident"]
    assert detail["item"]["status"] == "resolved" and detail["resolved_at"] is not None
    assert detail["assignments"][0]["ended_at"] is not None
    assert act(client, dispatcher, next_job, "assign", {"team_id": str(team)}).status_code == 204
    report_id = detail["reports"][0]["id"]
    assert client.get(f"/api/reports/{report_id}").json()["status"] == "resolved"


def test_closing_as_invalid_needs_a_reason_and_frees_the_team(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    team = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    incident = make_incident(deps)
    act(client, dispatcher, incident, "assign", {"team_id": str(team)})

    assert act(client, dispatcher, incident, "close", {"reason": ""}).status_code == 422
    assert act(client, dispatcher, incident, "close", {"reason": "Not a city road"}).status_code == 204

    with deps.sessions() as session:
        open_assignments = session.scalar(
            select(func.count()).select_from(Assignment).where(Assignment.ended_at.is_(None))
        )
    assert open_assignments == 0
    audit = get(client, dispatcher, incident)["incident"]["audit"][0]
    assert audit["action"] == "incident.closed_invalid"
    assert audit["detail"]["reason"] == "Not a city road"


# Merge and split (ADR 0006)


def test_merge_moves_reports_and_the_citizen_follows_the_survivor(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    team = make_team(deps, "Roads 1", [IssueType.POTHOLE])
    duplicate = make_incident(deps, where=NEAR)
    survivor = make_incident(deps, reports=2)
    act(client, dispatcher, duplicate, "assign", {"team_id": str(team)})
    act(client, dispatcher, survivor, "assign", {"team_id": str(make_team(deps, "B", []))})
    moved_report = get(client, dispatcher, duplicate)["incident"]["reports"][0]["id"]

    resp = act(client, dispatcher, duplicate, "merge", {"into_incident_id": str(survivor)})

    assert resp.status_code == 204
    source = get(client, dispatcher, duplicate)["incident"]
    assert source["item"]["status"] == "closed_duplicate"
    assert source["merged_into_id"] == str(survivor)
    target = get(client, dispatcher, survivor)["incident"]
    assert len(target["reports"]) == 3
    assert target["priority_inputs"]["report_count"] == 3  # rescored
    # The duplicate's team is free again; the citizen sees the survivor's progress.
    assert all(t["busy_with_incident_id"] != str(duplicate) for t in
               get(client, dispatcher, survivor)["candidate_teams"])
    assert client.get(f"/api/reports/{moved_report}").json()["status"] == "team_assigned"


def test_merge_guards(client: TestClient, deps: Deps, dispatcher: dict[str, str]) -> None:
    incident = make_incident(deps)
    closed = make_incident(deps, status=IncidentStatus.CLOSED_INVALID)
    body = {"into_incident_id": str(incident)}
    assert act(client, dispatcher, incident, "merge", body).json()["detail"] == (
        "cannot_merge_into_itself"
    )
    assert act(client, dispatcher, closed, "merge", body).json()["detail"] == "invalid_transition"
    assert (
        act(client, dispatcher, incident, "merge", {"into_incident_id": str(closed)}).status_code
        == 409
    )


def test_split_moves_chosen_reports_to_a_new_incident(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps, reports=3)
    report_ids = [r["id"] for r in get(client, dispatcher, incident)["incident"]["reports"]]

    resp = act(client, dispatcher, incident, "split", {"report_ids": report_ids[:1]})

    assert resp.status_code == 201
    new_id = resp.json()["new_incident_id"]
    new = get(client, dispatcher, uuid.UUID(new_id))["incident"]
    assert [r["id"] for r in new["reports"]] == report_ids[:1]
    assert new["item"]["status"] == "triaged" and new["item"]["issue_type"] == "pothole"
    old = get(client, dispatcher, incident)["incident"]
    assert old["priority_inputs"]["report_count"] == 2


def test_split_guards(client: TestClient, deps: Deps, dispatcher: dict[str, str]) -> None:
    incident, other = make_incident(deps, reports=2), make_incident(deps)
    own = [r["id"] for r in get(client, dispatcher, incident)["incident"]["reports"]]
    foreign = get(client, dispatcher, other)["incident"]["reports"][0]["id"]

    assert act(client, dispatcher, incident, "split", {"report_ids": own}).json()["detail"] == (
        "cannot_split_all_reports"
    )
    assert act(client, dispatcher, incident, "split", {"report_ids": [foreign]}).status_code == 422


# Incident detail


def test_detail_shows_reports_photos_hints_teams_and_neighbours(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    make_team(deps, "Lights", [IssueType.BROKEN_STREETLIGHT])
    far_roads = make_team(deps, "Roads far", [IssueType.POTHOLE], FAR)
    near_roads = make_team(deps, "Roads near", [IssueType.POTHOLE], NEAR)
    incident = make_incident(deps, photos=2)
    neighbour = make_incident(deps, IssueType.ROAD_DAMAGE, where=NEAR)
    make_incident(deps, where=FAR)  # too far to be a merge candidate

    body = get(client, dispatcher, incident)

    [report] = body["incident"]["reports"]
    assert report["summary"] == "Summary 0" and report["confidence"] == 0.9
    assert [p["url"].endswith("?view") for p in report["photos"]] == [True, True]
    names = [t["name"] for t in body["candidate_teams"]]
    assert names[:2] == ["Roads near", "Roads far"] and names[-1] == "Lights"
    assert [t["skilled"] for t in body["candidate_teams"]] == [True, True, False]
    assert far_roads and near_roads
    assert [n["id"] for n in body["nearby_incidents"]] == [str(neighbour)]


def test_unknown_incident(client: TestClient, dispatcher: dict[str, str]) -> None:
    assert client.get(f"/api/staff/incidents/{uuid.uuid4()}", headers=dispatcher).status_code == 404


def test_every_action_is_attributed_in_the_audit_log(
    client: TestClient, deps: Deps, dispatcher: dict[str, str]
) -> None:
    incident = make_incident(deps, issue_type=None, score=None)
    act(client, dispatcher, incident, "triage", {"issue_type": "pothole"})
    act(client, dispatcher, incident, "close", {"reason": "Duplicate call"})

    with deps.sessions() as session:
        rows = session.execute(
            select(AuditLog.action, AuditLog.staff_id)
            .where(AuditLog.entity_id == incident)
            .order_by(AuditLog.id)
        ).all()
    assert [a for a, _ in rows] == ["incident.triaged", "incident.closed_invalid"]
    assert all(staff_id is not None for _, staff_id in rows)
