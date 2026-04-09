import { query } from './db/mysql.js';
import { fetchSessionEnrichment } from './enrichmentPg.js';
import { normalizeZoomMeetingId } from './meetingId.js';
import {
  grammarPointsFromParsed,
  parseJsonValue,
  pronunciationFlagsFromParsed,
  vocabularyTokensFromParsed,
} from './parsedResponseExtractors.js';

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  const dedup = new Map();
  for (const v of values) {
    if (v == null) continue;
    const text = String(v).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (!dedup.has(key)) dedup.set(key, text);
  }
  return [...dedup.values()];
}

function topicsFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const nested = parsed?.raw_analysis?.lesson_analysis?.topics_covered;
  return normalizeStringArray([...(parsed.topics || []), ...(nested || [])]);
}

function mistakesFromPronunciationFlags(flags) {
  const out = [];
  for (const row of flags) {
    if (!row || typeof row !== 'object') continue;
    const word = String(row.word ?? '').trim();
    const count = Number(row.count ?? 0);
    if (!word || !Number.isFinite(count) || count < 2) continue;
    const issue = String(row.issue ?? 'pronunciation').trim() || 'pronunciation';
    out.push({
      word,
      issue,
      count,
      display: `${word} (${issue}, x${count})`,
    });
  }
  out.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  return out.slice(0, 10);
}

function readinessFromPractice(practiceGamesCount) {
  if (practiceGamesCount >= 3) return 'high';
  if (practiceGamesCount >= 1) return 'medium';
  return 'low';
}

function readinessScoreV2(practice, hasMistakeSignals) {
  // 0..100 deterministic score from volume, completion quality, recency and signal richness.
  let score = 0;
  const played = Number(practice.gamesPlayed || 0);
  const completed = Number(practice.completedGames || 0);
  const uniqueTypes = Number(practice.uniqueGameTypes || 0);
  const acc = Number(practice.overallAccuracy || 0);
  const lastActivityAt = practice.lastActivityAt ? new Date(practice.lastActivityAt).getTime() : null;

  score += Math.min(played, 6) * 8; // max 48
  score += Math.min(completed, 6) * 5; // max 30
  score += Math.min(uniqueTypes, 4) * 3; // max 12
  score += Math.max(0, Math.min(acc, 10)); // max 10 from quality

  if (lastActivityAt && Number.isFinite(lastActivityAt)) {
    const hours = (Date.now() - lastActivityAt) / (1000 * 60 * 60);
    if (hours <= 24) score += 5;
    else if (hours <= 72) score += 2;
  }

  if (!hasMistakeSignals && played === 0) {
    score = Math.max(0, score - 8);
  }
  score = Math.max(0, Math.min(100, score));

  let level = 'low';
  if (score >= 60) level = 'high';
  else if (score >= 28) level = 'medium';
  return { readinessScore: level, readinessNumeric: score };
}

function confidenceFromSignals({
  hasLastClass,
  hasParsedSummary,
  hasGameResults,
  gamesPlayed,
}) {
  let points = 0;
  if (hasLastClass) points += 1;
  if (hasParsedSummary) points += 1;
  if (hasGameResults) points += 1;
  if ((gamesPlayed || 0) > 0) points += 1;
  if (points >= 4) return 'high';
  if (points >= 2) return 'medium';
  return 'low';
}

async function getClassById(classId) {
  const rows = await query(
    `SELECT id, student_id AS studentId, teacher_id AS teacherId,
            meeting_start AS meetingStart, meeting_end AS meetingEnd, status,
            is_trial AS isTrial, demo_class_id AS demoClassId, class_type AS classType
     FROM classes
     WHERE id = :classId
     LIMIT 1`,
    { classId },
  );
  return rows[0] || null;
}

function isTrialLikeClass(row) {
  if (!row || typeof row !== 'object') return false;
  const isTrial = Number(row.isTrial || 0) === 1;
  const hasDemoClassId = row.demoClassId != null;
  const classType = String(row.classType || '').toLowerCase();
  return isTrial || hasDemoClassId || classType === 'demo';
}

