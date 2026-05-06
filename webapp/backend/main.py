"""
InfraAlert Web Application — FastAPI Backend
Acts as an API gateway to the orchestrator agent and serves the React frontend.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

ORCHESTRATOR_URL: str = os.getenv("ORCHESTRATOR_URL", "").rstrip("/")
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

app = FastAPI(
    title="InfraAlert API",
    description="AI-powered infrastructure issue reporting system",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic schemas


class ReportRequest(BaseModel):
    description: str = Field(..., min_length=10)
    location: str = Field(..., min_length=3)
    media_urls: list[str] = []
    citizen_phone: str = ""
    issue_type: str = "other"


class ReportResponse(BaseModel):
    report_id: str
    status: str
    message: str
    report_type: Optional[str] = None
    severity: Optional[str] = None
    priority_score: Optional[float] = None
    assigned_team_id: Optional[str] = None
    analysis_notes: Optional[str] = None
    location: str
    description: str
    citizen_phone: str = ""
    media_urls: list[str] = []
    created_at: str
    updated_at: str


class StatsResponse(BaseModel):
    total_reports: int
    resolved_today: int
    active_teams: int
    avg_response_hours: float


# Mock data helpers

_MOCK_REPORTS: list[dict] = [
    {
        "report_id": "RPT-001",
        "status": "resolved",
        "message": "Issue resolved successfully.",
        "report_type": "pothole",
        "severity": "high",
        "priority_score": 8.2,
        "assigned_team_id": "TEAM-ROADS-01",
        "analysis_notes": "Large pothole detected on main road. Immediate repair required.",
        "location": "123 Main Street, Downtown",
        "description": "Large pothole causing traffic hazard near the intersection.",
        "citizen_phone": "",
        "media_urls": [],
        "created_at": "2026-05-05T08:30:00Z",
        "updated_at": "2026-05-05T14:00:00Z",
    },
    {
        "report_id": "RPT-002",
        "status": "in_progress",
        "message": "Team dispatched to location.",
        "report_type": "water_leak",
        "severity": "critical",
        "priority_score": 9.5,
        "assigned_team_id": "TEAM-WATER-02",
        "analysis_notes": "Major water main leak detected. Water utility team en route.",
        "location": "45 Elm Avenue, Westside",
        "description": "Water gushing from broken pipe flooding the street.",
        "citizen_phone": "+254712345678",
        "media_urls": [],
        "created_at": "2026-05-06T06:15:00Z",
        "updated_at": "2026-05-06T07:00:00Z",
    },
    {
        "report_id": "RPT-003",
        "status": "dispatched",
        "message": "Repair team has been dispatched.",
        "report_type": "broken_streetlight",
        "severity": "medium",
        "priority_score": 5.1,
        "assigned_team_id": "TEAM-ELEC-01",
        "analysis_notes": "Streetlight outage on residential road. Safety concern at night.",
        "location": "78 Oak Lane, Northside",
        "description": "Streetlight has been out for three nights creating safety issues.",
        "citizen_phone": "",
        "media_urls": [],
        "created_at": "2026-05-05T20:00:00Z",
        "updated_at": "2026-05-06T05:30:00Z",
    },
    {
        "report_id": "RPT-004",
        "status": "analyzing",
        "message": "AI agents are analyzing the report.",
        "report_type": "sewage",
        "severity": "high",
        "priority_score": 7.8,
        "assigned_team_id": None,
        "analysis_notes": "Sewage overflow detected near residential area. Health risk assessment in progress.",
        "location": "12 River Road, Eastside",
        "description": "Sewage overflowing from manhole cover, strong smell affecting residents.",
        "citizen_phone": "+254798765432",
        "media_urls": [],
        "created_at": "2026-05-06T09:00:00Z",
        "updated_at": "2026-05-06T09:05:00Z",
    },
    {
        "report_id": "RPT-005",
        "status": "pending",
        "message": "Report received and queued for analysis.",
        "report_type": "road_damage",
        "severity": "low",
        "priority_score": 3.2,
        "assigned_team_id": None,
        "analysis_notes": None,
        "location": "200 Park Boulevard, Central",
        "description": "Cracked pavement along the sidewalk near the park entrance.",
        "citizen_phone": "",
        "media_urls": [],
        "created_at": "2026-05-06T10:45:00Z",
        "updated_at": "2026-05-06T10:45:00Z",
    },
]


def _make_mock_report(req: ReportRequest) -> dict:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "report_id": f"RPT-{uuid.uuid4().hex[:6].upper()}",
        "status": "pending",
        "message": "Report received and queued for analysis.",
        "report_type": req.issue_type,
        "severity": None,
        "priority_score": None,
        "assigned_team_id": None,
        "analysis_notes": None,
        "location": req.location,
        "description": req.description,
        "citizen_phone": req.citizen_phone,
        "media_urls": req.media_urls,
        "created_at": now,
        "updated_at": now,
    }


# API routes


@app.get("/api/health")
async def health():
    """Health check including orchestrator connectivity."""
    orchestrator_status = "not_configured"
    if ORCHESTRATOR_URL:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{ORCHESTRATOR_URL}/health")
                orchestrator_status = "ok" if r.status_code == 200 else "degraded"
        except Exception:
            orchestrator_status = "unreachable"
    return {
        "status": "ok",
        "version": "0.1.0",
        "orchestrator": orchestrator_status,
    }


@app.get("/api/stats", response_model=StatsResponse)
async def get_stats():
    """Return infrastructure statistics (real or mock)."""
    if ORCHESTRATOR_URL:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{ORCHESTRATOR_URL}/stats")
                if r.status_code == 200:
                    return r.json()
        except Exception:
            pass

    # Mock stats
    return StatsResponse(
        total_reports=247,
        resolved_today=18,
        active_teams=12,
        avg_response_hours=2.4,
    )


@app.get("/api/reports")
async def list_reports():
    """List reports — forwards to orchestrator or returns mock data."""
    if ORCHESTRATOR_URL:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{ORCHESTRATOR_URL}/reports")
                if r.status_code == 200:
                    return r.json()
        except Exception:
            pass

    return {"reports": _MOCK_REPORTS}


@app.get("/api/reports/{report_id}", response_model=ReportResponse)
async def get_report(report_id: str):
    """Get report status — forwards to orchestrator or searches mock data."""
    if ORCHESTRATOR_URL:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{ORCHESTRATOR_URL}/status/{report_id}")
                if r.status_code == 200:
                    return r.json()
                if r.status_code == 404:
                    raise HTTPException(status_code=404, detail="Report not found")
        except HTTPException:
            raise
        except Exception:
            pass

    # Search mock data
    for report in _MOCK_REPORTS:
        if report["report_id"] == report_id:
            return report

    raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found")


@app.post("/api/reports", response_model=ReportResponse, status_code=201)
async def submit_report(req: ReportRequest):
    """Submit a new infrastructure report."""
    if ORCHESTRATOR_URL:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                payload = {
                    "description": req.description,
                    "location": req.location,
                    "media_urls": req.media_urls,
                    "citizen_phone": req.citizen_phone,
                }
                r = await client.post(
                    f"{ORCHESTRATOR_URL}/process-report", json=payload
                )
                r.raise_for_status()
                data = r.json()
                # Orchestrator returns AgentResponse with nested `report`
                if "report" in data:
                    return data["report"]
                return data
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Orchestrator error: {exc.response.status_code}",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Orchestrator unreachable: {exc}",
            ) from exc

    # Development mock: simulate pipeline result
    mock = _make_mock_report(req)
    return mock


@app.post("/api/reports/{report_id}/voice")
async def voice_report(report_id: str, file: UploadFile = File(...)):
    """
    Accept a voice/audio report upload.

    Real implementation would send the audio to Google Speech-to-Text for
    transcription, then pass the resulting text to the orchestrator.
    This endpoint currently returns a mock transcription for development.
    """
    content = await file.read()
    size_kb = len(content) / 1024

    # NOTE: Real implementation would call Google Speech-to-Text API here:
    #   from google.cloud import speech
    #   client = speech.SpeechClient()
    #   audio = speech.RecognitionAudio(content=content)
    #   config = speech.RecognitionConfig(language_code="en-US")
    #   response = client.recognize(config=config, audio=audio)
    #   transcript = response.results[0].alternatives[0].transcript

    return {
        "report_id": report_id,
        "filename": file.filename,
        "content_type": file.content_type,
        "size_kb": round(size_kb, 2),
        "transcript": "Mock transcription: There is a large pothole on Main Street near the bus stop.",
        "confidence": 0.95,
        "note": "Real transcription requires Google Speech-to-Text API (GOOGLE_APPLICATION_CREDENTIALS must be set).",
    }


# Serve React frontend (production)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve the React SPA for all non-API routes."""
        requested = FRONTEND_DIST / full_path
        if requested.is_file():
            return FileResponse(str(requested))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
