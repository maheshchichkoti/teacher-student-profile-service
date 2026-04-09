import { query } from './db/mysql.js';
import { getPgPool } from './db/postgres.js';
import { config } from './config.js';
import { normalizeZoomMeetingId } from './meetingId.js';
import { fetchSessionEnrichment } from './enrichmentPg.js';
import {
  grammarPointsFromParsed,
  learningGoalFromParsed,
  levelFromParsed,
  parseJsonValue,
  pronunciationFlagsFromParsed,
  vocabularyTokensFromParsed,
} from './parsedResponseExtractors.js';

function mergeWeakFromPronunciationFlags(flagRows) {
  /** @type {Map<string, { word: string, mistakeCount: number, issue: string }>} */
  const byWord = new Map();
  for (const row of flagRows) {
    const word =
      (row.word != null && String(row.word).trim()) ||
      (row.item != null && String(row.item).trim()) ||
      '';
    if (!word) continue;
    const count = Number(row.count ?? row.mistake_count ?? 0);
    if (count < 2) continue;
    const issueRaw =
      row.issue ??
      row.type ??
      row.label ??
      row.problem ??
      row.flag_type ??
      '';
    const issue =
      issueRaw != null && String(issueRaw).trim()
        ? String(issueRaw).trim().slice(0, 80)
        : 'pronunciation';
    const key = word.toLowerCase();
    const prev = byWord.get(key);
    if (!prev || count > prev.mistakeCount) {
      byWord.set(key, { word, mistakeCount: count, issue });
    }
  }
  return [...byWord.values()]
    .sort((a, b) => b.mistakeCount - a.mistakeCount || a.word.localeCompare(b.word))
    .slice(0, 50)
    .map((w) => ({
      itemId: w.word,
      gameType: 'pronunciation_flag',
      mistakeCount: w.mistakeCount,
      item: w.word,
      issue: w.issue,
    }));
}

/**
 * @param {number} studentId
 * @returns {Promise<object>}
 */
