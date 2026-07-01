import { create } from 'zustand';
import { Article, UserSettings } from '../types';
import { scrapeArticle } from '../services/scraper';
import { translateArticle } from '../services/translator';
import { lookupWordDefinition, LookupResult } from '../services/vocab';
import { apiSaveArticle, apiLoadArticles, apiLoadArticle, apiDeleteArticle, apiClearArticles, apiPatchArticle } from '../services/api';
import { useUsageStore } from './usageStore';
import { CostSource } from '../services/apiCosts';

interface ArticleStore {
  currentArticle: Article | null;
  isLoading: boolean;
  loadingStep: string;
  error: string | null;
  savedArticles: Article[];
  ttsPlaying: boolean;
  wordLookupCache: Record<string, { definition: string; partOfSpeech?: string; gender?: string; article?: string; infinitive?: string }>;
  vocabInputTokens: number;
  vocabOutputTokens: number;

  loadArticle: (input: string, isUrl: boolean, settings: UserSettings, source?: CostSource) => Promise<void>;
  continueTranslation: (settings: UserSettings) => Promise<void>;
  lookupWord: (word: string, settings: UserSettings) => Promise<{ definition: string; partOfSpeech?: string; gender?: string; article?: string; infinitive?: string }>;
  toggleTTS: () => void;
  saveArticle: () => Promise<string | undefined>;
  loadArticleById: (id: string) => Promise<void>;
  loadSavedArticles: () => Promise<void>;
  clearSavedArticles: () => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  clearError: () => void;
  setCurrentArticle: (article: Article) => void;
}

export const useArticleStore = create<ArticleStore>((set, get) => ({
  currentArticle: null,
  isLoading: false,
  loadingStep: '',
  error: null,
  savedArticles: [],
  ttsPlaying: false,
  wordLookupCache: {},
  vocabInputTokens: 0,
  vocabOutputTokens: 0,

  loadArticle: async (input, isUrl, settings, source = 'article') => {
    set({ isLoading: true, error: null, wordLookupCache: {}, vocabInputTokens: 0, vocabOutputTokens: 0 });

    try {
      let rawText: string;
      let sourceUrl = '';

      if (isUrl) {
        set({ loadingStep: 'Fetching article…' });
        const scraped = await scrapeArticle(input);
        rawText = scraped.textContent;
        sourceUrl = input;
      } else {
        rawText = input;
      }

      set({ loadingStep: 'Translating…' });
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
      const result = await translateArticle(
        rawText,
        settings.sourceLanguage,
        settings.targetLanguage,
        apiKey,
        settings.difficulty ?? 'intermediate',
        source,
      );

      const article: Article = {
        id: Date.now().toString(),
        sourceUrl,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        sentencePairs: result.sentencePairs,
        vocabList: result.vocab,
        createdAt: Date.now(),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        remainingText: result.remainingText,
      };

      set({ currentArticle: article, isLoading: false, loadingStep: 'Done' });
      useUsageStore.getState().addArticle(result.inputTokens, result.outputTokens);
    } catch (err) {
      set({
        isLoading: false,
        loadingStep: '',
        error: err instanceof Error ? err.message : 'An unexpected error occurred.',
      });
    }
  },

  continueTranslation: async (settings) => {
    const { currentArticle, savedArticles } = get();
    if (!currentArticle?.remainingText) return;

    set({ isLoading: true, loadingStep: 'Translating more…', error: null });
    try {
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
      const result = await translateArticle(
        currentArticle.remainingText,
        currentArticle.sourceLanguage,
        currentArticle.targetLanguage,
        apiKey,
        settings.difficulty ?? 'intermediate',
        'article',
      );

      const updated: Article = {
        ...currentArticle,
        sentencePairs: [...currentArticle.sentencePairs, ...result.sentencePairs],
        inputTokens: currentArticle.inputTokens + result.inputTokens,
        outputTokens: currentArticle.outputTokens + result.outputTokens,
        remainingText: result.remainingText,
      };

      const isSaved = savedArticles.some((a) => a.id === currentArticle.id);
      if (isSaved) {
        await apiPatchArticle(currentArticle.id, {
          sentencePairsToAppend: result.sentencePairs,
          remainingText: result.remainingText,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        set({
          currentArticle: updated,
          savedArticles: savedArticles.map((a) => (a.id === updated.id ? updated : a)),
        });
      } else {
        set({ currentArticle: updated });
      }

      useUsageStore.getState().addArticle(result.inputTokens, result.outputTokens);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to continue translation.' });
    } finally {
      set({ isLoading: false, loadingStep: '' });
    }
  },

  lookupWord: async (word, settings) => {
    const cache = get().wordLookupCache;
    if (cache[word]) return cache[word];

    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
    const currentArticle = get().currentArticle;
    const articleText = currentArticle?.sentencePairs.map((p) => p.translation).join(' ');
    const result: LookupResult = await lookupWordDefinition(
      word,
      settings.targetLanguage,
      settings.sourceLanguage,
      apiKey,
      articleText,
    );

    const { vocabInputTokens, vocabOutputTokens } = get();
    const entry = { definition: result.definition, partOfSpeech: result.partOfSpeech, gender: result.gender, article: result.article, infinitive: result.infinitive };
    set({
      wordLookupCache: { ...cache, [word]: entry },
      vocabInputTokens: vocabInputTokens + result.inputTokens,
      vocabOutputTokens: vocabOutputTokens + result.outputTokens,
    });
    useUsageStore.getState().addVocab(result.inputTokens, result.outputTokens);
    return entry;
  },

  toggleTTS: () => set((state) => ({ ttsPlaying: !state.ttsPlaying })),

  saveArticle: async () => {
    const { currentArticle, savedArticles } = get();
    if (!currentArticle) return undefined;

    const already = savedArticles.find((a) => a.id === currentArticle.id);
    if (already) return currentArticle.id;

    const backendId = await apiSaveArticle(currentArticle);
    const saved = { ...currentArticle, id: backendId };
    set({ currentArticle: saved, savedArticles: [saved, ...savedArticles] });
    return backendId;
  },

  loadArticleById: async (id) => {
    const article = await apiLoadArticle(id);
    if (article) set({ currentArticle: article });
  },

  loadSavedArticles: async () => {
    const articles = await apiLoadArticles();
    set({ savedArticles: articles });
  },

  clearSavedArticles: async () => {
    await apiClearArticles();
    set({ savedArticles: [] });
  },

  deleteArticle: async (id) => {
    await apiDeleteArticle(id);
    set((state) => ({ savedArticles: state.savedArticles.filter((a) => a.id !== id) }));
  },

  clearError: () => set({ error: null }),

  setCurrentArticle: (article) => set({ currentArticle: article }),
}));