async function getLastAttendedClass(studentId, beforeMeetingStart) {
  const rows = await query(
    `SELECT id AS classId,
            meeting_start AS meetingStart,
            meeting_end AS meetingEnd,
            zoom_meeting_id AS zoomMeetingId,
            admin_url AS adminUrl,
            join_url AS joinUrl,
            is_trial AS isTrial,
            demo_class_id AS demoClassId,
            class_type AS classType
     FROM classes
     WHERE student_id = :studentId
       AND status = 'ended'
       AND is_present = 1
       AND COALESCE(is_trial, 0) = 0
       AND demo_class_id IS NULL
       AND (class_type IS NULL OR LOWER(class_type) <> 'demo')
       AND meeting_start < :beforeMeetingStart
     ORDER BY meeting_start DESC
     LIMIT 1`,
    { studentId, beforeMeetingStart },
  );
  return rows[0] || null;
}

async function getPracticeSince(studentId, sinceTs, untilTs) {
  if (!sinceTs) {
    return {
      gamesPlayed: 0,
      completedGames: 0,
      uniqueGameTypes: 0,
    };
  }
  const rows = await query(
    `SELECT
       COUNT(*) AS gamesPlayed,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedGames,
       COUNT(DISTINCT game_type) AS uniqueGameTypes
     FROM game_sessions
     WHERE user_id = :studentId
       AND started_at > :sinceTs
       AND started_at < :untilTs`,
    { studentId, sinceTs, untilTs },
  );
  const row = rows[0] || {};
  return {
    gamesPlayed: Number(row.gamesPlayed || 0),
    completedGames: Number(row.completedGames || 0),
    uniqueGameTypes: Number(row.uniqueGameTypes || 0),
  };
}

async function getPracticeDetailSince(studentId, sinceTs, untilTs) {
  if (!sinceTs) {
    return {
      overallAccuracy: 0,
      topGameTypes: [],
      topWrongItems: [],
      grammarMistakeCount: 0,
      pronunciationMistakeCount: 0,
      lastActivityAt: null,
    };
  }

  const typeRows = await query(
    `SELECT
       s.game_type AS gameType,
       COUNT(*) AS sessions,
       SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed,
       COALESCE(AVG(CASE WHEN (s.correct_count + s.incorrect_count) > 0
         THEN (s.correct_count * 100.0 / (s.correct_count + s.incorrect_count))
         ELSE NULL END), 0) AS accuracy
     FROM game_sessions s
     WHERE s.user_id = :studentId
       AND s.started_at > :sinceTs
       AND s.started_at < :untilTs
     GROUP BY s.game_type
     ORDER BY sessions DESC
     LIMIT 5`,
    { studentId, sinceTs, untilTs },
  );

  const resultRows = await query(
    `SELECT
       gr.item_id AS itemId,
       gr.error_type AS errorType,
       SUM(CASE WHEN gr.is_correct = 0 THEN 1 ELSE 0 END) AS wrongCount
     FROM game_results gr
     JOIN game_sessions s ON s.id = gr.session_id
     WHERE s.user_id = :studentId
       AND s.started_at > :sinceTs
       AND s.started_at < :untilTs
     GROUP BY gr.item_id, gr.error_type
     HAVING wrongCount > 0
     ORDER BY wrongCount DESC
     LIMIT 15`,
    { studentId, sinceTs, untilTs },
  );

  const activityRows = await query(
    `SELECT MAX(started_at) AS lastActivityAt
     FROM game_sessions
     WHERE user_id = :studentId
       AND started_at > :sinceTs
       AND started_at < :untilTs`,
    { studentId, sinceTs, untilTs },
  );
  const lastActivityAt = activityRows[0]?.lastActivityAt || null;

  const topGameTypes = typeRows.map((r) => ({
    gameType: r.gameType,
    sessions: Number(r.sessions || 0),
    completed: Number(r.completed || 0),
    accuracy: Number(r.accuracy || 0),
  }));

  const topWrongItems = resultRows.map((r) => ({
    itemId: r.itemId,
    errorType: r.errorType || 'unknown',
    wrongCount: Number(r.wrongCount || 0),
    display: `${r.itemId} (${r.errorType || 'unknown'}, x${Number(r.wrongCount || 0)})`,
  }));

  const totalWrong = topWrongItems.reduce((sum, x) => sum + x.wrongCount, 0);
  const grammarMistakeCount = topWrongItems
    .filter((x) => String(x.errorType || '').toLowerCase().includes('grammar'))
    .reduce((sum, x) => sum + x.wrongCount, 0);
  const pronunciationMistakeCount = topWrongItems
    .filter((x) => String(x.errorType || '').toLowerCase().includes('pronun'))
    .reduce((sum, x) => sum + x.wrongCount, 0);
  const overallAccuracy = totalWrong > 0
    ? Math.max(0, 100 - Math.min(100, totalWrong * 4))
    : (
      topGameTypes.length > 0
        ? Math.round(topGameTypes.reduce((sum, x) => sum + x.accuracy, 0) / topGameTypes.length)
        : 0
    );

  return {
    overallAccuracy,
    topGameTypes,
    topWrongItems,
    grammarMistakeCount,
    pronunciationMistakeCount,
    lastActivityAt,
  };
}

