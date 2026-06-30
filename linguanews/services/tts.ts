import * as Speech from 'expo-speech';
import { LanguageCode } from '../types';

// expo-speech has a ~4000 char limit per call on Android/iOS.
// Split at sentence boundaries and speak chunks sequentially.
function splitChunks(text: string, maxLen = 3800): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('. ', maxLen);
    if (cut === -1) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut === -1) cut = maxLen;
    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export interface TTSService {
  speak(text: string, language: LanguageCode, onDone?: () => void): void;
  stop(): void;
}

export const ttsService: TTSService = {
  speak(text, language, onDone) {
    Speech.stop();
    const chunks = splitChunks(text);
    let idx = 0;
    function next() {
      if (idx >= chunks.length) { onDone?.(); return; }
      Speech.speak(chunks[idx++], { language, onDone: next, onError: () => onDone?.() });
    }
    next();
  },
  stop() {
    Speech.stop();
  },
};
