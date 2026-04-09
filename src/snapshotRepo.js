import crypto from 'crypto';
import { queryPg } from './db/postgres.js';
import { metricsPayloadForHash } from './aggregate.js';

export function computeInputHash(metrics) {
  const payload = metricsPayloadForHash(metrics);
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export async function getSnapshot(studentId) {
  const sid = Number(studentId);
  const rows = await queryPg(
    `SELECT student_id AS "studentId",
            metrics_status AS "metricsStatus",
            summary_status AS "summaryStatus",
            english_level AS "englishLevel",
            total_classes AS "totalClasses",
            total_words_learned AS "totalWordsLearned",
            learning_goal AS "learningGoal",
            weak_words AS "weakWords",
            grammar_topics AS "grammarTopics",
            ai_summary AS "aiSummary",
            input_hash AS "inputHash",
            metrics_updated_at AS "metricsUpdatedAt",
            summary_updated_at AS "summaryUpdatedAt",
            last_analysis_at AS "lastAnalysisAt",
            updated_at AS "updatedAt"
     FROM serve.student_profile_snapshots
     WHERE student_id = $1
     LIMIT 1`,
    [sid],
  );
  return rows[0] || null;
}

export async function ensureSnapshotRow(studentId) {
  const sid = Number(studentId);
  await queryPg(
    `INSERT INTO serve.student_profile_snapshots (student_id, metrics_status, summary_status)
     VALUES ($1, 'pending', 'pending')
     ON CONFLICT (student_id) DO NOTHING`,
    [sid],
  );
}

export async function updateSnapshotMetrics(studentId, metrics, inputHash, summaryStatus = 'pending') {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET metrics_status = 'ready',
         summary_status = $10,
         english_level = $2,
         total_classes = $3,
         total_words_learned = $4,
         learning_goal = $5,
         weak_words = $6::jsonb,
         grammar_topics = $7::jsonb,
         input_hash = $8,
         last_analysis_at = $9::timestamptz,
         metrics_updated_at = now(),
         updated_at = now()
     WHERE student_id = $1`,
    [
      sid,
      metrics.englishLevel,
      metrics.totalClasses,
      metrics.totalWordsLearned,
      metrics.learningGoal,
      JSON.stringify(metrics.weakWords ?? []),
      JSON.stringify(metrics.grammarTopics ?? []),
      inputHash,
      metrics.lastAnalysisAt || null,
      summaryStatus,
    ],
  );
}

export async function updateSnapshotSummary(studentId, text) {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET ai_summary = $2,
         summary_updated_at = now(),
         metrics_status = 'ready',
         summary_status = 'ready',
         updated_at = now()
     WHERE student_id = $1`,
    [sid, text],
  );
}

export async function markMetricsFailed(studentId) {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET metrics_status = 'failed',
         updated_at = now()
     WHERE student_id = $1`,
    [sid],
  );
}

export async function markMetricsGenerating(studentId) {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET metrics_status = 'generating',
         updated_at = now()
     WHERE student_id = $1`,
    [sid],
  );
}

export async function markSummaryGenerating(studentId) {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET summary_status = 'generating',
         updated_at = now()
     WHERE student_id = $1`,
    [sid],
  );
}

export async function markSummaryFailed(studentId) {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET summary_status = 'failed',
         updated_at = now()
     WHERE student_id = $1`,
    [sid],
  );
}

export async function markSummaryReady(studentId) {
  const sid = Number(studentId);
  await queryPg(
    `UPDATE serve.student_profile_snapshots
     SET summary_status = CASE
           WHEN ai_summary IS NOT NULL AND btrim(ai_summary) <> '' THEN 'ready'
           ELSE 'pending'
         END,
         updated_at = now()
     WHERE student_id = $1`,
    [sid],
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
    metricsStatus: row.metricsStatus || 'pending',
    summaryStatus: row.summaryStatus || 'pending',
    weakWords: weakWords || [],
    grammarTopics: grammarTopics || [],
  };
}
