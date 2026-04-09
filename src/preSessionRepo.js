import crypto from 'crypto';
import { queryPg } from './db/postgres.js';
import { preSessionHashPayload } from './preSessionAggregate.js';

export function computePreSessionInputHash(data) {
  const payload = preSessionHashPayload(data);
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export async function getPreSessionBrief(classId) {
  const rows = await queryPg(
    `SELECT class_id AS "classId",
            student_id AS "studentId",
            teacher_id AS "teacherId",
            scheduled_start AS "scheduledStart",
            scheduled_end AS "scheduledEnd",
            status,
            readiness_score AS "readinessScore",
            last_attended_class_id AS "lastAttendedClassId",
            last_attended_class_end AS "lastAttendedClassEnd",
            practice_games_count AS "practiceGamesCount",
            practice_completed_count AS "practiceCompletedCount",
            practice_unique_games AS "practiceUniqueGames",
            last_session_summary AS "lastSessionSummary",
            recent_mistakes AS "recentMistakes",
            focus_recommendations AS "focusRecommendations",
            brief_text AS "briefText",
            brief_json AS "briefJson",
            input_hash AS "inputHash",
            generated_at AS "generatedAt",
            last_activity_at AS "lastActivityAt",
            provider,
            model,
            prompt_version AS "promptVersion",
            generation_latency_ms AS "generationLatencyMs",
            error_message AS "errorMessage",
            updated_at AS "updatedAt"
     FROM serve.teacher_pre_session_briefs
     WHERE class_id = $1
     LIMIT 1`,
    [Number(classId)],
  );
  return rows[0] || null;
}

export async function upsertPreSessionBase(data) {
  await queryPg(
    `INSERT INTO serve.teacher_pre_session_briefs
      (class_id, student_id, teacher_id, scheduled_start, scheduled_end, status,
       readiness_score, last_attended_class_id, last_attended_class_end,
       practice_games_count, practice_completed_count, practice_unique_games,
       last_session_summary, recent_mistakes, input_hash, last_activity_at)
     VALUES
      ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'pending',
       $6, $7, $8::timestamptz,
       $9, $10, $11,
       $12::jsonb, $13::jsonb, $14, now())
     ON CONFLICT (class_id) DO UPDATE
     SET student_id = EXCLUDED.student_id,
         teacher_id = EXCLUDED.teacher_id,
         scheduled_start = EXCLUDED.scheduled_start,
         scheduled_end = EXCLUDED.scheduled_end,
         readiness_score = EXCLUDED.readiness_score,
         last_attended_class_id = EXCLUDED.last_attended_class_id,
         last_attended_class_end = EXCLUDED.last_attended_class_end,
         practice_games_count = EXCLUDED.practice_games_count,
         practice_completed_count = EXCLUDED.practice_completed_count,
         practice_unique_games = EXCLUDED.practice_unique_games,
         last_session_summary = EXCLUDED.last_session_summary,
         recent_mistakes = EXCLUDED.recent_mistakes,
         input_hash = EXCLUDED.input_hash,
         last_activity_at = now(),
         status = CASE
           WHEN serve.teacher_pre_session_briefs.status = 'ready'
             AND serve.teacher_pre_session_briefs.input_hash = EXCLUDED.input_hash
           THEN serve.teacher_pre_session_briefs.status
           ELSE 'pending'
         END,
         updated_at = now()`,
    [
      data.classId,
      data.studentId,
      data.teacherId,
      data.scheduledStart,
      data.scheduledEnd || null,
      data.readinessScore,
      data.lastAttendedClassId || null,
      data.lastAttendedClassEnd || null,
      data.appPracticeSinceLastClass?.gamesPlayed || 0,
      data.appPracticeSinceLastClass?.completedGames || 0,
      data.appPracticeSinceLastClass?.uniqueGameTypes || 0,
      JSON.stringify({
        ...(data.lastSessionSummary || {}),
        classContext: data.classContext || null,
      }),
      JSON.stringify(data.recentMistakes || []),
      data.inputHash,
    ],
  );
}

export async function markPreSessionGenerating(classId) {
  await queryPg(
    `UPDATE serve.teacher_pre_session_briefs
     SET status = 'generating',
         error_message = NULL,
         updated_at = now()
     WHERE class_id = $1`,
    [Number(classId)],
  );
}

export async function markPreSessionFailed(classId, message) {
  await queryPg(
    `UPDATE serve.teacher_pre_session_briefs
     SET status = 'failed',
         error_message = $2,
         updated_at = now()
     WHERE class_id = $1`,
    [Number(classId), message?.slice(0, 1000) || 'Unknown error'],
  );
}

export async function savePreSessionReady(classId, result) {
  await queryPg(
    `UPDATE serve.teacher_pre_session_briefs
     SET status = 'ready',
         focus_recommendations = $2::jsonb,
         brief_text = $3,
         brief_json = $4::jsonb,
         provider = 'gemini',
         model = $5,
         prompt_version = 'v1',
         generation_latency_ms = $6,
         generated_at = now(),
         error_message = NULL,
         updated_at = now()
     WHERE class_id = $1`,
    [
      Number(classId),
      JSON.stringify(result.focusRecommendations || []),
      result.briefText || '',
      JSON.stringify(result.raw || {}),
      result.model || null,
      Number(result.generationLatencyMs || 0),
    ],
  );
}
