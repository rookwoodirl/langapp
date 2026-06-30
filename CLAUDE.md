# LinguaNews — Project Guide

## What this is

A language-learning app (React Native / Expo Go, targeting Android) that lets users paste a URL or text, translates it into a target language sentence-by-sentence, and builds a personal vocabulary list from that reading. The user can long-press words while reading to look them up, or tap "Generate Vocab" to auto-extract key words. Each word gets a rich entry: definition, part of speech, gender/article (for nouns), and conjugation table (for verbs).

The repo has two workspaces:
- `linguanews/` — Expo React Native app (TypeScript)
- `linguanews-backend/` — Express + PostgreSQL API server (TypeScript), deployed on Railway

## Critical rules

- **Never commit to GitHub.** The user handles all git commits and pushes.
- LLM calls are expensive; prefer free alternatives (Wiktionary) first.

---

## Architecture overview

### Frontend (`linguanews/`)

**Entry point:** `app/index.tsx` — single screen with three tabs (Translate, Articles, Vocab) rendered as a horizontal ScrollView pager. Contains `handleGenerateVocab`, cost summary display, conjugation modal, and article/vocab CRUD.

**Article reading:** `app/article/[id].tsx` — full-screen article reader with ParagraphCard components. Long-press on a word triggers `articleStore.lookupWord()`.

**Stores (Zustand):**
- `store/articleStore.ts` — fetches/saves articles, `lookupWord()` (with in-memory cache), tracks vocab token counts
- `store/vocabStore.ts` — user's saved vocabulary words, optimistic add then reload
- `store/usageStore.ts` — session-level token usage tracking

**Services:**
- `services/llm.ts` — **all LLM calls go through `callLLM()`**. Wraps Anthropic SDK, records cost to backend after every call. Model rates are hardcoded here.
- `services/vocab.ts` — three exported functions:
  - `lookupWordDefinition(word, targetLang, sourceLang, apiKey, articleContext?)` — primary word lookup. Tries Wiktionary first (English source only), falls back to Sonnet. Returns `LookupResult` with `definition`, `partOfSpeech`, `gender`, `article`, `infinitive`, `inputTokens`, `outputTokens`.
  - `selectVocabWords(text, targetLang, sourceLang, existingWords, apiKey)` — Haiku call, returns `string[]` of recommended words. Defensive parsing handles Haiku sometimes returning `{"word":"..."}` objects.
  - `getVerbConjugation(verb, language, apiKey)` — Haiku call, returns `VerbConjugation` with `infinitive` + `tenses` array.
- `services/wiktionary.ts` — free word lookup via `https://en.wiktionary.org/api/rest_v1/page/definition/{word}`. 4-second abort timeout. Extracts definition, partOfSpeech, gender (from `grammaticalFeatures` or HTML scan), article (from `DEFINITE_ARTICLES` table), infinitive (from "form of" links in HTML). Only called when `sourceLanguage === 'en'` since English Wiktionary only returns English definitions.
- `services/translator.ts` — `translateArticle()` using Sonnet, returns sentence pairs + initial vocab list. Has JSON retry logic.
- `services/api.ts` — all REST calls to the backend. User identity is a UUID stored in AsyncStorage (`@linguanews/user_id`).
- `services/apiCosts.ts` — `recordApiCost()` POSTs token usage to backend after every LLM call.
- `services/scraper.ts` — fetches and extracts article text from a URL.
- `services/tts.ts` — text-to-speech.

**Types (`types/index.ts`):**
- `VocabWord` — word in an article's vocab list: `word`, `definition`, `partOfSpeech?`, `gender?`, `article?`, `infinitive?`
- `UserVocabWord` — saved vocab entry: adds `id`, `vocabWordId`, `language`, `conjugation?`, `addedAt`
- `Article` — saved article with `sentencePairs`, `vocabList`, `inputTokens`, `outputTokens`
- `VerbConjugation` — `{ infinitive, tenses: VerbTense[] }` (has legacy `present?` field for backward compat)
- `CostSource` (in `apiCosts.ts`) — `'article' | 'article-regeneration' | 'vocab' | 'vocab_selection' | 'audio'`

