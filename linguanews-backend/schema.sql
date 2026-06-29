CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        NOT NULL,
  url           TEXT,
  title         TEXT,
  source_language TEXT      NOT NULL DEFAULT 'en',
  target_language TEXT      NOT NULL DEFAULT 'es',
  translated_text TEXT      NOT NULL,
  vocab         JSONB       NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS articles_user_id_idx ON articles (user_id, created_at DESC);
