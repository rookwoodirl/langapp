import { Article, NotecardList, ReviewGrade, UserVocabWord, VerbConjugation } from '../types';
import { getAuthState } from './auth';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');

export async function getUserId(): Promise<string> {
  const auth = await getAuthState();
  if (!auth) throw new Error('Not signed in');
  return auth.userId;
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
  const originals: string[] = Array.isArray(row.original_sentences) ? row.original_sentences as string[] : [];
  const translations: string[] = Array.isArray(row.translated_sentences) ? row.translated_sentences as string[] : [];
  const sentencePairs = translations.map((translation, i) => ({
    original: originals[i] ?? '',
    translation,
  }));
  const rawStatus = row.status as string | undefined;
  const status: Article['status'] =
    rawStatus === 'translating' || rawStatus === 'error' ? rawStatus : 'complete';
  return {
    id: row.id as string,
    title: (row.title as string) || undefined,
    sourceUrl: (row.url as string) ?? '',
    sourceLanguage: row.source_language as string,
    targetLanguage: row.target_language as string,
    sentencePairs,
    vocabList: Array.isArray(row.vocab) ? row.vocab : [],
    createdAt: new Date(row.created_at as string).getTime(),
    inputTokens: (row.input_tokens as number) ?? 0,
    outputTokens: (row.output_tokens as number) ?? 0,
    remainingText: (row.remaining_text as string) || undefined,
    status,
    statusMessage: (row.status_message as string) || undefined,
  };
}

export async function apiStartTranslation(params: {
  text: string;
  sourceUrl?: string;
  title?: string;
  sourceLanguage: string;
  targetLanguage: string;
  nativeLanguage: string;
  difficulty: string;
}): Promise<{ id: string }> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      text: params.text,
      url: params.sourceUrl ?? null,
      title: params.title ?? null,
      source_language: params.sourceLanguage,
      target_language: params.targetLanguage,
      native_language: params.nativeLanguage,
      difficulty: params.difficulty,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to start translation');
  return { id: data.id as string };
}

export async function apiPollArticleSentences(
  articleId: string,
  after: number,
): Promise<{ sentences: { original: string; translation: string }[]; status: string; total: number }> {
  const userId = await getUserId();
  const params = new URLSearchParams({ user_id: userId, after: String(after) });
  const res = await fetch(`${BACKEND_URL}/articles/${encodeURIComponent(articleId)}/sentences?${params.toString()}`);
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to poll sentences');
  return data as { sentences: { original: string; translation: string }[]; status: string; total: number };
}

export async function apiSaveArticle(article: Article): Promise<string> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      url: article.sourceUrl || null,
      title: article.title ?? null,
      source_language: article.sourceLanguage,
      target_language: article.targetLanguage,
      sentence_pairs: article.sentencePairs ?? [],
      vocab: article.vocabList,
      input_tokens: article.inputTokens ?? 0,
      output_tokens: article.outputTokens ?? 0,
      remaining_text: article.remainingText ?? null,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to save article');
  return data.id as string;
}

export async function apiPatchArticle(id: string, params: {
  sentencePairsToAppend: { original: string; translation: string }[];
  remainingText?: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      sentence_pairs_to_append: params.sentencePairsToAppend,
      remaining_text: params.remainingText ?? null,
      input_tokens_to_add: params.inputTokens,
      output_tokens_to_add: params.outputTokens,
    }),
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to update article');
  }
}

export async function apiLoadArticles(): Promise<Article[]> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles?user_id=${encodeURIComponent(userId)}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load articles');
  return (data as Record<string, unknown>[]).map(rowToArticle);
}

