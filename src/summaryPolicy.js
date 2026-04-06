import { config } from './config.js';

/**
 * @param {{ newHash: string, prevHash: string|null, summaryUpdatedAt: Date|string, lastAnalysisAt: Date|string|null }} p
 */
export function shouldRegenerateSummary(p) {
  const { newHash, prevHash, summaryUpdatedAt, lastAnalysisAt, ttlMs: ttlMsOverride } = p;
  if (!prevHash || prevHash !== newHash) return true;

  const ttlMs =
    typeof ttlMsOverride === 'number' && Number.isFinite(ttlMsOverride)
      ? ttlMsOverride
      : config.summaryTtlDays * 24 * 60 * 60 * 1000;
  const summaryTime = new Date(summaryUpdatedAt).getTime();
  if (Number.isFinite(summaryTime) && Date.now() - summaryTime > ttlMs)
    return true;

  if (lastAnalysisAt) {
    const la = new Date(lastAnalysisAt).getTime();
    if (Number.isFinite(la) && la > summaryTime) return true;
  }

  return false;
}
