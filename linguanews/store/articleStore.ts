import { create } from 'zustand';
import { Article, UserSettings } from '../types';
import { scrapeArticle } from '../services/scraper';
import { translateArticle } from '../services/translator';
import { lookupWordDefinition, LookupResult } from '../services/vocab';
import { apiSaveArticle, apiLoadArticles, apiLoadArticle, apiDeleteArticle, apiClearArticles } from '../services/api';
import { useUsageStore } from './usageStore';
import { recordApiCost, CostSource } from '../services/apiCosts';

// Claude Sonnet 4.6 rates ($/million tokens)
const SONNET_IN = 3.0;
const SONNET_OUT = 15.0;

interface ArticleStore {
  currentArticle: Article | null;
  isLoading: boolean;
  loadingStep: string;
  error: string | null;
  savedArticles: Article[];
  ttsPlaying: boolean;
  wordLookupCache: Record<string, { definition: string; partOfSpeech?: string; gender?: string; article?: string }>;
  vocabInputTokens: number;
  vocabOutputTokens: number;

  loadArticle: (input: string, isUrl: boolean, settings: UserSettings, source?: CostSource) => Promise<void>;
  lookupWord: (word: string, settings: UserSettings) => Promise<{ definition: string; partOfSpeech?: string; gender?: string; article?: string }>;
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
      const apiKey = settings.apiKey || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
      const result = await translateArticle(
        rawText,
        settings.sourceLanguage,
        settings.targetLanguage,
        apiKey,
        settings.difficulty ?? 'intermediate'
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
      };

      set({ currentArticle: article, isLoading: false, loadingStep: 'Done' });
      useUsageStore.getState().addArticle(result.inputTokens, result.outputTokens);
      recordApiCost({
        source,
        model: 'claude-sonnet-4-6',
        inputCreditRate: SONNET_IN,
        totalInputCredits: result.inputTokens,
        outputCreditRate: SONNET_OUT,
        totalOutputCredits: result.outputTokens,
      });
    } catch (err) {
      set({
        isLoading: false,
        loadingStep: '',
        error: err instanceof Error ? err.message : 'An unexpected error occurred.',
      });
    }
  },

  lookupWord: async (word, settings) => {
    const cache = get().wordLookupCache;
    if (cache[word]) return cache[word];

    const apiKey = settings.apiKey || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
    const articleText = get().currentArticle?.sentencePairs.map((p) => p.translation).join(' ');
    const result: LookupResult = await lookupWordDefinition(
      word,
      settings.targetLanguage,
      settings.sourceLanguage,
      apiKey,
      articleText
    );

    const { vocabInputTokens, vocabOutputTokens } = get();
    const entry = { definition: result.definition, partOfSpeech: result.partOfSpeech, gender: result.gender, article: result.article };
    set({
      wordLookupCache: { ...cache, [word]: entry },
      vocabInputTokens: vocabInputTokens + result.inputTokens,
      vocabOutputTokens: vocabOutputTokens + result.outputTokens,
    });
    useUsageStore.getState().addVocab(result.inputTokens, result.outputTokens);
    recordApiCost({
      source: 'vocab',
      model: 'claude-sonnet-4-6',
      inputCreditRate: SONNET_IN,
      totalInputCredits: result.inputTokens,
      outputCreditRate: SONNET_OUT,
      totalOutputCredits: result.outputTokens,
    });
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
