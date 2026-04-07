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

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
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
  return text;
}
