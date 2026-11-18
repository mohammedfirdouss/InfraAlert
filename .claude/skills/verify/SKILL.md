---
name: verify-infraalert
description: How to boot and drive InfraAlert to verify a change end to end. Use with the global verify skill before committing.
---

# Verify InfraAlert

Run everything from the repo root.

## Cheap checks
```bash
uvx ruff check webapp/backend && uvx ruff format --check webapp/backend
uv run --with mypy mypy webapp/backend/infraalert
(cd webapp/frontend && npm run build && npm test)
make db-up && make test-backend        # needs Docker; uses a throwaway database per run
```

## Boot
A scratch database on the local PostGIS server, so development data is left alone.
```bash
ENV=.claude/skills/verify/verify.env
psql() { docker compose exec -T db psql -U infraalert -d "$1" -tAc "$2"; }
psql postgres "DROP DATABASE IF EXISTS infraalert_verify WITH (FORCE)"
psql postgres "CREATE DATABASE infraalert_verify"
(cd webapp/backend && uv run --env-file ../../$ENV alembic upgrade head)
uv run --env-file $ENV python -m infraalert.cli seed-dev
uv run --env-file $ENV uvicorn main:app --app-dir webapp/backend --port 8011 &
# ready when: curl -sf localhost:8011/api/health  ->  {"status":"ok"}
```
The app serves the built frontend from `webapp/frontend/dist`, so build first when the UI changed.

## Drive (main user flows)
1. API flows: `python3 .claude/skills/verify/e2e.py` (set `VERIFY_URL` for another port) → every line `PASS`.
   Covers photo upload and report submission, processing, staff queue, assign/resolve and the
   suggested team on other incidents, team and place permissions, place rescoring, email signup.
2. Staff UI: open `http://localhost:8011/staff`, sign in with a seeded account button
   (dispatcher / supervisor / admin) → queue loads; dispatcher sees Queue and Teams only.
3. Citizen UI: `http://localhost:8011/` → form with map; `/reports/<id>` → status page;
   `/unsubscribe` → must not request `map-*.js`.
4. CLI: `uv run --env-file $ENV python -m infraalert.cli retention` → prints counts, exit 0.
5. Restart: insert a `received` report by SQL while the server is down, start it → the report
   leaves `received` within seconds.
6. Dispatch, team, place or processing changes: hammer assign/resolve/team-edit/place-edit and
   report submission in parallel, then check the server log has no `deadlock` or `Traceback`.

## Teardown
```bash
pkill -f "uvicorn main:app --app-dir webapp/backend --port 8011"
psql postgres "DROP DATABASE IF EXISTS infraalert_verify WITH (FORCE)"
rm -rf var/verify
```

## Gotchas
- Staff auth in dev is a header: `Authorization: Bearer dev:<email>` with `dispatcher@dev.local`,
  `supervisor@dev.local` or `admin@dev.local`.
- `EXTRACTOR_BACKEND=fake` classifies by keyword ("pothole", "leak", "power", …); with `disabled`
  every report goes to triage and has no score or suggestion.
- `/tasks/*` (sweep, notifications, retention, import-osm) is only mounted with
  `TASKS_BACKEND=cloud_tasks`; locally call the functions, or rely on the pytest coverage.
- `uv run --env-file` does not override variables already exported in the shell.
- Reports are rate-limited per client (`X-Forwarded-For`); vary it or raise `RATE_LIMIT_PER_HOUR`.
- Nothing cloud-side (GCS signing, Identity Platform, Cloud Tasks/Scheduler) can be run locally: say so
  under "Not verified".
