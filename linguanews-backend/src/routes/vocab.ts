import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// Add a word to user's vocab (upserts vocab_words globally, then links to user)
router.post('/', async (req: Request, res: Response) => {
  const { user_id, word, language, definition, part_of_speech, gender, article, conjugation } = req.body;

  if (!user_id || !word || !language || !definition) {
    return res.status(400).json({ error: 'user_id, word, language, definition are required' });
  }

  try {
    // Upsert the global word record
    const wordResult = await pool.query(
      `INSERT INTO vocab_words (word, language, definition, part_of_speech, gender, article, conjugation)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (word, language) DO UPDATE
         SET definition = EXCLUDED.definition,
             part_of_speech = EXCLUDED.part_of_speech,
             gender = COALESCE(EXCLUDED.gender, vocab_words.gender),
             article = COALESCE(EXCLUDED.article, vocab_words.article),
             conjugation = COALESCE(EXCLUDED.conjugation, vocab_words.conjugation)
       RETURNING id`,
      [word, language, definition, part_of_speech ?? null, gender ?? null, article ?? null, conjugation ? JSON.stringify(conjugation) : null]
    );

    const vocabWordId = wordResult.rows[0].id;

    // Link to user (ignore if already added)
    const linkResult = await pool.query(
      `INSERT INTO user_vocab (user_id, vocab_word_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, vocab_word_id) DO NOTHING
       RETURNING id, added_at`,
      [user_id, vocabWordId]
    );

    const row = linkResult.rows[0] ?? null;
    return res.status(201).json({
      id: row?.id ?? null,
      vocab_word_id: vocabWordId,
      already_saved: !row,
    });
  } catch (err) {
    console.error('POST /vocab error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// List user's vocab words
router.get('/', async (req: Request, res: Response) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    const result = await pool.query(
      `SELECT uv.id, uv.added_at, vw.id AS vocab_word_id,
              vw.word, vw.language, vw.definition, vw.part_of_speech, vw.gender, vw.article, vw.conjugation
       FROM user_vocab uv
       JOIN vocab_words vw ON vw.id = uv.vocab_word_id
       WHERE uv.user_id = $1
       ORDER BY uv.added_at DESC
       LIMIT 500`,
      [user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('GET /vocab error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Edit a vocab word's notecard fields (the vocab_words row is shared by all users who saved it)
router.put('/:vocabWordId', async (req: Request, res: Response) => {
  const { vocabWordId } = req.params;
  const { user_id, word, definition, part_of_speech, gender, article } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const owns = await pool.query(
      `SELECT 1 FROM user_vocab WHERE user_id = $1 AND vocab_word_id = $2`,
      [user_id, vocabWordId]
    );
    if (owns.rowCount === 0) {
      return res.status(404).json({ error: 'Vocab word not found for this user' });
    }

    const result = await pool.query(
      `UPDATE vocab_words
         SET word = COALESCE($1, word),
             definition = COALESCE($2, definition),
             part_of_speech = COALESCE($3, part_of_speech),
             gender = $4,
             article = $5
       WHERE id = $6
       RETURNING id, word, language, definition, part_of_speech, gender, article, conjugation`,
      [word ?? null, definition ?? null, part_of_speech ?? null, gender ?? null, article ?? null, vocabWordId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Vocab word not found' });
    }
    return res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Another word already uses that spelling in this language' });
    }
    console.error('PUT /vocab/:vocabWordId error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Remove a word from user's vocab (by user_vocab.id)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    await pool.query(
      `DELETE FROM user_vocab WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /vocab/:id error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
