import { VocabWord, SentencePair } from '../types';
import { CostSource } from './apiCosts';
import { callLLM } from './llm';

export interface TranslationResult {
  translation: string;
  sentencePairs: SentencePair[];
  vocab: VocabWord[];
  inputTokens: number;
  outputTokens: number;
  remainingText?: string;
}

const DIFFICULTY_INSTRUCTIONS: Record<string, string> = {
  beginner:
    'Write the translation using simple, everyday vocabulary and short sentences. ' +
    'Avoid idioms and complex grammar. Prioritise clarity over nuance.',
  intermediate:
    'Write the translation at a standard reading level. ' +
    'Preserve most of the original meaning and structure, but simplify unusually complex phrasing.',
  advanced:
    'Write the translation preserving the full sophistication of the original: ' +
    'idiomatic expressions, nuanced vocabulary, and complex sentence structures.',
};


function buildSystemPrompt(sourceLanguage: string, targetLanguage: string, difficulty: string, nativeLanguage: string): string {
  const difficultyNote = DIFFICULTY_INSTRUCTIONS[difficulty] ?? DIFFICULTY_INSTRUCTIONS.intermediate;
  return (
    `You are a language translation assistant. You will receive article text in ${sourceLanguage}.\n` +
    `Reading difficulty: ${difficulty}. ${difficultyNote}\n\n` +
    `Return a JSON object with exactly two keys:\n` +
    `- "sentences": an array of objects, one per sentence from the source text, in order. Each object has:\n` +
    `  - "original": the sentence exactly as it appears in the source\n` +
    `  - "translation": that sentence translated into ${targetLanguage}\n` +
    `  Split on sentence-ending punctuation (., !, ?). Do not skip or merge sentences.\n` +
    `- "vocab": an array of 10–20 key vocabulary objects from the translations, written as a translation dictionary would. Each object has:\n` +
    `  - "word": as it appears in the translations\n` +
    `  - "definition": in ${nativeLanguage}; for verbs begin with "to" (e.g. "to run"); for nouns use a short noun phrase\n` +
    `  - "partOfSpeech": grammatical category\n` +
    `  - "gender": for nouns — "masculine", "feminine", "neuter", or "common"; omit for non-nouns\n` +
    `  - "article": for nouns — the definite article in ${targetLanguage}; omit for non-nouns\n\n` +
    `Respond with raw JSON only. No markdown, no code fences, no preamble.`
  );
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  return raw.trim();
}

export async function translateArticle(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  apiKey: string,
  difficulty = 'intermediate',
  source: CostSource = 'article',
  nativeLanguage = 'en',
): Promise<TranslationResult> {
  if (!apiKey) throw new Error('No Anthropic API key is configured for this app.');

  const system = buildSystemPrompt(sourceLanguage, targetLanguage, difficulty, nativeLanguage);
  const CHUNK_LIMIT = 40000;
  const remainingText = text.length > CHUNK_LIMIT ? text.slice(CHUNK_LIMIT) : undefined;
  const truncated = remainingText ? text.slice(0, CHUNK_LIMIT) : text;

  let result = await callLLM({
    source,
    apiKey,
    model: 'claude-sonnet-4-6',
    maxTokens: 32768,
    language: targetLanguage,
    system,
    messages: [{ role: 'user', content: truncated }],
  });
  let totalInput = result.inputTokens;
  let totalOutput = result.outputTokens;

  let parsed: { sentences: SentencePair[]; vocab: VocabWord[] };
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    result = await callLLM({
      source,
      apiKey,
      model: 'claude-sonnet-4-6',
      maxTokens: 32768,
      language: targetLanguage,
      system,
      messages: [
        { role: 'user', content: truncated },
        { role: 'assistant', content: result.text },
        { role: 'user', content: 'The previous response was not valid JSON. Please return only valid JSON.' },
      ],
    });
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    parsed = JSON.parse(extractJson(result.text));
  }

  if (!Array.isArray(parsed.sentences) || !Array.isArray(parsed.vocab)) {
    throw new Error('Unexpected response structure from translation API.');
  }

  const sentencePairs: SentencePair[] = parsed.sentences;
  const translation = sentencePairs.map((s) => s.translation).join(' ');

  return {
    translation,
    sentencePairs,
    vocab: parsed.vocab,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    remainingText,
  };
}

