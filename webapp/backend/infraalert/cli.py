"""
Operator commands. Uses DATABASE_URL.

    python -m infraalert.cli create-admin --email ada@city.example --name "Ada Lovelace"
    python -m infraalert.cli seed-dev        # local development only
    python -m infraalert.cli import-osm      # refresh sensitive places from OpenStreetMap
                                             # (CITY_BBOX, OVERPASS_URL)
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from infraalert.notify.retention import run_retention
from infraalert.config import Settings, _bbox
from infraalert.db.models import IssueType, PlaceSource, SensitivePlace, Staff, StaffRole, Team
from infraalert.db.session import make_engine, make_sessionmaker
from infraalert.places import osm

DEV_STAFF = [
    ("dispatcher@dev.local", "Dev Dispatcher", StaffRole.DISPATCHER),
    ("supervisor@dev.local", "Dev Supervisor", StaffRole.SUPERVISOR),
    ("admin@dev.local", "Dev Admin", StaffRole.ADMIN),
]

# Around Nairobi's CBD (-1.2921, 36.8219), the map's default view. (name, skills, lat, lng)
DEV_TEAMS = [
    ("Westlands Roads Crew", [IssueType.POTHOLE, IssueType.ROAD_DAMAGE], -1.2676, 36.8108),
    ("CBD Water & Sewer", [IssueType.WATER_LEAK, IssueType.SEWAGE], -1.2864, 36.8172),
    ("Eastlands Water Response", [IssueType.WATER_LEAK], -1.2833, 36.8833),
    (
        "Industrial Area Electrical",
        [IssueType.POWER_OUTAGE, IssueType.BROKEN_STREETLIGHT],
        -1.3031,
        36.8515,
    ),
    ("Kilimani Street Lighting", [IssueType.BROKEN_STREETLIGHT], -1.2921, 36.7856),
    (
        "Langata General Maintenance",
        [IssueType.POTHOLE, IssueType.SEWAGE, IssueType.OTHER],
        -1.3350,
        36.7700,
    ),
]

# (name, category, WKT)
DEV_PLACES = [
    ("Kenyatta National Hospital", "hospital", "POINT(36.8070 -1.3009)"),
    ("Nairobi School", "school", "POINT(36.7836 -1.2707)"),
    ("Uhuru Highway", "major_road", "LINESTRING(36.8138 -1.278, 36.8203 -1.2921, 36.826 -1.305)"),
]


def create_admin(session: Session, email: str, name: str) -> str:
    """Create an admin invitation, or make the existing staff member an active admin."""
    email = email.strip().lower()
    staff = session.scalars(select(Staff).where(func.lower(Staff.email) == email)).first()
    if staff is None:
        session.add(Staff(email=email, display_name=name, role=StaffRole.ADMIN))
        return f"invited {email} as admin; they are linked on first sign-in"
    if staff.role == StaffRole.ADMIN and staff.active:
        return f"{email} is already an admin"
    staff.role, staff.active = StaffRole.ADMIN, True
    return f"made {email} an active admin"


def seed_dev(session: Session) -> list[str]:
    """Create the development staff, teams and sensitive places that don't exist yet."""
    created: list[str] = []
    for email, name, role in DEV_STAFF:
        if session.scalars(select(Staff.id).where(func.lower(Staff.email) == email)).first():
            continue
        session.add(Staff(email=email, display_name=name, role=role))
        created.append(f"staff {email} ({role.value})")
    for name, skills, lat, lng in DEV_TEAMS:
        if session.scalars(select(Team.id).where(Team.name == name)).first():
            continue
        session.add(Team(name=name, skills=skills, base_location=f"SRID=4326;POINT({lng} {lat})"))
        created.append(f"team {name}: {', '.join(s.value for s in skills)}")
    for name, category, wkt in DEV_PLACES:
        existing = select(SensitivePlace.id).where(
            SensitivePlace.name == name, SensitivePlace.source == PlaceSource.MANUAL
        )
        if session.scalars(existing).first():
            continue
        session.add(
            SensitivePlace(
                name=name, category=category, geom=f"SRID=4326;{wkt}", source=PlaceSource.MANUAL
            )
        )
        created.append(f"sensitive place {name} ({category})")
    return created


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m infraalert.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    admin = commands.add_parser("create-admin", help="bootstrap or promote an admin")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    commands.add_parser("seed-dev", help="add development staff, teams and places")
    commands.add_parser("import-osm", help="refresh sensitive places from OpenStreetMap")
    commands.add_parser(
        "retention", help="apply the data-retention rules (ADR 0007) once, now"
    )
    args = parser.parse_args(argv)

    if args.command == "seed-dev" and (os.getenv("STAFF_AUTH_BACKEND") or "dev") != "dev":
        print("seed-dev is for local development only (STAFF_AUTH_BACKEND must be dev)")
        return 1

    if args.command == "import-osm":
        return _import_osm()
    if args.command == "retention":
        return _retention()

    engine = make_engine()
    try:
        with make_sessionmaker(engine)() as session:
            if args.command == "create-admin":
                lines = [create_admin(session, args.email, args.name)]
            else:
                lines = seed_dev(session) or ["nothing to do: everything already exists"]
            session.commit()
    finally:
        engine.dispose()
    print("\n".join(lines))
    return 0


def _import_osm() -> int:
    # Only the import's settings: the CLI must not need the web app's secrets.
    raw_bbox = os.getenv("CITY_BBOX")
    bbox = _bbox(raw_bbox) if raw_bbox else Settings.city_bbox
    overpass = osm.OverpassClient(os.getenv("OVERPASS_URL") or Settings.overpass_url)
    engine = make_engine()
    try:
        with make_sessionmaker(engine)() as session:
            result = osm.import_osm(session, overpass, bbox)
    except (osm.OverpassError, osm.ImportRefused) as exc:
        print(f"import failed, nothing changed: {exc}")
        return 1
    finally:
        engine.dispose()
    print(
        f"fetched {result.fetched}: {result.inserted} inserted, {result.updated} updated, "
        f"{result.unchanged} unchanged, {result.deleted} deleted"
    )
    if result.deletions_skipped:
        print("warning: the result looked incomplete, so vanished places were kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())


def _retention() -> int:
    engine = make_engine()
    try:
        with make_sessionmaker(engine)() as session:
            result = run_retention(session)
            session.commit()
    finally:
        engine.dispose()
    print(
        f"submitter keys cleared: {result.submitter_keys_cleared}, "
        f"verifications deleted: {result.verifications_deleted}, "
        f"contacts deleted: {result.contacts_deleted}"
    )
    return 0
