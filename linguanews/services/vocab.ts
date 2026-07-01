import { VerbConjugation } from '../types';
import { apiLookupWord, apiSelectVocabWords, apiGetVerbConjugation } from './api';

export interface LookupResult {
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  infinitive?: string;
  inputTokens: number;
  outputTokens: number;
}

export async function lookupWordDefinition(
  word: string,
  targetLanguage: string,
  nativeLanguage: string,
  articleContext?: string,
): Promise<LookupResult> {
  return apiLookupWord({ word, targetLanguage, nativeLanguage, articleContext });
}

export async function selectVocabWords(
  translatedText: string,
  targetLanguage: string,
  nativeLanguage: string,
  existingWords: string[],
): Promise<{ words: string[]; inputTokens: number; outputTokens: number }> {
  return apiSelectVocabWords({ text: translatedText, targetLanguage, nativeLanguage, existingWords });
}

export async function getVerbConjugation(
  verb: string,
  language: string,
): Promise<VerbConjugation | null> {
  const result = await apiGetVerbConjugation({ verb, language });
  return result.conjugation;
}
