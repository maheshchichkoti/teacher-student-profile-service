CREATE SCHEMA IF NOT EXISTS serve;

CREATE TABLE IF NOT EXISTS serve.teacher_pre_session_briefs (
  class_id integer PRIMARY KEY,
  student_id integer NOT NULL,
  teacher_id integer NOT NULL,
  scheduled_start timestamp with time zone NOT NULL,
  scheduled_end timestamp with time zone,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'ready', 'stale', 'failed')),
  readiness_score text
    CHECK (readiness_score IN ('high', 'medium', 'low')),
  last_attended_class_id integer,
  last_attended_class_end timestamp with time zone,
  practice_games_count integer NOT NULL DEFAULT 0,
  practice_completed_count integer NOT NULL DEFAULT 0,
  practice_unique_games integer NOT NULL DEFAULT 0,
  last_session_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  recent_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  focus_recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  brief_text text,
  brief_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_hash varchar(64),
  provider text NOT NULL DEFAULT 'gemini',
  model text,
  prompt_version text NOT NULL DEFAULT 'v1',
  generation_latency_ms integer,
  generated_at timestamp with time zone,
  last_activity_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teacher_pre_session_briefs_status_start
  ON serve.teacher_pre_session_briefs (status, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_teacher_pre_session_briefs_teacher_start
  ON serve.teacher_pre_session_briefs (teacher_id, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_teacher_pre_session_briefs_student_start
  ON serve.teacher_pre_session_briefs (student_id, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_teacher_pre_session_briefs_generated_at
  ON serve.teacher_pre_session_briefs (generated_at);

CREATE OR REPLACE FUNCTION serve.set_updated_at_teacher_pre_session_briefs()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_teacher_pre_session_briefs
  ON serve.teacher_pre_session_briefs;

CREATE TRIGGER trg_set_updated_at_teacher_pre_session_briefs
BEFORE UPDATE ON serve.teacher_pre_session_briefs
FOR EACH ROW
EXECUTE FUNCTION serve.set_updated_at_teacher_pre_session_briefs();
