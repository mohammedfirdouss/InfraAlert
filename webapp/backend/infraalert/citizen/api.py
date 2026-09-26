from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from infraalert.captcha import CaptchaResult
from infraalert.citizen.service import NewReport, create_report, get_report_view
from infraalert.citizen.status import ReportStatus
from infraalert.db.models import IssueType
from infraalert.deps import Deps, get_deps, get_session
from infraalert.ratelimit import client_ip, over_limit, submitter_key
from infraalert.storage import UPLOAD_OBJECT_NAME, new_upload_object_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["citizen"])

MAX_PHOTOS_PER_REPORT = 3

DepsDep = Annotated[Deps, Depends(get_deps)]
SessionDep = Annotated[Session, Depends(get_session)]


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class SubmitReportRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    description: str = Field(min_length=10, max_length=2000)
    location: Location
    address_text: str | None = Field(default=None, max_length=300)
    photos: list[str] = Field(default_factory=list, max_length=MAX_PHOTOS_PER_REPORT)
    captcha_token: str = Field(min_length=1, max_length=2048)

    @field_validator("photos")
    @classmethod
    def _photos_are_our_uploads(cls, photos: list[str]) -> list[str]:
        if len(set(photos)) != len(photos):
            raise ValueError("photos must not repeat")
        for name in photos:
            if not UPLOAD_OBJECT_NAME.match(name):
                raise ValueError(f"not an upload object name: {name!r}")
        return photos


class SubmitReportResponse(BaseModel):
    report_id: uuid.UUID
    status: ReportStatus


class ReportResponse(BaseModel):
    report_id: uuid.UUID
    status: ReportStatus
    issue_type: IssueType | None
    description: str
    address_text: str | None
    location: Location
    photo_count: int
    submitted_at: datetime
    # Set once someone confirmed email updates, e.g. "a•••@gmail.com" (infraalert.notify).
    updates_email_masked: str | None


class UploadRequest(BaseModel):
    content_type: Literal["image/jpeg", "image/png", "image/webp", "image/heic"]


class UploadResponse(BaseModel):
    object_name: str
    upload_url: str
    method: str
    headers: dict[str, str]


@router.post("/uploads", status_code=201)
def create_upload(body: UploadRequest, deps: DepsDep) -> UploadResponse:
    target = deps.storage.upload_target(
        new_upload_object_name(body.content_type), body.content_type
    )
    return UploadResponse(
        object_name=target.object_name,
        upload_url=target.url,
        method=target.method,
        headers=target.headers,
    )


@router.post("/reports", status_code=202)
def submit_report(
    body: SubmitReportRequest, request: Request, session: SessionDep, deps: DepsDep
) -> SubmitReportResponse:
    settings = deps.settings
    ip = client_ip(request, settings.trusted_proxy_hops)
    key = submitter_key(ip, settings.rate_limit_secret)

    if over_limit(session, key, settings.rate_limit_per_hour):
        raise HTTPException(429, detail="rate_limited", headers={"Retry-After": "3600"})
    if deps.captcha.verify(body.captcha_token, ip) is CaptchaResult.FAILED:
        raise HTTPException(400, detail="captcha_failed")

    new = NewReport(
        description=body.description,
        lat=body.location.lat,
        lng=body.location.lng,
        address_text=body.address_text or None,
        photo_object_names=body.photos,
    )
    try:
        report_id = create_report(session, new, key)
        session.commit()
    except IntegrityError as exc:
        # The only unique value a citizen controls is a photo's object name.
        session.rollback()
        raise HTTPException(409, detail="photo_already_used") from exc

    try:
        deps.tasks.enqueue_report_processing(report_id)
    except Exception:
        # The report is saved; the sweep will pick it up (see infraalert.tasks).
        logger.exception("Failed to enqueue processing for report %s", report_id)

    return SubmitReportResponse(report_id=report_id, status=ReportStatus.RECEIVED)


@router.get("/reports/{report_id}")
def get_report(report_id: uuid.UUID, session: SessionDep) -> ReportResponse:
    view = get_report_view(session, report_id)
    if view is None:
        raise HTTPException(404, detail="report_not_found")
    return ReportResponse(
        report_id=view.id,
        status=view.status,
        issue_type=view.issue_type,
        description=view.description,
        address_text=view.address_text,
        location=Location(lat=view.lat, lng=view.lng),
        photo_count=view.photo_count,
        submitted_at=view.submitted_at,
        updates_email_masked=view.updates_email_masked,
    )
