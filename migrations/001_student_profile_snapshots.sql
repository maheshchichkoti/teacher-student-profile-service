-- Task 1 read model — aligns with docs/plans/2026-04-02-task-1-student-profile-snapshot.md
CREATE TABLE IF NOT EXISTS student_profile_snapshots (
  student_id INT UNSIGNED NOT NULL PRIMARY KEY,
  status ENUM('pending','generating','ready','failed') NOT NULL DEFAULT 'pending',
  english_level VARCHAR(255) NULL,
  total_classes INT UNSIGNED NOT NULL DEFAULT 0,
  total_words_learned INT UNSIGNED NOT NULL DEFAULT 0,
  learning_goal TEXT NULL,
  weak_words JSON NULL,
  grammar_topics JSON NULL,
  ai_summary TEXT NULL,
  input_hash CHAR(64) NULL,
  metrics_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  summary_updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00',
  last_analysis_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profile_snapshot_student
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_snapshot_status_summary (status, summary_updated_at),
  INDEX idx_snapshot_last_analysis (last_analysis_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
