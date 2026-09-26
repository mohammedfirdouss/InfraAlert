from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


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

    tasks_backend: Literal["log", "cloud_tasks"] = "log"
    cloud_tasks_queue: str | None = None  # projects/<p>/locations/<l>/queues/<q>
    tasks_target_url: str | None = None  # https://<service>/tasks/process-report
    tasks_service_account: str | None = None  # signs the OIDC token Cloud Tasks sends

    @classmethod
    def from_env(cls) -> Settings:
        storage = os.getenv("STORAGE_BACKEND", "local")
        tasks = os.getenv("TASKS_BACKEND", "log")
        if storage not in ("gcs", "local"):
            raise RuntimeError(f"STORAGE_BACKEND must be 'gcs' or 'local', got {storage!r}")
        if tasks not in ("log", "cloud_tasks"):
            raise RuntimeError(f"TASKS_BACKEND must be 'log' or 'cloud_tasks', got {tasks!r}")
        return cls(
            database_url=_require("DATABASE_URL"),
            turnstile_secret_key=_require("TURNSTILE_SECRET_KEY"),
            rate_limit_secret=_require("RATE_LIMIT_SECRET"),
            rate_limit_per_hour=int(os.getenv("RATE_LIMIT_PER_HOUR", "5")),
            trusted_proxy_hops=int(os.getenv("TRUSTED_PROXY_HOPS", "0")),
            storage_backend=storage,
            gcs_bucket=_require("GCS_BUCKET") if storage == "gcs" else None,
            local_upload_dir=Path(os.getenv("LOCAL_UPLOAD_DIR", "var/uploads")),
            public_base_url=os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
            tasks_backend=tasks,
            cloud_tasks_queue=_require("CLOUD_TASKS_QUEUE") if tasks == "cloud_tasks" else None,
            tasks_target_url=_require("TASKS_TARGET_URL") if tasks == "cloud_tasks" else None,
            tasks_service_account=(
                _require("TASKS_SERVICE_ACCOUNT") if tasks == "cloud_tasks" else None
            ),
        )
