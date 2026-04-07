import { aggregateStudentMetrics } from './aggregate.js';
import { generateTeacherSummary } from './llm.js';
import {
  computeInputHash,
  ensureSnapshotRow,
  getSnapshot,
  markSnapshotFailed,
  markSnapshotGenerating,
  parseSnapshotRow,
  updateSnapshotMetrics,
  updateSnapshotSummary,
} from './snapshotRepo.js';
import { shouldRegenerateSummary } from './summaryPolicy.js';

/**
 * Full refresh: metrics + optional LLM summary.
 * @param {number} studentId
 * @param {{ skipLlm?: boolean }} opts
 */
export async function refreshStudentProfile(studentId, opts = {}) {
  const sid = Number(studentId);
  await ensureSnapshotRow(sid);
  const existing = parseSnapshotRow(await getSnapshot(sid));

  await markSnapshotGenerating(sid);

  let metrics;
  try {
    metrics = await aggregateStudentMetrics(sid);
  } catch (e) {
    await markSnapshotFailed(sid);
    throw e;
  }

  const inputHash = computeInputHash(metrics);
  await updateSnapshotMetrics(sid, metrics, inputHash);

  const reloaded = parseSnapshotRow(await getSnapshot(sid));
  if (!reloaded) {
    await markSnapshotFailed(sid);
    throw new Error('Snapshot missing after metrics write');
  }

  if (opts.skipLlm) {
    return reloaded;
  }

  const needLlm =
    !reloaded.aiSummary ||
    shouldRegenerateSummary({
      newHash: inputHash,
      prevHash: existing?.inputHash || null,
      summaryUpdatedAt: reloaded.summaryUpdatedAt,
      lastAnalysisAt: reloaded.lastAnalysisAt,
    });

  if (!needLlm) {
    console.log('[worker] summary skipped (fresh)', {
      studentId: sid,
      hasSummary: Boolean(reloaded.aiSummary),
    });
    return reloaded;
  }

  let summaryText;
  try {
    console.log('[worker] summary generation started', { studentId: sid });
    summaryText = await generateTeacherSummary(metrics);
  } catch (err) {
    console.error('[worker] summary generation failed', {
      studentId: sid,
      message: err?.message,
      stack: err?.stack,
    });
    if (reloaded.aiSummary) {
      return reloaded;
    }
    // Metrics are already persisted as `ready`; do not flip snapshot to `failed`
    // so the screen stays usable (Task 1: never block profile on summary).
    return reloaded;
  }

  await updateSnapshotSummary(sid, summaryText);
  console.log('[worker] summary generation completed', { studentId: sid });
  return parseSnapshotRow(await getSnapshot(sid));
}
