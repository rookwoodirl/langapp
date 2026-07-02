import { SentencePair } from '../types';

// Current implementation uses MyMemory (free cloud API, no key required).
// TODO: Replace internals with ML Kit (Android) / Apple Translation (iOS) when moving
// off Expo. Language pack download UX hooks are already in place in the UI.
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?。！？…])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function translateSentence(sentence: string, from: string, to: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `${MYMEMORY_URL}?q=${encodeURIComponent(sentence)}&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Translation request failed (${res.status})`);
    const data = await res.json() as {
      responseStatus: number;
      responseData: { translatedText: string };
      responseDetails?: string;
    };
    if (data.responseStatus !== 200) throw new Error(data.responseDetails ?? 'Translation failed');
    return data.responseData.translatedText;
  } finally {
    clearTimeout(timeout);
  }
}

export async function translateTextOnDevice(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  return translateSentence(text, sourceLanguage, targetLanguage);
}

export async function translateArticleOnDevice(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  onSentence: (pair: SentencePair) => void | Promise<void>,
): Promise<void> {
  const sentences = splitSentences(text);
  for (const original of sentences) {
    const translation = await translateSentence(original, sourceLanguage, targetLanguage);
    await onSentence({ original, translation });
  }
}
