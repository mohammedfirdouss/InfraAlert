from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from infraalert.db.models import Assignment, AuditLog, Incident, StaffRole
from infraalert.deps import Deps
from tests.staff.conftest import StaffFactory, auth

NAIROBI = {"lat": -1.2921, "lng": 36.8219}


def team_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": f"Team {uuid.uuid4().hex[:6]}",
        "skills": ["pothole", "road_damage"],
        "base_location": NAIROBI,
    }
    return body | overrides


def audit_entries(deps: Deps, entity_id: uuid.UUID | str) -> list[AuditLog]:
    with deps.sessions() as session:
        return list(
            session.scalars(
                select(AuditLog)
                .where(AuditLog.entity_id == uuid.UUID(str(entity_id)))
                .order_by(AuditLog.id)
            )
        )


def open_assignment(deps: Deps, team_id: str, by: uuid.UUID) -> uuid.UUID:
    with deps.sessions() as session:
        incident = Incident(location="SRID=4326;POINT(36.82 -1.29)")
        session.add(incident)
        session.flush()
        session.add(Assignment(incident_id=incident.id, team_id=uuid.UUID(team_id), assigned_by=by))
        session.commit()
        return incident.id


# Role enforcement

ENDPOINTS: list[tuple[str, str, StaffRole | None]] = [
    ("GET", "/api/staff/me", None),
    ("GET", "/api/staff/teams", StaffRole.DISPATCHER),
    ("POST", "/api/staff/teams", StaffRole.SUPERVISOR),
    ("PATCH", f"/api/staff/teams/{uuid.uuid4()}", StaffRole.SUPERVISOR),
    ("GET", "/api/staff/members", StaffRole.ADMIN),
    ("POST", "/api/staff/members", StaffRole.ADMIN),
    ("PATCH", f"/api/staff/members/{uuid.uuid4()}", StaffRole.ADMIN),
]


@pytest.mark.parametrize(("method", "path", "_"), ENDPOINTS)
def test_every_endpoint_needs_a_sign_in(
    client: TestClient, method: str, path: str, _: StaffRole | None
) -> None:
    assert client.request(method, path, json={}).status_code == 401
    bad = client.request(method, path, json={}, headers={"Authorization": "Bearer nonsense"})
    assert bad.status_code == 401
    assert bad.json()["detail"] == "sign_in_required"


@pytest.mark.parametrize(("method", "path", "_"), ENDPOINTS)
def test_signed_in_non_staff_are_forbidden(
    client: TestClient, method: str, path: str, _: StaffRole | None
) -> None:
    response = client.request(method, path, json={}, headers=auth("stranger@example.com"))
    assert response.status_code == 403
    assert response.json()["detail"] == "not_staff"


def test_deactivated_staff_are_forbidden(client: TestClient, staff: StaffFactory) -> None:
    gone = staff(StaffRole.ADMIN, active=False)
    response = client.get("/api/staff/me", headers=auth(gone.email))
    assert response.status_code == 403


@pytest.mark.parametrize(
    ("method", "path", "minimum"), [e for e in ENDPOINTS if e[2] is not None]
)
def test_roles_below_the_minimum_are_forbidden(
    client: TestClient, staff: StaffFactory, method: str, path: str, minimum: StaffRole
) -> None:
    ranks = [StaffRole.DISPATCHER, StaffRole.SUPERVISOR, StaffRole.ADMIN]
    for role in ranks[: ranks.index(minimum)]:
        member = staff(role)
        response = client.request(method, path, json={}, headers=auth(member.email))
        assert response.status_code == 403, role
        assert response.json()["detail"] == "insufficient_role"
    # The minimum role gets past the check (to validation or not-found, if nothing else).
    allowed = client.request(method, path, json={}, headers=auth(staff(minimum).email))
    assert allowed.status_code not in (401, 403)


def test_me(client: TestClient, staff: StaffFactory) -> None:
    member = staff(StaffRole.SUPERVISOR, "Grace@City.test", display_name="Grace Hopper")
    response = client.get("/api/staff/me", headers=auth("grace@city.test"))
    assert response.status_code == 200
    assert response.json() == {
        "id": str(member.id),
        "email": "Grace@City.test",
        "display_name": "Grace Hopper",
        "role": "supervisor",
    }


