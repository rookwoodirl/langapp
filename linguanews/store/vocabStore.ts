import { create } from 'zustand';
import { UserVocabWord, VerbConjugation } from '../types';
import { apiAddVocabWord, apiLoadVocab, apiRemoveVocabWord, apiUpdateVocabWord } from '../services/api';

interface VocabStore {
  words: UserVocabWord[];
  loadVocab: () => Promise<void>;
  addWord: (params: {
    word: string;
    language: string;
    definition: string;
    partOfSpeech?: string;
    gender?: string;
    article?: string;
    conjugation?: VerbConjugation;
  }) => Promise<void>;
  updateWord: (vocabWordId: string, params: {
    word?: string;
    definition?: string;
    partOfSpeech?: string;
    gender?: string;
    article?: string;
  }) => Promise<void>;
  removeWord: (userVocabId: string) => Promise<void>;
}

export const useVocabStore = create<VocabStore>((set, get) => ({
  words: [],

  loadVocab: async () => {
    const words = await apiLoadVocab();
    set({ words });
  },

  addWord: async (params) => {
    await apiAddVocabWord(params);
    // Optimistically prepend; reload will reconcile duplicates
    const optimistic: UserVocabWord = {
      id: '__pending__' + Date.now(),
      vocabWordId: '',
      word: params.word,
      language: params.language,
      definition: params.definition,
      partOfSpeech: params.partOfSpeech,
      gender: params.gender,
      article: params.article,
      conjugation: params.conjugation,
      addedAt: Date.now(),
      dueAt: Date.now(),
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
    };
    set({ words: [optimistic, ...get().words] });
    // Reload to get real IDs
    const words = await apiLoadVocab();
    set({ words });
  },

  updateWord: async (vocabWordId, params) => {
    await apiUpdateVocabWord(vocabWordId, params);
    const words = await apiLoadVocab();
    set({ words });
  },

  removeWord: async (userVocabId) => {
    set({ words: get().words.filter((w) => w.id !== userVocabId) });
    await apiRemoveVocabWord(userVocabId);
  },
}));
