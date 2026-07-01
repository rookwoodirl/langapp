import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';

const DIFFICULTY_INSTRUCTIONS: Record<string, string> = {
  beginner:
    'Write the translation using simple, everyday vocabulary and short sentences. ' +
    'Avoid idioms and complex grammar. Prioritise clarity over nuance.',
  intermediate:
    'Write the translation at a standard reading level. ' +
    'Preserve most of the original meaning and structure, but simplify unusually complex phrasing.',
  advanced:
    'Write the translation preserving the full sophistication of the original: ' +
    'idiomatic expressions, nuanced vocabulary, and complex sentence structures.',
};

// Sonnet 4.6 pricing (per token)
const INPUT_RATE = 3.0 / 1_000_000;
const OUTPUT_RATE = 15.0 / 1_000_000;
const MODEL = 'claude-sonnet-4-6';
const CHUNK_SIZE = 40_000;

export async function runTranslationJob(
  articleId: string,
  userId: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  nativeLanguage: string,
  difficulty: string,
  title?: string,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await pool.query(
      `UPDATE articles SET status = 'error', status_message = $1 WHERE id = $2`,
      ['ANTHROPIC_API_KEY is not configured on the server.', articleId],
    );
    return;
  }

  const client = new Anthropic({ apiKey });
  const difficultyNote = DIFFICULTY_INSTRUCTIONS[difficulty] ?? DIFFICULTY_INSTRUCTIONS.intermediate;

  const system =
    `You are a language translation assistant. You will receive article text in ${sourceLanguage}.\n` +
    `Reading difficulty: ${difficulty}. ${difficultyNote}\n\n` +
    `Translate the text sentence by sentence. For each sentence output exactly one JSON object on its own line:\n` +
    `{"original":"<the exact original sentence>","translation":"<that sentence in ${targetLanguage}>"}\n\n` +
    `Rules:\n` +
    `- One JSON object per line — no arrays, no wrapper object\n` +
    `- Split on sentence-ending punctuation (. ! ?). Do not skip or merge sentences.\n` +
    `- All string values must be valid JSON strings: escape internal quotes as \\" and backslashes as \\\\\n` +
    `- No markdown, no preamble, no explanation — only JSON lines`;

  let rowOrder = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  try {
    for (const chunk of chunks) {
      let buffer = '';

      const stream = await client.messages.create({
        model: MODEL,
        max_tokens: 32768,
        system,
        messages: [{ role: 'user', content: chunk }],
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'message_start') {
          totalInputTokens += event.message.usage?.input_tokens ?? 0;
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          buffer += event.delta.text;

          // Flush all complete lines from the buffer
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (!line) continue;
            try {
              const parsed = JSON.parse(line) as { original: string; translation: string };
              if (typeof parsed.original === 'string' && typeof parsed.translation === 'string') {
                await pool.query(
                  `INSERT INTO article_text (article_id, row_order, original, translated, source_language, target_language)
                   VALUES ($1, $2, $3, $4, $5, $6)`,
                  [articleId, rowOrder++, parsed.original, parsed.translation, sourceLanguage, targetLanguage],
                );
              }
            } catch {
              // Malformed JSON line — skip
            }
          }
        }
        if (event.type === 'message_delta') {
          totalOutputTokens += event.usage?.output_tokens ?? 0;
        }
      }

      // Flush any remaining buffer content after stream ends
      const remaining = buffer.trim();
      if (remaining) {
        try {
          const parsed = JSON.parse(remaining) as { original: string; translation: string };
          if (typeof parsed.original === 'string' && typeof parsed.translation === 'string') {
            await pool.query(
              `INSERT INTO article_text (article_id, row_order, original, translated, source_language, target_language)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [articleId, rowOrder++, parsed.original, parsed.translation, sourceLanguage, targetLanguage],
            );
          }
        } catch {
          // ignore
        }
      }
    }

    // Record cost in api_costs (one row per article translation)
    const description = title?.trim() || null;
    await pool.query(
      `INSERT INTO api_costs (user_id, source, model, language, input_credit_rate, total_input_credits, output_credit_rate, total_output_credits, description, article_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, 'article', MODEL, targetLanguage, INPUT_RATE, totalInputTokens, OUTPUT_RATE, totalOutputTokens, description, articleId],
    );

    // Mark complete with token totals
    await pool.query(
      `UPDATE articles SET status = 'complete', input_tokens = $1, output_tokens = $2 WHERE id = $3`,
      [totalInputTokens, totalOutputTokens, articleId],
    );
  } catch (err) {
    console.error(`Translation job failed for article ${articleId}:`, err);
    await pool.query(
      `UPDATE articles SET status = 'error', status_message = $1 WHERE id = $2`,
      [err instanceof Error ? err.message : 'Translation failed', articleId],
    );
  }
}