export async function apiLoadArticle(id: string): Promise<Article | null> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles/${id}?user_id=${encodeURIComponent(userId)}`);
  if (res.status === 404) return null;
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load article');
  return rowToArticle(data as Record<string, unknown>);
}

export async function apiDeleteArticle(id: string): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles/${id}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to delete article');
  }
}

export interface CostEvent {
  id: string;
  createdAt: number;
  source: string;
  model: string;
  language?: string;
  description?: string;
  articleId?: string;
  inputCredits: number;
  outputCredits: number;
  cost: number;
}

export async function apiGetCostEvents(filters?: { since?: Date; source?: string; limit?: number }): Promise<CostEvent[]> {
  try {
    const userId = await getUserId();
    const params = new URLSearchParams({ user_id: userId });
    if (filters?.since) params.set('since', filters.since.toISOString());
    if (filters?.source) params.set('source', filters.source);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const res = await fetch(`${BACKEND_URL}/api-costs/events?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await parseJson(res)) as Record<string, unknown>[];
    return data.map((row) => ({
      id: row.id as string,
      createdAt: new Date(row.createdAt as string).getTime(),
      source: row.source as string,
      model: row.model as string,
      language: (row.language as string) ?? undefined,
      description: (row.description as string) ?? undefined,
      articleId: (row.articleId as string) ?? undefined,
      inputCredits: row.inputCredits as number,
      outputCredits: row.outputCredits as number,
      cost: row.cost as number,
    }));
  } catch {
    return [];
  }
}

export async function apiContinueTranslation(articleId: string, params: {
  difficulty: string;
  nativeLanguage: string;
}): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles/${encodeURIComponent(articleId)}/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      difficulty: params.difficulty,
      native_language: params.nativeLanguage,
    }),
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to continue translation');
  }
}

export async function apiLookupWord(params: {
  word: string;
  targetLanguage: string;
  nativeLanguage: string;
  articleContext?: string;
}): Promise<{
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  infinitive?: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/llm/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      word: params.word,
      target_language: params.targetLanguage,
      native_language: params.nativeLanguage,
      article_context: params.articleContext ?? null,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Lookup failed');
  return {
    definition: data.definition as string,
    partOfSpeech: (data.partOfSpeech as string) || undefined,
    gender: (data.gender as string) || undefined,
    article: (data.article as string) || undefined,
    infinitive: (data.infinitive as string) || undefined,
    inputTokens: (data.inputTokens as number) ?? 0,
    outputTokens: (data.outputTokens as number) ?? 0,
  };
}

export async function apiSelectVocabWords(params: {
  text: string;
  targetLanguage: string;
  nativeLanguage: string;
  existingWords: string[];
}): Promise<{ words: string[]; inputTokens: number; outputTokens: number }> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/llm/vocab-select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      text: params.text,
      target_language: params.targetLanguage,
      native_language: params.nativeLanguage,
      existing_words: params.existingWords,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Vocab selection failed');
  return {
    words: data.words as string[],
    inputTokens: (data.inputTokens as number) ?? 0,
    outputTokens: (data.outputTokens as number) ?? 0,
  };
}

export async function apiGetVerbConjugation(params: {
  verb: string;
  language: string;
}): Promise<{ conjugation: import('../types').VerbConjugation | null; inputTokens: number; outputTokens: number }> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/llm/conjugate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      verb: params.verb,
      language: params.language,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Conjugation failed');
  return {
    conjugation: (data.conjugation as import('../types').VerbConjugation) ?? null,
    inputTokens: (data.inputTokens as number) ?? 0,
    outputTokens: (data.outputTokens as number) ?? 0,
  };
}

export async function apiSendChatMessage(params: {
  mode: 'article' | 'vocab';
  difficulty: string;
  targetLanguage: string;
  nativeLanguage: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  articleId?: string;
  vocabWords?: string[];
  vocabLabel?: string;
}): Promise<{ reply: string; inputTokens: number; outputTokens: number }> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      mode: params.mode,
      difficulty: params.difficulty,
      target_language: params.targetLanguage,
      native_language: params.nativeLanguage,
      messages: params.messages,
      article_id: params.articleId ?? null,
      vocab_words: params.vocabWords ?? null,
      vocab_label: params.vocabLabel ?? null,
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Chat failed');
  return {
    reply: data.reply as string,
    inputTokens: (data.inputTokens as number) ?? 0,
    outputTokens: (data.outputTokens as number) ?? 0,
  };
}

export async function apiCreateDeviceArticle(params: {
  sourceUrl: string;
  title?: string;
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<{ id: string }> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      url: params.sourceUrl || null,
      title: params.title ?? null,
      source_language: params.sourceLanguage,
      target_language: params.targetLanguage,
      sentence_pairs: [],
      vocab: [],
      input_tokens: 0,
      output_tokens: 0,
      status: 'translating',
    }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to create article');
  return { id: data.id as string };
}

