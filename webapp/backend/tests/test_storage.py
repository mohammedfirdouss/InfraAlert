from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed

from infraalert.storage import GcsPhotoStorage, LocalPhotoStorage, PhotoRef

UPLOAD = f"uploads/{'a' * 32}.jpg"
REPORT_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")
CLAIMED = f"reports/{REPORT_ID}/{'a' * 32}.jpg"


# --- LocalPhotoStorage -------------------------------------------------------


@pytest.fixture
def local(tmp_path: Path) -> LocalPhotoStorage:
    return LocalPhotoStorage(tmp_path, "http://localhost:8000")


def test_local_claim_moves_the_file(local: LocalPhotoStorage) -> None:
    local.save(UPLOAD, b"photo")

    assert local.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert not (local.directory / UPLOAD).exists()
    assert (local.directory / CLAIMED).read_bytes() == b"photo"


def test_local_claim_is_idempotent(local: LocalPhotoStorage) -> None:
    local.save(UPLOAD, b"photo")
    local.claim(UPLOAD, REPORT_ID)

    assert local.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert (local.directory / CLAIMED).read_bytes() == b"photo"


def test_local_claim_never_overwrites_an_existing_claim(local: LocalPhotoStorage) -> None:
    local.save(CLAIMED, b"claimed")
    local.save(UPLOAD, b"leftover")

    assert local.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert (local.directory / CLAIMED).read_bytes() == b"claimed"
    assert not (local.directory / UPLOAD).exists()


def test_local_claim_of_missing_upload_is_none(local: LocalPhotoStorage) -> None:
    assert local.claim(UPLOAD, REPORT_ID) is None


@pytest.mark.parametrize(
    "name",
    [
        "../outside.jpg",
        f"uploads/../../{'a' * 32}.jpg",
        f"/etc/{'a' * 32}.jpg",
        f"reports/x/{'a' * 32}.jpg",
        "uploads/not-a-hex-name.jpg",
        f"uploads/{'a' * 32}.exe",
    ],
)
def test_local_claim_rejects_bad_names(local: LocalPhotoStorage, name: str) -> None:
    with pytest.raises(ValueError):
        local.claim(name, REPORT_ID)


def test_local_photo_ref_returns_bytes(local: LocalPhotoStorage) -> None:
    local.save(UPLOAD, b"photo")
    local.claim(UPLOAD, REPORT_ID)

    assert local.photo_ref(CLAIMED, "image/jpeg") == PhotoRef("image/jpeg", data=b"photo")


def test_local_photo_ref_rejects_traversal(local: LocalPhotoStorage) -> None:
    with pytest.raises(ValueError):
        local.photo_ref("../secret", "image/jpeg")


# --- GcsPhotoStorage with an in-memory fake ------------------------------------


class FakeBlob:
    def __init__(self, bucket: FakeBucket, name: str) -> None:
        self.bucket = bucket
        self.name = name

    def exists(self) -> bool:
        return self.name in self.bucket.objects

    def delete(self) -> None:
        if self.name not in self.bucket.objects:
            raise NotFound(self.name)
        del self.bucket.objects[self.name]


class FakeBucket:
    def __init__(self, name: str) -> None:
        self.name = name
        self.objects: dict[str, bytes] = {}
        self.copies = 0

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self, name)

    def copy_blob(
        self,
        blob: FakeBlob,
        destination_bucket: FakeBucket,
        new_name: str,
        if_generation_match: int | None = None,
    ) -> FakeBlob:
        if blob.name not in self.objects:
            raise NotFound(blob.name)
        if if_generation_match == 0 and new_name in destination_bucket.objects:
            raise PreconditionFailed(new_name)
        self.copies += 1
        destination_bucket.objects[new_name] = self.objects[blob.name]
        return destination_bucket.blob(new_name)


class FakeClient:
    def __init__(self) -> None:
        self.buckets: dict[str, FakeBucket] = {}

    def bucket(self, name: str) -> FakeBucket:
        return self.buckets.setdefault(name, FakeBucket(name))


