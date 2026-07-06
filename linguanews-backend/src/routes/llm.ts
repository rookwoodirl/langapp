import { Router, Request, Response } from 'express';
import { callLLM } from '../llmService';
import { lookupWiktionary } from '../wiktionary';
import { requireAuth } from '../middleware/auth';
import { InsufficientCreditsError } from '../creditService';

const router = Router();
router.use(requireAuth);

const GENDERED_LANGUAGES = new Set(['de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'no', 'da', 'pl', 'ru', 'ar', 'he', 'hi']);

// Explicit, fixed tense/mood sets per language so every verb in that language
// gets the same conjugation table shape — without this, the model is free to
// pick "the most important tenses" per call, which produces inconsistent
// results between verbs (e.g. one gets an Imperative table, another doesn't).
const FIXED_TENSE_LANGUAGES: Record<string, string[]> = {
  es: ['Present', 'Imperfect', 'Preterite', 'Subjunctive', 'Future', 'Present Perfect', 'Present Progressive'],
  fr: ['Present', 'Imperfect', 'Preterite', 'Subjunctive', 'Future', 'Present Perfect', 'Present Progressive'],
  it: ['Present', 'Imperfect', 'Preterite', 'Subjunctive', 'Future', 'Present Perfect', 'Present Progressive'],
  pt: ['Present', 'Imperfect', 'Preterite', 'Subjunctive', 'Future', 'Present Perfect', 'Present Progressive'],
  de: ['Present', 'Simple Past', 'Perfect', 'Future', 'Imperative', 'Subjunctive II'],
};

function extractContext(text: string, word: string, radius = 400): string {
  const idx = text.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + word.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// Word definition lookup — Wiktionary first (when nativeLanguage === 'en'), fallback to Sonnet
router.post('/lookup', async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const { word, target_language, native_language, article_context } = req.body;

  if (!word || !target_language || !native_language) {
    return res.status(400).json({ error: 'word, target_language, and native_language are required' });
  }

  try {
    if (native_language === 'en') {
      const wikt = await lookupWiktionary(word as string, target_language as string);
      // Wiktionary's REST summary doesn't expose grammatical gender for most
      // languages (it lives in the headword line, not the sense definitions).
      // Don't accept a gender-less noun result here — fall through to Sonnet,
      // which reliably knows the gender, instead of silently returning null.
      const needsGender = GENDERED_LANGUAGES.has(target_language as string) && wikt?.partOfSpeech === 'noun';
      if (wikt && !(needsGender && !wikt.gender)) {
        return res.json({
          definition: wikt.definition,
          partOfSpeech: wikt.partOfSpeech ?? null,
          gender: wikt.gender ?? null,
          article: wikt.article ?? null,
          infinitive: wikt.infinitive ?? null,
          inputTokens: 0,
          outputTokens: 0,
        });
      }
    }

    const contextSnippet = article_context ? extractContext(article_context as string, word as string) : '';
    const contextLine = contextSnippet ? `The word appears in this passage: "${contextSnippet}"\n\n` : '';
    const genderLines = GENDERED_LANGUAGES.has(target_language as string)
      ? `- "gender": for nouns only — "masculine", "feminine", "neuter", or "common"; omit for all other parts of speech\n` +
        `- "article": for nouns only — the definite article in ${target_language} (e.g. "der", "la", "the"); omit for all other parts of speech\n`
      : '';

    const system =
      `You are a bilingual translation dictionary. A ${native_language} speaker is learning ${target_language}. ` +
      contextLine +
      `Given a ${target_language} word or phrase, return a JSON dictionary entry with these keys:\n` +
      `- "definition": concise definition in ${native_language}, as a translation dictionary would write it. ` +
      `For verbs and verb phrases (including conjugated forms), convert to the infinitive and begin with "to <infinitive in ${native_language}>" (e.g. "to run", "to have eaten"). ` +
      `For nouns, use a short noun phrase.\n` +
      `- "partOfSpeech": grammatical category (noun, verb, adjective, adverb, phrase, etc.)\n` +
      `- "infinitive": for verbs and verb phrases only — the infinitive/base form in ${target_language} (e.g. "laufen", "être", "haber comido"); omit for non-verbs\n` +
      genderLines +
      `Respond with raw JSON only. No markdown, no code fences, no preamble.`;

    const result = await callLLM({
      userId,
      source: 'vocab',
      model: 'claude-sonnet-4-6',
      maxTokens: 256,
      language: target_language as string,
      system,
      messages: [{ role: 'user', content: `${target_language} word or phrase: "${word}"` }],
    });

    let definition = result.text;
    let partOfSpeech: string | null = null;
    let gender: string | null = null;
    let article: string | null = null;
    let infinitive: string | null = null;
    try {
      const raw = result.text.trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        definition: string;
        partOfSpeech?: string;
        gender?: string;
        article?: string;
        infinitive?: string;
      };
      definition = parsed.definition;
      partOfSpeech = parsed.partOfSpeech ?? null;
      gender = parsed.gender ?? null;
      article = parsed.article ?? null;
      infinitive = parsed.infinitive ?? null;
    } catch {
      // return raw text if JSON parse fails
    }

    return res.json({ definition, partOfSpeech, gender, article, infinitive, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'insufficient_credits', balanceUsd: err.balanceUsd });
    }
    console.error('POST /llm/lookup error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Lookup failed' });
  }
});

