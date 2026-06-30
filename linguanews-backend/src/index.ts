import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import articlesRouter from './routes/articles';
import vocabRouter from './routes/vocab';
import scrapeRouter from './routes/scrape';
import apiCostsRouter from './routes/api-costs';
import notecardsRouter from './routes/notecards';

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
app.use('/vocab', vocabRouter);
app.use('/scrape', scrapeRouter);
app.use('/api-costs', apiCostsRouter);
app.use('/notecards', notecardsRouter);

async function migrate() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              TEXT        NOT NULL,
      url                  TEXT,
      title                TEXT,
      source_language      TEXT        NOT NULL DEFAULT 'en',
      target_language      TEXT        NOT NULL DEFAULT 'es',
      original_sentences   JSONB       NOT NULL DEFAULT '[]',
      translated_sentences JSONB       NOT NULL DEFAULT '[]',
      vocab                JSONB       NOT NULL DEFAULT '[]',
      input_tokens         INTEGER     NOT NULL DEFAULT 0,
      output_tokens        INTEGER     NOT NULL DEFAULT 0,
      deleted              BOOLEAN     NOT NULL DEFAULT false,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS articles_user_id_idx ON articles (user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vocab_words (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      word            TEXT        NOT NULL,
      language        TEXT        NOT NULL,
      definition      TEXT        NOT NULL,
      part_of_speech  TEXT,
      gender          TEXT,
      article         TEXT,
      conjugation     JSONB,
      UNIQUE(word, language)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_costs (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              TEXT        NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source               TEXT        NOT NULL,
      model                TEXT        NOT NULL,
      language             TEXT,
      input_credit_rate    NUMERIC     NOT NULL DEFAULT 0,
      total_input_credits  INTEGER     NOT NULL DEFAULT 0,
      output_credit_rate   NUMERIC     NOT NULL DEFAULT 0,
      total_output_credits INTEGER     NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS api_costs_user_id_idx ON api_costs (user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_vocab (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          TEXT        NOT NULL,
      vocab_word_id    UUID        NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
      added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      due_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      interval_days    REAL        NOT NULL DEFAULT 0,
      ease_factor      REAL        NOT NULL DEFAULT 2.5,
      repetitions      INTEGER     NOT NULL DEFAULT 0,
      last_reviewed_at TIMESTAMPTZ,
      UNIQUE(user_id, vocab_word_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_vocab_user_id_idx ON user_vocab (user_id, added_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_vocab_due_idx ON user_vocab (user_id, due_at)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notecard_lists (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      language    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, name)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS notecard_lists_user_id_idx ON notecard_lists (user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notecard_list_items (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id       UUID        NOT NULL REFERENCES notecard_lists(id) ON DELETE CASCADE,
      user_vocab_id UUID        NOT NULL REFERENCES user_vocab(id) ON DELETE CASCADE,
      added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(list_id, user_vocab_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS notecard_list_items_list_id_idx ON notecard_list_items (list_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS notecard_list_items_user_vocab_id_idx ON notecard_list_items (user_vocab_id)`);

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
