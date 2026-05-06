
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

# Install dependencies first (better layer caching)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# Copy source and build production bundle
COPY frontend/ .
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

# Install uv and project dependencies
COPY backend/pyproject.toml .
RUN pip install --no-cache-dir uv && \
    uv pip install --system --no-cache -e .

# Copy backend source
COPY backend/ .

# Copy built frontend assets from builder stage.
# FastAPI mounts ../frontend/dist relative to main.py, which lives at /app.
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Run as non-root for security
RUN adduser --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
