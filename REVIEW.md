# Review rules

Read from the base branch by the verify skill and verifier agent. Only check items whose trigger matches the diff.
Add an item only when the same kind of bug has happened at least twice and can be spotted from a diff. Remove items that never trigger or keep false-flagging.

## Focus for this codebase
- Reports must never be lost or stuck: accepting one doesn't depend on an external service, and every
  processing step is safe to run twice (ADR 0002).
- The model states facts; code decides priority and a person dispatches (ADR 0004, 0005). Don't move
  decisions into the extraction.
- Citizen contact details and photos are personal data: kept out of logs and the audit log, deleted by
  retention (ADR 0007, 0008).
- Every staff change is audited with the person who made it, and checked against their role on the backend.

## Checklist
| Trigger (visible in diff) | Check | Source |
|---|---|---|
| Stored data / schema / message shape changes | Old records without the new field still load; a migration exists and `test_models_match_migrations` passes | always-on |
| Logging or error messages touched | No secrets, email addresses or report text in output | always-on |
| Code that takes row locks or advisory locks (`with_for_update`, `pg_advisory_xact_lock`, `lock_dispatch`), or updates incidents other than the one being acted on | Locks are taken in the same order everywhere (`lock_dispatch` first); run parallel dispatch + processing and check for deadlocks | audit Nov 2026: lock placement was wrong twice before it was right |
| Photo object names moved, claimed or deleted in `storage.py` / `worker.py` / `retention.py` | After a storage failure part-way through, every `report_photos` row still points at an existing object | audit Nov 2026: give-up path |
| A frontend helper, test stand-in or backend constant copied into a second file | Import the existing one (`src/format.js`, `src/staff/ui.jsx`, `src/test/leafletStandIn.jsx`, `infraalert/geo.py`, `db/models.OPEN_STATUSES`) | audit Nov 2026: many duplicates removed |
| New or changed setting | In `Settings` (`config.py`), `.env.example`, and `docs/deploy.md` if production needs it; frontend `VITE_*` also in the Dockerfile and Makefile `VITE_VARS` | audit Nov 2026 |
