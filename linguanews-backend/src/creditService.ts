import { pool } from './db';

const MIN_BALANCE_TO_START = 1.0;

// We charge the user this multiple of actual Anthropic cost — the difference is our margin.
export const CREDIT_MARGIN = 1.1;

export class InsufficientCreditsError extends Error {
  balanceUsd: number;
  constructor(balanceUsd: number) {
    super('Insufficient credit balance');
    this.balanceUsd = balanceUsd;
  }
}

export async function checkBalance(userId: string): Promise<number> {
  const result = await pool.query(`SELECT balance_usd FROM user_credits WHERE user_id = $1`, [userId]);
  const balance = result.rows.length ? Number(result.rows[0].balance_usd) : 0;
  if (balance < MIN_BALANCE_TO_START) throw new InsufficientCreditsError(balance);
  return balance;
}

// Deduction is inherently post-paid — token counts (and thus cost) aren't known
// until after the Anthropic call returns, so there's an unavoidable gap between
// checkBalance() and this. No WHERE balance >= amount guard: Anthropic has
// already been paid regardless of what the balance says, so the debit is
// unconditional and the balance is allowed to go slightly negative.
export async function chargeUsage(userId: string, source: string, costUsd: number, referenceId?: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO user_credits (user_id, balance_usd)
       VALUES ($1, -$2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_usd = user_credits.balance_usd - $2, updated_at = NOW()
       RETURNING balance_usd`,
      [userId, costUsd],
    );
    const balanceAfter = Number(result.rows[0].balance_usd);
    await client.query(
      `INSERT INTO credit_transactions (user_id, type, amount_usd, balance_after_usd, source, reference_id)
       VALUES ($1, 'debit_llm', $2, $3, $4, $5)`,
      [userId, -costUsd, balanceAfter, source, referenceId ?? null],
    );
    await client.query('COMMIT');
    return balanceAfter;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function creditPurchase(
  userId: string,
  amountUsd: number,
  type: 'credit_purchase' | 'credit_starter',
  source: string,
  referenceId?: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO user_credits (user_id, balance_usd)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_usd = user_credits.balance_usd + $2, updated_at = NOW()
       RETURNING balance_usd`,
      [userId, amountUsd],
    );
    const balanceAfter = Number(result.rows[0].balance_usd);
    await client.query(
      `INSERT INTO credit_transactions (user_id, type, amount_usd, balance_after_usd, source, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, amountUsd, balanceAfter, source, referenceId ?? null],
    );
    await client.query('COMMIT');
    return balanceAfter;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
