# Load testing and profiling

A reproducible load test of citizen report submission, and what it found.

## Results

Same steps on a fresh database each time: simulated citizens submit a report, then check its status a few times, for 45 seconds per step. One API process, Apple M4 Pro, with locust and PostGIS on the same machine.

| Citizens | Before: req/s | Before: POST p95 | Before: failures | After: req/s | After: POST p95 | After: failures |
|---|---|---|---|---|---|---|
| 200 | 144 | 92 ms | 0% | 145 | 12 ms | 0% |
| 400 | 280 | 120 ms | 0% | 287 | 20 ms | 0% |
| 800 | **36** | 450 ms (p99 30 s) | 1.7% | **519** | 130 ms | **0%** |
| 1,200 | collapsed | — | — | **548** | 690 ms | **0%** |

- **Database pool timeouts:** 452 → 0.
- **Repeatability:** the "after" run was repeated, and both runs agreed within 1% (519 and 519 req/s at 800 citizens). The "before" collapse reproduced in three separate runs (35–36 req/s at 800).
- **Past capacity, the server now plateaus** at about 550 req/s and queues requests (latency rises), instead of collapsing and returning errors.

## What was wrong

**1. A deadlock between FastAPI's worker threads and the database pool (the collapse).**
- Synchronous endpoints run on a 40-thread pool. After an endpoint returns, FastAPI validates its response on that same pool, while the request's database session is still open.
- With more requests in flight than pooled connections (15), this happens:
  - requests that are holding a connection wait for a free thread, while
  - every thread waits for a connection.
- Nothing moves until the pool's 30-second timeout fires.
- **Evidence:**
  - Server CPU dropped to 2% while under full load.
  - Postgres showed all connections "idle in transaction", waiting on the app.
  - A larger pool alone didn't help: still 40 req/s at 800 citizens.
- **Fix:** `infraalert/concurrency.py` lets at most 30 requests run at once and queues the rest in the event loop, where waiting costs neither a thread nor a connection.
  - uvicorn's `--limit-concurrency` is the wrong tool here. It counts open connections, including idle keep-alive ones, and rejected 60–90% of traffic even at loads the server handled fine.

**2. One new thread per report for inline processing.**
- Matching a report to an incident takes a Postgres advisory lock per issue type (ADR 0006), so reports of the same type are processed one at a time.
- Under load, up to 24 threads at once waited on that lock, each holding a connection.
- **Fix:** `InlineTaskQueue` now uses 4 worker threads and a queue, like Cloud Tasks' maximum concurrent dispatches in production.
- **Effect on its own:** throughput at 800 citizens rose from 36 to 70 req/s. That's not enough by itself.

**3. Connection churn, found with [memray](https://github.com/bloomberg/memray).**
- The first pool fix kept only 10 connections open, plus 30 overflow connections. Overflow connections are closed when they're returned.
- memray showed **79% of all allocations (8.8 million) were in psycopg's connection setup.**
- Postgres confirmed it: **371 new connections** during a 40-second run at 400 citizens, against **37** with all 40 kept open.
- **Fix:** `infraalert/db/session.py` keeps 34 connections open (30 requests + 4 workers), with 6 overflow and a 10-second timeout.
- **Measured with memray**, at 400 citizens for 60 seconds, for the same number of requests:

| | Before | After |
|---|---|---|
| Allocations | 11.1 million | **2.6 million (−77%)** |
| Bytes allocated | 2.76 GB | **1.76 GB (−36%)** |
| Peak memory | 93 MB | 95 MB (unchanged) |
| POST p95 | 89 ms | **22 ms** |

## Caveats

- **Load-test backends:**
  - `EXTRACTOR_BACKEND=fake` replaces Gemini with keyword rules, so the numbers exclude model latency.
  - `CAPTCHA_BACKEND=disabled` skips the Turnstile call.
  - Both refuse to start in production mode.
- **Local processing is starved at saturation.** Inline processing kept up with submissions up to about 75 per second. Above that, request handling took the process's CPU and processing fell to about 21 reports/s, so a backlog built up (about 7,800 reports at the end of the run). Processing catches up when load drops, and reports left in `received` are recovered by the sweep. In production, Cloud Tasks delivers processing as separate HTTP requests, which can scale across instances.
- **One process, one machine.** locust, PostGIS and the API shared the laptop, so absolute numbers are for comparison, not capacity planning.
- **Production sizing:** each instance keeps up to 40 connections open. Set `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` and `MAX_CONCURRENT_REQUESTS` so that instances × 40 stays under Cloud SQL's connection limit. Keep `MAX_CONCURRENT_REQUESTS` below both the pool size and FastAPI's 40 threads.

## Run it

Needs Docker (for PostGIS) and `uv`. Each run drops and recreates its own database,
`infraalert_loadtest`, on the local PostGIS server; your development database is not touched.

```sh
# Fresh database, server started for you, fixed steps; prints the results table.
scripts/loadtest/run_steps.sh after 200 400 800 1200

# Approximate the original setup: old pool settings (5 + 10 overflow, 30s timeout) and
# effectively no cap on requests in flight. The third fix (4 inline workers instead of a
# thread per report) is in the code and can't be switched off, so expect the collapse
# but not the exact "before" numbers above, which were measured on the old code.
DB_POOL_SIZE=5 DB_MAX_OVERFLOW=10 DB_POOL_TIMEOUT=30 MAX_CONCURRENT_REQUESTS=100000 \
  scripts/loadtest/run_steps.sh before

# Profile with memray while a load runs (writes var/memray/*.bin):
PROFILE=1 scripts/loadtest/run_server.sh
uvx --from locust locust -f scripts/loadtest/locustfile.py --headless -u 400 -r 100 -t 60s -H http://localhost:8000
uvx memray stats var/memray/<file>.bin
uvx memray flamegraph var/memray/<file>.bin
```

Results are written to `var/loadtest/<label>/`, which git ignores.