# Teams


def test_create_and_list_teams(client: TestClient, staff: StaffFactory, deps: Deps) -> None:
    boss = staff(StaffRole.SUPERVISOR)
    headers = auth(boss.email)
    created = client.post(
        "/api/staff/teams",
        json=team_body(name="Zulu Roads", skills=["pothole", "pothole", "sewage"]),
        headers=headers,
    )
    assert created.status_code == 201
    team = created.json()
    assert team["name"] == "Zulu Roads"
    assert team["skills"] == ["pothole", "sewage"]
    assert team["base_location"] == pytest.approx(NAIROBI)
    assert team["active"] is True
    assert team["busy_with_incident_id"] is None

    client.post("/api/staff/teams", json=team_body(name="Alpha Water"), headers=headers)
    listed = client.get("/api/staff/teams", headers=auth(staff().email))
    assert listed.status_code == 200
    names = [t["name"] for t in listed.json()]
    assert names == sorted(names)
    assert {"Alpha Water", "Zulu Roads"} <= set(names)

    [entry] = audit_entries(deps, team["id"])
    assert (entry.action, entry.entity_type, entry.staff_id) == ("team.created", "team", boss.id)
    assert entry.detail["name"] == "Zulu Roads"


@pytest.mark.parametrize(
    "overrides",
    [
        {"skills": ["teleportation"]},
        {"name": ""},
        {"name": "   "},
        {"base_location": {"lat": 91, "lng": 0}},
        {"base_location": None},
        {"unexpected": True},
    ],
)
def test_invalid_teams_are_rejected(
    client: TestClient, staff: StaffFactory, overrides: dict[str, Any]
) -> None:
    headers = auth(staff(StaffRole.SUPERVISOR).email)
    response = client.post("/api/staff/teams", json=team_body(**overrides), headers=headers)
    assert response.status_code == 422


def test_team_names_are_unique(client: TestClient, staff: StaffFactory) -> None:
    headers = auth(staff(StaffRole.SUPERVISOR).email)
    assert client.post("/api/staff/teams", json=team_body(name="Roads"), headers=headers).is_success
    duplicate = client.post("/api/staff/teams", json=team_body(name="roads"), headers=headers)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "team_name_taken"

    other = client.post("/api/staff/teams", json=team_body(name="Water"), headers=headers).json()
    renamed = client.patch(
        f"/api/staff/teams/{other['id']}", json={"name": "Roads"}, headers=headers
    )
    assert renamed.status_code == 409
    assert renamed.json()["detail"] == "team_name_taken"


