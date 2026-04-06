import crypto from 'crypto';
import { query } from './db/mysql.js';
import { metricsPayloadForHash } from './aggregate.js';

export function computeInputHash(metrics) {
  const payload = metricsPayloadForHash(metrics);
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export async function getSnapshot(studentId) {
  const sid = Number(studentId);
  const rows = await query(
    `SELECT student_id AS studentId, status, english_level AS englishLevel,
            total_classes AS totalClasses, total_words_learned AS totalWordsLearned,
            learning_goal AS learningGoal, weak_words AS weakWords,
            grammar_topics AS grammarTopics, ai_summary AS aiSummary,
            input_hash AS inputHash, metrics_updated_at AS metricsUpdatedAt,
            summary_updated_at AS summaryUpdatedAt, last_analysis_at AS lastAnalysisAt,
            updated_at AS updatedAt
     FROM student_profile_snapshots
     WHERE student_id = :sid
     LIMIT 1`,
    { sid },
  );
  return rows[0] || null;
}

export async function ensureSnapshotRow(studentId) {
  const sid = Number(studentId);
  await query(
    `INSERT INTO student_profile_snapshots (student_id, status)
     VALUES (:sid, 'pending')
     ON DUPLICATE KEY UPDATE student_id = student_id`,
    { sid },
  );
}

export async function updateSnapshotMetrics(studentId, metrics, inputHash) {
  const sid = Number(studentId);
  await query(
    `UPDATE student_profile_snapshots
     SET status = 'ready',
         english_level = :englishLevel,
         total_classes = :totalClasses,
         total_words_learned = :totalWordsLearned,
         learning_goal = :learningGoal,
         weak_words = :weakWords,
         grammar_topics = :grammarTopics,
         input_hash = :inputHash,
         last_analysis_at = :lastAnalysisAt,
         metrics_updated_at = CURRENT_TIMESTAMP
     WHERE student_id = :sid`,
    {
      sid,
      englishLevel: metrics.englishLevel,
      totalClasses: metrics.totalClasses,
      totalWordsLearned: metrics.totalWordsLearned,
      learningGoal: metrics.learningGoal,
      weakWords: metrics.weakWords,
      grammarTopics: metrics.grammarTopics,
      inputHash,
      lastAnalysisAt: metrics.lastAnalysisAt
        ? metrics.lastAnalysisAt.replace('T', ' ').slice(0, 19)
        : null,
    },
  );
}

export async function updateSnapshotSummary(studentId, text) {
  const sid = Number(studentId);
  await query(
    `UPDATE student_profile_snapshots
     SET ai_summary = :text,
         summary_updated_at = CURRENT_TIMESTAMP,
         status = 'ready'
     WHERE student_id = :sid`,
    { sid, text },
  );
}

export async function markSnapshotFailed(studentId) {
  const sid = Number(studentId);
  await query(
    `UPDATE student_profile_snapshots SET status = 'failed' WHERE student_id = :sid`,
    { sid },
  );
}

export async function markSnapshotGenerating(studentId) {
  const sid = Number(studentId);
  await query(
    `UPDATE student_profile_snapshots SET status = 'generating' WHERE student_id = :sid`,
    { sid },
  );
}

export function parseSnapshotRow(row) {
  if (!row) return null;
  let weakWords = row.weakWords;
  let grammarTopics = row.grammarTopics;
  if (typeof weakWords === 'string') {
    try {
      weakWords = JSON.parse(weakWords);
    } catch {
      weakWords = [];
    }
  }
  if (typeof grammarTopics === 'string') {
    try {
      grammarTopics = JSON.parse(grammarTopics);
    } catch {
      grammarTopics = [];
    }
  }
  return {
    ...row,
    weakWords: weakWords || [],
    grammarTopics: grammarTopics || [],
  };
}
