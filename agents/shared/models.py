from pydantic import BaseModel
from typing import Optional
from enum import Enum


class ReportType(str, Enum):
    POTHOLE = "pothole"
    WATER_LEAK = "water_leak"
    POWER_OUTAGE = "power_outage"
    BROKEN_STREETLIGHT = "broken_streetlight"
    SEWAGE = "sewage"
    ROAD_DAMAGE = "road_damage"
    OTHER = "other"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ReportStatus(str, Enum):
    PENDING = "pending"
    ANALYZING = "analyzing"
    DISPATCHED = "dispatched"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"


class InfraReport(BaseModel):
    report_id: str
    report_type: Optional[ReportType] = None
    description: str
    location: str
    severity: Optional[Severity] = None
    priority_score: Optional[float] = None
    media_urls: list[str] = []
    citizen_phone: Optional[str] = None
    status: ReportStatus = ReportStatus.PENDING
    assigned_team_id: Optional[str] = None
    analysis_notes: Optional[str] = None


class AgentResponse(BaseModel):
    success: bool
    report: InfraReport
    message: str = ""
