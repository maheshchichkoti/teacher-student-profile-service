# Teacher student profile service

Task 1 — cached student profile snapshot (metrics + AI summary) for the teacher app.

Metrics follow the engineering rules in `docs/plans/2026-04-02-ai-teacher-intelligence-separate-repo.md`:

- **Grammar / level / vocabulary breadth:** merged from Postgres `raw.llm_responses.parsed_response`, joined via `raw.zoom_webhook_request` + `raw.llm_intake_queue` (same time-window join as the pre-session brief plan).
- **Weak vocabulary:** `pronunciation_flags` with `count >= 2` inside `parsed_response` — **not** deprecated `user_mistakes`, `student_progress`, or `llm_audio_analyses`.
- **`total_words_learned`:** distinct vocabulary tokens seen across those parsed responses’ `vocabulary_words` (or nested lesson_analysis lists). If Postgres is unavailable or empty, this can be `0` with no invented totals.
- **Aggregation window:** last `PROFILE_ANALYSIS_WINDOW_DAYS` days (default `90`) and up to `PROFILE_ANALYSIS_MAX_CLASSES` attended classes (default `20`).
- **Zoom meeting id:** normalized from `classes.zoom_meeting_id`, else digits from `admin_url` / `join_url` `/j/<id>`.
- **Shape tolerance:** grammar/vocab/level/pronunciation fields are read from **top-level** `parsed_response` and from **`raw_analysis.lesson_analysis`**, **`raw_analysis.student_performance`**, **`raw_analysis.metadata`** when present (Lessonscope-style). Optional game payloads under the same JSON (`flashcards`, `spelling_bee`, or nested `games` / `games_response` / `practice_content`) contribute extra **vocabulary tokens** for `total_words_learned` only.

## Setup

```bash
cp .env.example .env
# users / classes stay in MySQL
# raw LLM tables + serve.student_profile_snapshots live in Postgres
# Apply the snapshot migration against Postgres:
psql -h … -U … -d … -f migrations/001_student_profile_snapshots.sql
npm install
```

## Run

```bash
npm start
```

## Deploy on Render

This service is a **Node/Express backend** with server-side secrets and external MySQL/Postgres dependencies, so deploy it as a Render **Web Service** (not a static site).

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Render will detect `render.yaml` and use:
   - build command: `npm install`
   - start command: `npm start`
   - health check: `/health`
4. Set all required environment variables in Render:
   - `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
   - `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
   - `GEMINI_API_KEY`
   - optional: `GEMINI_MODEL`, `INTERNAL_API_SECRET`, `SUMMARY_TTL_DAYS`, `METRICS_STALE_AFTER_SEC`, `PROFILE_ANALYSIS_WINDOW_DAYS`, `PROFILE_ANALYSIS_MAX_CLASSES`
5. Run the Postgres migration before first production use:
   - `migrations/001_student_profile_snapshots.sql`

If your databases are private, make sure Render can reach them via allowed IPs, peering, or a tunnel/VPN layer.

- **`http://localhost:<PORT>/`** (or `/my-students-demo.html`) — **standalone demo UI** that recreates the **student list page** data population (from MySQL `classes` + `users`) and links into the snapshot page.
- `GET /health` — liveness
- `GET /v1/teachers/students/:studentId/profile` — JSON snapshot (requires `Authorization: Bearer <INTERNAL_API_SECRET>` when `INTERNAL_API_SECRET` is set; optional `X-Teacher-Id` enforces teacher–student class relationship)
- `GET /demo/my-students` — demo-only student list endpoint (no auth; supports `page`, `limit`, `search`, `sortBy`, `sortOrder`)

**Response (Task 1):** `englishLevel`, `totalWordsLearned`, `weakWords` (`{ word, count, issue }`), `grammarTopics`, `totalClasses`, `learningGoal`, `aiSummary` (nullable), `summaryDisplay` (always show this in UI: real paragraph, or `Generating summary...`, or `Summary temporarily unavailable`), `metricsStatus`, `summaryStatus`, `lastAnalysisAt`, `metricsUpdatedAt`, `summaryUpdatedAt`.

There are **two lifecycle statuses**:

- `metricsStatus` — whether the computed snapshot metrics are pending, generating, ready, or failed.
- `summaryStatus` — whether the AI paragraph for the current metrics is pending, generating, ready, or failed.

**Read path:** one indexed read from Postgres `serve.student_profile_snapshots`; no heavy joins at request time. When metrics look stale, the service schedules a background refresh (does not block the response).

**Standalone repo:** integrate the main teacher app only after approval; until then, use the demo page above or point a gateway at this service.

**AI summary:** configured with **Gemini only** — set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`). No Anthropic/OpenAI keys are used.

- `POST /v1/teachers/students/:studentId/profile/refresh` — synchronous full refresh (`?skipLlm=1` skips LLM)

Background refresh runs on GET when metrics status is `pending`/`failed`, metrics are stale (`METRICS_STALE_AFTER_SEC`), or metrics are stuck in `generating` (~3+ minutes).

Metrics and summary now refresh independently:

- `metricsStatus` reflects aggregation state for the snapshot metrics.
- `summaryStatus` reflects whether the AI summary for the current metrics is pending, generating, ready, or failed.
- The service may return `metricsStatus: ready` while `summaryStatus: pending|generating` if the metrics are already usable but the paragraph is still being regenerated.

## One-off worker

```bash
node src/cli-worker-once.js <studentId> [--skip-llm]
```

## Tests

```bash
npm test
```
