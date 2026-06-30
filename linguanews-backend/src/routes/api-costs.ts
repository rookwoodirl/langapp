import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const {
    user_id, source, model, language,
    input_credit_rate, total_input_credits,
    output_credit_rate, total_output_credits,
  } = req.body;

  if (!user_id || !source || !model) {
    return res.status(400).json({ error: 'user_id, source, and model are required' });
  }

  try {
    await pool.query(
      `INSERT INTO api_costs
         (user_id, source, model, language, input_credit_rate, total_input_credits, output_credit_rate, total_output_credits)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        user_id, source, model, language ?? null,
        input_credit_rate ?? 0, total_input_credits ?? 0,
        output_credit_rate ?? 0, total_output_credits ?? 0,
      ]
    );
    return res.status(201).send();
  } catch (err) {
    console.error('POST /api-costs error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// List individual cost events (most recent first), optionally filtered by time range / source
router.get('/events', async (req: Request, res: Response) => {
  const { user_id, since, source, limit } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });

  const conditions = ['user_id = $1'];
  const params: unknown[] = [user_id];
  if (since) {
    params.push(since);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }

  const cappedLimit = Math.min(Number(limit) || 200, 500);

  try {
    const result = await pool.query(
      `SELECT
         id, created_at, source, model, language,
         total_input_credits, total_output_credits,
         (total_input_credits  * input_credit_rate  / 1000000.0 +
          total_output_credits * output_credit_rate / 1000000.0) AS cost
       FROM api_costs
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${cappedLimit}`,
      params
    );

    return res.json(result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      model: row.model,
      language: row.language,
      inputCredits: Number(row.total_input_credits),
      outputCredits: Number(row.total_output_credits),
      cost: Number(row.cost),
    })));
  } catch (err) {
    console.error('GET /api-costs/events error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
