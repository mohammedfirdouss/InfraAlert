from __future__ import annotations

import pytest

from infraalert.config import Settings

PRODUCTION_ENV = {
    "DATABASE_URL": "postgresql+psycopg://u:p@db/infraalert",
    "TURNSTILE_SECRET_KEY": "secret",
    "RATE_LIMIT_SECRET": "secret",
    "TASKS_BACKEND": "cloud_tasks",
    "CLOUD_TASKS_QUEUE": "projects/p/locations/l/queues/q",
    "SERVICE_URL": "https://infraalert.example",
    "TASKS_SERVICE_ACCOUNT": "tasks@p.iam.gserviceaccount.com",
    "STAFF_AUTH_BACKEND": "identity_platform",
    "GOOGLE_CLOUD_PROJECT": "p",
}


def set_env(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name in (*PRODUCTION_ENV, "EXTRACTOR_BACKEND", "CAPTCHA_BACKEND"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)


@pytest.mark.parametrize(
    ("name", "value"), [("EXTRACTOR_BACKEND", "fake"), ("CAPTCHA_BACKEND", "disabled")]
)
def test_load_test_backends_refuse_production(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    set_env(monkeypatch, {**PRODUCTION_ENV, name: value})
    with pytest.raises(RuntimeError, match="load testing only"):
        Settings.from_env()


def test_disabled_captcha_needs_no_turnstile_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(
        monkeypatch,
        {
            "DATABASE_URL": "postgresql+psycopg://u:p@localhost/infraalert",
            "RATE_LIMIT_SECRET": "secret",
            "CAPTCHA_BACKEND": "disabled",
            "EXTRACTOR_BACKEND": "fake",
        },
    )
    settings = Settings.from_env()
    assert settings.captcha_backend == "disabled"
    assert settings.extractor_backend == "fake"
