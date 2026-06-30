import { VocabWord, VerbConjugation } from '../types';
import { callLLM } from './llm';

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
  sourceLanguage: string,
  apiKey: string,
  articleContext?: string
): Promise<LookupResult> {
  const contextSnippet = articleContext ? extractContext(articleContext, word) : '';
  const contextLine = contextSnippet ? `The word appears in this passage: "${contextSnippet}"\n\n` : '';

  const system =
    `You are a bilingual translation dictionary. A ${sourceLanguage} speaker is learning ${targetLanguage}. ` +
    `${contextLine}` +
    `Given a ${targetLanguage} word or phrase, return a JSON dictionary entry with these keys:\n` +
    `- "definition": concise definition in ${sourceLanguage}, as a translation dictionary would write it. ` +
    `For verbs and verb phrases (including conjugated forms), convert to the infinitive and begin with "to <infinitive in ${sourceLanguage}>" (e.g. "to run", "to have eaten"). ` +
    `For nouns, use a short noun phrase.\n` +
    `- "partOfSpeech": grammatical category (noun, verb, adjective, adverb, phrase, etc.)\n` +
    `- "infinitive": for verbs and verb phrases only — the infinitive/base form in ${targetLanguage} (e.g. "laufen", "être", "haber comido"); omit for non-verbs\n` +
    `- "gender": for nouns only — "masculine", "feminine", "neuter", or "common"; omit for all other parts of speech\n` +
    `- "article": for nouns only — the definite article in ${targetLanguage} (e.g. "der", "la", "the"); omit for all other parts of speech\n` +
    `Respond with raw JSON only. No markdown, no code fences, no preamble.`;

  const result = await callLLM({
    source: 'vocab',
    apiKey,
    model: 'claude-sonnet-4-6',
    maxTokens: 256,
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

export async function generateRecommendedVocab(
  translatedText: string,
  targetLanguage: string,
  sourceLanguage: string,
  existingWords: string[],
  apiKey: string
): Promise<{ words: VocabWord[]; inputTokens: number; outputTokens: number }> {
  const knownStr = existingWords.length
    ? ` Do not include words the learner already knows: ${existingWords.slice(0, 80).join(', ')}.`
    : '';

  const result = await callLLM({
    source: 'vocab',
    apiKey,
    model: 'claude-sonnet-4-6',
    maxTokens: 1024,
    system:
      `You are a language learning assistant helping a ${sourceLanguage} speaker learn ${targetLanguage}. ` +
      `Identify the most useful vocabulary words from the given text for the learner to study.${knownStr}`,
    messages: [
      {
        role: 'user',
        content:
          `${targetLanguage} text:\n\n${translatedText.slice(0, 4000)}\n\n` +
          `Return a JSON array of up to 10 vocabulary words. ` +
          `Each item: {"word":"...","definition":"(in ${sourceLanguage})...","partOfSpeech":"..."}. ` +
          `Raw JSON array only, no markdown.`,
      },
    ],
  });

  const raw = result.text.trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Could not parse vocab list from response.');
  const words = JSON.parse(raw.slice(start, end + 1)) as VocabWord[];

  return { words, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export async function getVerbConjugation(
  verb: string,
  language: string,
  apiKey: string
): Promise<VerbConjugation | null> {
  if (!apiKey) return null;
  try {
    const result = await callLLM({
      source: 'vocab',
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 512,
      messages: [
        {
          role: 'user',
          content:
            `Give the infinitive and conjugations for the most important tenses of the ${language} verb "${verb}". ` +
            `Use the pronoun labels appropriate for ${language}. ` +
            `Reply with raw JSON only, no markdown:\n` +
            `{"infinitive":"...","tenses":[{"name":"Present","forms":["...","...","...","...","...","..."]},{"name":"Past","forms":[...]},{"name":"Future","forms":[...]}]}`,
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
