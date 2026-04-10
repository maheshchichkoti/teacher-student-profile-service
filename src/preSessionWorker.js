import { query } from './db/mysql.js';
import { config } from './config.js';
import { aggregatePreSessionBriefData } from './preSessionAggregate.js';
import { generatePreSessionBrief } from './llm.js';
import {
  computePreSessionInputHash,
  getPreSessionBrief,
  markPreSessionFailed,
  markPreSessionGenerating,
  savePreSessionReady,
  upsertPreSessionBase,
} from './preSessionRepo.js';

const inFlightByClass = new Map();

function isSameHashReady(existing, hash) {
  return existing && existing.status === 'ready' && existing.inputHash === hash;
}

function isFutureClass(scheduledStart) {
  if (!scheduledStart) return false;
  return new Date(scheduledStart).getTime() > Date.now();
}

function toApiShape(row) {
  if (!row) return null;
  const summary = row.lastSessionSummary || {};
  const mistakes = Array.isArray(row.recentMistakes) ? row.recentMistakes : [];
  const recommendations = Array.isArray(row.focusRecommendations) ? row.focusRecommendations : [];
  return {
    classId: row.classId,
    status: row.status,
    lastSessionSummary: {
      topics: summary.topics || [],
      vocabulary: summary.vocabulary || [],
      grammar: summary.grammar || [],
    },
    appPracticeSinceLastClass: {
      gamesPlayed: Number(row.practiceGamesCount || 0),
      completedGames: Number(row.practiceCompletedCount || 0),
      uniqueGameTypes: Number(row.practiceUniqueGames || 0),
      overallAccuracy: Number(row.briefJson?.appPracticeSinceLastClass?.overallAccuracy || 0),
      topGameTypes: row.briefJson?.appPracticeSinceLastClass?.topGameTypes || [],
      grammarMistakeCount: Number(row.briefJson?.appPracticeSinceLastClass?.grammarMistakeCount || 0),
      pronunciationMistakeCount: Number(row.briefJson?.appPracticeSinceLastClass?.pronunciationMistakeCount || 0),
      lastActivityAt: row.briefJson?.appPracticeSinceLastClass?.lastActivityAt || null,
    },
    mistakesSinceLastClass: mistakes.map((m) => m.display || `${m.word} (${m.issue}, x${m.count})`),
    topFocusRecommendations: recommendations,
    readinessScore: String(row.readinessScore || 'low').toUpperCase(),
    readinessNumeric: Number(row.briefJson?.readinessNumeric || 0),
    confidence: String(row.briefJson?.confidence || 'low').toUpperCase(),
    classContext: row.briefJson?.classContext || row.lastSessionSummary?.classContext || null,
    generatedAt: row.generatedAt ? new Date(row.generatedAt).toISOString() : null,
    briefText: row.briefText || null,
    error: row.errorMessage || null,
  };
}

