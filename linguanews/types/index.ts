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
  title?: string;
  sourceUrl: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sentencePairs: SentencePair[];
  vocabList: VocabWord[];
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  remainingText?: string;
  status?: 'translating' | 'complete' | 'error';
  statusMessage?: string;
}

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface UserSettings {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  nativeLanguage: LanguageCode;
  difficulty: DifficultyLevel;
  useLLM?: boolean;
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
  dueAt: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lastReviewedAt?: number;
}

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface NotecardList {
  id: string;
  name: string;
  language?: string;
  createdAt: number;
  itemCount?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  mode: 'article' | 'vocab';
  difficulty: DifficultyLevel;
  targetLanguage: LanguageCode;
  nativeLanguage: LanguageCode;
  articleId?: string;
  articleTitle?: string;
  vocabWords?: string[];
  vocabLabel?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