export async function aggregateStudentMetrics(studentId) {
  const sid = Number(studentId);
  if (!Number.isFinite(sid) || sid <= 0) {
    throw new Error('Invalid studentId');
  }

  console.log('[aggregate] start', { studentId: sid });

  const [classRow] = await query(
    `SELECT COUNT(*) AS total_classes
     FROM classes c
     WHERE c.student_id = :sid
       AND c.status = 'ended'
       AND c.is_present = 1`,
    { sid },
  );

  const totalClasses = Number(classRow?.total_classes || 0);

  const [goalClass] = await query(
    `SELECT student_goal
     FROM classes
     WHERE student_id = :sid
       AND status = 'ended'
       AND is_present = 1
       AND student_goal IS NOT NULL
       AND TRIM(student_goal) != ''
     ORDER BY meeting_start DESC
     LIMIT 1`,
    { sid },
  );

  const [userRow] = await query(
    `SELECT what_learn, student_level
     FROM users
     WHERE id = :sid
     LIMIT 1`,
    { sid },
  );

  const classGoal = goalClass?.student_goal?.trim() || '';
  const whatLearn = userRow?.what_learn?.trim() || '';
  let learningGoal = classGoal || whatLearn || null;
  let englishLevel = null;

  const windowDays = Math.max(1, Number(config.profileAnalysisWindowDays || 90));
  const maxClasses = Math.max(1, Math.min(200, Number(config.profileAnalysisMaxClasses || 20)));
  const cutoffTs = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const timeline = await query(
    `SELECT id AS classId,
            zoom_meeting_id AS zoomMeetingId,
            admin_url AS adminUrl,
            join_url AS joinUrl,
            meeting_start AS meetingStart,
            meeting_end AS meetingEnd
     FROM classes
     WHERE student_id = :sid
       AND status = 'ended'
       AND is_present = 1
       AND meeting_start >= :cutoffTs
     ORDER BY meeting_start DESC
     LIMIT ${maxClasses}`,
    { sid, cutoffTs },
  );

  const grammarSet = new Map();
  const vocabAll = new Set();
  const pronunciationFlagRows = [];
  let lastAnalysisMs = null;
  const enrichmentDebugSamples = [];

  let timelineRowsCount = 0;
  let skippedMissingMeetingId = 0;
  let enrichmentMatched = 0;
  let enrichmentMissed = 0;
  let parsedResponseMissing = 0;
  let parsedResponseOk = 0;

  const pgConfigured = Boolean(getPgPool());
  timelineRowsCount = timeline.length;

  for (const row of timeline) {
    const meetingId = normalizeZoomMeetingId(
      row.zoomMeetingId,
      row.adminUrl,
      row.joinUrl,
    );
    if (!meetingId || !row.meetingStart) {
      skippedMissingMeetingId += 1;
      if (enrichmentDebugSamples.length < 5) {
        enrichmentDebugSamples.push({
          kind: 'missing_meeting_id',
          rawZoomMeetingId: row.zoomMeetingId || null,
          meetingStart: row.meetingStart || null,
          meetingEnd: row.meetingEnd || null,
        });
      }
      continue;
    }

    if (!pgConfigured) continue;

    let enrichment;
    try {
      enrichment = await fetchSessionEnrichment(
        row.classId,
        meetingId,
        row.meetingStart,
        row.meetingEnd,
      );
    } catch (err) {
      enrichmentMissed += 1;
      if (enrichmentDebugSamples.length < 5) {
        enrichmentDebugSamples.push({
          kind: 'pg_lookup_error',
          classId: row.classId || null,
          meetingId,
          meetingStart: row.meetingStart || null,
          meetingEnd: row.meetingEnd || null,
          message: err?.message || 'Unknown Postgres lookup error',
        });
      }
      continue;
    }
    if (!enrichment) {
      enrichmentMissed += 1;
      if (enrichmentDebugSamples.length < 5) {
        enrichmentDebugSamples.push({
          kind: 'no_enrichment_match',
          classId: row.classId || null,
          meetingId,
          meetingStart: row.meetingStart || null,
          meetingEnd: row.meetingEnd || null,
        });
      }
      continue;
    }

    enrichmentMatched += 1;

    const pr = parseJsonValue(enrichment.parsed_response);
    if (!pr) {
      parsedResponseMissing += 1;
      if (enrichmentDebugSamples.length < 5) {
        enrichmentDebugSamples.push({
          kind: 'parsed_response_missing',
          classId: row.classId || null,
          meetingId,
          meetingStart: row.meetingStart || null,
          recordingStart: enrichment.recording_start || null,
        });
      }
      continue;
    }

    parsedResponseOk += 1;

    if (!learningGoal) {
      const goalFromParsed = learningGoalFromParsed(pr);
      if (goalFromParsed) learningGoal = goalFromParsed;
    }

    for (const g of grammarPointsFromParsed(pr)) {
      if (!grammarSet.has(g.toLowerCase())) grammarSet.set(g.toLowerCase(), g);
    }
    for (const t of vocabularyTokensFromParsed(pr)) {
      vocabAll.add(t.toLowerCase());
    }
    for (const f of pronunciationFlagsFromParsed(pr)) {
      if (f && typeof f === 'object') pronunciationFlagRows.push(f);
    }

    const lvl = levelFromParsed(pr);
    if (lvl && !englishLevel) englishLevel = lvl;

    if (enrichment.recording_start) {
      const t = new Date(enrichment.recording_start).getTime();
      if (!Number.isNaN(t) && (!lastAnalysisMs || t > lastAnalysisMs)) {
        lastAnalysisMs = t;
      }
    }
  }

  if (!englishLevel && userRow?.student_level) {
    englishLevel = String(userRow.student_level).trim().slice(0, 50) || null;
  }

  const grammarTopics = [...grammarSet.values()].sort((a, b) => a.localeCompare(b));
  const totalWordsLearned = vocabAll.size;
  const weakWords = mergeWeakFromPronunciationFlags(pronunciationFlagRows);

  const englishLevelSource = englishLevel
    ? (parsedResponseOk > 0 ? 'postgres_parsed_response_or_mysql_fallback' : 'mysql_user_fallback')
    : 'none';

  const qualityImpactReasons = [];
  if (timelineRowsCount === 0) qualityImpactReasons.push('no_recent_attended_classes_in_window');
  if (pgConfigured && enrichmentMatched === 0 && timelineRowsCount > 0) {
    qualityImpactReasons.push('no_matched_postgres_enrichment_for_recent_classes');
  }
  if (pgConfigured && enrichmentMatched > 0 && parsedResponseOk === 0) {
    qualityImpactReasons.push('matched_enrichment_but_parsed_response_missing');
  }
  if (!englishLevel) qualityImpactReasons.push('english_level_missing_in_sources');
  if (!learningGoal) qualityImpactReasons.push('learning_goal_missing_in_sources');
  if (totalWordsLearned === 0) qualityImpactReasons.push('no_vocabulary_signals_from_parsed_sessions');

  console.log('[aggregate] result', {
    studentId: sid,
    totalClasses,
    learningGoal,
    englishLevel,
    englishLevelSource,
    totalWordsLearned,
    grammarTopicsCount: grammarTopics.length,
    weakWordsCount: weakWords.length,
    lastAnalysisAt: lastAnalysisMs ? new Date(lastAnalysisMs).toISOString() : null,
    pgConfigured,
    timelineRowsCount,
    skippedMissingMeetingId,
    enrichmentMatched,
    enrichmentMissed,
    parsedResponseMissing,
    parsedResponseOk,
    qualityImpactReasons,
    enrichmentDebugSamples,
  });

  return {
    studentId: sid,
    englishLevel,
    totalWordsLearned,
    weakWords,
    grammarTopics,
    totalClasses,
    learningGoal,
    lastAnalysisAt: lastAnalysisMs ? new Date(lastAnalysisMs).toISOString() : null,
    qualityDiagnostics: {
      qualityImpactReasons,
      pgConfigured,
      timelineRowsCount,
      enrichmentMatched,
      enrichmentMissed,
      parsedResponseOk,
      parsedResponseMissing,
    },
  };
}

export function metricsPayloadForHash(m) {
  return {
    englishLevel: m.englishLevel,
    totalWordsLearned: m.totalWordsLearned,
    totalClasses: m.totalClasses,
    learningGoal: m.learningGoal,
    grammarTopics: [...m.grammarTopics].sort((a, b) => a.localeCompare(b)),
    weakWords: [...m.weakWords]
      .map((w) => ({
        itemId: w.itemId,
        gameType: w.gameType,
        mistakeCount: w.mistakeCount,
        issue: w.issue,
      }))
      .sort((a, b) => `${a.gameType}:${a.itemId}`.localeCompare(`${b.gameType}:${b.itemId}`)),
  };
}
