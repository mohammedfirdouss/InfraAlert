"""The worker against a real test database and real local photo storage; only the model is faked."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from infraalert.db.models import IssueType, Report, ReportPhoto, Team
from infraalert.processing.extraction import Extraction, HazardFlag
from infraalert.processing.worker import Processor
from infraalert.storage import LocalPhotoStorage, PhotoRef

# Two points 40 m apart, and one about 220 m from the first.
HERE = (36.82190, -1.29210)
NEAR = (36.82226, -1.29210)
FAR = (36.82388, -1.29210)


def wkt(lng_lat: tuple[float, float]) -> str:
    return f"SRID=4326;POINT({lng_lat[0]} {lng_lat[1]})"


@dataclass
class FakeExtractor:
    """Returns `result` (or raises it) and records what it was shown."""

    result: Extraction | Exception = field(
        default_factory=lambda: extraction(IssueType.POTHOLE, confidence=0.9)
    )
    calls: list[tuple[str, str | None, list[PhotoRef]]] = field(default_factory=list)

    def extract(self, description: str, address_text: str | None, photos: list[PhotoRef]):  # type: ignore[no-untyped-def]
        self.calls.append((description, address_text, photos))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def extraction(
    issue_type: IssueType,
    confidence: float = 0.9,
    flags: frozenset[HazardFlag] = frozenset(),
) -> Extraction:
    return Extraction(
        issue_type=issue_type,
        hazard_flags=flags,
        summary=f"A {issue_type} reported by a citizen.",
        confidence=confidence,
        model="fake-model",
    )


@pytest.fixture()
def sessions(engine: Engine) -> Iterator[sessionmaker[Session]]:
    """Every session shares one connection whose work is rolled back after the test."""
    with engine.connect() as conn:
        trans = conn.begin()
        yield sessionmaker(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        trans.rollback()


@pytest.fixture()
def storage(tmp_path: Path) -> LocalPhotoStorage:
    return LocalPhotoStorage(tmp_path, "http://localhost:8000")


@pytest.fixture()
def extractor() -> FakeExtractor:
    return FakeExtractor()


@pytest.fixture()
def processor(
    sessions: sessionmaker[Session], storage: LocalPhotoStorage, extractor: FakeExtractor
) -> Processor:
    return Processor(sessions=sessions, storage=storage, extractor=extractor)


@pytest.fixture()
def submit(sessions: sessionmaker[Session], storage: LocalPhotoStorage) -> Callable[..., uuid.UUID]:
    """Store a received report as the citizen API would; optionally upload its photos."""

    def _submit(
        where: tuple[float, float] = HERE,
        photos: int = 0,
        uploaded: bool = True,
        description: str = "Deep pothole in the left lane",
    ) -> uuid.UUID:
        names = [f"uploads/{uuid.uuid4().hex}.jpg" for _ in range(photos)]
        if uploaded:
            for name in names:
                storage.save(name, b"jpeg-bytes")
        with sessions() as session:
            report = Report(
                description=description,
                location=wkt(where),
                photos=[ReportPhoto(object_name=n, content_type="image/jpeg") for n in names],
            )
            session.add(report)
            session.commit()
            return report.id

    return _submit


@pytest.fixture()
def team(sessions: sessionmaker[Session]) -> Callable[..., uuid.UUID]:
    def _team(name: str, skills: list[IssueType], where: tuple[float, float] = HERE) -> uuid.UUID:
        with sessions() as session:
            t = Team(name=name, skills=skills, base_location=wkt(where))
            session.add(t)
            session.commit()
            return t.id

    return _team
