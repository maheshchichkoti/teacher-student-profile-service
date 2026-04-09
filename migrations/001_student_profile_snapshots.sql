-- Task 1 read model (Postgres)
-- Aligned with lessonscope serve-schema profile tables and LLM raw pipeline.

CREATE SCHEMA IF NOT EXISTS serve;

CREATE TABLE IF NOT EXISTS serve.student_profile_snapshots (
  student_id integer PRIMARY KEY,
  metrics_status text NOT NULL DEFAULT 'pending'
    CHECK (metrics_status IN ('pending', 'generating', 'ready', 'failed')),
  summary_status text NOT NULL DEFAULT 'pending'
    CHECK (summary_status IN ('pending', 'generating', 'ready', 'failed')),
  english_level text,
  total_classes integer NOT NULL DEFAULT 0 CHECK (total_classes >= 0),
  total_words_learned integer NOT NULL DEFAULT 0 CHECK (total_words_learned >= 0),
  learning_goal text,
  weak_words jsonb,
  grammar_topics jsonb,
  ai_summary text,
  input_hash varchar(64),
  metrics_updated_at timestamp with time zone NOT NULL DEFAULT now(),
  summary_updated_at timestamp with time zone NOT NULL DEFAULT to_timestamp(0),
  last_analysis_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE serve.student_profile_snapshots
  ADD COLUMN IF NOT EXISTS metrics_status text,
  ADD COLUMN IF NOT EXISTS summary_status text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'serve'
      AND table_name = 'student_profile_snapshots'
      AND column_name = 'status'
  ) THEN
    EXECUTE $sql$
      UPDATE serve.student_profile_snapshots
      SET metrics_status = COALESCE(metrics_status, status, 'pending'),
          summary_status = COALESCE(
            summary_status,
            CASE
              WHEN ai_summary IS NOT NULL AND btrim(ai_summary) <> '' THEN 'ready'
              WHEN status = 'failed' THEN 'failed'
              WHEN status = 'generating' THEN 'generating'
              ELSE 'pending'
            END
          )
      WHERE metrics_status IS NULL
         OR summary_status IS NULL
    $sql$;

    EXECUTE 'ALTER TABLE serve.student_profile_snapshots DROP COLUMN status';
  ELSE
    EXECUTE $sql$
      UPDATE serve.student_profile_snapshots
      SET metrics_status = COALESCE(metrics_status, 'pending'),
          summary_status = COALESCE(summary_status, 'pending')
      WHERE metrics_status IS NULL
         OR summary_status IS NULL
    $sql$;
  END IF;
END
$$;

ALTER TABLE serve.student_profile_snapshots
  ALTER COLUMN metrics_status SET DEFAULT 'pending',
  ALTER COLUMN summary_status SET DEFAULT 'pending',
  ALTER COLUMN metrics_status SET NOT NULL,
  ALTER COLUMN summary_status SET NOT NULL;

ALTER TABLE serve.student_profile_snapshots
  DROP CONSTRAINT IF EXISTS student_profile_snapshots_metrics_status_check,
  DROP CONSTRAINT IF EXISTS student_profile_snapshots_summary_status_check;

ALTER TABLE serve.student_profile_snapshots
  ADD CONSTRAINT student_profile_snapshots_metrics_status_check
    CHECK (metrics_status IN ('pending', 'generating', 'ready', 'failed')),
  ADD CONSTRAINT student_profile_snapshots_summary_status_check
    CHECK (summary_status IN ('pending', 'generating', 'ready', 'failed'));

DROP INDEX IF EXISTS serve.idx_student_profile_snapshots_status_summary;

CREATE INDEX IF NOT EXISTS idx_student_profile_snapshots_metrics_summary
  ON serve.student_profile_snapshots (metrics_status, summary_status, summary_updated_at);

CREATE INDEX IF NOT EXISTS idx_student_profile_snapshots_last_analysis
  ON serve.student_profile_snapshots (last_analysis_at);

CREATE INDEX IF NOT EXISTS idx_student_profile_snapshots_metrics_updated
  ON serve.student_profile_snapshots (metrics_updated_at);

CREATE OR REPLACE FUNCTION serve.set_updated_at_student_profile_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_student_profile_snapshots
  ON serve.student_profile_snapshots;

CREATE TRIGGER trg_set_updated_at_student_profile_snapshots
BEFORE UPDATE ON serve.student_profile_snapshots
FOR EACH ROW
EXECUTE FUNCTION serve.set_updated_at_student_profile_snapshots();
