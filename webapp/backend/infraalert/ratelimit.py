"""
Per-client submission limits for anonymous reports (ADR 0007).

Clients are identified by an HMAC of their IP, stored on the report as
`submitter_key`, so raw IPs are never persisted.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.requests import Request

from infraalert.db.models import Report

WINDOW = timedelta(hours=1)


def client_ip(request: Request, trusted_proxy_hops: int) -> str | None:
    """
    The client's IP as seen by the last trusted proxy. Entries further left in
    X-Forwarded-For are supplied by the client and can be forged.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        index = len(hops) - 1 - trusted_proxy_hops
        if 0 <= index < len(hops):
            return hops[index]
    return request.client.host if request.client else None


def submitter_key(ip: str | None, secret: str) -> str | None:
    if ip is None:
        return None
    return hmac.new(secret.encode(), ip.encode(), hashlib.sha256).hexdigest()


def over_limit(session: Session, key: str | None, limit: int) -> bool:
    if key is None:
        return False
    recent = session.scalar(
        select(func.count())
        .select_from(Report)
        .where(Report.submitter_key == key, Report.submitted_at > func.now() - WINDOW)
    )
    return (recent or 0) >= limit
