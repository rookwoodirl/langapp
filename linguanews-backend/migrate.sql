-- Migrate from flat-text columns to structured sentence arrays + soft deletes.
-- Safe to run multiple times (IF EXISTS / IF NOT EXISTS guards).
ALTER TABLE articles
  DROP COLUMN IF EXISTS original_text,
  DROP COLUMN IF EXISTS translated_text,
  DROP COLUMN IF EXISTS sentence_pairs,
  ADD COLUMN IF NOT EXISTS original_sentences   JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS translated_sentences JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS input_tokens         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted              BOOLEAN NOT NULL DEFAULT false;