export async function refreshPreSessionBrief(classId, opts = {}) {
  const cid = Number(classId);
  if (!Number.isFinite(cid) || cid <= 0) throw new Error('Invalid classId');

  const existingRun = inFlightByClass.get(cid);
  if (existingRun) {
    console.log('[pre-session] join in-flight refresh', { classId: cid });
    return existingRun;
  }

  const run = (async () => {
    const aggregate = await aggregatePreSessionBriefData(cid);
    const inputHash = computePreSessionInputHash(aggregate);
    await upsertPreSessionBase({ ...aggregate, inputHash });
    const existing = await getPreSessionBrief(cid);

    if (!opts.force && isSameHashReady(existing, inputHash)) {
      console.log('[pre-session] cache hit', {
        classId: cid,
        status: existing?.status,
        readinessScore: aggregate.readinessScore,
      });
      return toApiShape(existing);
    }

    console.log('[pre-session] generating brief', {
      classId: cid,
      force: Boolean(opts.force),
      previousStatus: existing?.status || 'none',
      readinessScore: aggregate.readinessScore,
      practiceGamesCount: aggregate.appPracticeSinceLastClass?.gamesPlayed || 0,
      recentMistakesCount: Array.isArray(aggregate.recentMistakes) ? aggregate.recentMistakes.length : 0,
    });
    if (aggregate?.qualityDiagnostics?.qualityImpactReasons?.length) {
      console.warn('[pre-session] quality diagnostics', {
        classId: cid,
        qualityImpactReasons: aggregate.qualityDiagnostics.qualityImpactReasons,
        diagnostics: aggregate.qualityDiagnostics,
      });
    }

    await markPreSessionGenerating(cid);
    let llmOutput;
    try {
      llmOutput = await generatePreSessionBrief({
        classId: aggregate.classId,
        readinessScore: aggregate.readinessScore,
        readinessNumeric: aggregate.readinessNumeric,
        confidence: aggregate.confidence,
        lastSessionSummary: aggregate.lastSessionSummary,
        appPracticeSinceLastClass: aggregate.appPracticeSinceLastClass,
        recentMistakes: aggregate.recentMistakes,
      });
    } catch (err) {
      console.error('[pre-session] generation failed', {
        classId: cid,
        message: err?.message,
      });
      await markPreSessionFailed(cid, err?.message || 'Brief generation failed');
      const failed = await getPreSessionBrief(cid);
      return toApiShape(failed);
    }

    await savePreSessionReady(cid, {
      ...llmOutput,
      raw: {
        ...(llmOutput.raw || {}),
        appPracticeSinceLastClass: aggregate.appPracticeSinceLastClass,
        readinessNumeric: aggregate.readinessNumeric,
        confidence: aggregate.confidence,
        classContext: aggregate.classContext,
        qualityDiagnostics: aggregate.qualityDiagnostics,
      },
    });
    console.log('[pre-session] generation ready', {
      classId: cid,
      model: llmOutput?.model || null,
      generationLatencyMs: Number(llmOutput?.generationLatencyMs || 0),
      recommendationCount: Array.isArray(llmOutput?.focusRecommendations)
        ? llmOutput.focusRecommendations.length
        : 0,
    });
    const ready = await getPreSessionBrief(cid);
    return toApiShape(ready);
  })();

  inFlightByClass.set(cid, run);
  try {
    return await run;
  } finally {
    inFlightByClass.delete(cid);
  }
}

export async function getPreSessionBriefWithAutoRefresh(classId) {
  const row = await getPreSessionBrief(classId);
  if (!row) {
    console.log('[pre-session] no cached brief, scheduling initial refresh', {
      classId: Number(classId),
    });
    setImmediate(() => {
      refreshPreSessionBrief(classId).catch((err) => {
        console.error('[pre-session] initial auto-refresh failed', {
          classId,
          message: err?.message,
        });
      });
    });
    return {
      classId: Number(classId),
      status: 'pending',
      lastSessionSummary: { topics: [], vocabulary: [], grammar: [] },
      appPracticeSinceLastClass: { gamesPlayed: 0, completedGames: 0, uniqueGameTypes: 0 },
      mistakesSinceLastClass: [],
      topFocusRecommendations: [],
      readinessScore: 'LOW',
      readinessNumeric: 0,
      confidence: 'LOW',
      classContext: null,
      generatedAt: null,
      briefText: null,
      error: null,
    };
  }

  if (row.status === 'pending' || row.status === 'failed' || row.status === 'stale') {
    console.log('[pre-session] scheduling status-based refresh', {
      classId: Number(classId),
      status: row.status,
    });
    setImmediate(() => {
      refreshPreSessionBrief(classId).catch((err) => {
        console.error('[pre-session] status refresh failed', {
          classId,
          message: err?.message,
        });
      });
    });
  } else if (isFutureClass(row.scheduledStart)) {
    console.log('[pre-session] scheduling future-class hash refresh', {
      classId: Number(classId),
      status: row.status,
      scheduledStart: row.scheduledStart,
    });
    setImmediate(() => {
      refreshPreSessionBrief(classId).catch((err) => {
        console.error('[pre-session] hash refresh failed', {
          classId,
          message: err?.message,
        });
      });
    });
  }

  return toApiShape(row);
}

export async function refreshUpcomingPreSessionBriefs() {
  const rows = await query(
    `SELECT id
     FROM classes
     WHERE meeting_start >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 105 MINUTE)
       AND meeting_start < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 MINUTE)
       AND (status IS NULL OR status NOT IN ('ended', 'completed', 'cancelled'))
     ORDER BY meeting_start ASC
     LIMIT 200`,
    {},
  );

  console.log('[pre-session] scheduler scan', {
    candidateCount: rows.length,
  });

  for (const row of rows) {
    try {
      await refreshPreSessionBrief(Number(row.id));
    } catch (err) {
      console.error('[pre-session] scheduled refresh failed', {
        classId: row.id,
        message: err?.message,
      });
    }
  }
}