export async function apiAppendDeviceSentences(
  articleId: string,
  sentences: { original: string; translation: string }[],
  complete: boolean,
): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/articles/${encodeURIComponent(articleId)}/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, sentences, complete }),
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to append sentences');
  }
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
    gender: (row.gender as string) ?? undefined,
    article: (row.article as string) ?? undefined,
    conjugation: (row.conjugation as VerbConjugation) ?? undefined,
    addedAt: new Date(row.added_at as string).getTime(),
    dueAt: new Date(row.due_at as string).getTime(),
    intervalDays: row.interval_days as number,
    easeFactor: row.ease_factor as number,
    repetitions: row.repetitions as number,
    lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at as string).getTime() : undefined,
  };
}

function rowToNotecardList(row: Record<string, unknown>): NotecardList {
  return {
    id: row.id as string,
    name: row.name as string,
    language: (row.language as string) ?? undefined,
    createdAt: new Date(row.created_at as string).getTime(),
    itemCount: row.item_count != null ? Number(row.item_count) : undefined,
  };
}

export async function apiAddVocabWord(params: {
  word: string;
  language: string;
  definition: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
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
      gender: params.gender ?? null,
      article: params.article ?? null,
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

export async function apiUpdateVocabWord(vocabWordId: string, params: {
  word?: string;
  definition?: string;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
}): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/vocab/${vocabWordId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      word: params.word ?? null,
      definition: params.definition ?? null,
      part_of_speech: params.partOfSpeech ?? null,
      gender: params.gender ?? null,
      article: params.article ?? null,
    }),
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to update vocab word');
  }
}

export async function apiRemoveVocabWord(userVocabId: string): Promise<void> {
  const userId = await getUserId();
  await fetch(`${BACKEND_URL}/vocab/${userVocabId}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function apiGetDueNotecards(filters?: { language?: string; listId?: string; limit?: number }): Promise<UserVocabWord[]> {
  const userId = await getUserId();
  const params = new URLSearchParams({ user_id: userId });
  if (filters?.language) params.set('language', filters.language);
  if (filters?.listId) params.set('list_id', filters.listId);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const res = await fetch(`${BACKEND_URL}/notecards/due?${params.toString()}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load due notecards');
  return (data as Record<string, unknown>[]).map(rowToVocabWord);
}

export async function apiReviewNotecard(userVocabId: string, grade: ReviewGrade): Promise<UserVocabWord> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/notecards/${userVocabId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, grade }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to submit review');
  return rowToVocabWord(data);
}

export async function apiGetNotecardLists(): Promise<NotecardList[]> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/notecards/lists?user_id=${encodeURIComponent(userId)}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load notecard lists');
  return (data as Record<string, unknown>[]).map(rowToNotecardList);
}

export async function apiCreateNotecardList(name: string, language?: string): Promise<NotecardList> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/notecards/lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, name, language: language ?? null }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to create list');
  return rowToNotecardList(data);
}

export async function apiUpdateNotecardList(listId: string, params: { name?: string; language?: string }): Promise<NotecardList> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/notecards/lists/${listId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, name: params.name ?? null, language: params.language ?? null }),
  });
  const data = await parseJson(res) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? 'Failed to update list');
  return rowToNotecardList(data);
}

export async function apiDeleteNotecardList(listId: string): Promise<void> {
  const userId = await getUserId();
  await fetch(`${BACKEND_URL}/notecards/lists/${listId}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function apiGetNotecardListItems(listId: string): Promise<UserVocabWord[]> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/notecards/lists/${listId}/items?user_id=${encodeURIComponent(userId)}`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error('Failed to load list items');
  return (data as Record<string, unknown>[]).map(rowToVocabWord);
}

export async function apiAddToNotecardList(listId: string, userVocabId: string): Promise<void> {
  const userId = await getUserId();
  const res = await fetch(`${BACKEND_URL}/notecards/lists/${listId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, user_vocab_id: userVocabId }),
  });
  if (!res.ok) {
    const data = await parseJson(res).catch(() => ({})) as Record<string, unknown>;
    throw new Error((data.error as string) ?? 'Failed to add word to list');
  }
}

export async function apiRemoveFromNotecardList(listId: string, userVocabId: string): Promise<void> {
  const userId = await getUserId();
  await fetch(`${BACKEND_URL}/notecards/lists/${listId}/items/${userVocabId}?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
