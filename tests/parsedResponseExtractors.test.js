import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grammarPointsFromParsed,
  levelFromParsed,
  pronunciationFlagsFromParsed,
  vocabularyTokensFromGamesShape,
  vocabularyTokensFromParsed,
} from '../src/parsedResponseExtractors.js';

/** Mirrors production shape: top-level mirrors + raw_analysis nest */
const sampleAnalysis = {
  level: 'A1 Elementary',
  grammar_points: ['Past Simple Tense formation for irregular verbs (went, ate)'],
  vocabulary_words: ['hot', 'park'],
  pronunciation_flags: [],
  raw_analysis: {
    metadata: { cefr_level: 'A1 Elementary' },
    lesson_analysis: {
      learned_content: {
        grammar_points: ['Past Simple from nested'],
        vocabulary_list: ['snowy', 'rainy'],
      },
    },
    student_performance: {
      pronunciation_flags: [{ word: 'went', count: 3 }],
    },
  },
};

test('grammar: uses top-level grammar_points and nested raw_analysis.lesson_analysis', () => {
  const g = grammarPointsFromParsed(sampleAnalysis);
  assert.ok(g.some((s) => s.includes('Past Simple')));
  assert.ok(g.some((s) => s.includes('nested')));
});

test('vocabulary: merges vocabulary_words, learned_content.vocabulary_list, and order stable', () => {
  const v = vocabularyTokensFromParsed(sampleAnalysis);
  assert.ok(v.includes('hot'));
  assert.ok(v.includes('park'));
  assert.ok(v.includes('snowy'));
  assert.ok(v.includes('rainy'));
});

test('level: reads top-level level and raw_analysis.metadata.cefr_level', () => {
  assert.equal(levelFromParsed(sampleAnalysis), 'A1 Elementary');
});

test('pronunciation_flags: prefers top-level; falls back to raw_analysis.student_performance', () => {
  const emptyTop = {
    pronunciation_flags: [],
    raw_analysis: {
      student_performance: {
        pronunciation_flags: [{ word: 'library', count: 2 }],
      },
    },
  };
  const flags = pronunciationFlagsFromParsed(emptyTop);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].word, 'library');
});

test('pronunciation_flags: empty top-level array still reads nested raw_analysis', () => {
  const flags = pronunciationFlagsFromParsed(sampleAnalysis);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].word, 'went');
});

const gamesOnly = {
  flashcards: [
    { word_base: 'hot', meaning_en: 'x' },
    { word_base: 'park', meaning_en: 'y' },
  ],
  spelling_bee: [{ word: 'library', meaning: 'z' }],
};

test('vocabularyTokensFromGamesShape extracts word_base and spelling words', () => {
  const w = vocabularyTokensFromGamesShape(gamesOnly);
  assert.deepEqual(new Set(w), new Set(['hot', 'park', 'library']));
});

test('vocabularyTokensFromParsed merges games nested under games_response', () => {
  const pr = {
    vocabulary_words: ['ate'],
    games_response: gamesOnly,
  };
  const v = vocabularyTokensFromParsed(pr);
  assert.ok(v.includes('ate'));
  assert.ok(v.includes('hot'));
  assert.ok(v.includes('library'));
});
