import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { runTranslationJob, runContinuationJob } from '../translationService';
import { requireAuth } from '../middleware/auth';
import { checkBalance, InsufficientCreditsError } from '../creditService';

const router = Router();

// Start a background streaming translation job
router.post('/translate', requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const { text, url, title, source_language, target_language, native_language, difficulty } = req.body;

  if (!text || !source_language || !target_language) {
    return res.status(400).json({ error: 'text, source_language, and target_language are required' });
  }

  try {
    await checkBalance(userId);

    const result = await pool.query(
      `INSERT INTO articles (user_id, url, title, source_language, target_language, status, original_sentences, translated_sentences, vocab)
       VALUES ($1, $2, $3, $4, $5, 'translating', '[]', '[]', '[]')
       RETURNING id`,
      [userId, url ?? null, title ?? null, source_language, target_language],
    );
    const articleId = result.rows[0].id as string;

    // Fire-and-forget — response is already sent
    void runTranslationJob(
      articleId,
      userId,
      text as string,
      source_language as string,
      target_language as string,
      (native_language as string) ?? 'en',
      (difficulty as string) ?? 'intermediate',
      (title as string) ?? undefined,
    ).catch((err) => console.error('Unhandled translation job error:', err));

    return res.status(201).json({ id: articleId });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'insufficient_credits', balanceUsd: err.balanceUsd });
    }
    console.error('POST /articles/translate error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Poll for newly translated sentences (after row_order >= `after`)
router.get('/:id/sentences', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id, after } = req.query;
  const afterOrder = Math.max(0, parseInt(String(after ?? '0'), 10));

  try {
    const articleResult = await pool.query(
      `SELECT status FROM articles WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [id, user_id],
    );
    if (articleResult.rows.length === 0) return res.status(404).json({ error: 'Article not found' });

    const sentencesResult = await pool.query(
      `SELECT original, translated FROM article_text WHERE article_id = $1 AND row_order >= $2 ORDER BY row_order`,
      [id, afterOrder],
    );

    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM article_text WHERE article_id = $1`,
      [id],
    );

    return res.json({
      sentences: sentencesResult.rows.map((r) => ({ original: r.original as string, translation: r.translated as string })),
      status: articleResult.rows[0].status as string,
      total: parseInt(totalResult.rows[0].total as string, 10),
    });
  } catch (err) {
    console.error('GET /articles/:id/sentences error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Save a translated article (or create a stub with status='translating' for device translation)
router.post('/', async (req: Request, res: Response) => {
  const { user_id, url, title, source_language, target_language, sentence_pairs, vocab, input_tokens, output_tokens, status } = req.body;

  if (!user_id || !Array.isArray(sentence_pairs)) {
    return res.status(400).json({ error: 'user_id and sentence_pairs are required' });
  }

  const articleStatus = (status as string) || 'complete';
  const originalSentences: string[] = sentence_pairs.map((p: { original: string }) => p.original ?? '');
  const translatedSentences: string[] = sentence_pairs.map((p: { translation: string }) => p.translation ?? '');

  try {
    const result = await pool.query(
      `INSERT INTO articles (user_id, url, title, source_language, target_language, original_sentences, translated_sentences, vocab, input_tokens, output_tokens, remaining_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, created_at`,
      [
        user_id,
        url ?? null,
        title ?? null,
        source_language,
        target_language,
        JSON.stringify(originalSentences),
        JSON.stringify(translatedSentences),
        JSON.stringify(vocab ?? []),
        input_tokens ?? 0,
        output_tokens ?? 0,
        req.body.remaining_text ?? null,
        articleStatus,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /articles error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Append sentences to article_text for device translation streaming
router.post('/:id/text', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id, sentences, complete } = req.body;

  if (!user_id || !Array.isArray(sentences)) {
    return res.status(400).json({ error: 'user_id and sentences are required' });
  }

  try {
    const check = await pool.query(
      `SELECT source_language, target_language FROM articles WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [id, user_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Article not found' });
    const { source_language, target_language } = check.rows[0];

    if (sentences.length > 0) {
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(row_order) + 1, 0) AS next_row FROM article_text WHERE article_id = $1`,
        [id],
      );
      const startRow = parseInt(maxResult.rows[0].next_row as string, 10);
      for (let i = 0; i < sentences.length; i++) {
        const s = sentences[i] as { original: string; translation: string };
        await pool.query(
          `INSERT INTO article_text (article_id, row_order, original, translated, source_language, target_language)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, startRow + i, s.original, s.translation, source_language, target_language],
        );
      }
    }

    if (complete) {
      await pool.query(`UPDATE articles SET status = 'complete' WHERE id = $1`, [id]);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /articles/:id/text error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// List saved articles for a user (newest first)
router.get('/', async (req: Request, res: Response) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    const result = await pool.query(
      `SELECT
         a.id, a.url, a.title, a.source_language, a.target_language,
         a.vocab, a.input_tokens, a.output_tokens, a.remaining_text, a.created_at, a.status, a.status_message,
         CASE WHEN jsonb_array_length(a.original_sentences) > 0
           THEN a.original_sentences
           ELSE COALESCE(
             (SELECT jsonb_agg(t.original ORDER BY t.row_order)
              FROM (SELECT original, row_order FROM article_text WHERE article_id = a.id ORDER BY row_order LIMIT 5) t),
             '[]'::jsonb
           )
         END AS original_sentences,
         CASE WHEN jsonb_array_length(a.translated_sentences) > 0
           THEN a.translated_sentences
           ELSE COALESCE(
             (SELECT jsonb_agg(t.translated ORDER BY t.row_order)
              FROM (SELECT translated, row_order FROM article_text WHERE article_id = a.id ORDER BY row_order LIMIT 5) t),
             '[]'::jsonb
           )
         END AS translated_sentences
       FROM articles a
       WHERE a.user_id = $1 AND a.deleted = false
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [user_id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('GET /articles error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Get a single article (sentences come from article_text if present, else legacy JSONB columns)
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.query;

  try {
    const articleResult = await pool.query(
      `SELECT id, url, title, source_language, target_language, vocab, input_tokens, output_tokens,
              remaining_text, created_at, status, status_message, original_sentences, translated_sentences
       FROM articles WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [id, user_id],
    );
    if (articleResult.rows.length === 0) return res.status(404).json({ error: 'Article not found' });

    const article = articleResult.rows[0];

    // Prefer article_text rows (streaming-translated articles) over legacy JSONB columns
    const textResult = await pool.query(
      `SELECT original, translated FROM article_text WHERE article_id = $1 ORDER BY row_order`,
      [id],
    );
    if (textResult.rows.length > 0) {
      article.original_sentences = textResult.rows.map((r) => r.original as string);
      article.translated_sentences = textResult.rows.map((r) => r.translated as string);
    }

    return res.json(article);
  } catch (err) {
    console.error('GET /articles/:id error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Continue translating an article that has remaining_text (legacy articles)
router.post('/:id/continue', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.userId as string;
  const { difficulty, native_language } = req.body;

  try {
    await checkBalance(userId);

    const articleResult = await pool.query(
      `SELECT remaining_text, source_language, target_language FROM articles
       WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [id, userId],
    );
    if (articleResult.rows.length === 0) return res.status(404).json({ error: 'Article not found' });

    const { remaining_text, source_language, target_language } = articleResult.rows[0];
    if (!remaining_text) return res.status(400).json({ error: 'No remaining text to translate' });

    const startOrderResult = await pool.query(
      `SELECT COALESCE(MAX(row_order) + 1, 0) AS next_row FROM article_text WHERE article_id = $1`,
      [id],
    );
    const startRowOrder = parseInt(startOrderResult.rows[0].next_row as string, 10);

    await pool.query(
      `UPDATE articles SET status = 'translating' WHERE id = $1`,
      [id],
    );

    void runContinuationJob(
      id, userId,
      remaining_text as string,
      source_language as string, target_language as string,
      (native_language as string) ?? 'en',
      (difficulty as string) ?? 'intermediate',
      startRowOrder,
    ).catch((err) => console.error('Unhandled continuation job error:', err));

    return res.json({ status: 'translating' });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'insufficient_credits', balanceUsd: err.balanceUsd });
    }
    console.error('POST /articles/:id/continue error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Append sentence pairs and update remaining_text for a saved article
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id, sentence_pairs_to_append, remaining_text, input_tokens_to_add, output_tokens_to_add } = req.body;

  if (!user_id || !Array.isArray(sentence_pairs_to_append)) {
    return res.status(400).json({ error: 'user_id and sentence_pairs_to_append are required' });
  }

  try {
    const existing = await pool.query(
      `SELECT original_sentences, translated_sentences FROM articles WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [id, user_id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Article not found' });

    const row = existing.rows[0];
    const newOriginals = [
      ...(row.original_sentences as string[]),
      ...sentence_pairs_to_append.map((p: { original: string }) => p.original ?? ''),
    ];
    const newTranslated = [
      ...(row.translated_sentences as string[]),
      ...sentence_pairs_to_append.map((p: { translation: string }) => p.translation ?? ''),
    ];

    await pool.query(
      `UPDATE articles
       SET original_sentences = $1,
           translated_sentences = $2,
           remaining_text = $3,
           input_tokens = input_tokens + $4,
           output_tokens = output_tokens + $5
       WHERE id = $6 AND user_id = $7`,
      [
        JSON.stringify(newOriginals),
        JSON.stringify(newTranslated),
        remaining_text ?? null,
        input_tokens_to_add ?? 0,
        output_tokens_to_add ?? 0,
        id,
        user_id,
      ]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /articles/:id error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Soft-delete all articles for a user
router.delete('/', async (req: Request, res: Response) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });
  try {
    await pool.query(`UPDATE articles SET deleted = true WHERE user_id = $1`, [user_id]);
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /articles error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Soft-delete an article
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });

  try {
    await pool.query(
      `UPDATE articles SET deleted = true WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /articles/:id error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
