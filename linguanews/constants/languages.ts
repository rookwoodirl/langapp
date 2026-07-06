import { DifficultyLevel } from '../types';

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
];

export const DEFAULT_SOURCE_LANGUAGE = 'en';
export const DEFAULT_TARGET_LANGUAGE = 'es';
export const DEFAULT_NATIVE_LANGUAGE = 'en';

export const DIFFICULTIES: DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];

// Languages with grammatical gender (and, accordingly, gendered definite articles).
// Used to skip asking for gender/article on languages that don't have the concept (e.g. Chinese, Japanese, Korean, Turkish).
export const GENDERED_LANGUAGES = new Set(['es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'ar', 'hi', 'pl', 'sv']);

export function isGenderedLanguage(code: string): boolean {
  return GENDERED_LANGUAGES.has(code);
}

export function getLanguageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

// An article has two languages (source and target). Whichever one isn't the
// user's native/preferred language is the one being learned — don't assume
// that's always `targetLanguage`, since a translation can run either direction.
export function getLearningLanguage(sourceLanguage: string, targetLanguage: string, nativeLanguage: string): string {
  return targetLanguage === nativeLanguage ? sourceLanguage : targetLanguage;
}
