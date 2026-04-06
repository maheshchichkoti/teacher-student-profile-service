import { query, queryPositional } from './db/mysql.js';

function parseJsonField(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeGrammarTopics(rows) {
  const set = new Map();
  for (const r of rows) {
    const gp = parseJsonField(r.grammar_points);
    if (!Array.isArray(gp)) continue;
    for (const item of gp) {
      if (typeof item === 'string' && item.trim()) {
        const k = item.trim();
        if (!set.has(k.toLowerCase())) set.set(k.toLowerCase(), k);
      } else if (item && typeof item === 'object' && item.topic) {
        const k = String(item.topic).trim();
        if (k && !set.has(k.toLowerCase())) set.set(k.toLowerCase(), k);
      }
    }
  }
  return [...set.values()].sort();
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

  const [prog] = await query(
    `SELECT vocabulary_mastered, current_level
     FROM student_progress
     WHERE student_id = :sid
     LIMIT 1`,
    { sid },
  );

  const totalWordsLearned = Number(prog?.vocabulary_mastered ?? 0);
  let englishLevel = prog?.current_level?.trim() || null;
  if (!englishLevel && userRow?.student_level) {
    const sl = String(userRow.student_level).trim();
    if (sl) englishLevel = sl.slice(0, 50);
  }

  const weakRows = await query(
    `SELECT item_id AS itemId, game_type AS gameType, user_answer AS userAnswer,
            mistake_count AS mistakeCount
     FROM user_mistakes
     WHERE user_id = :sid AND mistake_count >= 2
     ORDER BY last_answered_at DESC
     LIMIT 50`,
    { sid },
  );

  const weakWords = weakRows.map((w) => ({
    itemId: w.itemId,
    gameType: w.gameType,
    mistakeCount: Number(w.mistakeCount || 0),
    item:
      (w.userAnswer && String(w.userAnswer).trim()) ||
      w.itemId ||
      '(unknown)',
  }));

  const timeline = await query(
    `SELECT zoom_meeting_id AS zoomMeetingId, meeting_start AS meetingStart
     FROM classes
     WHERE student_id = :sid
       AND status = 'ended'
       AND is_present = 1
       AND zoom_meeting_id IS NOT NULL
       AND zoom_meeting_id != ''
     ORDER BY meeting_start DESC
     LIMIT 20`,
    { sid },
  );

  const meetingIds = [...new Set(timeline.map((t) => t.zoomMeetingId).filter(Boolean))];

  let grammarTopics = [];
  let lastAnalysisAt = null;

  if (meetingIds.length > 0) {
    const placeholders = meetingIds.map(() => '?').join(',');
    const analysisRows = await queryPositional(
      `SELECT grammar_points AS grammar_points, level AS level, created_at AS createdAt
       FROM llm_audio_analyses
       WHERE zoom_meeting_id IN (${placeholders})
       ORDER BY created_at DESC`,
      meetingIds,
    );

    grammarTopics = normalizeGrammarTopics(analysisRows);

    for (const r of analysisRows) {
      if (r.createdAt) {
        const t = new Date(r.createdAt).getTime();
        if (!lastAnalysisAt || t > lastAnalysisAt) lastAnalysisAt = t;
      }
      if (!englishLevel && r.level) {
        englishLevel = String(r.level).trim().slice(0, 255);
      }
    }
  }

  return {
    studentId: sid,
    englishLevel,
    totalWordsLearned,
    weakWords,
    grammarTopics,
    totalClasses,
    learningGoal,
    lastAnalysisAt: lastAnalysisAt ? new Date(lastAnalysisAt).toISOString() : null,
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
      }))
      .sort((a, b) => `${a.gameType}:${a.itemId}`.localeCompare(`${b.gameType}:${b.itemId}`)),
  };
}
