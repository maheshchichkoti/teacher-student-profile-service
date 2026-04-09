  ALTER TABLE serve.student_profile_snapshots
    ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'gemini',
    ADD COLUMN IF NOT EXISTS model text,
    ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'v1',
    ADD COLUMN IF NOT EXISTS generation_latency_ms integer;

  CREATE INDEX IF NOT EXISTS idx_student_profile_snapshots_provider_model
    ON serve.student_profile_snapshots (provider, model);
