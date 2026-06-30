import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@linguanews/usage_v1';

interface Bucket { input: number; output: number }
const ZERO: Bucket = { input: 0, output: 0 };

interface UsageStore {
  article: Bucket;
  vocab: Bucket;
  audio: Bucket;
  loaded: boolean;

  load: () => Promise<void>;
  addArticle: (input: number, output: number) => Promise<void>;
  addVocab: (input: number, output: number) => Promise<void>;
  addAudio: (input: number, output: number) => Promise<void>;
}

async function save(state: Pick<UsageStore, 'article' | 'vocab' | 'audio'>) {
  await AsyncStorage.setItem(KEY, JSON.stringify({ article: state.article, vocab: state.vocab, audio: state.audio }));
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  article: { ...ZERO },
  vocab: { ...ZERO },
  audio: { ...ZERO },
  loaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        set({ article: d.article ?? ZERO, vocab: d.vocab ?? ZERO, audio: d.audio ?? ZERO });
      }
    } finally {
      set({ loaded: true });
    }
  },

  addArticle: async (input, output) => {
    const prev = get().article;
    const next = { input: prev.input + input, output: prev.output + output };
    set({ article: next });
    await save({ ...get(), article: next });
  },

  addVocab: async (input, output) => {
    const prev = get().vocab;
    const next = { input: prev.input + input, output: prev.output + output };
    set({ vocab: next });
    await save({ ...get(), vocab: next });
  },

  addAudio: async (input, output) => {
    const prev = get().audio;
    const next = { input: prev.input + input, output: prev.output + output };
    set({ audio: next });
    await save({ ...get(), audio: next });
  },
}));
