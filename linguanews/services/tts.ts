import * as Speech from 'expo-speech';
import { LanguageCode } from '../types';

// TODO: Replace expo-speech with an API-based voice (e.g. OpenAI TTS) when voice quality
// becomes a priority. expo-speech is free and works offline but uses the device's built-in voice.

export interface TTSService {
  speak(text: string, language: LanguageCode, onDone?: () => void): void;
  stop(): void;
  pause(): void;
}

export const ttsService: TTSService = {
  speak(text, language, onDone) {
    Speech.stop();
    Speech.speak(text, {
      language,
      onDone,
      onError: () => onDone?.(),
    });
  },

  stop() {
    Speech.stop();
  },

  pause() {
    // expo-speech does not support pause; stop is the best available fallback
    Speech.stop();
  },
};
