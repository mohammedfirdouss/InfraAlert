"""
Platform Integration Agent — Flask HTTP server.
Exposes POST /notify, POST /update-status, and GET /health.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, request

from agent import PlatformIntegrationAgent
from shared.utils import setup_logging

logger = setup_logging("platform_integration.app")
app = Flask(__name__)

_agent = PlatformIntegrationAgent()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "platform-integration"}), 200


@app.route("/notify", methods=["POST"])
def notify():
    body = request.get_json(silent=True) or {}

    report = body.get("report", {})
    event = body.get("event", "").strip()

    if not report:
        return jsonify({"error": "report is required"}), 400
    if not event:
        return jsonify({"error": "event is required"}), 400

    valid_events = {"received", "dispatched", "resolved", "in_progress"}
    if event not in valid_events:
        return (
            jsonify({"error": f"event must be one of: {', '.join(sorted(valid_events))}"}),
            400,
        )

    logger.info(
        "Notification request — report_id=%s event=%s",
        report.get("report_id", "unknown"),
        event,
    )

    result = _agent.process_event(report=report, event=event)
    return jsonify(result), 200


@app.route("/update-status", methods=["POST"])
def update_status():
    body = request.get_json(silent=True) or {}

    report_id = body.get("report_id", "").strip()
    updates = body.get("updates", {})

    if not report_id:
        return jsonify({"error": "report_id is required"}), 400
    if not updates:
        return jsonify({"error": "updates dict is required"}), 400

    logger.info("Status update for report %s: %s", report_id, updates)

    success = _agent.update_firestore(report_id, updates)
    return jsonify({"success": success, "report_id": report_id}), 200


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8084"))
    logger.info("Starting Platform Integration Agent on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
