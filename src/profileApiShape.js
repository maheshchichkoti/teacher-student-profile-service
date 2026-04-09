/**
 * Normalizes snapshot rows for GET /profile (Task 1 checklist + UI strings).
 */

/** Task 1 UI copy when there is no paragraph yet (simple build guide). */
export function summaryDisplayFromRow(r) {
  const summaryStatus = r.summaryStatus || 'pending';
  const text = r.aiSummary != null && String(r.aiSummary).trim();
  if (summaryStatus === 'ready' && text) return String(r.aiSummary).trim();
  if (summaryStatus === 'failed') return 'Summary temporarily unavailable';
  if (summaryStatus === 'ready') return 'Summary not available yet';
  return 'Generating summary...';
}

/** Public weak-word items: `{ word, count, issue }`. */
export function weakWordsForApi(list) {
  return (list || [])
    .map((w) => ({
      word: String(w.word ?? w.item ?? w.itemId ?? '').trim(),
      count: Number(w.count ?? w.mistakeCount ?? 0),
      issue:
        w.issue != null && String(w.issue).trim()
          ? String(w.issue).trim()
          : String(w.gameType || 'pronunciation'),
    }))
    .filter((w) => w.word);
}
