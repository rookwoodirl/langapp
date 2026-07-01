import { VerbConjugation } from '../types';
import { callLLM } from './llm';
import { lookupWiktionary } from './wiktionary';
import { isGenderedLanguage } from '../constants/languages';

export interface LookupResult {
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  infinitive?: string;
  inputTokens: number;
  outputTokens: number;
}

function extractContext(text: string, word: string, radius = 400): string {
  const idx = text.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + word.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export async function lookupWordDefinition(
  word: string,
  targetLanguage: string,
  nativeLanguage: string,
  apiKey: string,
  articleContext?: string,
): Promise<LookupResult> {
  // Wiktionary covers English-native lookups with zero LLM cost.
  // Non-English native falls through to LLM so definitions come in the right language.
  if (nativeLanguage === 'en') {
    const wikt = await lookupWiktionary(word, targetLanguage);
    if (wikt) {
      return {
        definition: wikt.definition,
        partOfSpeech: wikt.partOfSpeech,
        gender: wikt.gender,
        article: wikt.article,
        infinitive: wikt.infinitive,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  const contextSnippet = articleContext ? extractContext(articleContext, word) : '';
  const contextLine = contextSnippet ? `The word appears in this passage: "${contextSnippet}"\n\n` : '';
  const genderLines = isGenderedLanguage(targetLanguage)
    ? `- "gender": for nouns only — "masculine", "feminine", "neuter", or "common"; omit for all other parts of speech\n` +
      `- "article": for nouns only — the definite article in ${targetLanguage} (e.g. "der", "la", "the"); omit for all other parts of speech\n`
    : '';

  const system =
    `You are a bilingual translation dictionary. A ${nativeLanguage} speaker is learning ${targetLanguage}. ` +
    `${contextLine}` +
    `Given a ${targetLanguage} word or phrase, return a JSON dictionary entry with these keys:\n` +
    `- "definition": concise definition in ${nativeLanguage}, as a translation dictionary would write it. ` +
    `For verbs and verb phrases (including conjugated forms), convert to the infinitive and begin with "to <infinitive in ${nativeLanguage}>" (e.g. "to run", "to have eaten"). ` +
    `For nouns, use a short noun phrase.\n` +
    `- "partOfSpeech": grammatical category (noun, verb, adjective, adverb, phrase, etc.)\n` +
    `- "infinitive": for verbs and verb phrases only — the infinitive/base form in ${targetLanguage} (e.g. "laufen", "être", "haber comido"); omit for non-verbs\n` +
    `${genderLines}` +
    `Respond with raw JSON only. No markdown, no code fences, no preamble.`;

  const result = await callLLM({
    source: 'vocab',
    apiKey,
    model: 'claude-sonnet-4-6',
    maxTokens: 256,
    language: targetLanguage,
    system,
    messages: [{ role: 'user', content: `${targetLanguage} word or phrase: "${word}"` }],
  });

  let definition = result.text;
  let partOfSpeech: string | undefined;
  let gender: string | undefined;
  let article: string | undefined;
  let infinitive: string | undefined;
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
    partOfSpeech = parsed.partOfSpeech;
    gender = parsed.gender;
    article = parsed.article;
    infinitive = parsed.infinitive;
  } catch {
    // fall back to raw text if JSON parse fails
  }

  return {
    definition,
    partOfSpeech,
    gender,
    article,
    infinitive,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

export async function selectVocabWords(
  translatedText: string,
  targetLanguage: string,
  nativeLanguage: string,
  existingWords: string[],
  apiKey: string,
): Promise<{ words: string[]; inputTokens: number; outputTokens: number }> {
  const knownStr = existingWords.length
    ? ` Do not include words the learner already knows: ${existingWords.slice(0, 80).join(', ')}.`
    : '';

  const result = await callLLM({
    source: 'vocab_selection',
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 256,
    language: targetLanguage,
    system:
      `You are a language learning assistant helping a ${nativeLanguage} speaker learn ${targetLanguage}. ` +
      `Identify the most useful vocabulary words from the given text for the learner to study.${knownStr}`,
    messages: [
      {
        role: 'user',
        content:
          `${targetLanguage} text:\n\n${translatedText.slice(0, 4000)}\n\n` +
          `Return a JSON array of up to 10 words (base/infinitive form). Raw JSON array of strings only, no markdown.`,
      },
    ],
  });

  const raw = result.text.trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Could not parse vocab list from response.');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[];
  // Defensively extract strings — Haiku sometimes returns objects like {"word":"..."} instead of plain strings
  const words = parsed.map((item) =>
    typeof item === 'string' ? item : (item as Record<string, string>).word ?? String(item)
  );
  return { words, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

const ROMANCE_LANGUAGE_CODES = new Set(['es', 'fr', 'it', 'pt']);

const ROMANCE_TENSES = ['Present', 'Imperfect', 'Preterite', 'Subjunctive', 'Future', 'Present Perfect', 'Present Progressive'];

export async function getVerbConjugation(
  verb: string,
  language: string,
  apiKey: string,
): Promise<VerbConjugation | null> {
  if (!apiKey) return null;
  try {
    const isRomance = ROMANCE_LANGUAGE_CODES.has(language);
    const tenseInstruction = isRomance
      ? `Include exactly these tenses (skip any that genuinely do not exist in ${language}): ${ROMANCE_TENSES.join(', ')}. ` +
        `The "name" field must be EXACTLY one of: ${ROMANCE_TENSES.join(', ')}.`
      : `Include the most important tenses for ${language}. Use standard English names for tense headers (e.g. Present, Past, Future).`;

    const result = await callLLM({
      source: 'vocab',
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 800,
      language,
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
    if (start === -1 || end === -1) return null;
    return JSON.parse(raw.slice(start, end + 1)) as VerbConjugation;
  } catch {
    return null;
  }
}
