/**
 * Tolerant extractors for raw.llm_responses.parsed_response (Lessonscope shapes).
 * Aligns with teacher-intelligence: grammar + vocabulary from enrichment;
 * weak items from pronunciation_flags (count >= 2), not user_mistakes.
 */

export function parseJsonValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
}

/** @param {unknown} gp */
export function normalizeGrammarPoints(gp) {
  const set = new Map();
  const arr = Array.isArray(gp) ? gp : [];
  for (const item of arr) {
    if (typeof item === 'string' && item.trim()) {
      const k = item.trim();
      if (!set.has(k.toLowerCase())) set.set(k.toLowerCase(), k);
    } else if (item && typeof item === 'object' && item.topic) {
      const k = String(item.topic).trim();
      if (k && !set.has(k.toLowerCase())) set.set(k.toLowerCase(), k);
    }
  }
  return [...set.values()].sort();
}

/** Nested lesson_analysis (flat or under raw_analysis) */
function lessonAnalysisFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const ra = pr.raw_analysis;
  return pr.lesson_analysis || (ra && typeof ra === 'object' ? ra.lesson_analysis : null);
}

/** Nested student_performance (flat or under raw_analysis) */
function studentPerformanceFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const ra = pr.raw_analysis;
  return pr.student_performance || (ra && typeof ra === 'object' ? ra.student_performance : null);
}

/** Nested metadata (flat or under raw_analysis) */
function metadataFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const ra = pr.raw_analysis;
  return pr.metadata || (ra && typeof ra === 'object' ? ra.metadata : null);
}

/** @param {Record<string, unknown>|null} pr */
export function grammarPointsFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return [];
  const la = lessonAnalysisFromParsed(pr);
  const chunks = [
    pr.grammar_points,
    la?.learned_content?.grammar_points,
    la?.learned_content?.grammar,
  ].filter((c) => c != null);
  const merged = [];
  for (const c of chunks) {
    if (Array.isArray(c)) merged.push(...c);
  }
  return normalizeGrammarPoints(merged);
}

/**
 * Words from gamified payload keys sometimes shipped alongside analysis (flashcards, spelling_bee).
 * Does not replace lesson vocabulary; merged by caller for breadth.
 * @param {Record<string, unknown>|null} root
 * @returns {string[]}
 */
export function vocabularyTokensFromGamesShape(root) {
  if (!root || typeof root !== 'object') return [];
  const out = [];
  const flashcards = root.flashcards;
  if (Array.isArray(flashcards)) {
    for (const c of flashcards) {
      if (c && typeof c === 'object' && c.word_base != null && String(c.word_base).trim()) {
        out.push(String(c.word_base).trim());
      }
    }
  }
  const bee = root.spelling_bee;
  if (Array.isArray(bee)) {
    for (const c of bee) {
      if (c && typeof c === 'object' && c.word != null && String(c.word).trim()) {
        out.push(String(c.word).trim());
      }
    }
  }
  return out;
}

function pushVocabItems(raw, out) {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push(item.trim());
    } else if (item && typeof item === 'object') {
      const w = item.word ?? item.term ?? item.item;
      if (w != null && String(w).trim()) out.push(String(w).trim());
    }
  }
}

/** @param {Record<string, unknown>|null} pr */
export function vocabularyTokensFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return [];
  const la = lessonAnalysisFromParsed(pr);
  const out = [];
  pushVocabItems(pr.vocabulary_words, out);
  pushVocabItems(la?.learned_content?.vocabulary_list, out);
  pushVocabItems(la?.learned_content?.vocabulary_words, out);
  const fromGames = [
    ...vocabularyTokensFromGamesShape(pr),
    ...vocabularyTokensFromGamesShape(pr.raw_analysis),
    ...vocabularyTokensFromGamesShape(
      typeof pr.games === 'object' ? pr.games : null,
    ),
    ...vocabularyTokensFromGamesShape(
      typeof pr.games_response === 'object' ? pr.games_response : null,
    ),
    ...vocabularyTokensFromGamesShape(
      typeof pr.practice_content === 'object' ? pr.practice_content : null,
    ),
  ];
  return [...out, ...fromGames];
}

/** @param {Record<string, unknown>|null} pr */
export function pronunciationFlagsFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return [];
  const sp = studentPerformanceFromParsed(pr);
  const top = pr.pronunciation_flags;
  const nest = sp?.pronunciation_flags;
  const topArr = Array.isArray(top) ? top : [];
  const nestArr = Array.isArray(nest) ? nest : [];
  if (topArr.length > 0) return topArr;
  if (nestArr.length > 0) return nestArr;
  return topArr;
}

/** @param {Record<string, unknown>|null} pr */
export function levelFromParsed(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const md = metadataFromParsed(pr);
  const la = lessonAnalysisFromParsed(pr);
  const sp = studentPerformanceFromParsed(pr);
  const candidates = [
    pr.cefr_level,
    md?.cefr_level,
    pr.level,
    la?.level,
    sp?.level,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim().slice(0, 50);
  }
  return null;
}
