import Anthropic from '@anthropic-ai/sdk';

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
