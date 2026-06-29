import { create } from 'zustand';
import { Article, UserSettings } from '../types';
import { scrapeArticle } from '../services/scraper';
import { translateArticle } from '../services/translator';
import { lookupWordDefinition } from '../services/vocab';
import { apiSaveArticle, apiLoadArticles, apiDeleteArticle, apiClearArticles } from '../services/api';

interface ArticleStore {
  currentArticle: Article | null;
  isLoading: boolean;
  loadingStep: string;
  error: string | null;
  savedArticles: Article[];
  ttsPlaying: boolean;
  wordLookupCache: Record<string, string>;

  loadArticle: (input: string, isUrl: boolean, settings: UserSettings) => Promise<void>;
  lookupWord: (word: string, settings: UserSettings) => Promise<string>;
  toggleTTS: () => void;
  saveArticle: () => Promise<void>;
  loadSavedArticles: () => Promise<void>;
  clearSavedArticles: () => Promise<void>;
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

  loadArticle: async (input, isUrl, settings) => {
    set({ isLoading: true, error: null });

    try {
      let originalText: string;
      let sourceUrl = '';

      if (isUrl) {
        set({ loadingStep: 'Fetching article…' });
        const scraped = await scrapeArticle(input);
        originalText = scraped.textContent;
        sourceUrl = input;
      } else {
        originalText = input;
      }

      set({ loadingStep: 'Translating…' });
      const apiKey = settings.apiKey || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
      const result = await translateArticle(
        originalText,
        settings.sourceLanguage,
        settings.targetLanguage,
        apiKey
      );

      const article: Article = {
        id: Date.now().toString(),
        sourceUrl,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        originalText,
        translatedText: result.translation,
        vocabList: result.vocab,
        createdAt: Date.now(),
      };

      set({ currentArticle: article, isLoading: false, loadingStep: 'Done' });
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
    const definition = await lookupWordDefinition(
      word,
      settings.targetLanguage,
      settings.sourceLanguage,
      apiKey
    );

    set({ wordLookupCache: { ...cache, [word]: definition } });
    return definition;
  },

  toggleTTS: () => set((state) => ({ ttsPlaying: !state.ttsPlaying })),

  saveArticle: async () => {
    const { currentArticle, savedArticles } = get();
    if (!currentArticle) return;

    const already = savedArticles.find((a) => a.id === currentArticle.id);
    if (already) return;

    const backendId = await apiSaveArticle(currentArticle);
    const saved = { ...currentArticle, id: backendId };
    set({ currentArticle: saved, savedArticles: [saved, ...savedArticles] });
  },

  loadSavedArticles: async () => {
    const articles = await apiLoadArticles();
    set({ savedArticles: articles });
  },

  clearSavedArticles: async () => {
    await apiClearArticles();
    set({ savedArticles: [] });
  },

  clearError: () => set({ error: null }),

  setCurrentArticle: (article) => set({ currentArticle: article }),
}));
