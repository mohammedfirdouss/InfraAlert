#!/usr/bin/env bash
# Reproducible load-test run: fresh database, fresh server, fixed load steps.
# Usage: scripts/loadtest/run_steps.sh <label> [users...]
#   Pool settings come from the environment, e.g. the old SQLAlchemy defaults:
#   DB_POOL_SIZE=5 DB_MAX_OVERFLOW=10 DB_POOL_TIMEOUT=30 scripts/loadtest/run_steps.sh before
# Results: var/loadtest/<label>/u<N>_stats.csv and a summary table on stdout.
set -euo pipefail
cd "$(dirname "$0")/../.."
label=${1:?label}; shift
steps=("${@:-200 400 800 1200}")
read -r -a steps <<< "${steps[*]}"
duration=${DURATION:-45s}
out=var/loadtest/$label
env_file=scripts/loadtest/loadtest.env
mkdir -p "$out"

echo "== resetting database"
docker compose down -v --remove-orphans >/dev/null 2>&1
docker compose up -d --wait db >/dev/null 2>&1
(cd webapp/backend && uv run --env-file "../../$env_file" alembic upgrade head >/dev/null 2>&1)
uv run --env-file "$env_file" python -m infraalert.cli seed-dev >/dev/null

echo "== starting server (pool ${DB_POOL_SIZE:-default}+${DB_MAX_OVERFLOW:-default}, timeout ${DB_POOL_TIMEOUT:-default})"
scripts/loadtest/run_server.sh > "$out/server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null; wait $server 2>/dev/null || true' EXIT
until curl -sf -o /dev/null localhost:8000/docs; do sleep 0.5; done

for u in "${steps[@]}"; do
  echo "== $u users for $duration"
  uvx --from locust locust -f scripts/loadtest/locustfile.py --headless -u "$u" -r 100 \
    -t "$duration" -H http://localhost:8000 --csv "$out/u$u" --only-summary >/dev/null 2>&1 || true
done

python3 - "$out" "${steps[@]}" <<'PY'
import csv, sys
out, steps = sys.argv[1], sys.argv[2:]
print(f"{'users':>5}  {'req/s':>6}  {'POST p50':>8}  {'POST p95':>8}  {'POST p99':>8}  {'fail %':>6}")
for u in steps:
    rows = {r["Name"]: r for r in csv.DictReader(open(f"{out}/u{u}_stats.csv"))}
    agg, post = rows["Aggregated"], rows["POST /api/reports"]
    fail = 100 * int(agg["Failure Count"]) / max(1, int(agg["Request Count"]))
    print(f"{u:>5}  {float(agg['Requests/s']):6.1f}  {post['50%']:>8}  {post['95%']:>8}  {post['99%']:>8}  {fail:6.2f}")
PY
echo "pool timeouts in server log: $(grep -c 'QueuePool limit' "$out/server.log" || true)"
echo "reports left unprocessed: $(docker compose exec -T db psql -U infraalert -tAc "select count(*) from reports where processing = 'received'")"
