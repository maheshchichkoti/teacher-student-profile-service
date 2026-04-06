# Teacher student profile service

Task 1 — cached student profile snapshot (metrics + AI summary) for the teacher app.

## Setup

```bash
cp .env.example .env
# Apply migration against your Tulkka MySQL database:
mysql -h … -u … -p … tulkka < migrations/001_student_profile_snapshots.sql
npm install
```

## Run

```bash
npm start
```

- `GET /health` — liveness
- `GET /v1/teachers/students/:studentId/profile` — JSON snapshot (requires `Authorization: Bearer <INTERNAL_API_SECRET>` when `INTERNAL_API_SECRET` is set; optional `X-Teacher-Id` enforces teacher–student class relationship)
- `POST /v1/teachers/students/:studentId/profile/refresh` — synchronous full refresh (`?skipLlm=1` skips LLM)

Background refresh runs on GET when status is `pending`/`failed`, metrics are stale (`METRICS_STALE_AFTER_SEC`), or row stuck in `generating` (~3+ minutes).

## One-off worker

```bash
node src/cli-worker-once.js <studentId> [--skip-llm]
```

## Tests

```bash
npm test
```
