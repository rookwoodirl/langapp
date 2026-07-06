# LinguaNews — Project Guide

## What this is

A language-learning app (React Native / Expo Go, targeting Android) that lets users paste a URL, translates it into a target language sentence-by-sentence as a background job, and builds a personal vocabulary list from that reading. The user can tap words while reading to look them up, or tap "Generate Vocab" to auto-extract key words. Each word gets a rich entry: definition, part of speech, gender/article (for nouns), and conjugation table (for verbs).

The repo has two workspaces:
- `linguanews/` — Expo React Native app (TypeScript)
- `linguanews-backend/` — Express + PostgreSQL API server (TypeScript), deployed on Railway

## Critical rules

- **Never commit to GitHub.** The user handles all git commits and pushes.
- LLM calls are expensive; prefer free alternatives (Wiktionary) first.

---

## Environment

### Frontend (`linguanews/.env`)
```
EXPO_PUBLIC_ANTHROPIC_API_KEY=...   # used for vocab lookups / conjugations (client-side)
EXPO_PUBLIC_BACKEND_URL=https://linguanews-backend-production.up.railway.app
EXPO_PUBLIC_REVENUE_CAT_API_KEY_IOS=...
EXPO_PUBLIC_REVENUE_CAT_API_KEY_ANDROID=...
STRIPE_PUBLISHABLE_KEY=...
```

### Backend (Railway environment variables)
```
ANTHROPIC_API_KEY=...        # used server-side for streaming translation
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
BACKEND_URL=https://linguanews-backend-production.up.railway.app
REVENUECAT_WEBHOOK_SECRET=...  # static Authorization header value configured in the RevenueCat dashboard's webhook settings
DATABASE_URL=...             # injected by Railway PostgreSQL plugin
PORT=...                     # injected by Railway
```

**Important:** `ANTHROPIC_API_KEY` must be set in Railway for translation to work. The mobile app uses `EXPO_PUBLIC_ANTHROPIC_API_KEY` only for vocab/conjugation calls (still client-side). Translation itself moved server-side.

---

## Architecture overview

### Translation flow (backend-driven streaming)

1. User pastes a URL → mobile scrapes it (`POST /scrape`) → gets `{ title, textContent }`
2. Mobile calls `POST /articles/translate` with `{ text, url, title, sourceLanguage, targetLanguage, nativeLanguage, difficulty }`
3. Backend creates an article stub (`status: 'translating'`) and returns `{ id }` immediately
4. Backend runs `runTranslationJob()` as a fire-and-forget async job:
   - Calls Claude (`claude-sonnet-4-6`) with streaming enabled
   - First JSON line Claude emits: `{"title":"<article title in nativeLanguage>"}`
   - Subsequent lines: `{"original":"...","translation":"..."}`
   - Each parsed sentence is inserted into `article_text` as it arrives
   - On completion: updates `articles.status = 'complete'`, writes token counts, records to `api_costs`
5. Mobile shows a "Translating…" alert, switches to Articles tab
6. When user opens the article, the reader polls `GET /articles/:id/sentences?after=N` every 2 seconds, appending sentences until `status === 'complete'`

Articles are automatically saved on the backend from the moment translation starts — there is no manual "Save" button.

---

### Frontend (`linguanews/`)

**Entry point:** `app/index.tsx` — horizontal ScrollView pager with tabs: Translate, Articles, Vocab, Review, Cost. Contains `handleGenerateVocab`, cost event display, conjugation modal, article/vocab CRUD, and notecard list management.

**Article reading:** `app/article/[id].tsx` — full-screen reader with ParagraphCard components. Polls for new sentences while `status === 'translating'`. Long-press or tap on a word triggers `lookupWord()`.

**Stores (Zustand):**
- `store/articleStore.ts` — `loadArticle()` kicks off backend translation job, `lookupWord()` (with in-memory cache), `appendSentences()` for poll-driven updates, `continueTranslation()` for legacy articles with `remainingText`
- `store/vocabStore.ts` — saved vocabulary, optimistic add then reload
- `store/usageStore.ts` — session-level token usage tracking
- `store/notecardStore.ts` — notecard lists
- `store/themeStore.ts` — light/dark/system theme

**Services:**
- `services/llm.ts` — **all client-side LLM calls go through `callLLM()`**. Wraps Anthropic SDK, records cost to backend after every call.
- `services/vocab.ts` — three exports:
  - `lookupWordDefinition(word, targetLang, nativeLanguage, apiKey, articleContext?)` — tries Wiktionary first (when `nativeLanguage === 'en'`), falls back to Sonnet. Returns `LookupResult`.
  - `selectVocabWords(text, targetLang, nativeLanguage, existingWords, apiKey)` — Haiku call, returns `string[]`. Defensive parsing handles Haiku sometimes returning `{"word":"..."}` objects.
  - `getVerbConjugation(verb, language, apiKey)` — Haiku call, returns `VerbConjugation`.
