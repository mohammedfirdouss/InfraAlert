"""
Photo storage (ADR 0008). Browsers upload straight to a private bucket through
short-lived signed URLs; the API only ever hands out URLs and records object names.

New uploads land under `uploads/`. Unclaimed objects there are expected to be
removed by a bucket lifecycle rule; the processing worker claims the ones a
report references.
"""

from __future__ import annotations

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


def new_upload_object_name(content_type: str) -> str:
    return f"uploads/{uuid.uuid4().hex}.{CONTENT_TYPE_EXTENSIONS[content_type]}"


@dataclass(frozen=True)
class UploadTarget:
    object_name: str
    url: str
    method: str = "PUT"
    # Headers the browser must send exactly as given, or the signature fails.
    headers: dict[str, str] = field(default_factory=dict)


class PhotoStorage(Protocol):
    def upload_target(self, object_name: str, content_type: str) -> UploadTarget: ...


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

    def save(self, object_name: str, data: bytes) -> None:
        path = self.directory / object_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
