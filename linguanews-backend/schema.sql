CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
);

CREATE INDEX IF NOT EXISTS articles_user_id_idx ON articles (user_id, created_at DESC);

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
);

CREATE INDEX IF NOT EXISTS api_costs_user_id_idx ON api_costs (user_id, created_at DESC);
