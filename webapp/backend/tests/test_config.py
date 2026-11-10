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
    "PUBLIC_BASE_URL": "https://infraalert.example",
}

POOL_ENV = ("DB_POOL_SIZE", "DB_MAX_OVERFLOW", "DB_POOL_TIMEOUT")


def set_env(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name in (*PRODUCTION_ENV, "EXTRACTOR_BACKEND", "CAPTCHA_BACKEND", *POOL_ENV):
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


def test_production_requires_a_public_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    env = {k: v for k, v in PRODUCTION_ENV.items() if k != "PUBLIC_BASE_URL"}
    set_env(monkeypatch, env)
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="PUBLIC_BASE_URL is not set"):
        Settings.from_env()

    set_env(monkeypatch, PRODUCTION_ENV)
    assert Settings.from_env().public_base_url == "https://infraalert.example"


def test_database_pool_settings_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    set_env(monkeypatch, PRODUCTION_ENV)
    defaults = Settings.from_env()
    assert (defaults.db_pool_size, defaults.db_max_overflow, defaults.db_pool_timeout) == (
        34,
        6,
        10.0,
    )

    set_env(
        monkeypatch,
        {**PRODUCTION_ENV, "DB_POOL_SIZE": "5", "DB_MAX_OVERFLOW": "10", "DB_POOL_TIMEOUT": "30"},
    )
    custom = Settings.from_env()
    assert (custom.db_pool_size, custom.db_max_overflow, custom.db_pool_timeout) == (5, 10, 30.0)
