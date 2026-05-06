# InfraAlert MCP Server

Model Context Protocol server that exposes infrastructure management tools to AI agents in the InfraAlert system. Built with [FastMCP](https://github.com/jlowin/fastmcp) and backed by Google Cloud Firestore and BigQuery.

## Tools

| Tool | Description |
|---|---|
| `store_report` | Persist a new infrastructure report to Firestore with status `pending` |
| `get_report` | Retrieve a report document by ID |
| `update_report_status` | Transition a report through its lifecycle (`pending → analyzing → dispatched → in_progress → resolved`) |
| `list_available_teams` | List repair teams from Firestore, optionally filtered by type and availability |
| `assign_team_to_report` | Atomically assign a team to a report and mark the team as unavailable |
| `get_infrastructure_stats` | Aggregate report counts and resolution times from BigQuery (falls back to mock data if BigQuery is unavailable) |
| `send_notification` | Queue an SMS / push / email notification for the platform-integration agent to deliver |

A `GET /health` endpoint returns `{"status": "ok", "service": "mcp-server"}` for liveness probes.

## Running locally

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) (or pip)
- A GCP project with Firestore and BigQuery enabled (optional — tools degrade gracefully without credentials)

### Install dependencies

```bash
cd mcp_server
pip install uv
uv pip install --system -e ".[dev]"
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | _(gcloud default)_ | GCP project that hosts Firestore and BigQuery |
| `BIGQUERY_DATASET` | `infraalert` | BigQuery dataset name |
| `BIGQUERY_TABLE` | `reports` | BigQuery table name |

Copy `.env.example` (if present) to `.env` and fill in values, or export the variables directly.

### Start the server

```bash
python app.py
```

The server listens on `http://0.0.0.0:8080` using the streamable-HTTP MCP transport.

### Run tests

```bash
pytest tests/ -v
```

All tests mock GCP clients — no real credentials are required.

## Docker

```bash
docker build -t infra-alert-mcp-server .
docker run -p 8080:8080 \
  -e GCP_PROJECT_ID=my-project \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
  -v /path/to/sa.json:/secrets/sa.json \
  infra-alert-mcp-server
```

## Firestore schema

### `reports` collection

| Field | Type | Description |
|---|---|---|
| `report_id` | string | Unique report identifier |
| `report_type` | string | e.g. pothole, flood, power_outage |
| `location` | string | Human-readable or coordinate string |
| `description` | string | Free-text issue description |
| `severity` | string | low / medium / high / critical |
| `media_urls` | list[string] | Attached image/video URLs |
| `status` | string | Lifecycle status |
| `assigned_team` | string | Team ID (null until dispatched) |
| `estimated_arrival_minutes` | int | ETA set on dispatch |
| `notes` | string | Agent or operator notes |
| `created_at` | ISO-8601 string | UTC creation timestamp |
| `updated_at` | ISO-8601 string | UTC last-update timestamp |

### `teams` collection

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable team name |
| `type` | string | e.g. electrical, plumbing, roads |
| `location` | string | Current base location |
| `available` | bool | Whether the team can accept a job |
| `current_report` | string | Active report ID (null when idle) |

### `notifications` collection

Queued notification records consumed by the platform-integration agent.
