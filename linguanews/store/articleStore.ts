import { create } from 'zustand';
import { Article, SentencePair, UserSettings } from '../types';
import { scrapeArticle } from '../services/scraper';
import { lookupWordDefinition, LookupResult } from '../services/vocab';
import { apiSaveArticle, apiLoadArticles, apiLoadArticle, apiDeleteArticle, apiClearArticles, apiPatchArticle, apiStartTranslation, apiContinueTranslation, apiCreateDeviceArticle, apiAppendDeviceSentences } from '../services/api';
import { translateArticleOnDevice, translateTextOnDevice } from '../services/deviceTranslation';
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
  appendSentences: (articleId: string, sentences: SentencePair[], status: string) => void;
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

  loadArticle: async (input, isUrl, settings, _source = 'article') => {
    set({ isLoading: true, error: null, wordLookupCache: {}, vocabInputTokens: 0, vocabOutputTokens: 0 });

    try {
      let rawText: string;
      let sourceUrl: string | undefined;
      let title: string | undefined;

      if (isUrl) {
        set({ loadingStep: 'Fetching article…' });
        const scraped = await scrapeArticle(input);
        rawText = scraped.textContent;
        sourceUrl = input;
        title = scraped.title || undefined;
      } else {
        rawText = input;
      }

      if (settings.useLLM !== false) {
        // LLM path — backend translates asynchronously, frontend polls
        set({ loadingStep: 'Sending to server…' });
        const { id } = await apiStartTranslation({
          text: rawText,
          sourceUrl,
          title,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          nativeLanguage: settings.nativeLanguage ?? 'en',
          difficulty: settings.difficulty ?? 'intermediate',
        });

        const stub: Article = {
          id,
          title,
          sourceUrl: sourceUrl ?? '',
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          sentencePairs: [],
          vocabList: [],
          createdAt: Date.now(),
          inputTokens: 0,
          outputTokens: 0,
          status: 'translating',
        };

        set((state) => ({
          isLoading: false,
          loadingStep: '',
          currentArticle: stub,
          savedArticles: [stub, ...state.savedArticles.filter((a) => a.id !== id)],
        }));
      } else {
        // Device translation path — create stub immediately, stream sentences in background
        let translatedTitle = title;
        if (title) {
          try {
            translatedTitle = await translateTextOnDevice(title, settings.sourceLanguage, settings.targetLanguage);
          } catch {
            // Keep original title on failure
          }
        }

        set({ loadingStep: 'Preparing…' });
        const { id } = await apiCreateDeviceArticle({
          sourceUrl: sourceUrl ?? '',
          title: translatedTitle,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        });

        const stub: Article = {
          id,
          title: translatedTitle,
          sourceUrl: sourceUrl ?? '',
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          sentencePairs: [],
          vocabList: [],
          createdAt: Date.now(),
          inputTokens: 0,
          outputTokens: 0,
          status: 'translating',
        };

        set((state) => ({
          isLoading: false,
          loadingStep: '',
          currentArticle: stub,
          savedArticles: [stub, ...state.savedArticles.filter((a) => a.id !== id)],
        }));

        // Fire-and-forget — same pattern as LLM path
        void (async () => {
          try {
            await translateArticleOnDevice(
              rawText,
              settings.sourceLanguage,
              settings.targetLanguage,
              async (pair) => {
                get().appendSentences(id, [pair], 'translating');
                await apiAppendDeviceSentences(id, [pair], false);
              },
            );
            get().appendSentences(id, [], 'complete');
            await apiAppendDeviceSentences(id, [], true);
          } catch {
            get().appendSentences(id, [], 'error');
          }
        })();
      }
    } catch (err) {
      set({
        isLoading: false,
        loadingStep: '',
        error: err instanceof Error ? err.message : 'An unexpected error occurred.',
      });
    }
  },

  appendSentences: (articleId, sentences, status) => {
    const articleStatus: Article['status'] =
      status === 'translating' || status === 'error' ? status : 'complete';
    set((state) => {
      const update = (a: Article): Article => {
        if (a.id !== articleId) return a;
        return {
          ...a,
          sentencePairs: [...a.sentencePairs, ...sentences],
          status: articleStatus,
        };
      };
      return {
        currentArticle: state.currentArticle?.id === articleId ? update(state.currentArticle) : state.currentArticle,
        savedArticles: state.savedArticles.map(update),
      };
    });
  },

  continueTranslation: async (settings) => {
    const { currentArticle } = get();
    if (!currentArticle?.remainingText || !currentArticle?.id) return;

    set({ isLoading: true, loadingStep: 'Resuming translation…', error: null });
    try {
      await apiContinueTranslation(currentArticle.id, {
        difficulty: settings.difficulty ?? 'intermediate',
        nativeLanguage: settings.nativeLanguage ?? 'en',
      });
      // Backend is now translating; update local status so polling kicks in
      const id = currentArticle.id;
      set((state) => ({
        isLoading: false,
        loadingStep: '',
        currentArticle: state.currentArticle?.id === id
          ? { ...state.currentArticle, status: 'translating', remainingText: undefined }
          : state.currentArticle,
        savedArticles: state.savedArticles.map((a) =>
          a.id === id ? { ...a, status: 'translating', remainingText: undefined } : a
        ),
      }));
    } catch (err) {
      set({ isLoading: false, loadingStep: '', error: err instanceof Error ? err.message : 'Failed to continue translation.' });
    }
  },

  lookupWord: async (word, settings) => {
    const cache = get().wordLookupCache;
    if (cache[word]) return cache[word];

    const currentArticle = get().currentArticle;
    const articleText = currentArticle?.sentencePairs.map((p) => p.translation).join(' ');
    const result: LookupResult = await lookupWordDefinition(
      word,
      settings.targetLanguage,
      settings.nativeLanguage ?? 'en',
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