**Cost tracking display** (`app/index.tsx`):
- `SOURCE_ORDER` and `SOURCE_LABELS` control tab display order and labels
- `apiGetCostSummary()` fetches per-source totals from backend
- Label mapping: `article` → "Articles", `article-regeneration` → "Re-translations", `vocab` → "Vocab", `vocab_selection` → "Vocab picks", `audio` → "Audio"

**Generate Vocab pipeline** (`handleGenerateVocab` in `app/index.tsx`):
1. `selectVocabWords()` → string array of candidate words (Haiku, `source: 'vocab_selection'`)
2. For each word: `lookupWordDefinition()` → rich lookup (Wiktionary or Sonnet)
3. If verb: `getVerbConjugation()` → conjugation table (Haiku)
4. `saveWord = conjugation?.infinitive ?? lookup.infinitive ?? selectedWord`
5. `vocabStore.addWord()` with all fields

**Known Android quirks:**
- FlatLists inside horizontal ScrollViews need `nestedScrollEnabled={true}` to avoid scroll hijacking on Android.

---

### Backend (`linguanews-backend/`)

Express server (`src/index.ts`). Runs migrations on startup (idempotent `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`).

**Routes:**
- `POST /articles` — save article (sentence pairs stored as parallel JSONB arrays)
- `GET /articles?user_id=` — list user's articles
- `GET /articles/:id?user_id=` — get single article
- `DELETE /articles/:id?user_id=` — soft-delete (sets `deleted=true`)
- `POST /vocab` — upsert vocab word into `vocab_words`, link to user via `user_vocab`
- `GET /vocab?user_id=` — get user's saved words (joined view)
- `DELETE /vocab/:id?user_id=` — remove from `user_vocab`
- `POST /api-costs` — record a cost entry
- `GET /api-costs/summary?user_id=` — aggregate costs grouped by `source`
- `POST /scrape` — proxy scrape (used when direct fetch is blocked by CORS)

**DB tables:**
- `articles` — UUID PK, `user_id TEXT`, `original_sentences JSONB`, `translated_sentences JSONB`, `vocab JSONB`, `input_tokens`, `output_tokens`, `deleted BOOLEAN`
- `vocab_words` — `(word, language)` UNIQUE, `definition`, `part_of_speech`, `gender`, `article`, `conjugation JSONB`
- `user_vocab` — junction: `user_id`, `vocab_word_id`, `(user_id, vocab_word_id)` UNIQUE
- `api_costs` — `user_id`, `source`, `model`, `input_credit_rate`, `total_input_credits`, `output_credit_rate`, `total_output_credits`

**Backend URL:** `https://linguanews-backend-production.up.railway.app` (set via `EXPO_PUBLIC_BACKEND_URL` env var)

---

## Models used

| Use case | Model | Source label |
|---|---|---|
| Article translation | `claude-sonnet-4-6` | `article` / `article-regeneration` |
| Word lookup (LLM fallback) | `claude-sonnet-4-6` | `vocab` |
| Verb conjugation | `claude-haiku-4-5-20251001` | `vocab` |
| Vocab word selection | `claude-haiku-4-5-20251001` | `vocab_selection` |
| Word lookup (primary, free) | Wiktionary REST API | _(no cost recorded)_ |

---

## Key components

- `components/ConjugationModal.tsx` — modal showing verb tenses, triggered from vocab list
- `components/VocabPopup.tsx` — popup shown after long-press word lookup in article reader
- `components/ParagraphCard.tsx` — renders a sentence pair in the article reader
- `components/ArticleText.tsx` — wraps text with long-press detection
- `components/AudioPlayer.tsx` — TTS playback controls
- `components/LanguagePicker.tsx` — source/target language selector

## Utils

- `utils/cost.ts` — `calcCost(inputTokens, outputTokens, model)`, `formatCost()`, `formatTokens()`
- `utils/chunks.ts` — text chunking for long articles
- `constants/languages.ts` — `DEFAULT_SOURCE_LANGUAGE`, `DEFAULT_TARGET_LANGUAGE`, language list
