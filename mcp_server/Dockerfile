FROM python:3.12-slim

WORKDIR /app

# Install uv and project dependencies before copying source for layer caching
COPY pyproject.toml .
RUN pip install --no-cache-dir uv && \
    uv pip install --system -e .

# Copy application source
COPY . .

EXPOSE 8080

CMD ["python", "app.py"]
