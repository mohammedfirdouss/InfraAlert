"""
Priority Analysis Agent — Flask HTTP server.
Exposes POST /analyze and GET /health.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, request

from agent import PriorityAnalysisAgent
from shared.utils import setup_logging

logger = setup_logging("priority_analysis.app")
app = Flask(__name__)

_agent = PriorityAnalysisAgent()


# Routes


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "priority-analysis"}), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    body = request.get_json(silent=True) or {}

    report_type = body.get("report_type", "other")
    description = body.get("description", "").strip()
    location = body.get("location", "").strip()
    analysis = body.get("analysis", "")

    if not description:
        return jsonify({"error": "description is required"}), 400
    if not location:
        return jsonify({"error": "location is required"}), 400

    logger.info(
        "Priority analysis request — type=%s location='%s'",
        report_type,
        location,
    )

    result = _agent.analyze(
        report_type=report_type,
        description=description,
        location=location,
        analysis=analysis,
    )
    return jsonify(result), 200


# Entry point

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8082"))
    logger.info("Starting Priority Analysis Agent on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
