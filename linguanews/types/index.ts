export type LanguageCode = string; // e.g. "en", "de", "es", "ja"

export interface SentencePair {
  original: string;
  translation: string;
}

export interface VocabWord {
  word: string;
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  infinitive?: string;
}

export interface Article {
  id: string;
  sourceUrl: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sentencePairs: SentencePair[];
  vocabList: VocabWord[];
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
}

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface UserSettings {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  difficulty: DifficultyLevel;
}

export interface VerbTense {
  name: string;
  forms: string[];
}

export interface VerbConjugation {
  infinitive: string;
  tenses: VerbTense[];
  present?: string[]; // legacy field — kept for backward compat with saved words
}

export interface UserVocabWord {
  id: string;
  vocabWordId: string;
  word: string;
  language: string;
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  conjugation?: VerbConjugation;
  addedAt: number;
}
