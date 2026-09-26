"""
Stand-ins for signed bucket uploads and downloads during local development. Mounted only when
STORAGE_BACKEND=local; production uploads never touch the app (ADR 0008).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from infraalert.deps import get_deps
from infraalert.storage import (
    CONTENT_TYPE_EXTENSIONS,
    MAX_PHOTO_BYTES,
    UPLOAD_OBJECT_NAME,
    LocalPhotoStorage,
)

router = APIRouter(prefix="/dev", include_in_schema=False)


@router.put("/uploads/{object_name:path}", status_code=200)
async def put_upload(object_name: str, request: Request) -> Response:
    storage = get_deps(request).storage
    assert isinstance(storage, LocalPhotoStorage)

    if not UPLOAD_OBJECT_NAME.match(object_name):
        raise HTTPException(404)
    content_type = request.headers.get("content-type", "")
    if CONTENT_TYPE_EXTENSIONS.get(content_type) != object_name.rsplit(".", 1)[-1]:
        raise HTTPException(403, detail="content type does not match the signed upload")

    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413)
    storage.save(object_name, bytes(data))
    return Response(status_code=200)


@router.get("/files/{object_name:path}")
def get_file(object_name: str, expires: int, signature: str, request: Request) -> FileResponse:
    """Stand-in for signed GCS view URLs (see LocalPhotoStorage.view_url)."""
    storage = get_deps(request).storage
    assert isinstance(storage, LocalPhotoStorage)
    try:
        path = storage.verified_view_path(object_name, expires, signature)
    except ValueError:
        path = None
    if path is None:
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "private, max-age=600"})
