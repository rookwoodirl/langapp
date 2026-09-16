# LinguaNews — Project Guide

## What this is

A language-learning app (React Native / Expo, targeting Android, also exported as a static web build) that lets users paste a URL, translates it into a target language sentence-by-sentence as a background job, and builds a personal vocabulary list from that reading. The user can tap words while reading to look them up, or tap "Generate Vocab" to auto-extract key words. Each word gets a rich entry: definition, part of speech, gender/article (for nouns), and conjugation table (for verbs).

The repo has two workspaces:
- `linguanews/` — Expo React Native app (TypeScript). Also builds to a static web bundle (`npm run build:web` → `expo export --platform web`) and deploys that as its own Railway service (`linguanews/railway.toml`, `serve dist`) — separate from the backend deployment.
- `linguanews-backend/` — Express + PostgreSQL API server (TypeScript), deployed on Railway

## Critical rules

- **Never commit to GitHub.** The user handles all git commits and pushes.
- LLM calls are expensive; prefer free alternatives (Wiktionary) first.
- **Zero Anthropic calls from the client, ever.** Every LLM call — translation, word lookup, conjugation, vocab selection, chat — happens server-side through `callLLM()` in `linguanews-backend/src/llmService.ts`, which also records the `api_costs` row. The client never holds an Anthropic API key and never imports `@anthropic-ai/sdk`. When adding a new LLM-backed feature, add a backend route that calls `callLLM()` and have the client hit that route via `services/api.ts` — do not reach for the Anthropic SDK client-side. `services/llm.ts` and `services/translator.ts` are intentionally empty placeholders left from the migration off client-side calls; don't resurrect them.

---

## Environment

### Frontend (`linguanews/.env`)
```
EXPO_PUBLIC_BACKEND_URL=https://linguanews-backend-production.up.railway.app
```

### Backend (Railway environment variables)
```
ANTHROPIC_API_KEY=...        # used server-side for ALL LLM calls (translation, lookup, conjugation, vocab selection, chat)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
BACKEND_URL=https://linguanews-backend-production.up.railway.app
WEB_APP_URL=...               # deployed web build's URL; added to the OAuth redirect allowlist when set
DATABASE_URL=...             # injected by Railway PostgreSQL plugin
PORT=...                     # injected by Railway
```

