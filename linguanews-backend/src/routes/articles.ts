import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// Save a translated article
router.post('/', async (req: Request, res: Response) => {
  const { user_id, url, title, source_language, target_language, sentence_pairs, vocab, input_tokens, output_tokens } = req.body;

  if (!user_id || !Array.isArray(sentence_pairs) || sentence_pairs.length === 0) {
    return res.status(400).json({ error: 'user_id and sentence_pairs (non-empty) are required' });
  }

  const originalSentences: string[] = sentence_pairs.map((p: { original: string }) => p.original ?? '');
  const translatedSentences: string[] = sentence_pairs.map((p: { translation: string }) => p.translation ?? '');

  try {
    const result = await pool.query(
      `INSERT INTO articles (user_id, url, title, source_language, target_language, original_sentences, translated_sentences, vocab, input_tokens, output_tokens, remaining_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /articles error:', err);
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
      `SELECT id, url, title, source_language, target_language, original_sentences, translated_sentences, vocab, input_tokens, output_tokens, remaining_text, created_at
       FROM articles
       WHERE user_id = $1 AND deleted = false
       ORDER BY created_at DESC
       LIMIT 100`,
      [user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('GET /articles error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Get a single article
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM articles WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [id, user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /articles/:id error:', err);
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
