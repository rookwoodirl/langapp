import Anthropic from '@anthropic-ai/sdk';
import { VerbConjugation } from '../types';

export async function lookupWordDefinition(
  word: string,
  targetLanguage: string,
  sourceLanguage: string,
  apiKey: string
): Promise<string> {
  if (!apiKey) throw new Error('No API key set.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Define the word "${word}" in ${targetLanguage} for a language learner. Reply in ${sourceLanguage} in 1–2 sentences, and include part of speech.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
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
