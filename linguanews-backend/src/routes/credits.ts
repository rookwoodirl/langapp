import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET ?? '';

router.get('/balance', requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const result = await pool.query(`SELECT balance_usd FROM user_credits WHERE user_id = $1`, [userId]);
  const balance = result.rows.length ? Number(result.rows[0].balance_usd) : 0;
  return res.json({ balance });
});

router.get('/transactions', requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const result = await pool.query(
    `SELECT id, created_at, type, amount_usd, balance_after_usd, source
     FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
  return res.json(result.rows);
});

router.get('/packs', async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT product_id, credit_usd, display_name FROM credit_packs WHERE active = true ORDER BY sort_order`,
  );
  return res.json(result.rows);
});

function isAuthorizedWebhook(header: string | undefined): boolean {
  if (!header || !REVENUECAT_WEBHOOK_SECRET) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(REVENUECAT_WEBHOOK_SECRET);
  // timingSafeEqual throws on mismatched lengths — hash both first so length
  // never leaks through an early throw/short-circuit.
  const hashedA = crypto.createHash('sha256').update(a).digest();
  const hashedB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashedA, hashedB);
}

// RevenueCat sends every project event to this one URL. We only act on
// NON_RENEWING_PURCHASE (the event type for consumable/one-time IAP —
// INITIAL_PURCHASE/RENEWAL are subscription-only and don't apply here) and
// 200-and-ignore everything else so RevenueCat doesn't keep retrying.
router.post('/webhook/revenuecat', async (req: Request, res: Response) => {
  if (!isAuthorizedWebhook(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body?.event as
    | { id?: string; type?: string; app_user_id?: string; product_id?: string; environment?: string }
    | undefined;

  if (!event?.id || !event.type || !event.app_user_id) {
    return res.status(400).json({ error: 'Malformed webhook payload' });
  }

  if (process.env.NODE_ENV === 'production' && event.environment && event.environment !== 'PRODUCTION') {
    return res.status(200).json({ ok: true, skipped: 'non-production event' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO revenuecat_events (event_id, event_type, app_user_id, raw_payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, event.type, event.app_user_id, JSON.stringify(req.body)],
    );

    if (inserted.rows.length === 0) {
      // Duplicate delivery — already processed this event.id
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, duplicate: true });
    }

    if (event.type !== 'NON_RENEWING_PURCHASE' || !event.product_id) {
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, skipped: 'event type not handled' });
    }

    const packResult = await client.query(
      `SELECT credit_usd FROM credit_packs WHERE product_id = $1 AND active = true`,
      [event.product_id],
    );
    if (packResult.rows.length === 0) {
      console.error(`RevenueCat webhook: unknown product_id "${event.product_id}"`);
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, skipped: 'unknown product_id' });
    }

    const creditUsd = Number(packResult.rows[0].credit_usd);
    const balanceResult = await client.query(
      `INSERT INTO user_credits (user_id, balance_usd)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_usd = user_credits.balance_usd + $2, updated_at = NOW()
       RETURNING balance_usd`,
      [event.app_user_id, creditUsd],
    );
    const balanceAfter = Number(balanceResult.rows[0].balance_usd);
    await client.query(
      `INSERT INTO credit_transactions (user_id, type, amount_usd, balance_after_usd, source, reference_id)
       VALUES ($1, 'credit_purchase', $2, $3, 'revenuecat_webhook', $4)`,
      [event.app_user_id, creditUsd, balanceAfter, event.id],
    );

    await client.query('COMMIT');
    return res.status(200).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /credits/webhook/revenuecat error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    client.release();
  }
});

export default router;
