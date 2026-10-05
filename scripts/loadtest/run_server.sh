#!/usr/bin/env bash
# Start the API for load testing: one process, no auto-reload, load-test backends.
# Usage: scripts/loadtest/run_server.sh            # plain
#        PROFILE=1 scripts/loadtest/run_server.sh  # under memray (writes var/memray/)
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=scripts/loadtest/loadtest.env
APP=(uvicorn main:app --app-dir webapp/backend --port 8000 --log-level warning)
if [[ "${PROFILE:-}" == "1" ]]; then
  mkdir -p var/memray
  out="var/memray/server-$(date +%Y%m%d-%H%M%S).bin"
  echo "memray capture -> $out"
  exec uv run --env-file "$ENV_FILE" --with memray memray run --follow-fork -o "$out" -m "${APP[@]}"
fi
exec uv run --env-file "$ENV_FILE" "${APP[@]}"
