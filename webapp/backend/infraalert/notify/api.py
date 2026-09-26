"""
Citizen email updates (ADR 0007): subscribe, verify, unsubscribe.
Contract: webapp/frontend/src/api/client.js.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from infraalert.captcha import CaptchaResult
from infraalert.deps import Deps, get_deps, get_session
from infraalert.notify import subscriptions
from infraalert.notify.emails import verification_email
from infraalert.notify.tokens import MAX_EMAIL_LENGTH, normalise_email
from infraalert.ratelimit import client_ip, submitter_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["citizen-updates"])

DepsDep = Annotated[Deps, Depends(get_deps)]
SessionDep = Annotated[Session, Depends(get_session)]


class SubscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(max_length=MAX_EMAIL_LENGTH + 64)  # before trimming
    captcha_token: str = Field(min_length=1, max_length=2048)

    @field_validator("email")
    @classmethod
    def _normalise(cls, raw: str) -> str:
        email = normalise_email(raw)
        if email is None:
            raise ValueError("not an email address")
        return email


class SubscribeResponse(BaseModel):
    status: Literal["verification_sent"] = "verification_sent"


class VerifyRequest(BaseModel):
    token: str = Field(min_length=1, max_length=256)


class VerifyResponse(BaseModel):
    status: Literal["subscribed"] = "subscribed"
    email_masked: str


class UnsubscribeRequest(BaseModel):
    token: str = Field(min_length=1, max_length=256)


class UnsubscribeResponse(BaseModel):
    status: Literal["unsubscribed"] = "unsubscribed"


@router.post("/reports/{report_id}/subscribe", status_code=202)
def subscribe(
    report_id: uuid.UUID,
    body: SubscribeRequest,
    request: Request,
    session: SessionDep,
    deps: DepsDep,
) -> SubscribeResponse:
    if deps.mailer is None:
        raise HTTPException(503, detail="email_disabled")
    if not subscriptions.report_exists(session, report_id):
        raise HTTPException(404, detail="report_not_found")

    settings = deps.settings
    ip = client_ip(request, settings.trusted_proxy_hops)
    key = submitter_key(ip, settings.rate_limit_secret)
    if subscriptions.over_limit(session, report_id, key, settings.rate_limit_per_hour):
        raise HTTPException(429, detail="rate_limited", headers={"Retry-After": "3600"})
    # Turnstile being unavailable is accepted, as for reports (infraalert.captcha).
    if deps.captcha.verify(body.captcha_token, ip) is CaptchaResult.FAILED:
        raise HTTPException(400, detail="captcha_failed")

    # Identical for new, known and already-subscribed addresses: nothing is revealed.
    token = subscriptions.start_verification(session, report_id, body.email, key)
    session.commit()
    try:
        deps.mailer.send(
            verification_email(body.email, settings.public_base_url, report_id, token)
        )
    except Exception as exc:
        logger.exception("Failed to send a verification email for report %s", report_id)
        raise HTTPException(503, detail="email_unavailable") from exc
    return SubscribeResponse()


@router.post("/reports/{report_id}/verify")
def verify(report_id: uuid.UUID, body: VerifyRequest, session: SessionDep) -> VerifyResponse:
    masked = subscriptions.verify(session, report_id, body.token)
    if masked is None:
        session.rollback()
        raise HTTPException(400, detail="invalid_or_expired_token")
    session.commit()
    return VerifyResponse(email_masked=masked)


@router.post("/unsubscribe")
def unsubscribe(body: UnsubscribeRequest, session: SessionDep, deps: DepsDep) -> UnsubscribeResponse:
    if not subscriptions.unsubscribe(session, deps.settings.rate_limit_secret, body.token):
        raise HTTPException(400, detail="invalid_token")
    session.commit()
    return UnsubscribeResponse()