**Important:** `ANTHROPIC_API_KEY` only needs to be set in Railway. The client has no Anthropic key and makes no Anthropic calls — see [Critical rules](#critical-rules).

---

## Architecture overview

### Translation flow

There are two mutually-exclusive translation paths, selected by the `UserSettings.useLLM` toggle (a "LLM" / "Free" switch in the Translate tab of `app/index.tsx`; `useLLM !== false` means LLM mode). Both are driven from `articleStore.loadArticle()`.

**LLM mode (backend-driven streaming, default):**
1. User pastes a URL → mobile scrapes it (`POST /scrape`) → gets `{ title, textContent }`
2. Mobile calls `POST /articles/translate` with `{ text, url, title, sourceLanguage, targetLanguage, nativeLanguage, difficulty }`
3. Backend creates an article stub (`status: 'translating'`) and returns `{ id }` immediately
4. Backend runs `runTranslationJob()` as a fire-and-forget async job:
   - Calls Claude (`claude-sonnet-4-6`) with streaming enabled, chunking input at 40,000 chars (`CHUNK_SIZE` in `translationService.ts`)
   - First JSON line Claude emits: `{"title":"<article title in nativeLanguage>"}`
   - Subsequent lines: `{"original":"...","translation":"..."}`
   - Each parsed sentence is inserted into `article_text` as it arrives
   - On completion: updates `articles.status = 'complete'`, writes token counts, records to `api_costs`
5. Mobile shows a "Translating…" alert, switches to Articles tab
6. When user opens the article, the reader polls `GET /articles/:id/sentences?after=N` every 2 seconds, appending sentences until `status === 'complete'`
7. If the article was truncated (legacy long-article path), `articleStore.continueTranslation()` calls `POST /articles/:id/continue`, which resumes translating `articles.remaining_text` server-side via Claude and streams more rows into `article_text`

**Free mode (on-device, no LLM cost):**
1. Same scrape step, but `articleStore.loadArticle()` calls `POST /articles` to create the article row directly (`apiCreateDeviceArticle()`), then translates client-side via `services/deviceTranslation.ts`, which calls the free MyMemory REST API (`api.mymemory.translated.net`) sentence-by-sentence
2. Each translated sentence is appended locally and pushed to the backend with `POST /articles/:id/text` (`apiAppendDeviceSentences()`), which writes rows into `article_text` and marks `status = 'complete'` when done
3. No `api_costs` row is written for this path — it never touches `callLLM()`

Articles are automatically saved on the backend from the moment translation starts — there is no manual "Save" button.

---

### Frontend (`linguanews/`)

**Entry point:** `app/index.tsx` — horizontal ScrollView pager with tabs: Translate, Articles, Vocab, Review, Cost (`TABS` const). "Review" and "Cost" are tab labels only — tapping them navigates to the `/review` modal rather than showing inline pager content. Contains `handleGenerateVocab`, cost event display, conjugation modal, article/vocab CRUD, and notecard list management.

**Article reading:** `app/article/[id].tsx` — full-screen reader with ParagraphCard components. Polls for new sentences while `status === 'translating'`. Long-press or tap on a word triggers `lookupWord()`.

**Other screens** (`app/_layout.tsx` stack, all gated behind auth except `login`):
- `app/login.tsx` — shown when `getAuthState()` finds no token; root layout redirects here
- `app/settings.tsx` — modal; language pair / native language / difficulty / LLM-vs-free toggle
- `app/review.tsx` — modal; SRS review session (renders `ReviewCard.tsx`), optionally filtered by `language` or `listId` params
- `app/chat-setup.tsx` — modal; configure a new chat session (article-discussion or vocab-drill mode) before creating it
- `app/chat/[id].tsx` — chat conversation screen for an existing `ChatSession`

**Stores (Zustand):**
- `store/articleStore.ts` — `loadArticle()` branches on `settings.useLLM` to kick off either the backend LLM translation job or on-device translation (see [Translation flow](#translation-flow)), `lookupWord()` (with in-memory cache) calls `apiLookupWord()`, `appendSentences()` for poll-driven/device-streamed updates, `continueTranslation()` calls `POST /articles/:id/continue` to resume LLM translation for legacy articles with `remainingText`
- `store/vocabStore.ts` — saved vocabulary, optimistic add then reload
- `store/usageStore.ts` — session-level token usage tracking
- `store/notecardStore.ts` — notecard lists
- `store/chatStore.ts` — conversation practice (article-discussion or vocab-drill mode), sends turns via `apiSendChatMessage()`
- `store/themeStore.ts` — light/dark/system theme

**Services:**
- `services/llm.ts`, `services/translator.ts` — empty placeholders left over from the move off client-side Anthropic calls. Do not add code to them; see [Critical rules](#critical-rules).
- `services/supabase.ts` — another empty placeholder; auth used to go through Supabase and now goes through the Railway backend's Google OAuth (`services/auth.ts`). Do not add code to it.
- `services/deviceTranslation.ts` — the free/no-LLM translation path. `translateTextOnDevice()` / `translateArticleOnDevice()` call the free MyMemory REST API (no key required) sentence-by-sentence. Comment in the file flags this as a placeholder to eventually swap for ML Kit (Android) / Apple Translation (iOS) if the app moves off Expo.
- `services/ankiExport.ts` — `exportNotecardsToAnki()` builds a tab-separated file from saved vocab (`buildAnkiTsv()`) and shares/downloads it (`expo-sharing` on native, a `Blob` download on web). Used from the Vocab tab in `app/index.tsx`.
- `services/vocab.ts` — thin wrappers that just forward to `services/api.ts`:
  - `lookupWordDefinition(word, targetLang, nativeLanguage, articleContext?)` → `apiLookupWord()` → backend `POST /llm/lookup` (Wiktionary first server-side when `nativeLanguage === 'en'`, else Sonnet fallback). Returns `LookupResult`.
  - `selectVocabWords(text, targetLang, nativeLanguage, existingWords)` → `apiSelectVocabWords()` → backend `POST /llm/vocab-select` (Haiku). Defensive parsing handles the model sometimes returning `{"word":"..."}` objects.
  - `getVerbConjugation(verb, language)` → `apiGetVerbConjugation()` → backend `POST /llm/conjugate` (Haiku).
- `services/api.ts` — all REST calls to backend, including the LLM-backed ones above, `apiSendChatMessage()` → `POST /chat/message`, and the device-translation helpers `apiCreateDeviceArticle()` (`POST /articles`) / `apiAppendDeviceSentences()` (`POST /articles/:id/text`). Auth identity from `getAuthState()` (Google OAuth JWT stored in AsyncStorage). Note: `apiPatchArticle()` (`PATCH /articles/:id`) is defined but currently unused by any store.
- `services/apiCosts.ts` — cost recording now happens server-side inside `callLLM()`; this file only keeps the `CostSource` type for compatibility.
- `services/scraper.ts` — `scrapeArticle(url)` → `POST /scrape` → `{ title, textContent }`.
- `services/auth.ts` — `getAuthState()`, `saveAuthState(token)`, `clearAuthState()`. Token stored in AsyncStorage as `@linguanews/auth`.
- `services/tts.ts` — text-to-speech.

**Types (`types/index.ts`):**
- `Article` — `id`, `title?`, `sourceUrl`, `sourceLanguage`, `targetLanguage`, `sentencePairs`, `vocabList`, `inputTokens`, `outputTokens`, `remainingText?`, `status?: 'translating' | 'complete' | 'error'`, `statusMessage?`
- `SentencePair` — `{ original, translation }`
- `VocabWord` — word in an article's vocab list: `word`, `definition`, `partOfSpeech?`, `gender?`, `article?`, `infinitive?`
- `UserVocabWord` — saved vocab entry: adds `id`, `vocabWordId`, `language`, `conjugation?`, SRS fields (`dueAt`, `intervalDays`, `easeFactor`, `repetitions`)
- `UserSettings` — `sourceLanguage`, `targetLanguage`, `nativeLanguage`, `difficulty`, `useLLM?` (false selects the free on-device translation path, see [Translation flow](#translation-flow))
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
1. `selectVocabWords()` → candidate words (backend `POST /llm/vocab-select`, Haiku, `source: 'vocab_selection'`)
2. For each word: `lookupWordDefinition()` → rich lookup (backend `POST /llm/lookup`, Wiktionary or Sonnet)
3. If verb: `getVerbConjugation()` → conjugation table (backend `POST /llm/conjugate`, Haiku)
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
- `POST /articles` — create an article row directly (no Claude call); used by the on-device (`useLLM: false`) translation path to create the stub before streaming sentences in via `POST /articles/:id/text`
- `POST /articles/:id/text` — append `{ original, translated }` sentence rows into `article_text` for an article, optionally marking it `complete`; used by the on-device translation path
- `POST /articles/:id/continue` — resume LLM translation of a legacy article's `remaining_text`, streaming more rows into `article_text` via `runContinuationJob()`
- `PATCH /articles/:id` — append sentence pairs to the legacy JSONB columns (`original_sentences`/`translated_sentences`); a client wrapper (`apiPatchArticle()`) exists but is currently unused
- `DELETE /articles?user_id=` — soft-delete all articles
- `DELETE /articles/:id?user_id=` — soft-delete one article
- `POST /vocab` — upsert vocab word, link to user
- `GET /vocab?user_id=` — get user's saved words
- `PUT /vocab/:id` — update a vocab word
- `DELETE /vocab/:id?user_id=` — remove from user_vocab
- `POST /api-costs` — record a cost entry (legacy path; costs are now written directly by `callLLM()`)
- `GET /api-costs/events?user_id=` — list cost events (includes `description`, `articleId`)
- `POST /llm/lookup` — word definition lookup (Wiktionary first when `native_language === 'en'`, else Sonnet), calls `callLLM()`
- `POST /llm/vocab-select` — candidate vocab words from article text (Haiku), calls `callLLM()`
- `POST /llm/conjugate` — verb conjugation table (Haiku), calls `callLLM()`
- `POST /chat/message` — conversation-practice turn, article- or vocab-grounded (Sonnet), calls `callLLM()`
- `POST /scrape` — proxy scrape via Readability; returns `{ title, textContent }`
- `GET /auth/google` — start Google OAuth flow
- `GET /auth/google/callback` — exchange code, mint JWT, redirect to app
- `GET /notecards/due` — SRS due cards
- `POST /notecards/:userVocabId/review` — submit SRS review grade
- `GET /notecards/lists`, `POST /notecards/lists`, `PUT /notecards/lists/:listId`, `DELETE /notecards/lists/:listId`, `GET/POST/DELETE /notecards/lists/:listId/items` — notecard list CRUD

**DB tables:**
- `articles` — UUID PK, `user_id`, `url`, `title`, `source_language`, `target_language`, `original_sentences JSONB` (legacy), `translated_sentences JSONB` (legacy), `vocab JSONB`, `input_tokens`, `output_tokens`, `deleted`, `remaining_text`, `status TEXT DEFAULT 'complete'`, `status_message`
- `article_text` — `id SERIAL`, `article_id UUID → articles`, `row_order INT`, `original TEXT`, `translated TEXT`, `source_language`, `target_language`, `created_at`. Indexed on `(article_id, row_order)`.
- `vocab_words` — `(word, language)` UNIQUE, `definition`, `part_of_speech`, `gender`, `article`, `conjugation JSONB`
- `user_vocab` — junction: `user_id`, `vocab_word_id`, SRS fields (`due_at`, `interval_days`, `ease_factor`, `repetitions`, `last_reviewed_at`)
- `api_costs` — `user_id`, `source`, `model`, `language`, `input_credit_rate`, `total_input_credits`, `output_credit_rate`, `total_output_credits`, `description TEXT` (article title), `article_id TEXT`
- `notecard_lists` — `user_id`, `name`, `language`
- `notecard_list_items` — `list_id → notecard_lists`, `user_vocab_id → user_vocab`

**LLM service (`src/llmService.ts`):**
- `callLLM({ userId, source, model, maxTokens, language?, system?, messages, description?, articleId? })` is the **single chokepoint for every Anthropic call in the app** — translation, lookup, conjugation, vocab selection, chat all go through it.
- Instantiates the Anthropic client from `process.env.ANTHROPIC_API_KEY`, calls `messages.create()`, and writes the resulting `api_costs` row itself (rate lookup by model in `MODEL_RATES`) before returning `{ text, inputTokens, outputTokens }` to the calling route.
- Any new LLM-backed feature should add a route that calls this function rather than talking to Anthropic directly, and definitely never from the client — see [Critical rules](#critical-rules).
- `src/wiktionary.ts` — server-side port of the free Wiktionary lookup (used by `POST /llm/lookup`); 4-second abort timeout, only tried when `native_language === 'en'`.

**Translation service (`src/translationService.ts`):**
- Streams from Claude with NDJSON output: title line first, then sentence pairs
- Parses lines as they arrive; writes to `article_text` and updates `articles.title` immediately
- If a hint title came from the scraper, stores it first and skips asking Claude for a title
- Records one `api_costs` row per translation job (with `article_id` and `description = title`)
- Handles multi-chunk articles (40k char chunks) transparently

**Auth (`src/routes/auth.ts`):**
- Google OAuth 2.0 — `GET /auth/google` → Google → `GET /auth/google/callback` → mint JWT → redirect to app
- Redirect URI allowlist (`ALLOWED_PREFIXES`): `exp://` (Expo Go), `linguanews://` (native build), `http://localhost` / `http://127.0.0.1` (local web dev), plus `WEB_APP_URL` if set (the deployed web build's own Railway URL)
- JWTs contain `{ userId, email, name }`, expire in 365 days, signed with `JWT_SECRET`

---

## Models used

All model calls happen server-side (`linguanews-backend/src/llmService.ts` → `callLLM()`). The client never talks to Anthropic.

| Use case | Backend route | Model | Source label |
|---|---|---|---|
| Article translation | streaming job (`translationService.ts`) | `claude-sonnet-4-6` | `article` |
| Word lookup (LLM fallback) | `POST /llm/lookup` | `claude-sonnet-4-6` | `vocab` |
| Verb conjugation | `POST /llm/conjugate` | `claude-haiku-4-5-20251001` | `vocab` |
| Vocab word selection | `POST /llm/vocab-select` | `claude-haiku-4-5-20251001` | `vocab_selection` |
| Chat / conversation practice | `POST /chat/message` | `claude-sonnet-4-6` | `chat` |
| Word lookup (primary, free) | `POST /llm/lookup` (tries first) | Wiktionary REST API | _(no cost)_ |

---

## Key components

- `components/ConjugationModal.tsx` — modal showing verb tenses, triggered from vocab list
- `components/VocabPopup.tsx` — popup shown after word tap/long-press in article reader
- `components/ParagraphCard.tsx` — renders a sentence pair; supports word tap on both original and translation sides
- `components/ArticleText.tsx` — wraps text with long-press detection
- `components/LanguagePicker.tsx` — source/target/native language selector
- `components/AudioPlayer.tsx` — TTS playback controls for an article (wraps `services/tts.ts`)
- `components/ReviewCard.tsx` — single SRS review card (front/back flip, grade buttons), used by `app/review.tsx`
- `components/WheelPicker.tsx` — scrollable wheel-style picker, used for settings selectors in `app/index.tsx`

## Utils / Constants

- `utils/cost.ts` — `calcCost()`, `calcCostHaiku()`, `formatCost()`, `formatTokens()`
- `utils/chunks.ts` — `pairChunks()`; re-pairs translated/original text into `SentencePair[]` by chunking to matching sizes
- `constants/languages.ts` — `DEFAULT_SOURCE_LANGUAGE`, `DEFAULT_TARGET_LANGUAGE`, `DEFAULT_NATIVE_LANGUAGE`, language list, `isGenderedLanguage()`
- `constants/costs.ts` — `SOURCE_ORDER`, `SOURCE_LABELS`
- `constants/theme.ts` — `ThemeColors` interface
- `hooks/useColors.ts` — resolves current theme colors
- `hooks/useArticle.ts` — thin wrapper around `articleStore` exposing `fetchArticle()` (calls `loadArticle()`), `isLoading`, `loadingStep`, `error`, `currentArticle`; used by `app/index.tsx`
