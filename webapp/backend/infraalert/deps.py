"""The app's external collaborators, built once and swapped for fakes in tests."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

from infraalert.captcha import CaptchaVerifier, DisabledVerifier, TurnstileVerifier
from infraalert.config import Settings
from infraalert.db.models import Report, ReportProcessing
from infraalert.db.session import make_engine, make_sessionmaker
from infraalert.notify.mailer import ConsoleMailer, Mailer, SmtpMailer
from infraalert.processing.auth import GoogleOidcVerifier, TaskCallerVerifier
from infraalert.processing.extraction import (
    DisabledExtractor,
    Extractor,
    FakeExtractor,
    VertexExtractor,
)
from infraalert.processing.worker import Processor
from infraalert.staff.identity import (
    DevVerifier,
    IdentityPlatformVerifier,
    StaffTokenVerifier,
)
from infraalert.storage import GcsPhotoStorage, LocalPhotoStorage, PhotoStorage
from infraalert.tasks import CloudTasksQueue, InlineTaskQueue, TaskQueue

logger = logging.getLogger(__name__)


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
    # None disables citizen email updates.
    mailer: Mailer | None = None


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
    elif settings.extractor_backend == "fake":
        extractor = FakeExtractor()
    else:
        extractor = DisabledExtractor()

    sessions = make_sessionmaker(
        make_engine(
            settings.database_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout,
        )
    )
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
        _resume_unprocessed(sessions, tasks)

    staff_auth: StaffTokenVerifier
    if settings.staff_auth_backend == "identity_platform":
        assert settings.gcp_project
        staff_auth = IdentityPlatformVerifier(settings.gcp_project, settings.staff_sign_in_provider)
    else:
        staff_auth = DevVerifier()

    mailer: Mailer
    if settings.email_backend == "smtp":
        assert settings.smtp_host
        mailer = SmtpMailer(
            settings.smtp_host,
            settings.smtp_port,
            settings.email_from,
            settings.smtp_username,
            settings.smtp_password,
        )
    else:
        mailer = ConsoleMailer(settings.local_outbox_dir, settings.email_from)

    captcha: CaptchaVerifier
    if settings.captcha_backend == "disabled":
        captcha = DisabledVerifier()
    else:
        captcha = TurnstileVerifier(settings.turnstile_secret_key)

    return Deps(
        settings=settings,
        sessions=sessions,
        captcha=captcha,
        storage=storage,
        tasks=tasks,
        processor=processor,
        task_auth=task_auth,
        staff_auth=staff_auth,
        mailer=mailer,
    )


def _resume_unprocessed(sessions: sessionmaker[Session], tasks: TaskQueue) -> None:
    """
    The inline queue lives in memory and there is no sweep in development, so
    reports accepted just before a restart would otherwise stay `received` forever.
    """
    try:
        with sessions() as session:
            waiting = session.scalars(
                select(Report.id)
                .where(Report.processing == ReportProcessing.RECEIVED)
                .order_by(Report.submitted_at)
            ).all()
    except SQLAlchemyError as exc:  # database down or not migrated yet: start anyway
        logger.warning("Could not look for unprocessed reports: %s", type(exc).__name__)
        return
    for report_id in waiting:
        tasks.enqueue_report_processing(report_id)
    if waiting:
        logger.info("Resuming %d unprocessed report(s)", len(waiting))


def get_deps(request: Request) -> Deps:
    deps: Deps = request.app.state.deps
    return deps


def get_session(request: Request) -> Iterator[Session]:
    with get_deps(request).sessions() as session:
        yield session


DepsDep = Annotated[Deps, Depends(get_deps)]
SessionDep = Annotated[Session, Depends(get_session)]
