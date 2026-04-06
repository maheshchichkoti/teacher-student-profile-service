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
    return reloaded;
  }

  let summaryText;
  try {
    summaryText = await generateTeacherSummary(metrics);
  } catch (err) {
    if (reloaded.aiSummary) {
      return reloaded;
    }
    await markSnapshotFailed(sid);
    throw err;
  }

  await updateSnapshotSummary(sid, summaryText);
  return parseSnapshotRow(await getSnapshot(sid));
}
