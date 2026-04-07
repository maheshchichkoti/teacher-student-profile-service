import { query } from './db/mysql.js';
import { getPgPool } from './db/postgres.js';
import { normalizeZoomMeetingId } from './meetingId.js';
import { fetchSessionEnrichment } from './enrichmentPg.js';
import {
  grammarPointsFromParsed,
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

  const [goalUserGoal] = await query(
    `SELECT goal_name
     FROM user_goals
     WHERE user_id = :sid
       AND goal_name IS NOT NULL
       AND TRIM(goal_name) != ''
     ORDER BY id DESC
     LIMIT 1`,
    { sid },
  );

  const classGoal = goalClass?.student_goal?.trim() || '';
  const whatLearn = userRow?.what_learn?.trim() || '';
  const ug = goalUserGoal?.goal_name?.trim() || '';
  const learningGoal = classGoal || whatLearn || ug || null;

  let englishLevel = userRow?.student_level ? String(userRow.student_level).trim().slice(0, 50) : null;

  const timeline = await query(
    `SELECT zoom_meeting_id AS zoomMeetingId,
            admin_url AS adminUrl,
            join_url AS joinUrl,
            meeting_start AS meetingStart,
            meeting_end AS meetingEnd
     FROM classes
     WHERE student_id = :sid
       AND status IN ('ended', 'completed')
       AND is_present = 1
     ORDER BY meeting_start DESC
     LIMIT 20`,
    { sid },
  );

  const grammarSet = new Map();
  const vocabAll = new Set();
  const pronunciationFlagRows = [];
  let lastAnalysisMs = null;

  const pgConfigured = Boolean(getPgPool());

  for (const row of timeline) {
    const meetingId = normalizeZoomMeetingId(
      row.zoomMeetingId,
      row.adminUrl,
      row.joinUrl,
    );
    if (!meetingId || !row.meetingStart) continue;

    if (!pgConfigured) continue;

    let enrichment;
    try {
      enrichment = await fetchSessionEnrichment(meetingId, row.meetingStart, row.meetingEnd);
    } catch {
      continue;
    }
    if (!enrichment) continue;

    const pr = parseJsonValue(enrichment.parsed_response);
    if (!pr) continue;

    for (const g of grammarPointsFromParsed(pr)) {
      if (!grammarSet.has(g.toLowerCase())) grammarSet.set(g.toLowerCase(), g);
    }
    for (const t of vocabularyTokensFromParsed(pr)) {
      vocabAll.add(t.toLowerCase());
    }
    for (const f of pronunciationFlagsFromParsed(pr)) {
      if (f && typeof f === 'object') pronunciationFlagRows.push(f);
    }

    if (!englishLevel) {
      const lvl = levelFromParsed(pr);
      if (lvl) englishLevel = lvl;
    }

    if (enrichment.recording_start) {
      const t = new Date(enrichment.recording_start).getTime();
      if (!Number.isNaN(t) && (!lastAnalysisMs || t > lastAnalysisMs)) {
        lastAnalysisMs = t;
      }
    }
  }

  const grammarTopics = [...grammarSet.values()].sort((a, b) => a.localeCompare(b));
  const totalWordsLearned = vocabAll.size;
  const weakWords = mergeWeakFromPronunciationFlags(pronunciationFlagRows);

  return {
    studentId: sid,
    englishLevel,
    totalWordsLearned,
    weakWords,
    grammarTopics,
    totalClasses,
    learningGoal,
    lastAnalysisAt: lastAnalysisMs ? new Date(lastAnalysisMs).toISOString() : null,
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
