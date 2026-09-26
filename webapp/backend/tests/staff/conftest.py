"""
The app with dev staff sign-in, wired to a rolled-back test database.

    def test_x(client: TestClient, staff: StaffFactory) -> None:
        boss = staff(StaffRole.SUPERVISOR)
        client.get("/api/staff/teams", headers=auth(boss.email))
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Protocol

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from infraalert.app import create_app
from infraalert.config import Settings
from infraalert.db.models import Staff, StaffRole
from infraalert.deps import Deps
from infraalert.staff.identity import DevVerifier
from tests.citizen.conftest import FakeCaptcha, FakeStorage, FakeTasks


def auth(email: str) -> dict[str, str]:
    """Headers that sign in as `email` through the DevVerifier."""
    return {"Authorization": f"Bearer dev:{email}"}


class StaffFactory(Protocol):
    def __call__(
        self,
        role: StaffRole = StaffRole.DISPATCHER,
        email: str | None = None,
        *,
        display_name: str | None = None,
        invited: bool = False,
        active: bool = True,
    ) -> Staff: ...


@pytest.fixture()
def deps(engine: Engine) -> Iterator[Deps]:
    """Everything the app writes is rolled back after each test."""
    with engine.connect() as conn:
        trans = conn.begin()
        yield Deps(
            settings=Settings(
                database_url="unused",
                turnstile_secret_key="unused",
                rate_limit_secret="test-secret",
            ),
            sessions=sessionmaker(
                bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
            ),
            captcha=FakeCaptcha(),
            storage=FakeStorage(),
            tasks=FakeTasks(),
            staff_auth=DevVerifier(),
        )
        trans.rollback()


@pytest.fixture()
def client(deps: Deps) -> Iterator[TestClient]:
    with TestClient(create_app(deps)) as c:
        yield c


@pytest.fixture()
def staff(deps: Deps) -> StaffFactory:
    """
    Makes a staff member. By default they have already signed in (their dev subject is
    linked), so `auth(member.email)` works; `invited=True` leaves the subject unlinked.
    """

    def make(
        role: StaffRole = StaffRole.DISPATCHER,
        email: str | None = None,
        *,
        display_name: str | None = None,
        invited: bool = False,
        active: bool = True,
    ) -> Staff:
        email = email or f"{role.value}-{uuid.uuid4().hex[:8]}@city.test"
        member = Staff(
            email=email,
            display_name=display_name or email.split("@")[0],
            role=role,
            active=active,
            oidc_subject=None if invited else f"dev:{email.lower()}",
        )
        with deps.sessions() as session:
            session.add(member)
            session.commit()
            session.refresh(member)
        return member

    return make
