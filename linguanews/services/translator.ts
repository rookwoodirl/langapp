import Anthropic from '@anthropic-ai/sdk';
import { VocabWord } from '../types';

export interface TranslationResult {
  translation: string;
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

function buildSystemPrompt(sourceLanguage: string, targetLanguage: string): string {
  return (
    `You are a language translation assistant. You will receive article text in ${sourceLanguage}.\n` +
    `Return a JSON object with exactly two keys:\n` +
    `- "translation": the full article translated into ${targetLanguage}, preserving paragraph breaks with \\n\\n\n` +
    `- "vocab": an array of 10–20 key vocabulary objects, each with "word" (as it appears in the translation), ` +
    `"definition" (explained in ${sourceLanguage}), and "partOfSpeech"\n\n` +
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
    max_tokens: 8192,
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
  apiKey: string
): Promise<TranslationResult> {
  if (!apiKey) throw new Error('No API key set. Add your Anthropic API key in Settings.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const systemPrompt = buildSystemPrompt(sourceLanguage, targetLanguage);

  // Claude Sonnet 4.6 has a 200K token context window; 40K chars ≈ 10K words
  const truncated = text.length > 40000 ? text.slice(0, 40000) + '…' : text;

  let result = await callClaude(client, systemPrompt, truncated);
  let totalInput = result.inputTokens;
  let totalOutput = result.outputTokens;

  let parsed: { translation: string; vocab: VocabWord[] };
  try {
    parsed = JSON.parse(result.json);
  } catch {
    // Retry once, asking Claude to fix the JSON
    result = await callClaude(
      client,
      systemPrompt,
      `The previous response was not valid JSON. Please return only valid JSON.\n\nOriginal text:\n${truncated}`
    );
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    parsed = JSON.parse(result.json);
  }

  if (!parsed.translation || !Array.isArray(parsed.vocab)) {
    throw new Error('Unexpected response structure from translation API.');
  }

  return {
    translation: parsed.translation,
    vocab: parsed.vocab,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  };
}
