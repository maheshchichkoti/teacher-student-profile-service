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

- **`http://localhost:<PORT>/`** (or `/my-students-demo.html`) — **standalone demo UI** that recreates the **student list page** data population (from MySQL `classes` + `users`) and links into the snapshot page.
- `GET /health` — liveness
- `GET /v1/teachers/students/:studentId/profile` — JSON snapshot (requires `Authorization: Bearer <INTERNAL_API_SECRET>` when `INTERNAL_API_SECRET` is set; optional `X-Teacher-Id` enforces teacher–student class relationship)
- `GET /demo/my-students` — demo-only student list endpoint (no auth; supports `page`, `limit`, `search`, `sortBy`, `sortOrder`)

**Response (Task 1):** `englishLevel`, `totalWordsLearned`, `weakWords` (`{ word, count, issue }`), `grammarTopics`, `totalClasses`, `learningGoal`, `aiSummary` (nullable), `summaryDisplay` (always show this in UI: real paragraph, or `Generating summary...`, or `Summary temporarily unavailable`), `status`, `lastAnalysisAt`, `metricsUpdatedAt`, `summaryUpdatedAt`.

**Read path:** one indexed read from Postgres `serve.student_profile_snapshots`; no heavy joins at request time. When metrics look stale, the service schedules a background refresh (does not block the response).

**Standalone repo:** integrate the main teacher app only after approval; until then, use the demo page above or point a gateway at this service.

**AI summary:** configured with **Gemini only** — set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`). No Anthropic/OpenAI keys are used.

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
