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

function buildSystem(sourceLanguage: string, targetLanguage: string, difficulty: string, nativeLanguage: string, includeTitle: boolean): string {
  const difficultyNote = DIFFICULTY_INSTRUCTIONS[difficulty] ?? DIFFICULTY_INSTRUCTIONS.intermediate;
  const titleInstruction = includeTitle
    ? `First output a title line:\n` +
      `{"title":"<concise title for this article, in ${nativeLanguage}>"}\n\n` +
      `Then translate each sentence:\n`
    : `Translate each sentence:\n`;

  return (
    `You are a language translation assistant. You will receive article text in ${sourceLanguage}.\n` +
    `Reading difficulty: ${difficulty}. ${difficultyNote}\n\n` +
    `Output only JSON objects, one per line. No markdown, no preamble, no explanation.\n\n` +
    titleInstruction +
    `{"original":"<exact original sentence>","translation":"<that sentence in ${targetLanguage}>"}\n\n` +
    `Rules:\n` +
    `- One JSON object per line — no arrays, no wrapper\n` +
    `- Split on sentence-ending punctuation (. ! ?). Do not skip or merge sentences.\n` +
    `- Escape internal quotes as \\" and backslashes as \\\\`
  );
}

async function processLine(
  line: string,
  articleId: string,
  rowOrderRef: { value: number },
  resolvedTitleRef: { value: string | null },
  sourceLanguage: string,
  targetLanguage: string,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return; // skip malformed lines
  }

  if (typeof parsed.title === 'string' && resolvedTitleRef.value === null) {
    const t = parsed.title.trim();
    if (t) {
      resolvedTitleRef.value = t;
      await pool.query(`UPDATE articles SET title = $1 WHERE id = $2`, [t, articleId]);
    }
    return;
  }

  if (typeof parsed.original === 'string' && typeof parsed.translation === 'string') {
    await pool.query(
      `INSERT INTO article_text (article_id, row_order, original, translated, source_language, target_language)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [articleId, rowOrderRef.value++, parsed.original, parsed.translation, sourceLanguage, targetLanguage],
    );
  }
}

export async function runContinuationJob(
  articleId: string,
  userId: string,
  remainingText: string,
  sourceLanguage: string,
  targetLanguage: string,
  nativeLanguage: string,
  difficulty: string,
  startRowOrder: number,
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
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const rowOrderRef = { value: startRowOrder };
  // Pass non-null so processLine skips title extraction
  const resolvedTitleRef: { value: string | null } = { value: 'existing' };

  const chunks: string[] = [];
  for (let i = 0; i < remainingText.length; i += CHUNK_SIZE) {
    chunks.push(remainingText.slice(i, i + CHUNK_SIZE));
  }

  try {
    for (const chunk of chunks) {
      const system = buildSystem(sourceLanguage, targetLanguage, difficulty, nativeLanguage, false);
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
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            await processLine(line, articleId, rowOrderRef, resolvedTitleRef, sourceLanguage, targetLanguage);
          }
        }
        if (event.type === 'message_delta') {
          totalOutputTokens += event.usage?.output_tokens ?? 0;
        }
      }

      if (buffer.trim()) {
        await processLine(buffer, articleId, rowOrderRef, resolvedTitleRef, sourceLanguage, targetLanguage);
      }
    }

    await pool.query(
      `INSERT INTO api_costs (user_id, source, model, language, input_credit_rate, total_input_credits, output_credit_rate, total_output_credits, article_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, 'article', MODEL, targetLanguage, INPUT_RATE, totalInputTokens, OUTPUT_RATE, totalOutputTokens, articleId],
    );

    await pool.query(
      `UPDATE articles
       SET status = 'complete', remaining_text = NULL,
           input_tokens = input_tokens + $1, output_tokens = output_tokens + $2
       WHERE id = $3`,
      [totalInputTokens, totalOutputTokens, articleId],
    );
  } catch (err) {
    console.error(`Continuation job failed for article ${articleId}:`, err);
    await pool.query(
      `UPDATE articles SET status = 'error', status_message = $1 WHERE id = $2`,
      [err instanceof Error ? err.message : 'Translation failed', articleId],
    );
  }
}

export async function runTranslationJob(
  articleId: string,
  userId: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  nativeLanguage: string,
  difficulty: string,
  hintTitle?: string,
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

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const rowOrderRef = { value: 0 };
  // null = not yet extracted; string = extracted title
  const resolvedTitleRef: { value: string | null } = { value: hintTitle?.trim() || null };

  // If we already have a hint title from the scraper, store it immediately
  if (resolvedTitleRef.value) {
    await pool.query(`UPDATE articles SET title = $1 WHERE id = $2`, [resolvedTitleRef.value, articleId]);
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  try {
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      // Ask for title only on first chunk, and only if we don't have one yet
      const includeTitle = chunkIndex === 0 && resolvedTitleRef.value === null;
      const system = buildSystem(sourceLanguage, targetLanguage, difficulty, nativeLanguage, includeTitle);

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
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            await processLine(line, articleId, rowOrderRef, resolvedTitleRef, sourceLanguage, targetLanguage);
          }
        }
        if (event.type === 'message_delta') {
          totalOutputTokens += event.usage?.output_tokens ?? 0;
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        await processLine(buffer, articleId, rowOrderRef, resolvedTitleRef, sourceLanguage, targetLanguage);
      }
    }

    const finalTitle = resolvedTitleRef.value;

    await pool.query(
      `INSERT INTO api_costs (user_id, source, model, language, input_credit_rate, total_input_credits, output_credit_rate, total_output_credits, description, article_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, 'article', MODEL, targetLanguage, INPUT_RATE, totalInputTokens, OUTPUT_RATE, totalOutputTokens, finalTitle, articleId],
    );

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
