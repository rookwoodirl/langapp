# Claude Code bootstrap prompt — Language Learner News App

## What you're building

A mobile app (iOS + Android) built with **Expo + React Native + TypeScript** for language learners. Users paste a news article URL; the app fetches and scrapes the article text, translates it from a source language (Language A) into a target language (Language B) using the Anthropic Claude API, and displays the translated article with key vocabulary words highlighted. Tapping a highlighted word shows a popup with the word's definition/translation back into Language A. The app also supports AI-voice readback of the translated article using a TTS API.

This is an **alpha build** — no auth, no payments, no backend server. All API calls go directly from the client using keys stored in a local `.env` file.

---

## Tech stack

- **Expo SDK** (latest stable, managed workflow)
- **React Native** with **TypeScript**
- **Expo Router** for navigation (file-based, like Next.js)
- **Anthropic Claude API** (`claude-sonnet-4-6`) for translation, vocab extraction, and inline word lookup
- **Expo Speech** (`expo-speech`) for TTS as the first pass; structure the TTS service so it can be swapped to an API-based voice later
- **AsyncStorage** (`@react-native-async-storage/async-storage`) for persisting saved articles and user language preferences
- **React Native Webview or fetch + readability** for article scraping (see notes below)
- No backend, no database, no auth

---

## Project structure to generate

```
/
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout (stack navigator)
│   ├── index.tsx                 # Home screen — paste URL or enter text
│   ├── article/
│   │   └── [id].tsx              # Article reading screen
│   └── settings.tsx              # Language pair + API key settings
│
├── components/
│   ├── ArticleText.tsx           # Renders translated text with tappable vocab spans
│   ├── VocabPopup.tsx            # Bottom sheet popup for tapped vocab words
│   ├── AudioPlayer.tsx           # TTS playback controls (play/pause/stop)
│   └── LanguagePicker.tsx        # Reusable language selector dropdown
│
├── services/
│   ├── scraper.ts                # Fetches URL and extracts article text (see notes)
│   ├── translator.ts             # Claude API call: translate article, return vocab list
│   ├── vocab.ts                  # Claude API call: lookup single word on demand
│   └── tts.ts                    # TTS abstraction (wraps expo-speech for now)
│
├── store/
│   └── articleStore.ts           # Zustand store for current article state
│                                 # (translated text, vocab list, playback state)
│
├── types/
│   └── index.ts                  # Shared TypeScript types
│
├── constants/
│   └── languages.ts              # List of supported language pairs
│
├── hooks/
│   └── useArticle.ts             # Custom hook: orchestrates scrape → translate flow
│
├── .env                          # ANTHROPIC_API_KEY (gitignored)
├── .env.example                  # Template for the above
├── app.json                      # Expo config
└── tsconfig.json
```

---

## Key types to define in `types/index.ts`

```ts
export type LanguageCode = string; // e.g. "en", "de", "es", "ja"

export interface VocabWord {
  word: string;           // The word as it appears in the translated text
  definition: string;     // Translation/definition back in Language A
  partOfSpeech?: string;  // e.g. "noun", "verb"
}

export interface Article {
  id: string;             // uuid
  sourceUrl: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  originalText: string;   // Scraped article text in Language A
  translatedText: string; // Full translation in Language B
  vocabList: VocabWord[]; // Key vocab extracted at translation time
  createdAt: number;      // Unix timestamp
}

export interface UserSettings {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  apiKey: string;
}
```

---

## Service implementation notes

### `services/scraper.ts`
Use `fetch()` to GET the URL, then pass the HTML through Mozilla's **readability** library (`@mozilla/readability`) together with a DOM parser (`jsdom` or `dompurify` for React Native). The goal is to strip nav, ads, and boilerplate and return just the article `title` and `textContent`. Note that paywalled articles will fail — this is expected. When scraping fails, surface a clear error with a fallback: let the user paste article text manually instead.

### `services/translator.ts`
Make **one Claude API call** that does both jobs in a single response to minimize cost and latency:

**System prompt:**
```
You are a language translation assistant. You will receive article text in {{sourceLanguage}}.
Return a JSON object with exactly two keys:
- "translation": the full article translated into {{targetLanguage}}, preserving paragraph breaks with \n\n
- "vocab": an array of 10–20 key vocabulary objects, each with "word" (as it appears in the translation), "definition" (explained in {{sourceLanguage}}), and "partOfSpeech"

Respond with raw JSON only. No markdown, no code fences, no preamble.
```

Parse the JSON response. If parsing fails, retry once with a note to the model to fix the JSON.

