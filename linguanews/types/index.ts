export type LanguageCode = string; // e.g. "en", "de", "es", "ja"

export interface VocabWord {
  word: string;
  definition: string;
  partOfSpeech?: string;
}

export interface Article {
  id: string;
  sourceUrl: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  originalText: string;
  translatedText: string;
  vocabList: VocabWord[];
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
}

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface UserSettings {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  apiKey: string;
  difficulty: DifficultyLevel;
}

export interface VerbConjugation {
  infinitive: string;
  present: string[];
}

export interface UserVocabWord {
  id: string;
  vocabWordId: string;
  word: string;
  language: string;
  definition: string;
  partOfSpeech?: string;
  conjugation?: VerbConjugation;
  addedAt: number;
}