def test_update_team_is_partial_and_audited(
    client: TestClient, staff: StaffFactory, deps: Deps
) -> None:
    boss = staff(StaffRole.SUPERVISOR)
    headers = auth(boss.email)
    team = client.post("/api/staff/teams", json=team_body(name="Roads"), headers=headers).json()

    response = client.patch(
        f"/api/staff/teams/{team['id']}",
        json={"skills": ["water_leak"], "base_location": {"lat": -1.3, "lng": 36.8}},
        headers=headers,
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Roads"
    assert updated["skills"] == ["water_leak"]
    assert updated["base_location"] == pytest.approx({"lat": -1.3, "lng": 36.8})
    assert updated["warning"] is None

    # Unchanged values aren't recorded; a no-op isn't audited at all.
    client.patch(f"/api/staff/teams/{team['id']}", json={"name": "Roads"}, headers=headers)
    created, changed = audit_entries(deps, team["id"])
    assert changed.action == "team.updated"
    assert changed.staff_id == boss.id
    assert changed.detail == {
        "skills": {"from": ["pothole", "road_damage"], "to": ["water_leak"]},
        "base_location": {
            "from": pytest.approx(NAIROBI),
            "to": pytest.approx({"lat": -1.3, "lng": 36.8}),
        },
    }


@pytest.mark.parametrize(
    "body", [{"name": None}, {"active": None}, {"skills": ["nope"]}, {"extra": 1}]
)
def test_invalid_team_updates_are_rejected(
    client: TestClient, staff: StaffFactory, body: dict[str, Any]
) -> None:
    headers = auth(staff(StaffRole.SUPERVISOR).email)
    team = client.post("/api/staff/teams", json=team_body(), headers=headers).json()
    assert client.patch(f"/api/staff/teams/{team['id']}", json=body, headers=headers).status_code == 422


def test_unknown_team_is_not_found(client: TestClient, staff: StaffFactory) -> None:
    headers = auth(staff(StaffRole.SUPERVISOR).email)
    response = client.patch(f"/api/staff/teams/{uuid.uuid4()}", json={}, headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "team_not_found"


def test_busy_team_shows_its_incident_and_may_be_deactivated(
    client: TestClient, staff: StaffFactory, deps: Deps
) -> None:
    boss = staff(StaffRole.SUPERVISOR)
    headers = auth(boss.email)
    team = client.post("/api/staff/teams", json=team_body(), headers=headers).json()
    incident_id = open_assignment(deps, team["id"], boss.id)

    [listed] = [t for t in client.get("/api/staff/teams", headers=headers).json()
                if t["id"] == team["id"]]  # fmt: skip
    assert listed["busy_with_incident_id"] == str(incident_id)

    response = client.patch(
        f"/api/staff/teams/{team['id']}", json={"active": False}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["active"] is False
    assert response.json()["busy_with_incident_id"] == str(incident_id)
    assert response.json()["warning"] == "team_busy_until_assignment_ends"

    # Once the assignment ends the team is free.
    with deps.sessions() as session:
        assignment = session.scalars(
            select(Assignment).where(Assignment.incident_id == incident_id)
        ).one()
        assignment.ended_at = datetime.now(UTC)
        session.commit()
    [listed] = [t for t in client.get("/api/staff/teams", headers=headers).json()
                if t["id"] == team["id"]]  # fmt: skip
    assert listed["busy_with_incident_id"] is None


# Staff


def test_invite_normalises_the_email_and_is_audited(
    client: TestClient, staff: StaffFactory, deps: Deps
) -> None:
    admin = staff(StaffRole.ADMIN)
    response = client.post(
        "/api/staff/members",
        json={"email": "  Ada.Lovelace@City.TEST ", "display_name": "Ada", "role": "dispatcher"},
        headers=auth(admin.email),
    )
    assert response.status_code == 201
    member = response.json()
    assert member["email"] == "ada.lovelace@city.test"
    assert member["status"] == "invited"
    assert member["role"] == "dispatcher"

    [entry] = audit_entries(deps, member["id"])
    assert (entry.action, entry.staff_id) == ("staff.invited", admin.id)
    assert entry.detail["email"] == "ada.lovelace@city.test"


@pytest.mark.parametrize("email", ["ada@city.test", "ADA@City.Test"])
def test_invite_rejects_existing_staff_case_insensitively(
    client: TestClient, staff: StaffFactory, email: str
) -> None:
    admin = staff(StaffRole.ADMIN)
    staff(email="Ada@city.test")
    response = client.post(
        "/api/staff/members",
        json={"email": email, "display_name": "Ada", "role": "dispatcher"},
        headers=auth(admin.email),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "already_staff"


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email", "display_name": "X", "role": "dispatcher"},
        {"email": "x@city.test", "display_name": "", "role": "dispatcher"},
        {"email": "x@city.test", "display_name": "X", "role": "mayor"},
    ],
)
def test_invalid_invitations_are_rejected(
    client: TestClient, staff: StaffFactory, body: dict[str, Any]
) -> None:
    response = client.post(
        "/api/staff/members", json=body, headers=auth(staff(StaffRole.ADMIN).email)
    )
    assert response.status_code == 422


def test_first_sign_in_links_the_invitation(client: TestClient, staff: StaffFactory) -> None:
    admin_headers = auth(staff(StaffRole.ADMIN).email)
    invited = client.post(
        "/api/staff/members",
        json={"email": "new@city.test", "display_name": "New", "role": "supervisor"},
        headers=admin_headers,
    ).json()

    def status() -> str:
        members = client.get("/api/staff/members", headers=admin_headers).json()
        return next(m["status"] for m in members if m["id"] == invited["id"])

    assert status() == "invited"
    me = client.get("/api/staff/me", headers=auth("New@City.test"))
    assert me.status_code == 200
    assert me.json()["id"] == invited["id"]
    assert me.json()["role"] == "supervisor"
    assert status() == "active"


def test_members_lists_every_status(client: TestClient, staff: StaffFactory) -> None:
    admin = staff(StaffRole.ADMIN)
    invited = staff(invited=True)
    gone = staff(active=False)
    members = {
        m["id"]: m["status"]
        for m in client.get("/api/staff/members", headers=auth(admin.email)).json()
    }
    assert members[str(admin.id)] == "active"
    assert members[str(invited.id)] == "invited"
    assert members[str(gone.id)] == "deactivated"


def test_update_member_role_and_active(
    client: TestClient, staff: StaffFactory, deps: Deps
) -> None:
    admin = staff(StaffRole.ADMIN)
    member = staff(StaffRole.DISPATCHER)
    path = f"/api/staff/members/{member.id}"

    promoted = client.patch(path, json={"role": "supervisor"}, headers=auth(admin.email))
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "supervisor"
    assert promoted.json()["status"] == "active"

    deactivated = client.patch(path, json={"active": False}, headers=auth(admin.email))
    assert deactivated.json()["status"] == "deactivated"
    assert client.get("/api/staff/me", headers=auth(member.email)).status_code == 403

    first, second = audit_entries(deps, member.id)
    assert (first.action, first.staff_id) == ("staff.updated", admin.id)
    assert first.detail == {"role": {"from": "dispatcher", "to": "supervisor"}}
    assert second.detail == {"active": {"from": True, "to": False}}


def test_unknown_member_is_not_found(client: TestClient, staff: StaffFactory) -> None:
    response = client.patch(
        f"/api/staff/members/{uuid.uuid4()}",
        json={"active": False},
        headers=auth(staff(StaffRole.ADMIN).email),
    )
    assert response.status_code == 404


@pytest.mark.parametrize("change", [{"role": "supervisor"}, {"active": False}])
def test_admins_cannot_remove_their_own_access(
    client: TestClient, staff: StaffFactory, change: dict[str, Any]
) -> None:
    me = staff(StaffRole.ADMIN)
    staff(StaffRole.ADMIN)  # so this isn't about being the last admin
    response = client.patch(f"/api/staff/members/{me.id}", json=change, headers=auth(me.email))
    assert response.status_code == 409
    assert response.json()["detail"] == "cannot_change_own_access"


def test_admins_may_make_harmless_changes_to_themselves(
    client: TestClient, staff: StaffFactory
) -> None:
    me = staff(StaffRole.ADMIN)
    response = client.patch(
        f"/api/staff/members/{me.id}", json={"role": "admin", "active": True}, headers=auth(me.email)
    )
    assert response.status_code == 200


@pytest.mark.parametrize("change", [{"role": "dispatcher"}, {"active": False}])
def test_the_last_admin_is_never_removed(
    client: TestClient, staff: StaffFactory, change: dict[str, Any]
) -> None:
    only = staff(StaffRole.ADMIN)
    # An invitation that was never accepted doesn't count as another admin.
    staff(StaffRole.ADMIN, invited=True)
    response = client.patch(f"/api/staff/members/{only.id}", json=change, headers=auth(only.email))
    assert response.status_code == 409
    assert response.json()["detail"] == "last_admin"


def test_another_admin_can_be_demoted_while_one_remains(
    client: TestClient, staff: StaffFactory
) -> None:
    me = staff(StaffRole.ADMIN)
    other = staff(StaffRole.ADMIN)
    response = client.patch(
        f"/api/staff/members/{other.id}", json={"role": "supervisor"}, headers=auth(me.email)
    )
    assert response.status_code == 200
    # Now `me` is the last admin, and the guard protects them.
    response = client.patch(
        f"/api/staff/members/{me.id}", json={"active": False}, headers=auth(me.email)
    )
    assert response.json()["detail"] == "last_admin"
