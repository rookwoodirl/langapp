import { SentencePair } from '../types';
export type { SentencePair };

// Group paragraphs into chunks of ~targetSize chars
function chunkBySize(text: string, targetSize = 1000): string[] {
  const paras = text.split(/\n\n+/).filter((p) => p.trim());
  if (!paras.length) return text.trim() ? [text.trim()] : [];
  const chunks: string[] = [];
  let current = '';
  for (const para of paras) {
    if (current && current.length + para.length + 2 > targetSize) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Distribute paragraphs of 'text' evenly into exactly n slots
function distributeIntoN(text: string, n: number): string[] {
  const paras = text.split(/\n\n+/).filter((p) => p.trim());
  const result: string[] = Array.from({ length: n }, () => '');
  if (!paras.length || n <= 0) return result;
  paras.forEach((para, i) => {
    const slot = Math.min(Math.floor((i / paras.length) * n), n - 1);
    result[slot] = result[slot] ? `${result[slot]}\n\n${para}` : para;
  });
  return result;
}

export function pairChunks(translatedText: string, originalText: string): SentencePair[] {
  const translationChunks = chunkBySize(translatedText);
  const n = translationChunks.length;
  const originalChunks = originalText
    ? distributeIntoN(originalText, n)
    : Array<string>(n).fill('');
  return translationChunks.map((translation, i) => ({
    translation,
    original: originalChunks[i] ?? '',
  }));
}
