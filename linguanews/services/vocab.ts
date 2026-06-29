import Anthropic from '@anthropic-ai/sdk';
import { VerbConjugation } from '../types';

export interface LookupResult {
  definition: string;
  partOfSpeech?: string;
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
  if (!apiKey) throw new Error('No API key set.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const contextSnippet = articleContext ? extractContext(articleContext, word) : '';

  const contextLine = contextSnippet
    ? `The word appears in this passage: "${contextSnippet}"\n\n`
    : '';

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system:
      `You are a language translation assistant. A ${sourceLanguage} speaker is learning ${targetLanguage}. ` +
      `${contextLine}` +
      `Given a ${targetLanguage} word, return a JSON object with exactly two keys:\n` +
      `- "definition": a clear 1–2 sentence explanation in ${sourceLanguage}\n` +
      `- "partOfSpeech": the grammatical category (noun, verb, adjective, etc.)\n` +
      `Respond with raw JSON only. No markdown, no code fences, no preamble.`,
    messages: [{ role: 'user', content: `${targetLanguage} word: "${word}"` }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  let definition = content.text;
  let partOfSpeech: string | undefined;
  try {
    const raw = content.text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { definition: string; partOfSpeech?: string };
    definition = parsed.definition;
    partOfSpeech = parsed.partOfSpeech;
  } catch {
    // fall back to raw text if JSON parse fails
  }

  return {
    definition,
    partOfSpeech,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

export async function getVerbConjugation(
  verb: string,
  language: string,
  apiKey: string
): Promise<VerbConjugation | null> {
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      messages: [
        {
          role: 'user',
          content:
            `Give the infinitive and all 6 present-tense conjugations of the ${language} verb "${verb}". ` +
            `Reply with raw JSON only, no markdown: {"infinitive":"...","present":["yo...","tú...","él...","nosotros...","vosotros...","ellos..."]}. ` +
            `Use the pronoun labels appropriate for ${language}.`,
        },
      ],
    });
    const text = message.content[0];
    if (text.type !== 'text') return null;
    const raw = text.text.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(raw.slice(start, end + 1)) as VerbConjugation;
  } catch {
    return null;
  }
}