### `services/vocab.ts`
For on-demand word lookup (user taps a non-highlighted word), make a lightweight Claude call:

**Prompt:** `Define the word "{{word}}" in {{targetLanguage}} for a language learner. Reply in {{sourceLanguage}} in 1–2 sentences, and include part of speech.`

Cache results in the Zustand store so the same word isn't looked up twice per session.

### `services/tts.ts`
Wrap `expo-speech` with a simple interface:
```ts
interface TTSService {
  speak(text: string, language: LanguageCode): void;
  stop(): void;
  pause(): void;
}
```
Add a comment noting this should be replaced with an API-based voice (e.g. OpenAI TTS) when voice quality becomes a priority. `expo-speech` is free and works offline but uses the device's built-in voice.

---

## Screen behaviour notes

### `app/index.tsx` — Home screen
- Single input: URL field with a paste button
- Below it: a "paste article text directly" toggle that reveals a multiline text input (fallback for paywalled articles)
- Language pair selector (source → target), defaulting to user settings
- "Translate" button triggers the scrape → translate flow
- Show a loading state with step labels: "Fetching article…" → "Translating…" → "Done"
- On success, navigate to `/article/[id]`

### `app/article/[id].tsx` — Reading screen
- Display `article.translatedText` using `ArticleText.tsx`
- Vocab words from `article.vocabList` are highlighted (subtle underline or background tint — not garish)
- Tapping a highlighted word opens `VocabPopup.tsx` from the bottom
- Tapping any *non*-highlighted word triggers an on-demand lookup via `services/vocab.ts` and also opens `VocabPopup.tsx`
- `AudioPlayer.tsx` is pinned to the bottom of the screen (above the popup when open)
- Top bar shows source → target language and a share/export button (stub it out for now)

### `app/settings.tsx` — Settings screen
- Source language picker
- Target language picker
- API key input field (masked, stored in AsyncStorage — this is alpha, not production-grade security)
- "Clear saved articles" button

---

## `components/ArticleText.tsx` implementation note

This is the most nuanced component. The translated text is a plain string. The vocab list is an array of `{word, ...}` objects. You need to split the text into runs of normal text and highlighted-word spans.

Suggested approach:
1. Build a regex from all vocab words (escape special chars, join with `|`, case-insensitive)
2. Use `text.split(regex)` to get alternating plain/matched segments
3. Render each segment as either a plain `<Text>` or a tappable `<Text style={styles.highlight}>` 
4. Wrap everything in a scrollable `<Text>` container (React Native allows nested `<Text>` for inline styling)

---

## State management (`store/articleStore.ts`)

Use **Zustand** (lightweight, no boilerplate). Store should hold:
- `currentArticle: Article | null`
- `isLoading: boolean`
- `loadingStep: string` — human-readable step label for the loading UI
- `error: string | null`
- `savedArticles: Article[]` — persisted to AsyncStorage
- `ttsPlaying: boolean`
- `actions`: `loadArticle(url, settings)`, `lookupWord(word)`, `toggleTTS()`, `saveArticle()`, `clearError()`

---

## Packages to install

```bash
npx create-expo-app@latest linguanews --template blank-typescript
cd linguanews

npx expo install expo-speech expo-router @react-native-async-storage/async-storage

npm install zustand @anthropic-ai/sdk @mozilla/readability jsdom

npm install --save-dev @types/jsdom
```

Note: `jsdom` may require a polyfill shim in the Expo environment. If it causes issues at runtime, replace with a lightweight regex-based HTML stripper as a fallback (strip all tags, decode HTML entities, collapse whitespace).

---

## `.env.example`
```
ANTHROPIC_API_KEY=your_key_here
```

Access in code via `process.env.ANTHROPIC_API_KEY`. In Expo, prefix with `EXPO_PUBLIC_` if you need it accessible on the client without a build step: `EXPO_PUBLIC_ANTHROPIC_API_KEY`.

---

## What NOT to build yet

- User accounts or auth
- Anki integration
- Payment / per-word billing
- A backend server — all calls go client-side for now
- Push notifications
- Social/sharing features

Stub these out with placeholder functions and `// TODO` comments where their eventual insertion point would be.

---

## Definition of done for this bootstrap

The app should:
1. Launch in Expo Go on both iOS and Android
2. Accept a URL or pasted text on the home screen
3. Call the Claude API and return a translated article with a vocab list
4. Display the article with highlighted vocab words that open a definition popup on tap
5. Play the article aloud via `expo-speech`
6. Persist the language preference between sessions via AsyncStorage
7. Show clear loading states and error messages

No polish required. Placeholder UI is fine. The goal is a working end-to-end flow.