/**
 * Task 2 aggregate payload.
 * Uses:
 * - MySQL classes/game_sessions
 * - Postgres parsed_response enrichment for previous attended class
 */
export async function aggregatePreSessionBriefData(classId) {
  const cid = Number(classId);
  if (!Number.isFinite(cid) || cid <= 0) throw new Error('Invalid classId');

  const targetClass = await getClassById(cid);
  if (!targetClass) throw new Error('Class not found');
  const isTrialClass = isTrialLikeClass(targetClass);

  const lastAttended = await getLastAttendedClass(
    Number(targetClass.studentId),
    targetClass.meetingStart,
  );

  let parsed = null;
  let meetingIdForLastClass = null;
  let enrichmentFound = false;
  let llmSummary = {
    topics: [],
    vocabulary: [],
    grammar: [],
    source: 'none',
  };
  let mistakes = [];
  let hasParsedSummary = false;

  if (lastAttended) {
    const meetingId = normalizeZoomMeetingId(
      lastAttended.zoomMeetingId,
      lastAttended.adminUrl,
      lastAttended.joinUrl,
    );
    meetingIdForLastClass = meetingId || null;
    if (meetingId) {
      const enrichment = await fetchSessionEnrichment(
        lastAttended.classId,
        meetingId,
        lastAttended.meetingStart,
        lastAttended.meetingEnd,
      );
      enrichmentFound = Boolean(enrichment);
      parsed = parseJsonValue(enrichment?.parsed_response);
      if (parsed) {
        hasParsedSummary = true;
        llmSummary = {
          topics: topicsFromParsed(parsed),
          vocabulary: normalizeStringArray(vocabularyTokensFromParsed(parsed)).slice(0, 20),
          grammar: grammarPointsFromParsed(parsed).slice(0, 20),
          source: 'postgres_parsed_response',
        };
        mistakes = mistakesFromPronunciationFlags(pronunciationFlagsFromParsed(parsed));
      }
    }
  }

  const sinceTs = lastAttended?.meetingEnd || null;
  const untilTs = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const practice = await getPracticeSince(Number(targetClass.studentId), sinceTs, untilTs);
  const practiceDetail = await getPracticeDetailSince(
    Number(targetClass.studentId),
    sinceTs,
    untilTs,
  );

  // Merge LLM mistakes with app-level wrong patterns.
  const mergedMistakesMap = new Map();
  for (const m of mistakes) {
    mergedMistakesMap.set(`llm:${m.word}:${m.issue}`, {
      source: 'llm',
      ...m,
    });
  }
  for (const m of practiceDetail.topWrongItems) {
    const key = `game:${m.itemId}:${m.errorType}`;
    if (!mergedMistakesMap.has(key)) {
      mergedMistakesMap.set(key, {
        source: 'games',
        word: m.itemId,
        issue: m.errorType,
        count: m.wrongCount,
        display: m.display,
      });
    }
  }
  const mergedMistakes = [...mergedMistakesMap.values()]
    .sort((a, b) => b.count - a.count || String(a.word).localeCompare(String(b.word)))
    .slice(0, 12);

  const v2 = readinessScoreV2(
    { ...practice, ...practiceDetail },
    mergedMistakes.length > 0,
  );
  const confidence = confidenceFromSignals({
    hasLastClass: Boolean(lastAttended),
    hasParsedSummary,
    hasGameResults: practiceDetail.topWrongItems.length > 0,
    gamesPlayed: practice.gamesPlayed,
  });
  const readinessScore = v2.readinessScore || readinessFromPractice(practice.gamesPlayed);
  const finalConfidence = isTrialClass && confidence === 'high' ? 'medium' : confidence;

  const qualityImpactReasons = [];
  if (!lastAttended) qualityImpactReasons.push('no_previous_attended_class');
  if (lastAttended && !meetingIdForLastClass) qualityImpactReasons.push('last_class_missing_normalized_meeting_id');
  if (lastAttended && meetingIdForLastClass && !enrichmentFound) {
    qualityImpactReasons.push('previous_class_has_no_matched_parsed_enrichment');
  }
  if (lastAttended && enrichmentFound && !hasParsedSummary) {
    qualityImpactReasons.push('matched_enrichment_but_parsed_response_missing');
  }
  if ((practice.gamesPlayed || 0) === 0) qualityImpactReasons.push('no_recent_practice_activity');
  if (mergedMistakes.length === 0) qualityImpactReasons.push('no_recent_mistake_signals');

  return {
    classId: cid,
    studentId: Number(targetClass.studentId),
    teacherId: Number(targetClass.teacherId),
    scheduledStart: targetClass.meetingStart,
    scheduledEnd: targetClass.meetingEnd,
    lastAttendedClassId: lastAttended?.classId || null,
    lastAttendedClassEnd: lastAttended?.meetingEnd || null,
    classContext: {
      isTrialClass,
      classType: targetClass.classType || null,
      demoClassId: targetClass.demoClassId || null,
    },
    lastSessionSummary: llmSummary,
    recentMistakes: mergedMistakes,
    appPracticeSinceLastClass: {
      gamesPlayed: practice.gamesPlayed,
      completedGames: practice.completedGames,
      uniqueGameTypes: practice.uniqueGameTypes,
      overallAccuracy: practiceDetail.overallAccuracy,
      topGameTypes: practiceDetail.topGameTypes,
      grammarMistakeCount: practiceDetail.grammarMistakeCount,
      pronunciationMistakeCount: practiceDetail.pronunciationMistakeCount,
      lastActivityAt: practiceDetail.lastActivityAt,
    },
    readinessScore,
    readinessNumeric: v2.readinessNumeric,
    confidence: finalConfidence,
    qualityDiagnostics: {
      qualityImpactReasons,
      isTrialClass,
      hasLastAttendedClass: Boolean(lastAttended),
      meetingIdForLastClass: meetingIdForLastClass || null,
      enrichmentFound,
      hasParsedSummary,
      practiceGamesCount: Number(practice.gamesPlayed || 0),
      mergedMistakesCount: mergedMistakes.length,
    },
  };
}

