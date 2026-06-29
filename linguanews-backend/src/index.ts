import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import articlesRouter from './routes/articles';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/dbcheck', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

app.use('/articles', articlesRouter);

async function migrate() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         TEXT        NOT NULL,
      url             TEXT,
      title           TEXT,
      source_language TEXT        NOT NULL DEFAULT 'en',
      target_language TEXT        NOT NULL DEFAULT 'es',
      translated_text TEXT        NOT NULL,
      vocab           JSONB       NOT NULL DEFAULT '[]',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS articles_user_id_idx ON articles (user_id, created_at DESC)
  `);
  console.log('Migrations complete');
}

async function start() {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  try {
    await migrate();
  } catch (err) {
    console.error('Migration warning:', err);
  }
}

start();
