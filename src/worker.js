import { aggregateStudentMetrics } from './aggregate.js';
import { generateTeacherSummary } from './llm.js';
import {
  computeInputHash,
  ensureSnapshotRow,
  getSnapshot,
  markMetricsFailed,
  markMetricsGenerating,
  markSummaryFailed,
  markSummaryGenerating,
  markSummaryReady,
  parseSnapshotRow,
  updateSnapshotMetrics,
  updateSnapshotSummary,
} from './snapshotRepo.js';
import { shouldRegenerateSummary } from './summaryPolicy.js';

const inFlightRefreshes = new Map();

/**
 * Full refresh: metrics + optional LLM summary.
 * @param {number} studentId
 * @param {{ skipLlm?: boolean }} opts
 */
export async function refreshStudentProfile(studentId, opts = {}) {
  const sid = Number(studentId);
  const existingInFlight = inFlightRefreshes.get(sid);
  if (existingInFlight) {
    console.log('[worker] refresh joined existing run', { studentId: sid });
    return existingInFlight;
  }

  const run = (async () => {
    await ensureSnapshotRow(sid);
    const existing = parseSnapshotRow(await getSnapshot(sid));

    await markMetricsGenerating(sid);

    let metrics;
    try {
      metrics = await aggregateStudentMetrics(sid);
    } catch (e) {
      await markMetricsFailed(sid);
      throw e;
    }

    const inputHash = computeInputHash(metrics);
    const needLlm =
      !existing?.aiSummary ||
      shouldRegenerateSummary({
        newHash: inputHash,
        prevHash: existing?.inputHash || null,
        summaryUpdatedAt: existing?.summaryUpdatedAt,
        lastAnalysisAt: metrics.lastAnalysisAt,
      });

    await updateSnapshotMetrics(sid, metrics, inputHash, needLlm ? 'pending' : 'ready');

    if (metrics?.qualityDiagnostics?.qualityImpactReasons?.length) {
      console.warn('[worker] task1 quality diagnostics', {
        studentId: sid,
        qualityImpactReasons: metrics.qualityDiagnostics.qualityImpactReasons,
        diagnostics: metrics.qualityDiagnostics,
      });
    }

    const reloaded = parseSnapshotRow(await getSnapshot(sid));
    if (!reloaded) {
      await markMetricsFailed(sid);
      throw new Error('Snapshot missing after metrics write');
    }

    if (opts.skipLlm) {
      return reloaded;
    }

    if (!needLlm) {
      await markSummaryReady(sid);
      console.log('[worker] summary skipped (fresh)', {
        studentId: sid,
        hasSummary: Boolean(reloaded.aiSummary),
      });
      return parseSnapshotRow(await getSnapshot(sid));
    }

    await markSummaryGenerating(sid);

    let summaryResult;
    try {
      console.log('[worker] summary generation started', { studentId: sid });
      summaryResult = await generateTeacherSummary(metrics);
    } catch (err) {
      console.error('[worker] summary generation failed', {
        studentId: sid,
        message: err?.message,
        stack: err?.stack,
      });
      await markSummaryFailed(sid);
      if (reloaded.aiSummary) {
        return parseSnapshotRow(await getSnapshot(sid));
      }
      // Metrics are already persisted as `ready`; do not flip snapshot to `failed`
      // so the screen stays usable (Task 1: never block profile on summary).
      return parseSnapshotRow(await getSnapshot(sid));
    }

    await updateSnapshotSummary(sid, summaryResult);
    console.log('[worker] summary generation completed', { studentId: sid });
    return parseSnapshotRow(await getSnapshot(sid));
  })();

  inFlightRefreshes.set(sid, run);

  try {
    return await run;
  } finally {
    inFlightRefreshes.delete(sid);
  }
}
