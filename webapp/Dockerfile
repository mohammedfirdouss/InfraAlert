# The whole InfraAlert service in one image: the FastAPI backend serving the built
# React frontend. Build from the REPO ROOT so the root .dockerignore applies:
#   docker build -f webapp/Dockerfile .

FROM node:20-slim AS frontend-builder

WORKDIR /frontend

# Install dependencies first (better layer caching)
COPY webapp/frontend/package.json webapp/frontend/package-lock.json ./
RUN npm ci

COPY webapp/frontend/ .

# Frontend settings are baked in at build time (see webapp/frontend/.env.example).
# Empty values fall back to the development defaults in src/config.js.
ARG VITE_MAPTILER_KEY=""
ARG VITE_TURNSTILE_SITE_KEY=""
ARG VITE_MAP_DEFAULT_CENTER=""
ARG VITE_EMERGENCY_NUMBER=""
ARG VITE_STAFF_AUTH=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_STAFF_SIGN_IN_PROVIDER=""
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies only (from pyproject.toml), so code changes don't reinstall them.
COPY webapp/backend/pyproject.toml .
RUN pip install --no-cache-dir uv && \
    uv pip install --system --no-cache -r pyproject.toml

# main.py, alembic.ini, migrations/ and the infraalert package. Run from /app, so
# `uvicorn main:app`, `alembic upgrade head` and `python -m infraalert.cli` all work.
COPY webapp/backend/ .

# FastAPI serves /app/frontend/dist (see infraalert/app.py).
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Run as non-root. var/ is only written with the local storage/email backends.
RUN useradd --create-home --uid 10001 appuser && \
    mkdir -p var && chown appuser:appuser var
USER appuser

EXPOSE 8000

# Cloud Run sets PORT; locally it defaults to 8000.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
