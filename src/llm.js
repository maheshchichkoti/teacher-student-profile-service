import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * @param {object} metrics from aggregateStudentMetrics
 * @returns {Promise<string>}
 */
export async function generateTeacherSummary(metrics) {
  const block = {
    englishLevel: metrics.englishLevel,
    totalWordsLearned: metrics.totalWordsLearned,
    totalClassesCompleted: metrics.totalClasses,
    learningGoal: metrics.learningGoal,
    grammarTopicsCovered: metrics.grammarTopics,
    weakVocabulary: metrics.weakWords.map((w) => ({
      wordOrItem: w.item,
      mistakeCount: w.mistakeCount,
      gameType: w.gameType,
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

  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = msg.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!text) throw new Error('Empty Claude response');
    return text;
  }

  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty OpenAI response');
    return text;
  }

  throw new Error(
    'No LLM configured: set ANTHROPIC_API_KEY or OPENAI_API_KEY',
  );
}
