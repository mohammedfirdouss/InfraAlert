"""
Two workers at once, each on its own connection with real commits: the cases
the row lock and the matching lock exist for. A barrier inside the fake model
makes both workers pass the early "already processed?" check before either writes.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from infraalert.db.models import AuditLog, Incident, IssueType, Report
from infraalert.processing import worker
from infraalert.processing.worker import Outcome, Processor
from infraalert.storage import LocalPhotoStorage, PhotoRef
from tests.processing.conftest import HERE, NEAR, extraction, wkt


class BarrierExtractor:
    def __init__(self, parties: int) -> None:
        self._barrier = threading.Barrier(parties, timeout=10)

    def extract(self, description: str, address_text: str | None, photos: list[PhotoRef]):  # type: ignore[no-untyped-def]
        self._barrier.wait()
        return extraction(IssueType.POTHOLE)


@pytest.fixture()
def committed(engine: Engine) -> Iterator[tuple[sessionmaker[Session], list[uuid.UUID]]]:
    """Real commits (no shared transaction), cleaned up afterwards."""
    sessions = sessionmaker(engine, expire_on_commit=False)
    report_ids: list[uuid.UUID] = []
    yield sessions, report_ids
    with sessions() as session:
        incident_ids = session.scalars(
            select(Report.incident_id).where(Report.id.in_(report_ids))
        ).all()
        session.execute(delete(AuditLog).where(AuditLog.entity_id.in_(report_ids)))
        session.execute(delete(Report).where(Report.id.in_(report_ids)))
        session.execute(delete(Incident).where(Incident.id.in_([i for i in incident_ids if i])))
        session.commit()


def _new_report(sessions: sessionmaker[Session], where: tuple[float, float]) -> uuid.UUID:
    with sessions() as session:
        report = Report(description="Deep pothole in the left lane", location=wkt(where))
        session.add(report)
        session.commit()
        return report.id


def _run_together(processor: Processor, report_ids: list[uuid.UUID]) -> list[Outcome]:
    with ThreadPoolExecutor(len(report_ids)) as pool:
        return list(pool.map(processor.process, report_ids))


def test_duplicate_deliveries_process_a_report_once(
    committed: tuple[sessionmaker[Session], list[uuid.UUID]], tmp_path: Path
) -> None:
    sessions, report_ids = committed
    report_id = _new_report(sessions, HERE)
    report_ids.append(report_id)
    processor = Processor(sessions, LocalPhotoStorage(tmp_path, ""), BarrierExtractor(2))

    outcomes = _run_together(processor, [report_id, report_id])

    assert sorted(outcomes) == sorted([Outcome.PROCESSED, Outcome.ALREADY_DONE])
    with sessions() as session:
        assert (
            session.scalar(
                select(func.count()).select_from(AuditLog).where(AuditLog.entity_id == report_id)
            )
            == 1
        )


def test_simultaneous_reports_of_one_problem_share_an_incident(
    committed: tuple[sessionmaker[Session], list[uuid.UUID]],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Hold each worker just before it creates an incident. With the matching lock
    # only one can get here at a time, so the wait times out and the second then
    # finds the first's incident. Without it, both arrive together and duplicate.
    gate = threading.Barrier(2)
    real_new_incident = worker._new_incident

    def gated_new_incident(*args, **kwargs):  # type: ignore[no-untyped-def]
        try:
            gate.wait(timeout=1)
        except threading.BrokenBarrierError:
            pass
        return real_new_incident(*args, **kwargs)

    monkeypatch.setattr(worker, "_new_incident", gated_new_incident)
    sessions, report_ids = committed
    report_ids += [_new_report(sessions, HERE), _new_report(sessions, NEAR)]
    processor = Processor(sessions, LocalPhotoStorage(tmp_path, ""), BarrierExtractor(2))

    assert _run_together(processor, report_ids) == [Outcome.PROCESSED, Outcome.PROCESSED]

    with sessions() as session:
        incidents = set(
            session.scalars(select(Report.incident_id).where(Report.id.in_(report_ids)))
        )
    assert len(incidents) == 1
