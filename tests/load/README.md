# Load tests

k6 scripts that exercise the read-heavy endpoints of the API against a seeded
database. They run in two ways:

* **locally**, against the docker-compose environment in `tests/integration/`,
  with a dataset of whatever size you ask for;
* **in CI**, as the small smoke run described at the bottom of this file.

## What is covered

| Script | Endpoints | Load shape |
|---|---|---|
| `events.js` | `GET /api/v1/events/recent`, `GET /api/v1/events` (two cursor pages) | 10 VUs, 30 s |
| `invocations.js` | `GET /api/v1/invocations`, `GET /api/v1/invocations?status=FAILED` | 10 VUs, 30 s |
| `search.js` | `GET /api/v1/search?q=…` | 10 VUs, 30 s |

Every script carries thresholds, so a run fails (non-zero exit) when the API
regresses:

| Threshold | Meaning |
|---|---|
| `http_req_failed: rate<0.01` | fewer than 1 % of requests may fail |
| `http_req_duration: p(95)<500` | 95 % of the requests under 500 ms |
| `events_page_duration: p(95)<500` | the explorer page leg on its own |

`VUS`, `DURATION`, `LIMIT`, `BASE_URL` and `QUERY` can be overridden per run,
e.g. `k6 run -e VUS=50 -e DURATION=2m tests/load/events.js`.

## Running locally

```bash
# 1. bring up Postgres, Redis, the mock RPC and the API
cd tests/integration && docker compose up -d --build && cd ../..
until curl -sf http://localhost:8080/readyz > /dev/null; do sleep 1; done

# 2. apply the migrations (the API does not run them itself)
export DB_URL="postgres://postgres:test@localhost:5432/sorolens_test"
for f in $(ls apps/api/internal/db/migrations/*.up.sql | sort); do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done

# 3. seed a dataset — 1M events, 100k invocations
psql "$DB_URL" -v n=1000000 -v i=100000 -f tests/load/seed.sql

# 4. run the scenarios
k6 run tests/load/events.js
k6 run tests/load/invocations.js
k6 run tests/load/search.js

# 5. tear down
cd tests/integration && docker compose down -v
```

`seed.sql` takes two psql variables — `n` (events, default 10 000) and `i`
(invocations, default 1 000) — and is safe to re-run: every row is derived from
its sequence number, and the inserts are `ON CONFLICT DO NOTHING`. Synthetic
timestamps are placed inside the current month on purpose, because `events` is
partitioned by range on `ledger_closed_at` and the migrations only create the
current and next month's partitions.

Seeding 1M events against a laptop Postgres takes a few minutes; `ANALYZE` runs
at the end so the planner has statistics before you measure.

## CI smoke run

`.github/workflows/k6-smoke.yml` reproduces the local flow on a GitHub runner:
compose up, wait for `/readyz`, apply migrations, seed a small dataset
(20 000 events / 2 000 invocations), install k6, and run the three scripts with
`--vus 5 --duration 20s`. It is gated the same way as the integration suite —
the `run-load-tests` label on a pull request, a nightly schedule, or a manual
dispatch — so it never slows down ordinary PRs. Because the scripts keep their
thresholds, the job fails when the smoke run regresses.
