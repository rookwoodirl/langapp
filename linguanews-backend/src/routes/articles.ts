import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// Save a translated article
router.post('/', async (req: Request, res: Response) => {
  const { user_id, url, title, source_language, target_language, translated_text, vocab } = req.body;

  if (!user_id || !translated_text) {
    return res.status(400).json({ error: 'user_id and translated_text are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO articles (user_id, url, title, source_language, target_language, translated_text, vocab)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [user_id, url ?? null, title ?? null, source_language, target_language, translated_text, JSON.stringify(vocab ?? [])]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /articles error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// List saved articles for a user (newest first, no full text to keep payload small)
router.get('/', async (req: Request, res: Response) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id query param is required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, url, title, source_language, target_language, translated_text, vocab, created_at
       FROM articles
       WHERE user_id = $1
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

// Get a single article (with full text + vocab)
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM articles WHERE id = $1 AND user_id = $2`,
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

// Delete all articles for a user
router.delete('/', async (req: Request, res: Response) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });
  try {
    await pool.query(`DELETE FROM articles WHERE user_id = $1`, [user_id]);
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /articles error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Delete an article
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.query;

  try {
    await pool.query(
      `DELETE FROM articles WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );
    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /articles/:id error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
