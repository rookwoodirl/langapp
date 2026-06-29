import Anthropic from '@anthropic-ai/sdk';
import { VocabWord } from '../types';

export interface TranslationResult {
  translation: string;
  vocab: VocabWord[];
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
  // Strip markdown code fences the model sometimes adds despite instructions
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find the outermost { } in case there's preamble text
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1);
  return raw.trim();
}

async function callClaude(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');
  return extractJson(content.text);
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

  // Truncate very long articles to keep within token limits
  const truncated = text.length > 8000 ? text.slice(0, 8000) + '…' : text;

  let raw = await callClaude(client, systemPrompt, truncated);

  let parsed: TranslationResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Retry once, asking Claude to fix the JSON
    raw = await callClaude(
      client,
      systemPrompt,
      `The previous response was not valid JSON. Please return only valid JSON.\n\nOriginal text:\n${truncated}`
    );
    parsed = JSON.parse(raw);
  }

  if (!parsed.translation || !Array.isArray(parsed.vocab)) {
    throw new Error('Unexpected response structure from translation API.');
  }

  return parsed;
}
