-- Task 1 read model (Postgres)
-- Aligned with lessonscope serve-schema profile tables and LLM raw pipeline.

CREATE SCHEMA IF NOT EXISTS serve;

CREATE TABLE IF NOT EXISTS serve.student_profile_snapshots (
  student_id integer PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
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

CREATE INDEX IF NOT EXISTS idx_student_profile_snapshots_status_summary
  ON serve.student_profile_snapshots (status, summary_updated_at);

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