export function preSessionHashPayload(data) {
  return {
    classId: data.classId,
    studentId: data.studentId,
    teacherId: data.teacherId,
    scheduledStart: data.scheduledStart || null,
    classContext: data.classContext || null,
    lastAttendedClassId: data.lastAttendedClassId || null,
    lastAttendedClassEnd: data.lastAttendedClassEnd || null,
    lastSessionSummary: {
      topics: [...(data.lastSessionSummary?.topics || [])].sort((a, b) => a.localeCompare(b)),
      vocabulary: [...(data.lastSessionSummary?.vocabulary || [])].sort((a, b) => a.localeCompare(b)),
      grammar: [...(data.lastSessionSummary?.grammar || [])].sort((a, b) => a.localeCompare(b)),
    },
    recentMistakes: [...(data.recentMistakes || [])]
      .map((m) => ({ word: m.word, issue: m.issue, count: m.count }))
      .sort((a, b) => `${a.word}:${a.issue}`.localeCompare(`${b.word}:${b.issue}`)),
    appPracticeSinceLastClass: data.appPracticeSinceLastClass,
    readinessScore: data.readinessScore,
    readinessNumeric: data.readinessNumeric,
    confidence: data.confidence,
    qualityDiagnostics: data.qualityDiagnostics || null,
  };
}
