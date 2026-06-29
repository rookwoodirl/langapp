import AsyncStorage from '@react-native-async-storage/async-storage';
import { Article, UserVocabWord, VerbConjugation } from '../types';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');
const USER_ID_KEY = '@linguanews/user_id';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getUserId(): Promise<string> {
  let id = await AsyncStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = generateUUID();
    await AsyncStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

// Safely parse JSON — if the server returns an HTML error page (gateway
// timeout, cold-start, etc.) this gives a clear message instead of
// "unexpected token <".
async function parseJson(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`Server error (HTTP ${res.status}). Try again in a moment.`);
  }
  return res.json();
}

function rowToArticle(row: Record<string, unknown>): Article {
  return {
    id: row.id as string,
    sourceUrl: (row.url as string) ?? '',
    sourceLanguage: row.source_language as string,
    targetLanguage: row.target_language as string,
    originalText: (row.original_text as string) ?? '',
    translatedText: (row.translated_text as string) ?? '',
    vocabList: Array.isArray(row.vocab) ? row.vocab : [],
    createdAt: new Date(row.created_at as string).getTime(),
    inputTokens: (row.input_tokens as number) ?? 0,
    outputTokens: (row.output_tokens as number) ?? 0,
  };
}

export async function apiSaveArticle(article: Article): Promise<string> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      url: article.sourceUrl || null,
      title: null,
      source_language: article.sourceLanguage,
      target_language: article.targetLanguage,
      original_text: article.originalText || null,
      translated_text: article.translatedText,
      vocab: article.vocabList,
      input_tokens: article.inputTokens ?? 0,
      output_tokens: article.outputTokens ?? 0,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to save article');
  return data.id as string;
}

export async function apiLoadArticles(): Promise<Article[]> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles?user_id=${encodeURIComponent(userId)}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load articles');
  return (data as Record<string, unknown>[]).map(rowToArticle);
}

export async function apiDeleteArticle(id: string): Promise<void> {
  const userId = await getUserId();
  await fetch(`${BACKEND_URL}/articles/${id}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function apiClearArticles(): Promise<void> {
  const userId = await getUserId();
  await fetch(`${BACKEND_URL}/articles?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

function rowToVocabWord(row: Record<string, unknown>): UserVocabWord {
  return {
    id: row.id as string,
    vocabWordId: row.vocab_word_id as string,
    word: row.word as string,
    language: row.language as string,
    definition: row.definition as string,
    partOfSpeech: (row.part_of_speech as string) ?? undefined,
    conjugation: (row.conjugation as VerbConjugation) ?? undefined,
    addedAt: new Date(row.added_at as string).getTime(),
  };
}

export async function apiAddVocabWord(params: {
  word: string;
  language: string;
  definition: string;
  partOfSpeech?: string;
  conjugation?: VerbConjugation;
}): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/vocab`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      word: params.word,
      language: params.language,
      definition: params.definition,
      part_of_speech: params.partOfSpeech ?? null,
      conjugation: params.conjugation ?? null,
    }),
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to save vocab word');
  }
}

export async function apiLoadVocab(): Promise<UserVocabWord[]> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/vocab?user_id=${encodeURIComponent(userId)}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load vocab');
  return (data as Record<string, unknown>[]).map(rowToVocabWord);
}

export async function apiRemoveVocabWord(userVocabId: string): Promise<void> {
  const userId = await getUserId();
  await fetch(`${BACKEND_URL}/vocab/${userVocabId}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