- `services/wiktionary.ts` — free word lookup via English Wiktionary REST API. 4-second abort timeout. Only called when `nativeLanguage === 'en'`.
- `services/translator.ts` — legacy `translateArticle()` (still used by `continueTranslation()` for old articles with `remainingText`). New articles use the backend streaming flow instead.
- `services/api.ts` — all REST calls to backend. Auth identity from `getAuthState()` (Google OAuth JWT stored in AsyncStorage).
- `services/apiCosts.ts` — `recordApiCost()` POSTs token usage after every client-side LLM call.
- `services/scraper.ts` — `scrapeArticle(url)` → `POST /scrape` → `{ title, textContent }`.
- `services/auth.ts` — `getAuthState()`, `saveAuthState(token)`, `clearAuthState()`. Token stored in AsyncStorage as `@linguanews/auth`.
- `services/tts.ts` — text-to-speech.

**Types (`types/index.ts`):**
- `Article` — `id`, `title?`, `sourceUrl`, `sourceLanguage`, `targetLanguage`, `sentencePairs`, `vocabList`, `inputTokens`, `outputTokens`, `remainingText?`, `status?: 'translating' | 'complete' | 'error'`, `statusMessage?`
- `SentencePair` — `{ original, translation }`
- `VocabWord` — word in an article's vocab list: `word`, `definition`, `partOfSpeech?`, `gender?`, `article?`, `infinitive?`
- `UserVocabWord` — saved vocab entry: adds `id`, `vocabWordId`, `language`, `conjugation?`, SRS fields (`dueAt`, `intervalDays`, `easeFactor`, `repetitions`)
- `UserSettings` — `sourceLanguage`, `targetLanguage`, `nativeLanguage`, `difficulty`
- `VerbConjugation` — `{ infinitive, tenses: VerbTense[] }` (has legacy `present?` for backward compat)
- `CostSource` (in `apiCosts.ts`) — `'article' | 'article-regeneration' | 'vocab' | 'vocab_selection' | 'audio'`

**Settings (`nativeLanguage` vs `sourceLanguage`):**
- `sourceLanguage` — language of the article being read
- `targetLanguage` — language being learned (translation output)
- `nativeLanguage` — user's mother tongue; vocab definitions are returned in this language. Stored in `@linguanews/settings`. Wiktionary is only used when `nativeLanguage === 'en'`.

**Cost tab (`app/index.tsx`):**
- `SOURCE_ORDER` / `SOURCE_LABELS` in `constants/costs.ts` control display order and labels
- `apiGetCostEvents()` fetches individual events from backend
- Article events are aggregated client-side by `articleId` so each translated article shows as one line with its title as description
- Label mapping: `article` → "Articles", `article-regeneration` → "Re-translations", `vocab` → "Vocab", `vocab_selection` → "Vocab picks", `audio` → "Audio"

**Generate Vocab pipeline** (`handleGenerateVocab` in `app/index.tsx`):
1. `selectVocabWords()` → candidate words (Haiku, `source: 'vocab_selection'`)
2. For each word: `lookupWordDefinition()` → rich lookup (Wiktionary or Sonnet)
3. If verb: `getVerbConjugation()` → conjugation table (Haiku)
4. `saveWord = conjugation?.infinitive ?? lookup.infinitive ?? selectedWord`
5. `vocabStore.addWord()` with all fields

**Known Android quirks:**
- FlatLists inside horizontal ScrollViews need `nestedScrollEnabled={true}` to avoid scroll hijacking.

---

### Backend (`linguanews-backend/`)

