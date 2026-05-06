"""
Resource Coordination Agent — Flask HTTP server.
Exposes POST /coordinate, GET /health, and GET /teams.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, request

from agent import ResourceCoordinationAgent
from shared.utils import setup_logging

logger = setup_logging("resource_coordination.app")
app = Flask(__name__)

_agent = ResourceCoordinationAgent()


# Routes


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "resource-coordination"}), 200


@app.route("/teams", methods=["GET"])
def list_teams():
    teams = _agent.get_available_teams()
    return jsonify({"teams": teams, "count": len(teams)}), 200


@app.route("/coordinate", methods=["POST"])
def coordinate():
    body = request.get_json(silent=True) or {}

    report = body.get("report", {})
    priority_score = float(body.get("priority_score", 0.5))
    severity = body.get("severity", "MEDIUM")

    if not report:
        return jsonify({"error": "report is required"}), 400

    logger.info(
        "Coordination request — report_id=%s severity=%s",
        report.get("report_id", "unknown"),
        severity,
    )

    result = _agent.coordinate(
        report=report,
        priority_score=priority_score,
        severity=severity,
    )
    return jsonify(result), 200


# Entry point

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8083"))
    logger.info("Starting Resource Coordination Agent on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
