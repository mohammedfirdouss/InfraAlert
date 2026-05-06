# InfraAlert

InfraAlert is an AI-powered, multi-agent platform for reporting infrastructure issues, analyzing impact, prioritizing response, dispatching teams, and tracking status.

## Project architecture

The system runs as containerized services connected through an orchestrator:

| Service | Port | Purpose |
| --- | --- | --- |
| `mcp-server` | `8080` | Model Context Protocol server used by agents |
| `issue-detection` | `8081` | Detects issue type/severity context from report data |
| `priority-analysis` | `8082` | Computes urgency and priority scores |
| `resource-coordination` | `8083` | Selects/dispatches teams and resources |
| `platform-integration` | `8084` | Sends citizen notifications (logged), updates Firestore, logs to BigQuery |
| `orchestrator` | `8085` | Runs the end-to-end agent pipeline |
| `webapp` | `3000` (container `8000`) | FastAPI backend + React frontend |

Main API entrypoints:

- Web app API: `/api/*` (submit reports, query status/stats)
- Orchestrator: `POST /process-report`, `GET /status/<report_id>`, `GET /health`
- Agent services expose health endpoints and task-specific routes (`/analyze`, `/coordinate`, `/notify`, etc.)

## Local development

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
2. Install development dependencies (uv workspace):
   ```bash
   make install-dev
   ```
3. Start all services with Docker Compose:
   ```bash
   make docker-up
   ```

To stop services:

```bash
make docker-down
```

## Quality checks

```bash
make lint     # ruff
make test     # pytest
make check    # lint + mypy + pytest
```

## Deployment

Cloud Run helper targets are included:

```bash
make setup-gcloud
make deploy-service SERVICE=orchestrator
make deploy-all
```
