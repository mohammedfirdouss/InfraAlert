FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy pyproject.toml first for dependency layer caching
COPY platform_integration/pyproject.toml ./pyproject.toml

# Install dependencies
RUN uv pip install --system --no-cache \
        "flask>=3.0.0" \
        "google-cloud-firestore>=2.16.0" \
        "google-cloud-bigquery>=3.18.0" \
        "pydantic>=2.6.0" \
        "python-dotenv>=1.0.0" \
        "requests>=2.31.0"

# Copy shared utilities and agent source
COPY shared/ ./shared/
COPY platform_integration/agent.py ./agent.py
COPY platform_integration/app.py ./app.py

EXPOSE 8084

ENV PORT=8084

CMD ["python", "app.py"]
