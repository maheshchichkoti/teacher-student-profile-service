/**
 * Task 1 teacher summary — Gemini only (Google Generative Language API).
 * @param {object} metrics from aggregateStudentMetrics
 * @returns {Promise<string>}
 */
export async function generateTeacherSummary(metrics) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey?.trim()) {
    throw new Error(
      'GEMINI_API_KEY is required for the AI summary (Gemini is the only configured provider for this service).',
    );
  }

  const block = {
    englishLevel: metrics.englishLevel,
    totalWordsLearned: metrics.totalWordsLearned,
    totalClassesCompleted: metrics.totalClasses,
    learningGoal: metrics.learningGoal,
    grammarTopicsCovered: metrics.grammarTopics,
    weakVocabulary: metrics.weakWords.map((w) => ({
      word: w.item ?? w.word ?? w.itemId,
      count: w.mistakeCount,
      issue: w.issue ?? w.gameType,
    })),
  };

  const system = `You are an experienced ESL teacher writing a short progress note for another teacher.
Rules:
- Write exactly one paragraph of 3 to 5 sentences.
- Warm, professional, plain English.
- Do not invent numbers, levels, or facts that are not in the provided data.
- If a field is empty or zero, acknowledge uncertainty briefly rather than guessing.
- No bullet points.`;

  const user = `Use only this JSON data:\n${JSON.stringify(block, null, 2)}`;

  const configuredModel = (process.env.GEMINI_MODEL || '').trim();
  const model = !configuredModel || configuredModel === 'gemini-2.0-flash'
    ? 'gemini-2.5-flash'
    : configuredModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: `${system}\n\n${user}` }],
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    ?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return {
    text,
    provider: 'gemini',
    model,
    promptVersion: 'v1',
    generationLatencyMs: Date.now() - started,
  };
}

function buildPreSessionPrompt(input) {
  return `You are an experienced ESL supervisor writing a pre-session handoff for a teacher.
Return STRICT JSON only (no markdown, no code fences) using this schema:
{
  "lastSessionNarrative": "2-4 sentence concise summary of last class",
  "focusRecommendations": ["item1", "item2", "item3"],
  "readinessRationale": "short reason for readiness score"
}

Rules:
- focusRecommendations must contain exactly 3 actionable strings.
- Every recommendation must be specific and grounded in the provided data.
- Every recommendation must include evidence: source + measurable signal (count/frequency/recency/topic).
- Avoid generic recommendations like "keep practicing" unless tied to evidence.
- If there is no app practice, still provide useful recommendations from session history.
- If previous-class enrichment is missing or sparse, do NOT pretend lesson content existed.
- When data is sparse, switch to a teacher-operational fallback: diagnostic opener, confidence-building activity, and baseline speaking/vocabulary check.
- For new or low-context students, recommendations should help the teacher start the lesson well in the first 5-10 minutes.
- If class context indicates trial, website, or no-history patterns, mention that context when useful.
- Do not invent facts or numbers.

Data:
${JSON.stringify(input, null, 2)}`;
}

function parseJsonFromText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Task 2 pre-session brief generator (Gemini only).
 * @param {object} input
 * @returns {Promise<{briefText: string, focusRecommendations: string[], raw: object, model: string, generationLatencyMs: number}>}
 */
export async function generatePreSessionBrief(input) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey?.trim()) {
    throw new Error(
      'GEMINI_API_KEY is required for pre-session brief generation (Gemini-only policy).',
    );
  }

  const configuredModel = (process.env.GEMINI_MODEL || '').trim();
  const model = !configuredModel || configuredModel === 'gemini-2.0-flash'
    ? 'gemini-2.5-flash'
    : configuredModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: buildPreSessionPrompt(input) }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    ?.trim();
  if (!text) throw new Error('Empty Gemini pre-session response');
  const parsed = parseJsonFromText(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid Gemini pre-session JSON response');
  }

  const recommendations = Array.isArray(parsed.focusRecommendations)
    ? parsed.focusRecommendations
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  while (recommendations.length < 3) {
    recommendations.push('Review last class key points with guided speaking practice.');
  }

  const narrative = String(parsed.lastSessionNarrative || '').trim();
  const rationale = String(parsed.readinessRationale || '').trim();
  const briefText = [narrative, `Readiness: ${input.readinessScore.toUpperCase()}. ${rationale}`]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    briefText,
    focusRecommendations: recommendations,
    raw: parsed,
    model,
    generationLatencyMs: Date.now() - started,
  };
}
