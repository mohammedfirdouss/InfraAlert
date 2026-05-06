FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy pyproject.toml first for dependency layer caching
COPY issue_detection/pyproject.toml ./pyproject.toml

# Install dependencies
RUN uv pip install --system --no-cache \
        "flask>=3.0.0" \
        "google-adk>=0.5.0" \
        "google-cloud-vision>=3.7.0" \
        "google-cloud-speech>=2.26.0" \
        "google-cloud-language>=2.13.0" \
        "google-generativeai>=0.7.0" \
        "pydantic>=2.6.0" \
        "python-dotenv>=1.0.0" \
        "requests>=2.31.0"

# Copy shared utilities and agent source
COPY shared/ ./shared/
COPY issue_detection/agent.py ./agent.py
COPY issue_detection/app.py ./app.py

EXPOSE 8081

ENV PORT=8081

CMD ["python", "app.py"]
