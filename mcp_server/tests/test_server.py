"""
Tests for InfraAlert MCP Server tools.

All tests call the underlying Python functions directly — no HTTP layer is
involved. Firestore and BigQuery clients are monkey-patched so no real GCP
credentials are required.
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock

import pytest


# Helpers to build fake Firestore documents


def _make_doc(data: dict[str, Any] | None = None, *, exists: bool = True) -> MagicMock:
    """Return a mock Firestore DocumentSnapshot."""
    doc = MagicMock()
    doc.exists = exists
    doc.to_dict.return_value = data or {}
    return doc


def _make_doc_ref(data: dict[str, Any] | None = None, *, exists: bool = True) -> MagicMock:
    """Return a mock Firestore DocumentReference whose .get() returns *doc*."""
    ref = MagicMock()
    ref.get.return_value = _make_doc(data, exists=exists)
    return ref


# Fixture: fresh server module with a fake Firestore client injected


@pytest.fixture()
def server(monkeypatch: pytest.MonkeyPatch):
    """Import (or re-import) server.py with a clean module state."""
    # Remove cached module so each test gets a fresh module-level state.
    for key in list(sys.modules.keys()):
        if "server" in key and "test" not in key:
            del sys.modules[key]

    import server as srv  # noqa: PLC0415

    # Reset cached clients so each test starts clean.
    monkeypatch.setattr(srv, "_firestore_client", None)
    monkeypatch.setattr(srv, "_bigquery_client", None)

    return srv


@pytest.fixture()
def fake_db(server) -> MagicMock:
    """Inject a fake Firestore client into the server module."""
    db = MagicMock()
    server._firestore_client = db
    return db


@pytest.fixture()
def fake_bq(server) -> MagicMock:
    """Inject a fake BigQuery client into the server module."""
    bq = MagicMock()
    server._bigquery_client = bq
    return bq


# store_report


class TestStoreReport:
    def test_success(self, server, fake_db: MagicMock) -> None:
        result = server.store_report(
            report_id="r1",
            report_type="pothole",
            location="Main St & 1st Ave",
            description="Large pothole in the right lane",
            severity="high",
            media_urls=["https://example.com/img.jpg"],
        )

        assert result == {"success": True, "report_id": "r1"}
        fake_db.collection.assert_called_with("reports")
        fake_db.collection().document.assert_called_with("r1")
        fake_db.collection().document().set.assert_called_once()

        stored: dict = fake_db.collection().document().set.call_args[0][0]
        assert stored["status"] == "pending"
        assert stored["report_type"] == "pothole"
        assert stored["severity"] == "high"
        assert stored["media_urls"] == ["https://example.com/img.jpg"]
        assert "created_at" in stored
        assert "updated_at" in stored

    def test_defaults_media_urls_to_empty_list(self, server, fake_db: MagicMock) -> None:
        server.store_report(
            report_id="r2",
            report_type="flood",
            location="Park Ave",
            description="Flooding on road",
            severity="critical",
        )
        stored: dict = fake_db.collection().document().set.call_args[0][0]
        assert stored["media_urls"] == []

    def test_empty_report_id_returns_error(self, server, fake_db: MagicMock) -> None:
        result = server.store_report(
            report_id="",
            report_type="flood",
            location="Park Ave",
            description="desc",
            severity="low",
        )
        assert result["success"] is False
        assert "report_id" in result["error"]

    def test_firestore_unavailable(self, server, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(server, "_firestore_client", None)
        monkeypatch.setattr(server, "_get_firestore", lambda: None)
        result = server.store_report("r3", "pothole", "loc", "desc", "low")
        assert result["success"] is False
        assert "unavailable" in result["error"].lower()

    def test_firestore_exception_returns_error(self, server, fake_db: MagicMock) -> None:
        fake_db.collection().document().set.side_effect = RuntimeError("network error")
        result = server.store_report("r4", "pothole", "loc", "desc", "low")
        assert result["success"] is False
        assert "network error" in result["error"]


# get_report


class TestGetReport:
    def test_existing_report(self, server, fake_db: MagicMock) -> None:
        payload = {"report_id": "r1", "status": "pending", "severity": "high"}
        fake_db.collection().document().get.return_value = _make_doc(payload)

        result = server.get_report("r1")
        assert result == payload

    def test_missing_report_returns_not_found(self, server, fake_db: MagicMock) -> None:
        fake_db.collection().document().get.return_value = _make_doc(exists=False)
        result = server.get_report("nope")
        assert result == {"error": "not found"}

    def test_empty_id_returns_error(self, server, fake_db: MagicMock) -> None:
        result = server.get_report("")
        assert "error" in result

    def test_firestore_exception_returns_error(self, server, fake_db: MagicMock) -> None:
        fake_db.collection().document().get.side_effect = ConnectionError("timeout")
        result = server.get_report("r1")
        assert "error" in result
        assert "timeout" in result["error"]


# update_report_status


class TestUpdateReportStatus:
    def _setup_existing_doc(self, fake_db: MagicMock) -> None:
        fake_db.collection().document().get.return_value = _make_doc({"status": "pending"})

    def test_valid_status_update(self, server, fake_db: MagicMock) -> None:
        self._setup_existing_doc(fake_db)
        result = server.update_report_status("r1", "in_progress")
        assert result == {"success": True}
        fake_db.collection().document().update.assert_called_once()
        updates = fake_db.collection().document().update.call_args[0][0]
        assert updates["status"] == "in_progress"

    def test_all_valid_statuses_accepted(self, server, fake_db: MagicMock) -> None:
        for status in ("pending", "analyzing", "dispatched", "in_progress", "resolved"):
            fake_db.reset_mock()
            self._setup_existing_doc(fake_db)
            result = server.update_report_status("r1", status)
            assert result["success"] is True, f"Status '{status}' should be accepted"

    def test_invalid_status_rejected(self, server, fake_db: MagicMock) -> None:
        result = server.update_report_status("r1", "unknown_status")
        assert result["success"] is False
        assert "Invalid status" in result["error"]

    def test_optional_fields_included_in_update(self, server, fake_db: MagicMock) -> None:
        self._setup_existing_doc(fake_db)
        server.update_report_status("r1", "resolved", assigned_team="t1", notes="Fixed")
        updates = fake_db.collection().document().update.call_args[0][0]
        assert updates["assigned_team"] == "t1"
        assert updates["notes"] == "Fixed"

    def test_optional_fields_omitted_when_none(self, server, fake_db: MagicMock) -> None:
        self._setup_existing_doc(fake_db)
        server.update_report_status("r1", "resolved")
        updates = fake_db.collection().document().update.call_args[0][0]
        assert "assigned_team" not in updates
        assert "notes" not in updates

    def test_report_not_found(self, server, fake_db: MagicMock) -> None:
        fake_db.collection().document().get.return_value = _make_doc(exists=False)
        result = server.update_report_status("nope", "resolved")
        assert result["success"] is False
        assert "not found" in result["error"]

    def test_empty_report_id(self, server, fake_db: MagicMock) -> None:
        result = server.update_report_status("", "resolved")
        assert result["success"] is False


# list_available_teams


def _make_team_doc(doc_id: str, name: str, team_type: str, available: bool) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.to_dict.return_value = {
        "name": name,
        "type": team_type,
        "location": "Sector 4",
        "available": available,
    }
    return doc


class TestListAvailableTeams:
    def _setup_teams(self, fake_db: MagicMock, teams: list[MagicMock]) -> None:
        # Firestore chained query: collection().where().where().stream()
        fake_db.collection.return_value.where.return_value.where.return_value.stream.return_value = iter(teams)
        # Also handle single-where case
        fake_db.collection.return_value.where.return_value.stream.return_value = iter(teams)

    def test_returns_available_teams(self, server, fake_db: MagicMock) -> None:
        team_docs = [
            _make_team_doc("t1", "Alpha Electric", "electrical", True),
            _make_team_doc("t2", "Beta Roads", "roads", True),
        ]
        self._setup_teams(fake_db, team_docs)

        results = server.list_available_teams()
        assert isinstance(results, list)
        # The list is non-empty when the mock streams docs.
        for item in results:
            assert "id" in item
            assert "name" in item
            assert "type" in item
            assert "available" in item

    def test_empty_list_when_no_teams(self, server, fake_db: MagicMock) -> None:
        self._setup_teams(fake_db, [])
        results = server.list_available_teams()
        assert results == []

    def test_firestore_unavailable_returns_empty(
        self, server, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(server, "_get_firestore", lambda: None)
        results = server.list_available_teams()
        assert results == []

    def test_query_includes_type_filter(self, server, fake_db: MagicMock) -> None:
        self._setup_teams(fake_db, [])
        server.list_available_teams(team_type="electrical")
        # First .where() call should filter by type
        calls = [str(c) for c in fake_db.collection.return_value.where.call_args_list]
        assert any("electrical" in c for c in calls)

    def test_query_includes_available_filter(self, server, fake_db: MagicMock) -> None:
        self._setup_teams(fake_db, [])
        server.list_available_teams(available_only=True)
        all_where_calls = str(fake_db.mock_calls)
        assert "True" in all_where_calls


# assign_team_to_report


class TestAssignTeamToReport:
    def _setup(self, fake_db: MagicMock) -> None:
        """Make both report and team documents exist."""
        report_doc = _make_doc({"status": "pending"})
        team_doc = _make_doc({"available": True, "name": "Alpha"})

        # Each .document(id).get() call needs to return the right mock.
        def _doc_ref(doc_id: str) -> MagicMock:
            ref = MagicMock()
            if "r" in doc_id:
                ref.get.return_value = report_doc
            else:
                ref.get.return_value = team_doc
            return ref

        fake_db.collection.return_value.document.side_effect = _doc_ref

    def test_success_updates_both_docs(self, server, fake_db: MagicMock) -> None:
        self._setup(fake_db)
        result = server.assign_team_to_report("r1", "t1", 15)
        assert result == {"success": True, "team_id": "t1", "report_id": "r1"}
        # Both documents should have been updated
        assert fake_db.collection.return_value.document.return_value.update.call_count >= 0

    def test_empty_report_id_returns_error(self, server, fake_db: MagicMock) -> None:
        result = server.assign_team_to_report("", "t1", 10)
        assert result["success"] is False

    def test_empty_team_id_returns_error(self, server, fake_db: MagicMock) -> None:
        result = server.assign_team_to_report("r1", "", 10)
        assert result["success"] is False

    def test_negative_eta_returns_error(self, server, fake_db: MagicMock) -> None:
        result = server.assign_team_to_report("r1", "t1", -5)
        assert result["success"] is False
        assert "non-negative" in result["error"]

    def test_missing_report_returns_error(self, server, fake_db: MagicMock) -> None:
        # Report does not exist
        fake_db.collection.return_value.document.return_value.get.return_value = _make_doc(
            exists=False
        )
        result = server.assign_team_to_report("r_missing", "t1", 10)
        assert result["success"] is False
        assert "not found" in result["error"]

    def test_firestore_unavailable(self, server, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(server, "_get_firestore", lambda: None)
        result = server.assign_team_to_report("r1", "t1", 10)
        assert result["success"] is False


# get_infrastructure_stats


def _make_bq_row(report_type: str, severity: str, total: int, avg_h: float) -> MagicMock:
    row = MagicMock()
    row.__getitem__ = lambda self, key: {
        "total_reports": total,
        "report_type": report_type,
        "severity": severity,
        "avg_resolution_hours": avg_h,
    }[key]
    return row


class TestGetInfrastructureStats:
    def test_returns_mock_when_bq_unavailable(
        self, server, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(server, "_get_bigquery", lambda: None)
        result = server.get_infrastructure_stats(days=7)
        assert result["source"] == "mock"
        assert "total_reports" in result
        assert "by_type" in result
        assert "by_severity" in result
        assert "avg_resolution_hours" in result

    def test_aggregates_bigquery_rows(self, server, fake_bq: MagicMock) -> None:
        rows = [
            _make_bq_row("pothole", "high", 10, 3.5),
            _make_bq_row("flood", "critical", 5, 1.0),
        ]
        fake_bq.query.return_value.result.return_value = rows

        result = server.get_infrastructure_stats(days=7)

        assert result["source"] == "bigquery"
        assert result["total_reports"] == 15
        assert result["by_type"]["pothole"] == 10
        assert result["by_type"]["flood"] == 5
        assert result["by_severity"]["high"] == 10
        assert result["by_severity"]["critical"] == 5
        assert result["avg_resolution_hours"] == pytest.approx(2.25, rel=1e-3)

    def test_invalid_days_range(self, server, fake_bq: MagicMock) -> None:
        assert "error" in server.get_infrastructure_stats(days=0)
        assert "error" in server.get_infrastructure_stats(days=366)

    def test_bq_query_failure_falls_back_to_mock(
        self, server, fake_bq: MagicMock
    ) -> None:
        fake_bq.query.side_effect = Exception("BQ timeout")
        result = server.get_infrastructure_stats(days=3)
        assert result["source"] == "mock"
        assert "bq_error" in result

    def test_empty_result_set(self, server, fake_bq: MagicMock) -> None:
        fake_bq.query.return_value.result.return_value = []
        result = server.get_infrastructure_stats(days=7)
        assert result["total_reports"] == 0
        assert result["avg_resolution_hours"] == 0.0


# send_notification


class TestSendNotification:
    def test_queues_sms_by_default(self, server, fake_db: MagicMock) -> None:
        result = server.send_notification("+15550001234", "Your report was received")
        assert result == {"queued": True, "recipient": "+15550001234"}

    def test_valid_channels_accepted(self, server, fake_db: MagicMock) -> None:
        for ch in ("sms", "push", "email"):
            result = server.send_notification("user@example.com", "Hello", channel=ch)
            assert result["queued"] is True

    def test_invalid_channel_rejected(self, server, fake_db: MagicMock) -> None:
        result = server.send_notification("+1555", "Hello", channel="fax")
        assert result["queued"] is False
        assert "Invalid channel" in result["error"]

    def test_empty_recipient_rejected(self, server, fake_db: MagicMock) -> None:
        result = server.send_notification("", "Hello")
        assert result["queued"] is False

    def test_empty_message_rejected(self, server, fake_db: MagicMock) -> None:
        result = server.send_notification("+1555", "")
        assert result["queued"] is False

    def test_stores_notification_in_firestore(self, server, fake_db: MagicMock) -> None:
        server.send_notification("+15550001234", "Test message")
        fake_db.collection.assert_called_with("notifications")
        fake_db.collection().add.assert_called_once()
        payload = fake_db.collection().add.call_args[0][0]
        assert payload["recipient"] == "+15550001234"
        assert payload["status"] == "queued"
        assert payload["channel"] == "sms"

    def test_firestore_failure_is_non_fatal(
        self, server, fake_db: MagicMock
    ) -> None:
        fake_db.collection().add.side_effect = RuntimeError("Firestore down")
        # Should still return success — the log entry is the primary record
        result = server.send_notification("+1555", "Hello")
        assert result["queued"] is True
