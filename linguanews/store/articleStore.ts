import { create } from 'zustand';
import { Article, UserSettings } from '../types';
import { scrapeArticle } from '../services/scraper';
import { translateArticle } from '../services/translator';
import { lookupWordDefinition, LookupResult } from '../services/vocab';
import { apiSaveArticle, apiLoadArticles, apiDeleteArticle, apiClearArticles } from '../services/api';

interface ArticleStore {
  currentArticle: Article | null;
  isLoading: boolean;
  loadingStep: string;
  error: string | null;
  savedArticles: Article[];
  ttsPlaying: boolean;
  wordLookupCache: Record<string, { definition: string; partOfSpeech?: string }>;
  vocabInputTokens: number;
  vocabOutputTokens: number;

  loadArticle: (input: string, isUrl: boolean, settings: UserSettings) => Promise<void>;
  lookupWord: (word: string, settings: UserSettings) => Promise<{ definition: string; partOfSpeech?: string }>;
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
  vocabInputTokens: 0,
  vocabOutputTokens: 0,

  loadArticle: async (input, isUrl, settings) => {
    set({ isLoading: true, error: null, wordLookupCache: {}, vocabInputTokens: 0, vocabOutputTokens: 0 });

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
        apiKey,
        settings.difficulty ?? 'intermediate'
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
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
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
    const articleText = get().currentArticle?.translatedText;
    const result: LookupResult = await lookupWordDefinition(
      word,
      settings.targetLanguage,
      settings.sourceLanguage,
      apiKey,
      articleText
    );

    const { vocabInputTokens, vocabOutputTokens } = get();
    set({
      wordLookupCache: { ...cache, [word]: { definition: result.definition, partOfSpeech: result.partOfSpeech } },
      vocabInputTokens: vocabInputTokens + result.inputTokens,
      vocabOutputTokens: vocabOutputTokens + result.outputTokens,
    });
    return { definition: result.definition, partOfSpeech: result.partOfSpeech };
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
