import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summaryDisplayFromRow,
  weakWordsForApi,
} from '../src/profileApiShape.js';

test('weakWordsForApi maps stored rows to word/count/issue', () => {
  const out = weakWordsForApi([
    { item: 'Shabbat', mistakeCount: 3, issue: 'stress', gameType: 'x' },
    { word: 'run', count: 2, issue: 'vowel' },
  ]);
  assert.deepEqual(out, [
    { word: 'Shabbat', count: 3, issue: 'stress' },
    { word: 'run', count: 2, issue: 'vowel' },
  ]);
});

test('weakWordsForApi falls back issue to gameType', () => {
  const out = weakWordsForApi([
    { item: 'a', mistakeCount: 2, gameType: 'pronunciation_flag' },
  ]);
  assert.equal(out[0].issue, 'pronunciation_flag');
});

test('summaryDisplayFromRow uses paragraph when present', () => {
  assert.equal(
    summaryDisplayFromRow({
      summaryStatus: 'ready',
      aiSummary: 'One paragraph here.',
    }),
    'One paragraph here.',
  );
});

test('summaryDisplayFromRow failed without summary', () => {
  assert.equal(
    summaryDisplayFromRow({ summaryStatus: 'failed', aiSummary: null }),
    'Summary temporarily unavailable',
  );
});

test('summaryDisplayFromRow generating placeholder', () => {
  assert.equal(
    summaryDisplayFromRow({ summaryStatus: 'pending', aiSummary: null }),
    'Generating summary...',
  );
});

test('summaryDisplayFromRow hides stale summary text while summary is pending', () => {
  assert.equal(
    summaryDisplayFromRow({
      summaryStatus: 'pending',
      aiSummary: 'Old text should not be shown',
    }),
    'Generating summary...',
  );
});
