"""
Orchestrator Agent — Flask HTTP server.
Exposes POST /process-report, GET /health, and GET /status/<report_id>.
"""
from __future__ import annotations

import os
import sys
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, request

from pipeline import InfraAlertPipeline
from shared.utils import generate_report_id, setup_logging

logger = setup_logging("orchestrator.app")
app = Flask(__name__)

_pipeline = InfraAlertPipeline()

_report_store: dict[str, dict] = {}
_store_lock = threading.Lock()


def _store_report(report: dict) -> None:
    with _store_lock:
        _report_store[report["report_id"]] = report


def _get_report(report_id: str) -> dict | None:
    with _store_lock:
        return _report_store.get(report_id)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "orchestrator"}), 200


@app.route("/process-report", methods=["POST"])
def process_report():
    body = request.get_json(silent=True) or {}

    description = body.get("description", "").strip()
    location = body.get("location", "").strip()
    media_urls = body.get("media_urls", [])
    citizen_phone = body.get("citizen_phone", "").strip() or None

    if not description:
        return jsonify({"error": "description is required"}), 400
    if not location:
        return jsonify({"error": "location is required"}), 400

    report_id = generate_report_id()
    logger.info("Processing new report %s from location '%s'", report_id, location)

    initial = {
        "report_id": report_id,
        "description": description,
        "location": location,
        "media_urls": media_urls,
        "citizen_phone": citizen_phone or "",
        "status": "pending",
    }
    _store_report(initial)

    try:
        report = _pipeline.run(
            description=description,
            location=location,
            media_urls=media_urls,
            citizen_phone=citizen_phone,
            report_id=report_id,
        )
    except Exception as exc:
        logger.error("Pipeline error for report %s: %s", report_id, exc)
        return jsonify({"error": "Pipeline processing failed", "report_id": report_id}), 500

    public_report = {k: v for k, v in report.items() if not k.startswith("_")}
    _store_report(public_report)

    logger.info(
        "Report %s complete — status=%s type=%s severity=%s",
        report_id,
        public_report.get("status"),
        public_report.get("report_type"),
        public_report.get("severity"),
    )
    return jsonify(public_report), 200


@app.route("/status/<report_id>", methods=["GET"])
def get_status(report_id: str):
    report = _get_report(report_id)
    if report is None:
        return jsonify({"error": f"Report '{report_id}' not found"}), 404
    return jsonify(report), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8085"))
    logger.info("Starting Orchestrator Agent on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