Express server (`src/index.ts`). Runs idempotent migrations on startup (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`). Body size limit: 4mb (articles can be large).

**Routes:**
- `POST /articles/translate` — create article stub, start async streaming translation job, return `{ id }` immediately
- `GET /articles/:id/sentences?after=N&user_id=` — polling endpoint; returns `{ sentences, status, total }`
- `GET /articles?user_id=` — list user's articles (joins `article_text` for preview when JSONB is empty)
- `GET /articles/:id?user_id=` — get single article (joins `article_text`, prefers it over legacy JSONB)
- `POST /articles` — legacy: save a fully-translated article (used by old client flow / `continueTranslation`)
- `PATCH /articles/:id` — append sentence pairs (used by legacy `continueTranslation`)
- `DELETE /articles?user_id=` — soft-delete all articles
- `DELETE /articles/:id?user_id=` — soft-delete one article
- `POST /vocab` — upsert vocab word, link to user
- `GET /vocab?user_id=` — get user's saved words
- `PUT /vocab/:id` — update a vocab word
- `DELETE /vocab/:id?user_id=` — remove from user_vocab
- `POST /api-costs` — record a client-side cost entry
- `GET /api-costs/events?user_id=` — list cost events (includes `description`, `articleId`)
- `POST /scrape` — proxy scrape via Readability; returns `{ title, textContent }`
- `GET /auth/google` — start Google OAuth flow
- `GET /auth/google/callback` — exchange code, mint JWT, redirect to app
- `GET /notecards/due` — SRS due cards
- `POST /notecards/:id/review` — submit SRS review grade
- `GET /notecards/lists`, `POST /notecards/lists`, etc. — notecard list CRUD

**DB tables:**
- `articles` — UUID PK, `user_id`, `url`, `title`, `source_language`, `target_language`, `original_sentences JSONB` (legacy), `translated_sentences JSONB` (legacy), `vocab JSONB`, `input_tokens`, `output_tokens`, `deleted`, `remaining_text`, `status TEXT DEFAULT 'complete'`, `status_message`
- `article_text` — `id SERIAL`, `article_id UUID → articles`, `row_order INT`, `original TEXT`, `translated TEXT`, `source_language`, `target_language`, `created_at`. Indexed on `(article_id, row_order)`.
- `vocab_words` — `(word, language)` UNIQUE, `definition`, `part_of_speech`, `gender`, `article`, `conjugation JSONB`
- `user_vocab` — junction: `user_id`, `vocab_word_id`, SRS fields (`due_at`, `interval_days`, `ease_factor`, `repetitions`, `last_reviewed_at`)
- `api_costs` — `user_id`, `source`, `model`, `language`, `input_credit_rate`, `total_input_credits`, `output_credit_rate`, `total_output_credits`, `description TEXT` (article title), `article_id TEXT`
- `notecard_lists` — `user_id`, `name`, `language`
- `notecard_list_items` — `list_id → notecard_lists`, `user_vocab_id → user_vocab`

**Translation service (`src/translationService.ts`):**
- Streams from Claude with NDJSON output: title line first, then sentence pairs
- Parses lines as they arrive; writes to `article_text` and updates `articles.title` immediately
- If a hint title came from the scraper, stores it first and skips asking Claude for a title
- Records one `api_costs` row per translation job (with `article_id` and `description = title`)
- Handles multi-chunk articles (40k char chunks) transparently

**Auth (`src/routes/auth.ts`):**
- Google OAuth 2.0 — `GET /auth/google` → Google → `GET /auth/google/callback` → mint JWT → redirect to app
- Redirect URI allowlist: `exp://` (Expo Go) and `linguanews://` (native build)
- JWTs contain `{ userId, email, name }`, expire in 365 days, signed with `JWT_SECRET`

---

## Models used

| Use case | Where | Model | Source label |
|---|---|---|---|
| Article translation | Backend streaming | `claude-sonnet-4-6` | `article` |
| Word lookup (LLM fallback) | Client | `claude-sonnet-4-6` | `vocab` |
| Verb conjugation | Client | `claude-haiku-4-5-20251001` | `vocab` |
| Vocab word selection | Client | `claude-haiku-4-5-20251001` | `vocab_selection` |
| Word lookup (primary, free) | Client | Wiktionary REST API | _(no cost)_ |

---

## Key components

- `components/ConjugationModal.tsx` — modal showing verb tenses, triggered from vocab list
- `components/VocabPopup.tsx` — popup shown after word tap/long-press in article reader
- `components/ParagraphCard.tsx` — renders a sentence pair; supports word tap on both original and translation sides
- `components/ArticleText.tsx` — wraps text with long-press detection
- `components/LanguagePicker.tsx` — source/target/native language selector

## Utils / Constants

- `utils/cost.ts` — `calcCost()`, `calcCostHaiku()`, `formatCost()`, `formatTokens()`
- `constants/languages.ts` — `DEFAULT_SOURCE_LANGUAGE`, `DEFAULT_TARGET_LANGUAGE`, `DEFAULT_NATIVE_LANGUAGE`, language list, `isGenderedLanguage()`
- `constants/costs.ts` — `SOURCE_ORDER`, `SOURCE_LABELS`
- `constants/theme.ts` — `ThemeColors` interface
- `hooks/useColors.ts` — resolves current theme colors
