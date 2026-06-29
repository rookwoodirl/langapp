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
}

export interface UserSettings {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  apiKey: string;
}
