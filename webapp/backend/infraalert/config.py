from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not set")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    turnstile_secret_key: str
    # HMAC key for turning client IPs into rate-limit keys; IPs are never stored.
    rate_limit_secret: str
    rate_limit_per_hour: int = 5
    # Proxies that append to X-Forwarded-For after the client's own entry:
    # 0 when Cloud Run is hit directly, 1 behind an external HTTPS load balancer.
    trusted_proxy_hops: int = 0

    storage_backend: Literal["gcs", "local"] = "local"
    gcs_bucket: str | None = None
    local_upload_dir: Path = Path("var/uploads")
    public_base_url: str = "http://localhost:8000"

    # "inline" (local dev) processes reports in a background thread of this process.
    tasks_backend: Literal["inline", "cloud_tasks"] = "inline"
    cloud_tasks_queue: str | None = None  # projects/<p>/locations/<l>/queues/<q>
    # This service's public URL; task targets and token audiences derive from it.
    service_url: str | None = None
    tasks_service_account: str | None = None  # signs the OIDC tokens on task requests

    # "disabled" (local dev) sends every report to human triage.
    extractor_backend: Literal["vertex", "disabled"] = "disabled"
    gcp_project: str | None = None
    gcp_location: str | None = None
    gemini_model: str | None = None

    # "dev" (local development) accepts "dev:<email>" tokens; never in production.
    staff_auth_backend: Literal["identity_platform", "dev"] = "dev"
    # Restrict staff sign-in to one Identity Platform provider, e.g. "oidc.city-sso".
    staff_sign_in_provider: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        storage = _choice("STORAGE_BACKEND", "local", ("gcs", "local"))
        tasks = _choice("TASKS_BACKEND", "inline", ("inline", "cloud_tasks"))
        extractor = _choice("EXTRACTOR_BACKEND", "disabled", ("vertex", "disabled"))
        staff_auth = _choice("STAFF_AUTH_BACKEND", "dev", ("identity_platform", "dev"))
        cloud = tasks == "cloud_tasks"
        vertex = extractor == "vertex"
        if staff_auth == "dev" and cloud:
            raise RuntimeError("STAFF_AUTH_BACKEND=dev is for local development only")
        identity_platform = staff_auth == "identity_platform"
        return cls(
            database_url=_require("DATABASE_URL"),
            turnstile_secret_key=_require("TURNSTILE_SECRET_KEY"),
            rate_limit_secret=_require("RATE_LIMIT_SECRET"),
            rate_limit_per_hour=int(os.getenv("RATE_LIMIT_PER_HOUR", "5")),
            trusted_proxy_hops=int(os.getenv("TRUSTED_PROXY_HOPS", "0")),
            storage_backend=cast(Literal["gcs", "local"], storage),
            gcs_bucket=_require("GCS_BUCKET") if storage == "gcs" else None,
            local_upload_dir=Path(os.getenv("LOCAL_UPLOAD_DIR", "var/uploads")),
            public_base_url=os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
            tasks_backend=cast(Literal["inline", "cloud_tasks"], tasks),
            cloud_tasks_queue=_require("CLOUD_TASKS_QUEUE") if cloud else None,
            service_url=_require("SERVICE_URL").rstrip("/") if cloud else None,
            tasks_service_account=_require("TASKS_SERVICE_ACCOUNT") if cloud else None,
            extractor_backend=cast(Literal["vertex", "disabled"], extractor),
            gcp_project=(
                _require("GOOGLE_CLOUD_PROJECT") if vertex or identity_platform else None
            ),
            gcp_location=_require("GOOGLE_CLOUD_REGION") if vertex else None,
            gemini_model=_require("GEMINI_MODEL") if vertex else None,
            staff_auth_backend=cast(Literal["identity_platform", "dev"], staff_auth),
            staff_sign_in_provider=os.getenv("STAFF_SIGN_IN_PROVIDER") or None,
        )


def _choice(name: str, default: str, allowed: tuple[str, ...]) -> str:
    value = os.getenv(name, default)
    if value not in allowed:
        raise RuntimeError(f"{name} must be one of {allowed}, got {value!r}")
    return value
