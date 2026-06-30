import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { gradeCard, ReviewGrade } from '../srs';

const router = Router();

const VOCAB_COLUMNS = `
  uv.id, uv.added_at, vw.id AS vocab_word_id,
  vw.word, vw.language, vw.definition, vw.part_of_speech, vw.gender, vw.article, vw.conjugation,
  uv.due_at, uv.interval_days, uv.ease_factor, uv.repetitions, uv.last_reviewed_at
`;

// Cards due for review
router.get('/due', async (req: Request, res: Response) => {
  const { user_id, language, list_id, limit } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  const conditions = ['uv.user_id = $1', 'uv.due_at <= NOW()'];
  const params: any[] = [user_id];

  if (language) {
    params.push(language);
    conditions.push(`vw.language = $${params.length}`);
  }

  let join = '';
  if (list_id) {
    params.push(list_id);
    join = `JOIN notecard_list_items nli ON nli.user_vocab_id = uv.id AND nli.list_id = $${params.length}`;
  }

  const cappedLimit = Math.min(Number(limit) || 50, 200);

  try {
    const result = await pool.query(
      `SELECT ${VOCAB_COLUMNS}
       FROM user_vocab uv
       JOIN vocab_words vw ON vw.id = uv.vocab_word_id
       ${join}
       WHERE ${conditions.join(' AND ')}
       ORDER BY uv.due_at ASC
       LIMIT ${cappedLimit}`,
      params
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('GET /notecards/due error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Submit a review grade for a card
router.post('/:userVocabId/review', async (req: Request, res: Response) => {
  const { userVocabId } = req.params;
  const { user_id, grade } = req.body as { user_id?: string; grade?: ReviewGrade };

  if (!user_id || !grade) {
    return res.status(400).json({ error: 'user_id and grade are required' });
  }
  if (!['again', 'hard', 'good', 'easy'].includes(grade)) {
    return res.status(400).json({ error: 'grade must be one of: again, hard, good, easy' });
  }

  try {
    const current = await pool.query(
      `SELECT repetitions, interval_days, ease_factor FROM user_vocab WHERE id = $1 AND user_id = $2`,
      [userVocabId, user_id]
    );
    if (current.rowCount === 0) {
      return res.status(404).json({ error: 'Notecard not found for this user' });
    }

    const { repetitions, interval_days, ease_factor } = current.rows[0];
    const result = gradeCard(
      { repetitions, intervalDays: interval_days, easeFactor: ease_factor },
      grade
    );

    await pool.query(
      `UPDATE user_vocab
         SET due_at = $1, interval_days = $2, ease_factor = $3, repetitions = $4, last_reviewed_at = NOW()
       WHERE id = $5 AND user_id = $6`,
      [result.dueAt, result.intervalDays, result.easeFactor, result.repetitions, userVocabId, user_id]
    );

    const updated = await pool.query(
      `SELECT ${VOCAB_COLUMNS}
       FROM user_vocab uv
       JOIN vocab_words vw ON vw.id = uv.vocab_word_id
       WHERE uv.id = $1 AND uv.user_id = $2`,
      [userVocabId, user_id]
    );

    return res.json(updated.rows[0]);
  } catch (err) {
    console.error('POST /notecards/:userVocabId/review error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// List user's notecard lists with item counts
router.get('/lists', async (req: Request, res: Response) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    const result = await pool.query(
      `SELECT nl.id, nl.name, nl.language, nl.created_at, COUNT(nli.id)::int AS item_count
       FROM notecard_lists nl
       LEFT JOIN notecard_list_items nli ON nli.list_id = nl.id
       WHERE nl.user_id = $1
       GROUP BY nl.id
       ORDER BY nl.created_at DESC`,
      [user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('GET /notecards/lists error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Create a list
router.post('/lists', async (req: Request, res: Response) => {
  const { user_id, name, language } = req.body;

  if (!user_id || !name) {
    return res.status(400).json({ error: 'user_id and name are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO notecard_lists (user_id, name, language)
       VALUES ($1, $2, $3)
       RETURNING id, name, language, created_at`,
      [user_id, name, language ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'A list with that name already exists' });
    }
    console.error('POST /notecards/lists error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Rename / re-language a list
router.put('/lists/:listId', async (req: Request, res: Response) => {
  const { listId } = req.params;
  const { user_id, name, language } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const owns = await pool.query(
      `SELECT 1 FROM notecard_lists WHERE id = $1 AND user_id = $2`,
      [listId, user_id]
    );
    if (owns.rowCount === 0) {
      return res.status(404).json({ error: 'List not found for this user' });
    }

    const result = await pool.query(
      `UPDATE notecard_lists
         SET name = COALESCE($1, name),
             language = $2
       WHERE id = $3
       RETURNING id, name, language, created_at`,
      [name ?? null, language ?? null, listId]
    );
    return res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'A list with that name already exists' });
    }
    console.error('PUT /notecards/lists/:listId error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Delete a list
router.delete('/lists/:listId', async (req: Request, res: Response) => {
  const { listId } = req.params;
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    await pool.query(`DELETE FROM notecard_lists WHERE id = $1 AND user_id = $2`, [listId, user_id]);
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /notecards/lists/:listId error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Get a list's words
router.get('/lists/:listId/items', async (req: Request, res: Response) => {
  const { listId } = req.params;
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    const result = await pool.query(
      `SELECT ${VOCAB_COLUMNS}
       FROM notecard_list_items nli
       JOIN user_vocab uv ON uv.id = nli.user_vocab_id
       JOIN vocab_words vw ON vw.id = uv.vocab_word_id
       JOIN notecard_lists nl ON nl.id = nli.list_id
       WHERE nli.list_id = $1 AND nl.user_id = $2
       ORDER BY nli.added_at DESC`,
      [listId, user_id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('GET /notecards/lists/:listId/items error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Add a word to a list
router.post('/lists/:listId/items', async (req: Request, res: Response) => {
  const { listId } = req.params;
  const { user_id, user_vocab_id } = req.body;

  if (!user_id || !user_vocab_id) {
    return res.status(400).json({ error: 'user_id and user_vocab_id are required' });
  }

  try {
    const listOwned = await pool.query(
      `SELECT 1 FROM notecard_lists WHERE id = $1 AND user_id = $2`,
      [listId, user_id]
    );
    if (listOwned.rowCount === 0) {
      return res.status(404).json({ error: 'List not found for this user' });
    }

    const wordOwned = await pool.query(
      `SELECT 1 FROM user_vocab WHERE id = $1 AND user_id = $2`,
      [user_vocab_id, user_id]
    );
    if (wordOwned.rowCount === 0) {
      return res.status(404).json({ error: 'Vocab word not found for this user' });
    }

    await pool.query(
      `INSERT INTO notecard_list_items (list_id, user_vocab_id)
       VALUES ($1, $2)
       ON CONFLICT (list_id, user_vocab_id) DO NOTHING`,
      [listId, user_vocab_id]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('POST /notecards/lists/:listId/items error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Remove a word from a list
router.delete('/lists/:listId/items/:userVocabId', async (req: Request, res: Response) => {
  const { listId, userVocabId } = req.params;
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    await pool.query(
      `DELETE FROM notecard_list_items nli
       USING notecard_lists nl
       WHERE nli.list_id = nl.id
         AND nli.list_id = $1
         AND nli.user_vocab_id = $2
         AND nl.user_id = $3`,
      [listId, userVocabId, user_id]
    );
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /notecards/lists/:listId/items/:userVocabId error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