// Vocab word selection — returns a list of recommended words from article text
router.post('/vocab-select', async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const { text, target_language, native_language, existing_words } = req.body;

  if (!text || !target_language || !native_language) {
    return res.status(400).json({ error: 'text, target_language, and native_language are required' });
  }

  const existing: string[] = Array.isArray(existing_words) ? existing_words : [];
  const knownStr = existing.length
    ? ` Do not include words the learner already knows: ${existing.slice(0, 80).join(', ')}.`
    : '';

  try {
    const result = await callLLM({
      userId,
      source: 'vocab_selection',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 256,
      language: target_language as string,
      system:
        `You are a language learning assistant helping a ${native_language} speaker learn ${target_language}. ` +
        `Identify the most useful vocabulary words from the given text for the learner to study.${knownStr}`,
      messages: [
        {
          role: 'user',
          content:
            `${target_language} text:\n\n${(text as string).slice(0, 4000)}\n\n` +
            `Return a JSON array of up to 10 words (base/infinitive form). Raw JSON array of strings only, no markdown.`,
        },
      ],
    });

    const raw = result.text.trim();
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'Could not parse vocab list from model response' });
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[];
    const words = parsed.map((item) =>
      typeof item === 'string' ? item : (item as Record<string, string>).word ?? String(item)
    );

    return res.json({ words, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'insufficient_credits', balanceUsd: err.balanceUsd });
    }
    console.error('POST /llm/vocab-select error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Vocab selection failed' });
  }
});

// Verb conjugation
router.post('/conjugate', async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const { verb, language } = req.body;

  if (!verb || !language) {
    return res.status(400).json({ error: 'verb and language are required' });
  }

  try {
    const fixedTenses = FIXED_TENSE_LANGUAGES[language as string];
    const tenseInstruction = fixedTenses
      ? `Include exactly these tenses/moods (skip any that genuinely do not exist in ${language}): ${fixedTenses.join(', ')}. ` +
        `The "name" field must be EXACTLY one of: ${fixedTenses.join(', ')}.`
      : `Include the most important tenses for ${language}. Always use the same standard set of tenses for every verb in ${language}, so conjugation tables are consistent across different words. Use standard English names for tense headers (e.g. Present, Past, Future).`;

    const result = await callLLM({
      userId,
      source: 'vocab',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 800,
      language: language as string,
      messages: [
        {
          role: 'user',
          content:
            `Give the infinitive and full conjugation tables for the ${language} verb "${verb}". ` +
            tenseInstruction + ` ` +
            `Use pronoun labels appropriate for ${language}. ` +
            `Reply with raw JSON only, no markdown:\n` +
            `{"infinitive":"...","tenses":[{"name":"Present","forms":["yo ...","tú ...","él/ella ...","nosotros ...","vosotros ...","ellos ..."]},...]}`
        },
      ],
    });

    const raw = result.text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.json({ conjugation: null, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    }

    const conjugation = JSON.parse(raw.slice(start, end + 1));
    return res.json({ conjugation, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'insufficient_credits', balanceUsd: err.balanceUsd });
    }
    console.error('POST /llm/conjugate error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Conjugation failed' });
  }
});

export default router;
