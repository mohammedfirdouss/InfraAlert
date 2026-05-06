"""
Issue Detection Agent — Flask HTTP server.
Exposes POST /analyze and GET /health.
"""
from __future__ import annotations

import os
import sys

# Ensure shared package is importable.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify, request

from agent import IssueDetectionAgent
from shared.utils import setup_logging

logger = setup_logging("issue_detection.app")
app = Flask(__name__)

_agent = IssueDetectionAgent()


# Routes


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "issue-detection"}), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    body = request.get_json(silent=True) or {}

    description = body.get("description", "").strip()
    location = body.get("location", "").strip()
    media_urls = body.get("media_urls", [])
    report_id = body.get("report_id", "unknown")

    if not description:
        return jsonify({"error": "description is required"}), 400
    if not location:
        return jsonify({"error": "location is required"}), 400

    logger.info("Analyzing report %s from location '%s'", report_id, location)

    result = _agent.analyze(
        description=description,
        location=location,
        media_urls=media_urls,
        report_id=report_id,
    )
    return jsonify(result), 200


# Entry point

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8081"))
    logger.info("Starting Issue Detection Agent on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
