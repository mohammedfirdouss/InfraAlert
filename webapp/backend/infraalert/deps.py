"""The app's external collaborators, built once and swapped for fakes in tests."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

from infraalert.captcha import CaptchaVerifier, TurnstileVerifier
from infraalert.config import Settings
from infraalert.db.session import make_engine, make_sessionmaker
from infraalert.storage import GcsPhotoStorage, LocalPhotoStorage, PhotoStorage
from infraalert.tasks import CloudTasksQueue, LoggingTaskQueue, TaskQueue


@dataclass
class Deps:
    settings: Settings
    sessions: sessionmaker[Session]
    captcha: CaptchaVerifier
    storage: PhotoStorage
    tasks: TaskQueue


def build_deps(settings: Settings) -> Deps:
    storage: PhotoStorage
    if settings.storage_backend == "gcs":
        assert settings.gcs_bucket
        storage = GcsPhotoStorage(settings.gcs_bucket)
    else:
        storage = LocalPhotoStorage(settings.local_upload_dir, settings.public_base_url)

    tasks: TaskQueue
    if settings.tasks_backend == "cloud_tasks":
        assert settings.cloud_tasks_queue
        assert settings.tasks_target_url
        assert settings.tasks_service_account
        tasks = CloudTasksQueue(
            settings.cloud_tasks_queue, settings.tasks_target_url, settings.tasks_service_account
        )
    else:
        tasks = LoggingTaskQueue()

    return Deps(
        settings=settings,
        sessions=make_sessionmaker(make_engine(settings.database_url)),
        captcha=TurnstileVerifier(settings.turnstile_secret_key),
        storage=storage,
        tasks=tasks,
    )


def get_deps(request: Request) -> Deps:
    deps: Deps = request.app.state.deps
    return deps


def get_session(request: Request) -> Iterator[Session]:
    with get_deps(request).sessions() as session:
        yield session
