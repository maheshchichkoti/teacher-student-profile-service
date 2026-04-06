import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInputHash } from '../src/snapshotRepo.js';

test('same metrics produce same hash', () => {
  const m = {
    englishLevel: 'B1',
    totalWordsLearned: 100,
    weakWords: [
      { itemId: 1, gameType: 'x', mistakeCount: 2, item: 'word' },
      { itemId: 2, gameType: 'y', mistakeCount: 3, item: 'other' },
    ],
    grammarTopics: ['past simple', 'articles'],
    totalClasses: 5,
    learningGoal: 'IELTS',
    lastAnalysisAt: null,
    studentId: 1,
  };
  const a = computeInputHash(m);
  const b = computeInputHash({
    ...m,
    weakWords: [
      { itemId: 2, gameType: 'y', mistakeCount: 3, item: 'ignore' },
      { itemId: 1, gameType: 'x', mistakeCount: 2, item: 'ignore' },
    ],
    grammarTopics: ['articles', 'past simple'],
  });
  assert.equal(a, b);
});

test('different weakWords id changes hash', () => {
  const base = {
    englishLevel: 'B1',
    totalWordsLearned: 100,
    weakWords: [{ itemId: 1, gameType: 'x', mistakeCount: 2, item: 'a' }],
    grammarTopics: [],
    totalClasses: 0,
    learningGoal: null,
    lastAnalysisAt: null,
    studentId: 1,
  };
  const h1 = computeInputHash(base);
  const h2 = computeInputHash({
    ...base,
    weakWords: [{ itemId: 2, gameType: 'x', mistakeCount: 2, item: 'a' }],
  });
  assert.notEqual(h1, h2);
});
