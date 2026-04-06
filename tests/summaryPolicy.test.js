import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRegenerateSummary } from '../src/summaryPolicy.js';

test('regenerates when hash changed', () => {
  assert.equal(
    shouldRegenerateSummary({
      newHash: 'a',
      prevHash: 'b',
      summaryUpdatedAt: new Date().toISOString(),
      lastAnalysisAt: null,
      ttlMs: 86_400_000,
    }),
    true,
  );
});

test('regenerates when no prev hash', () => {
  assert.equal(
    shouldRegenerateSummary({
      newHash: 'x',
      prevHash: null,
      summaryUpdatedAt: new Date().toISOString(),
      lastAnalysisAt: null,
      ttlMs: 86_400_000,
    }),
    true,
  );
});

test('no regenerate when hash matches and within TTL', () => {
  const now = Date.now();
  assert.equal(
    shouldRegenerateSummary({
      newHash: 'same',
      prevHash: 'same',
      summaryUpdatedAt: new Date(now),
      lastAnalysisAt: null,
      ttlMs: 86_400_000,
    }),
    false,
  );
});

test('regenerates when summary older than TTL', () => {
  const old = new Date(Date.now() - 10 * 86_400_000);
  assert.equal(
    shouldRegenerateSummary({
      newHash: 'same',
      prevHash: 'same',
      summaryUpdatedAt: old,
      lastAnalysisAt: null,
      ttlMs: 86_400_000,
    }),
    true,
  );
});

test('regenerates when lastAnalysisAt newer than summary', () => {
  const sum = new Date('2024-01-01T12:00:00Z');
  const la = new Date('2024-06-01T12:00:00Z');
  assert.equal(
    shouldRegenerateSummary({
      newHash: 'same',
      prevHash: 'same',
      summaryUpdatedAt: sum,
      lastAnalysisAt: la,
      ttlMs: 365 * 86_400_000,
    }),
    true,
  );
});
