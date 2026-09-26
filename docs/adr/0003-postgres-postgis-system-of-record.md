---
status: accepted
---

# Cloud SQL Postgres + PostGIS as the single system of record

Reports used to live in three Firestore writers, an in-memory dict and BigQuery. We picked Cloud SQL Postgres with PostGIS as the single store, and only the monolith's data layer writes to it. Dispatch is relational and geographic at its core. Postgres handles "assign this team only if still available" as one conditional update in a transaction, and "nearest team" or "open incident within 100m" as a PostGIS query. At city scale, plain SQL covers the stats too.

## Considered Options

- **Firestore**: serverless and cheap, with real-time listeners. But filtering on several fields, aggregates and geo queries are awkward, and preventing double-booking needs clunky transactions.
- **Firestore + BigQuery**: two stores to keep consistent, with no analytics needs yet that justify it.

## Consequences

- BigQuery is dropped. If analysts need it later, add it as a scheduled export.
- Every report must carry coordinates (lat/lng). The citizen form captures them via geolocation and a draggable pin, and they are required. Free-text addresses are for display only and are never geocoded on the server.
- Status updates reach the UI by polling, not by push.
- Schema changes go through migrations (Alembic).
