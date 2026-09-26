from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from infraalert import dev_uploads
from infraalert.citizen import api as citizen_api
from infraalert.config import Settings
from infraalert.deps import Deps, build_deps
from infraalert.processing import api as processing_api
from infraalert.storage import LocalPhotoStorage

# The built frontend: next to the backend in the Docker image (/app/frontend/dist),
# or in webapp/frontend/dist when running from the repo.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIST_CANDIDATES = [
    _BACKEND_DIR / "frontend" / "dist",
    _BACKEND_DIR.parent / "frontend" / "dist",
]


def create_app(deps: Deps | None = None) -> FastAPI:
    deps = deps or build_deps(Settings.from_env())

    app = FastAPI(title="InfraAlert API", version="0.2.0")
    app.state.deps = deps
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        with deps.sessions() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(citizen_api.router)
    if deps.task_auth is not None:
        app.include_router(processing_api.router)
    if isinstance(deps.storage, LocalPhotoStorage):
        app.include_router(dev_uploads.router)

    dist = next((d for d in FRONTEND_DIST_CANDIDATES if d.is_dir()), None)
    if dist is not None:
        _serve_spa(app, dist)
    return app


def _serve_spa(app: FastAPI, dist: Path) -> None:
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path.startswith(("api/", "dev/")):
            raise HTTPException(404)
        requested = (dist / full_path).resolve()
        if requested.is_file() and requested.is_relative_to(dist.resolve()):
            return FileResponse(requested)
        return FileResponse(dist / "index.html")
