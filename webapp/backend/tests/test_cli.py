from __future__ import annotations

import urllib.parse
from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from infraalert import cli
from infraalert.places import osm
from infraalert.db.models import IssueType, SensitivePlace, Staff, StaffRole, Team


class _Undisposable:
    def dispose(self) -> None:
        pass


@pytest.fixture()
def sessions(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[sessionmaker[Session]]:
    """Point cli.main at a rolled-back connection instead of DATABASE_URL."""
    with engine.connect() as conn:
        trans = conn.begin()
        factory = sessionmaker(bind=conn, join_transaction_mode="create_savepoint")
        monkeypatch.setattr(cli, "make_engine", lambda: _Undisposable())
        monkeypatch.setattr(cli, "make_sessionmaker", lambda _engine: factory)
        yield factory
        trans.rollback()


def staff_by_email(sessions: sessionmaker[Session], email: str) -> list[Staff]:
    with sessions() as session:
        query = select(Staff).where(func.lower(Staff.email) == email.lower())
        return list(session.scalars(query))


def test_create_admin_is_idempotent(
    sessions: sessionmaker[Session], capsys: pytest.CaptureFixture[str]
) -> None:
    argv = ["create-admin", "--email", "Ada@City.test", "--name", "Ada"]
    assert cli.main(argv) == 0
    assert "invited ada@city.test" in capsys.readouterr().out
    assert cli.main(argv) == 0
    assert "already an admin" in capsys.readouterr().out

    [admin] = staff_by_email(sessions, "ada@city.test")
    assert admin.email == "ada@city.test"
    assert admin.role == StaffRole.ADMIN
    assert admin.oidc_subject is None  # linked on first sign-in


def test_create_admin_promotes_existing_staff(
    sessions: sessionmaker[Session], capsys: pytest.CaptureFixture[str]
) -> None:
    with sessions() as session:
        session.add(
            Staff(
                email="Grace@city.test",
                display_name="Grace",
                role=StaffRole.DISPATCHER,
                active=False,
            )
        )
        session.commit()

    assert cli.main(["create-admin", "--email", "grace@CITY.test", "--name", "G"]) == 0
    assert "made grace@city.test an active admin" in capsys.readouterr().out
    [grace] = staff_by_email(sessions, "grace@city.test")
    assert (grace.role, grace.active, grace.display_name) == (StaffRole.ADMIN, True, "Grace")


def test_seed_dev_is_idempotent(
    sessions: sessionmaker[Session],
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STAFF_AUTH_BACKEND", raising=False)
    assert cli.main(["seed-dev"]) == 0
    first = capsys.readouterr().out
    assert "staff admin@dev.local (admin)" in first
    assert "sensitive place Kenyatta National Hospital (hospital)" in first

    with sessions() as session:
        roles = {
            s.email: s.role
            for s in session.scalars(select(Staff).where(Staff.email.like("%@dev.local")))
        }
        teams = session.scalars(select(Team)).all()
        categories = set(session.scalars(select(SensitivePlace.category)))
    assert roles == {
        "dispatcher@dev.local": StaffRole.DISPATCHER,
        "supervisor@dev.local": StaffRole.SUPERVISOR,
        "admin@dev.local": StaffRole.ADMIN,
    }
    assert len(teams) == len(cli.DEV_TEAMS)
    assert {skill for team in teams for skill in team.skills} == set(IssueType)
    assert {"hospital", "school", "major_road"} <= categories

    monkeypatch.setenv("STAFF_AUTH_BACKEND", "dev")
    assert cli.main(["seed-dev"]) == 0
    assert "nothing to do" in capsys.readouterr().out
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Team)) == len(cli.DEV_TEAMS)
        assert session.scalar(
            select(func.count()).select_from(Staff).where(Staff.email.like("%@dev.local"))
        ) == len(cli.DEV_STAFF)


def test_seed_dev_refuses_outside_development(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def no_database() -> None:
        raise AssertionError("seed-dev must not touch the database")

    monkeypatch.setattr(cli, "make_engine", no_database)
    monkeypatch.setenv("STAFF_AUTH_BACKEND", "identity_platform")
    assert cli.main(["seed-dev"]) == 1
    assert "local development only" in capsys.readouterr().out


def test_import_osm(
    sessions: sessionmaker[Session],
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.places.conftest import FakeOverpass

    fake = FakeOverpass()
    urls: list[str] = []

    def client(url: str) -> osm.OverpassClient:
        urls.append(url)
        return fake.client()

    monkeypatch.setattr(cli.osm, "OverpassClient", client)
    monkeypatch.setenv("CITY_BBOX", "-1.3,36.7,-1.2,36.9")
    monkeypatch.delenv("OVERPASS_URL", raising=False)

    assert cli.main(["import-osm"]) == 0
    assert "fetched 6: 6 inserted, 0 updated, 0 unchanged, 0 deleted" in capsys.readouterr().out
    assert urls == ["https://overpass-api.de/api/interpreter"]
    [query] = urllib.parse.parse_qs(fake.requests[0].content.decode())["data"]
    assert "[bbox:-1.3,36.7,-1.2,36.9]" in query
    assert cli.main(["import-osm"]) == 0
    assert "0 inserted, 0 updated, 6 unchanged" in capsys.readouterr().out
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(SensitivePlace)) == 6


def test_import_osm_failure_changes_nothing(
    sessions: sessionmaker[Session],
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.places.conftest import FakeOverpass

    fake = FakeOverpass(status=504)
    monkeypatch.setattr(cli.osm, "OverpassClient", lambda _url: fake.client())

    assert cli.main(["import-osm"]) == 1
    assert "import failed, nothing changed" in capsys.readouterr().out
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(SensitivePlace)) == 0
