# LinguaNews

A language-learning app that turns any news article into a reading lesson. Paste a URL, and LinguaNews translates it sentence-by-sentence into the language you're learning, then helps you build a personal vocabulary list — with definitions, part of speech, gender/article, and full conjugation tables — from the words you actually encounter.

**🔗 Live app: [langapp-production-6ea9.up.railway.app](https://langapp-production-6ea9.up.railway.app/)**

> **A note on cost:** the AI-powered features (translation, word lookup, conjugation, chat practice) run on the Claude API, billed out of a personal $5 account I'm covering myself. There's no ads, subscriptions, or paywall — but if that budget runs dry, AI features may pause until it's topped up. A **free, on-device translation mode** (no AI, no cost) is always available as a fallback.

## What it does

- **Paste a URL → get a lesson.** LinguaNews scrapes the article, translates it into your target language sentence-by-sentence as a background job, and streams the result in as it's ready — no waiting on a blank screen.
- **Tap any word** while reading to look up its definition, or hit **Generate Vocab** to auto-extract the key words worth learning from the piece.
- **Rich vocab entries.** Every saved word gets a definition, part of speech, gender/article (for nouns), and a full conjugation table (for verbs).
- **Spaced repetition review.** Saved words feed into an SRS review queue, gradable and organized into custom notecard lists, exportable to Anki.
- **Conversation practice.** Chat with an AI tutor grounded in either an article you've read or a set of vocab words, at your chosen difficulty level.
- **Two translation modes.** Full AI-quality translation via Claude, or a free on-device fallback (no AI cost) for unlimited reading.
- **Google sign-in.** Articles, vocab, and progress are saved to your account and sync across sessions.

## Tech stack

| Layer | Stack |
|---|---|
| Mobile / web app | Expo (React Native + TypeScript), targeting Android and exported as a static web build |
| Backend API | Express + TypeScript |
| Database | PostgreSQL |
| AI | Claude (Anthropic API) — translation, lookup, conjugation, vocab selection, chat |
| Free fallbacks | Wiktionary (word lookup), MyMemory (on-device translation) — used ahead of paid AI calls wherever possible |
| Auth | Google OAuth 2.0 |
| Hosting | Railway (both the API server and the web build) |

The app is a monorepo with two workspaces: `linguanews/` (the Expo client) and `linguanews-backend/` (the API server). Every AI call is funneled through a single server-side chokepoint so the client never holds an API key or talks to Anthropic directly — keeping the whole project's AI spend visible, capped, and cheap to run.

## Status

Actively developed as a personal project / learning tool. Feedback and issues welcome.