@pytest.fixture
def bucket() -> FakeBucket:
    return FakeBucket("photos")


@pytest.fixture
def gcs(bucket: FakeBucket) -> GcsPhotoStorage:
    client: Any = FakeClient()
    client.buckets["photos"] = bucket
    return GcsPhotoStorage("photos", client=client)


def test_gcs_claim_copies_then_deletes(gcs: GcsPhotoStorage, bucket: FakeBucket) -> None:
    bucket.objects[UPLOAD] = b"photo"

    assert gcs.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert bucket.objects == {CLAIMED: b"photo"}


def test_gcs_retry_after_copy_but_before_delete(gcs: GcsPhotoStorage, bucket: FakeBucket) -> None:
    bucket.objects[UPLOAD] = b"photo"
    bucket.objects[CLAIMED] = b"photo"

    assert gcs.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert bucket.objects == {CLAIMED: b"photo"}
    assert bucket.copies == 0


def test_gcs_retry_after_copy_and_delete(gcs: GcsPhotoStorage, bucket: FakeBucket) -> None:
    bucket.objects[CLAIMED] = b"photo"

    assert gcs.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert bucket.objects == {CLAIMED: b"photo"}


def test_gcs_claim_of_missing_upload_is_none(gcs: GcsPhotoStorage, bucket: FakeBucket) -> None:
    assert gcs.claim(UPLOAD, REPORT_ID) is None
    assert bucket.objects == {}


def test_gcs_destination_precondition_never_overwrites(
    gcs: GcsPhotoStorage, bucket: FakeBucket
) -> None:
    bucket.objects[UPLOAD] = b"new"
    bucket.objects[CLAIMED] = b"original"

    assert gcs.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert bucket.objects == {CLAIMED: b"original"}


def test_gcs_source_vanishes_during_concurrent_claim(
    gcs: GcsPhotoStorage, bucket: FakeBucket, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Between our exists() and copy, another worker finishes the whole move."""
    bucket.objects[UPLOAD] = b"photo"
    real_copy = bucket.copy_blob

    def racing_copy(blob: FakeBlob, dest: FakeBucket, new_name: str, **kw: Any) -> FakeBlob:
        real_copy(blob, dest, new_name, **kw)
        del bucket.objects[UPLOAD]
        return real_copy(blob, dest, new_name, **kw)  # raises NotFound

    monkeypatch.setattr(bucket, "copy_blob", racing_copy)

    assert gcs.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert bucket.objects == {CLAIMED: b"photo"}


def test_gcs_source_deleted_concurrently_before_our_delete(
    gcs: GcsPhotoStorage, bucket: FakeBucket, monkeypatch: pytest.MonkeyPatch
) -> None:
    bucket.objects[UPLOAD] = b"photo"
    real_copy = bucket.copy_blob

    def copy_then_other_worker_deletes(
        blob: FakeBlob, dest: FakeBucket, new_name: str, **kw: Any
    ) -> FakeBlob:
        result = real_copy(blob, dest, new_name, **kw)
        del bucket.objects[UPLOAD]
        return result

    monkeypatch.setattr(bucket, "copy_blob", copy_then_other_worker_deletes)

    assert gcs.claim(UPLOAD, REPORT_ID) == CLAIMED
    assert bucket.objects == {CLAIMED: b"photo"}


@pytest.mark.parametrize("name", ["../x.jpg", CLAIMED, "uploads/nope.jpg"])
def test_gcs_claim_rejects_non_upload_names(gcs: GcsPhotoStorage, name: str) -> None:
    with pytest.raises(ValueError):
        gcs.claim(name, REPORT_ID)


def test_gcs_photo_ref_is_a_gs_uri(gcs: GcsPhotoStorage) -> None:
    assert gcs.photo_ref(CLAIMED, "image/jpeg") == PhotoRef(
        "image/jpeg", gcs_uri=f"gs://photos/{CLAIMED}"
    )
