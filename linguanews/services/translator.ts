import Anthropic from '@anthropic-ai/sdk';
import { VocabWord, SentencePair } from '../types';

export interface TranslationResult {
  translation: string;
  sentencePairs: SentencePair[];
  vocab: VocabWord[];
  inputTokens: number;
  outputTokens: number;
}

// Claude Sonnet 4.6 pricing (per million tokens)
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

export function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
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

function buildSystemPrompt(sourceLanguage: string, targetLanguage: string, difficulty: string): string {
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
    `  - "definition": in ${sourceLanguage}; for verbs begin with "to" (e.g. "to run"); for nouns use a short noun phrase\n` +
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

async function callClaude(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string
): Promise<{ json: string; inputTokens: number; outputTokens: number }> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 32768,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');
  return {
    json: extractJson(content.text),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

export async function translateArticle(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  apiKey: string,
  difficulty = 'intermediate'
): Promise<TranslationResult> {
  if (!apiKey) throw new Error('No API key set. Add your Anthropic API key in Settings.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const systemPrompt = buildSystemPrompt(sourceLanguage, targetLanguage, difficulty);

  // Claude Sonnet 4.6 has a 200K token context window; 40K chars ≈ 10K words
  const truncated = text.length > 40000 ? text.slice(0, 40000) + '…' : text;

  let result = await callClaude(client, systemPrompt, truncated);
  let totalInput = result.inputTokens;
  let totalOutput = result.outputTokens;

  let parsed: { sentences: SentencePair[]; vocab: VocabWord[] };
  try {
    parsed = JSON.parse(result.json);
  } catch {
    result = await callClaude(
      client,
      systemPrompt,
      `The previous response was not valid JSON. Please return only valid JSON.\n\nOriginal text:\n${truncated}`
    );
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    parsed = JSON.parse(result.json);
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
  };
}
