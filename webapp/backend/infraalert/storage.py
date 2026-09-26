"""
Photo storage (ADR 0008). Browsers upload straight to a private bucket through
short-lived signed URLs; the API only ever hands out URLs and records object names.

New uploads land under `uploads/`. Unclaimed objects there are expected to be
removed by a bucket lifecycle rule; the processing worker claims the ones a
report references.
"""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any, Protocol

CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
}
MAX_PHOTO_BYTES = 10 * 1024 * 1024
UPLOAD_URL_TTL = timedelta(minutes=10)
UPLOAD_OBJECT_NAME = re.compile(r"^uploads/[0-9a-f]{32}\.(jpg|png|webp|heic)$")


def _require_upload_name(upload_object_name: str) -> None:
    if not UPLOAD_OBJECT_NAME.fullmatch(upload_object_name):
        raise ValueError(f"not an upload object name: {upload_object_name!r}")


def new_upload_object_name(content_type: str) -> str:
    return f"uploads/{uuid.uuid4().hex}.{CONTENT_TYPE_EXTENSIONS[content_type]}"


@dataclass(frozen=True)
class UploadTarget:
    object_name: str
    url: str
    method: str = "PUT"
    # Headers the browser must send exactly as given, or the signature fails.
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PhotoRef:
    """How the extractor reads one photo: a gs:// URI in production, raw bytes locally."""

    content_type: str
    gcs_uri: str | None = None
    data: bytes | None = None


def claimed_object_name(report_id: uuid.UUID, upload_object_name: str) -> str:
    """Where a claimed photo lives: reports/<report_id>/<file name of the upload>."""
    return f"reports/{report_id}/{upload_object_name.rsplit('/', 1)[-1]}"


class PhotoStorage(Protocol):
    def upload_target(self, object_name: str, content_type: str) -> UploadTarget: ...

    def claim(self, upload_object_name: str, report_id: uuid.UUID) -> str | None:
        """
        Move an upload out of `uploads/` (where unclaimed files expire) to
        claimed_object_name(). Returns the new name, or None if the citizen never
        finished uploading it. Idempotent: if it was already moved, return the
        destination name.
        """
        ...

    def photo_ref(self, object_name: str, content_type: str) -> PhotoRef:
        """A reference the extractor can read, for a claimed object."""
        ...


class GcsPhotoStorage:
    """
    Signs V4 PUT URLs. On Cloud Run there is no private key, so signing goes
    through the IAM signBlob API: the service account needs
    roles/iam.serviceAccountTokenCreator on itself.
    """

    def __init__(self, bucket_name: str, client: Any = None) -> None:
        from google.cloud import storage  # type: ignore[attr-defined]

        self._client = client or storage.Client()
        self._bucket = self._client.bucket(bucket_name)

    def upload_target(self, object_name: str, content_type: str) -> UploadTarget:
        import google.auth
        import google.auth.transport.requests

        credentials, _ = google.auth.default()
        credentials.refresh(google.auth.transport.requests.Request())
        size_header = {"x-goog-content-length-range": f"0,{MAX_PHOTO_BYTES}"}
        url = self._bucket.blob(object_name).generate_signed_url(
            version="v4",
            expiration=UPLOAD_URL_TTL,
            method="PUT",
            content_type=content_type,
            headers=size_header,
            service_account_email=getattr(credentials, "service_account_email", None),
            access_token=credentials.token,
        )
        return UploadTarget(
            object_name=object_name,
            url=url,
            headers={"Content-Type": content_type, **size_header},
        )

    def claim(self, upload_object_name: str, report_id: uuid.UUID) -> str | None:
        """
        Copy then delete (GCS has no atomic move). Every step tolerates a crash or
        a concurrent attempt: the destination is only ever created, never
        overwritten, and a missing source after a copy means someone finished it.
        """
        from google.api_core.exceptions import NotFound, PreconditionFailed

        _require_upload_name(upload_object_name)
        destination = claimed_object_name(report_id, upload_object_name)
        source = self._bucket.blob(upload_object_name)

        if not source.exists():
            return destination if self._bucket.blob(destination).exists() else None
        try:
            self._bucket.copy_blob(source, self._bucket, destination, if_generation_match=0)
        except PreconditionFailed:
            pass  # An earlier or concurrent attempt already created the destination.
        except NotFound:
            # The source vanished between exists() and the copy: a concurrent claim
            # moved it, or the lifecycle rule expired it.
            return destination if self._bucket.blob(destination).exists() else None
        try:
            source.delete()
        except NotFound:
            pass  # A concurrent attempt deleted it first.
        return destination

    def photo_ref(self, object_name: str, content_type: str) -> PhotoRef:
        return PhotoRef(content_type, gcs_uri=f"gs://{self._bucket.name}/{object_name}")


class LocalPhotoStorage:
    """Local development only: uploads go to a dev-only endpoint on this app."""

    def __init__(self, directory: Path, public_base_url: str) -> None:
        self.directory = directory
        self._base_url = public_base_url

    def upload_target(self, object_name: str, content_type: str) -> UploadTarget:
        return UploadTarget(
            object_name=object_name,
            url=f"{self._base_url}/dev/uploads/{object_name}",
            headers={"Content-Type": content_type},
        )

    def _path(self, object_name: str) -> Path:
        root = self.directory.resolve()
        path = (root / object_name).resolve()
        if not path.is_relative_to(root) or path == root:
            raise ValueError(f"object name escapes the storage directory: {object_name!r}")
        return path

    def claim(self, upload_object_name: str, report_id: uuid.UUID) -> str | None:
        source = self._path(upload_object_name)
        _require_upload_name(upload_object_name)
        destination_name = claimed_object_name(report_id, upload_object_name)
        destination = self._path(destination_name)
        destination.parent.mkdir(parents=True, exist_ok=True)

        if destination.exists():
            # Already claimed; never overwrite it, just drop any leftover source.
            source.unlink(missing_ok=True)
            return destination_name
        try:
            os.replace(source, destination)
        except FileNotFoundError:
            return destination_name if destination.exists() else None
        return destination_name

    def photo_ref(self, object_name: str, content_type: str) -> PhotoRef:
        return PhotoRef(content_type, data=self._path(object_name).read_bytes())

    def save(self, object_name: str, data: bytes) -> None:
        path = self.directory / object_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
