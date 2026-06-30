-- Migrate from flat-text columns to structured sentence arrays + soft deletes.
-- Safe to run multiple times (IF EXISTS / IF NOT EXISTS guards).

-- Step 1: Add new columns first so we can backfill before dropping old data.
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS original_sentences   JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS translated_sentences JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS input_tokens         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted              BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Backfill sentence arrays from old flat-text columns (no-op if columns already gone).
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
END $$;

-- Step 3: Drop obsolete columns.
ALTER TABLE articles
  DROP COLUMN IF EXISTS original_text,
  DROP COLUMN IF EXISTS translated_text,
  DROP COLUMN IF EXISTS sentence_pairs;
