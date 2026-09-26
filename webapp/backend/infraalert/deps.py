"""The app's external collaborators, built once and swapped for fakes in tests."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

from infraalert.captcha import CaptchaVerifier, TurnstileVerifier
from infraalert.config import Settings
from infraalert.db.session import make_engine, make_sessionmaker
from infraalert.processing.auth import GoogleOidcVerifier, TaskCallerVerifier
from infraalert.processing.extraction import DisabledExtractor, Extractor, VertexExtractor
from infraalert.processing.worker import Processor
from infraalert.staff.identity import (
    DevVerifier,
    IdentityPlatformVerifier,
    StaffTokenVerifier,
)
from infraalert.storage import GcsPhotoStorage, LocalPhotoStorage, PhotoStorage
from infraalert.tasks import CloudTasksQueue, InlineTaskQueue, TaskQueue


@dataclass
class Deps:
    settings: Settings
    sessions: sessionmaker[Session]
    captcha: CaptchaVerifier
    storage: PhotoStorage
    tasks: TaskQueue
    processor: Processor | None = None
    # Set only when tasks arrive over HTTP (TASKS_BACKEND=cloud_tasks).
    task_auth: TaskCallerVerifier | None = None
    staff_auth: StaffTokenVerifier | None = None


def build_deps(settings: Settings) -> Deps:
    storage: PhotoStorage
    if settings.storage_backend == "gcs":
        assert settings.gcs_bucket
        storage = GcsPhotoStorage(settings.gcs_bucket)
    else:
        storage = LocalPhotoStorage(settings.local_upload_dir, settings.public_base_url)

    extractor: Extractor
    if settings.extractor_backend == "vertex":
        assert settings.gcp_project and settings.gcp_location and settings.gemini_model
        extractor = VertexExtractor(
            settings.gcp_project, settings.gcp_location, settings.gemini_model
        )
    else:
        extractor = DisabledExtractor()

    sessions = make_sessionmaker(make_engine(settings.database_url))
    processor = Processor(sessions=sessions, storage=storage, extractor=extractor)

    tasks: TaskQueue
    task_auth: TaskCallerVerifier | None = None
    if settings.tasks_backend == "cloud_tasks":
        assert settings.cloud_tasks_queue and settings.service_url
        assert settings.tasks_service_account
        tasks = CloudTasksQueue(
            settings.cloud_tasks_queue, settings.service_url, settings.tasks_service_account
        )
        task_auth = GoogleOidcVerifier(settings.tasks_service_account)
    else:
        tasks = InlineTaskQueue(processor.process)

    staff_auth: StaffTokenVerifier
    if settings.staff_auth_backend == "identity_platform":
        assert settings.gcp_project
        staff_auth = IdentityPlatformVerifier(
            settings.gcp_project, settings.staff_sign_in_provider
        )
    else:
        staff_auth = DevVerifier()

    return Deps(
        settings=settings,
        sessions=sessions,
        captcha=TurnstileVerifier(settings.turnstile_secret_key),
        storage=storage,
        tasks=tasks,
        processor=processor,
        task_auth=task_auth,
        staff_auth=staff_auth,
    )


def get_deps(request: Request) -> Deps:
    deps: Deps = request.app.state.deps
    return deps


def get_session(request: Request) -> Iterator[Session]:
    with get_deps(request).sessions() as session:
        yield session
