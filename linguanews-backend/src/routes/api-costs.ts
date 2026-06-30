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

router.get('/summary', async (req: Request, res: Response) => {
  const { user_id, language, since } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });

  const conditions = ['user_id = $1'];
  const params: unknown[] = [user_id];
  if (language) {
    params.push(language);
    conditions.push(`language = $${params.length}`);
  }
  if (since) {
    params.push(since);
    conditions.push(`created_at >= $${params.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT
         source,
         SUM(total_input_credits)  AS input_credits,
         SUM(total_output_credits) AS output_credits,
         SUM(total_input_credits  * input_credit_rate  / 1000000.0 +
             total_output_credits * output_credit_rate / 1000000.0) AS total_cost
       FROM api_costs
       WHERE ${conditions.join(' AND ')}
       GROUP BY source`,
      params
    );

    const summary: Record<string, { inputCredits: number; outputCredits: number; totalCost: number }> = {};
    for (const row of result.rows) {
      summary[row.source] = {
        inputCredits: Number(row.input_credits),
        outputCredits: Number(row.output_credits),
        totalCost: Number(row.total_cost),
      };
    }
    return res.json(summary);
  } catch (err) {
    console.error('GET /api-costs/summary error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/languages', async (req: Request, res: Response) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });

  try {
    const result = await pool.query(
      `SELECT DISTINCT language FROM api_costs WHERE user_id = $1 AND language IS NOT NULL ORDER BY language`,
      [user_id]
    );
    return res.json(result.rows.map((r) => r.language as string));
  } catch (err) {
    console.error('GET /api-costs/languages error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
