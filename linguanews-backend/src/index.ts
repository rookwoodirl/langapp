import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import articlesRouter from './routes/articles';
import vocabRouter from './routes/vocab';
import scrapeRouter from './routes/scrape';
import apiCostsRouter from './routes/api-costs';

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

async function migrate() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  // Fresh install: create with the correct schema
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

  // Upgrade path: add new columns if not present (no-op on fresh installs)
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS input_tokens         INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS output_tokens        INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS original_sentences   JSONB   NOT NULL DEFAULT '[]'`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS translated_sentences JSONB   NOT NULL DEFAULT '[]'`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS deleted              BOOLEAN NOT NULL DEFAULT false`);

  // Backfill sentence arrays from old flat-text columns before dropping them
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='articles' AND column_name='translated_text') THEN
        UPDATE articles
        SET translated_sentences = jsonb_build_array(translated_text)
        WHERE translated_text IS NOT NULL AND translated_text != '' AND translated_sentences = '[]'::jsonb;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='articles' AND column_name='original_text') THEN
        UPDATE articles
        SET original_sentences = jsonb_build_array(original_text)
        WHERE original_text IS NOT NULL AND original_text != '' AND original_sentences = '[]'::jsonb;
      END IF;
    END $$
  `);

  // Drop obsolete columns (no-op if already removed)
  await pool.query(`ALTER TABLE articles DROP COLUMN IF EXISTS translated_text`);
  await pool.query(`ALTER TABLE articles DROP COLUMN IF EXISTS original_text`);
  await pool.query(`ALTER TABLE articles DROP COLUMN IF EXISTS sentence_pairs`);

  await pool.query(`ALTER TABLE vocab_words ADD COLUMN IF NOT EXISTS gender TEXT`);
  await pool.query(`ALTER TABLE vocab_words ADD COLUMN IF NOT EXISTS article TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_costs (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              TEXT        NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source               TEXT        NOT NULL,
      model                TEXT        NOT NULL,
      input_credit_rate    NUMERIC     NOT NULL DEFAULT 0,
      total_input_credits  INTEGER     NOT NULL DEFAULT 0,
      output_credit_rate   NUMERIC     NOT NULL DEFAULT 0,
      total_output_credits INTEGER     NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS api_costs_user_id_idx ON api_costs (user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vocab_words (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      word            TEXT        NOT NULL,
      language        TEXT        NOT NULL,
      definition      TEXT        NOT NULL,
      part_of_speech  TEXT,
      conjugation     JSONB,
      UNIQUE(word, language)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_vocab (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         TEXT        NOT NULL,
      vocab_word_id   UUID        NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, vocab_word_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_vocab_user_id_idx ON user_vocab (user_id, added_at DESC)
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
