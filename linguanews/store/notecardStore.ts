import { create } from 'zustand';
import { NotecardList, ReviewGrade, UserVocabWord } from '../types';
import {
  apiAddToNotecardList,
  apiCreateNotecardList,
  apiDeleteNotecardList,
  apiGetDueNotecards,
  apiGetNotecardListItems,
  apiGetNotecardLists,
  apiRemoveFromNotecardList,
  apiReviewNotecard,
  apiUpdateNotecardList,
} from '../services/api';

interface NotecardStore {
  dueCards: UserVocabWord[];
  lists: NotecardList[];
  currentListItems: UserVocabWord[];
  loadDueCards: (filter?: { language?: string; listId?: string }) => Promise<void>;
  reviewCard: (userVocabId: string, grade: ReviewGrade) => Promise<void>;
  loadLists: () => Promise<void>;
  createList: (name: string, language?: string) => Promise<void>;
  updateList: (listId: string, params: { name?: string; language?: string }) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  loadListItems: (listId: string) => Promise<void>;
  addToList: (listId: string, userVocabId: string) => Promise<void>;
  removeFromList: (listId: string, userVocabId: string) => Promise<void>;
}

export const useNotecardStore = create<NotecardStore>((set, get) => ({
  dueCards: [],
  lists: [],
  currentListItems: [],

  loadDueCards: async (filter) => {
    const dueCards = await apiGetDueNotecards(filter);
    set({ dueCards });
  },

  reviewCard: async (userVocabId, grade) => {
    const card = get().dueCards.find((c) => c.id === userVocabId);
    const remaining = get().dueCards.filter((c) => c.id !== userVocabId);
    if (grade === 'again' && card) {
      // Resurface failed cards later in the same session
      set({ dueCards: [...remaining, card] });
    } else {
      set({ dueCards: remaining });
    }
    await apiReviewNotecard(userVocabId, grade);
  },

  loadLists: async () => {
    const lists = await apiGetNotecardLists();
    set({ lists });
  },

  createList: async (name, language) => {
    await apiCreateNotecardList(name, language);
    const lists = await apiGetNotecardLists();
    set({ lists });
  },

  updateList: async (listId, params) => {
    await apiUpdateNotecardList(listId, params);
    const lists = await apiGetNotecardLists();
    set({ lists });
  },

  deleteList: async (listId) => {
    set({ lists: get().lists.filter((l) => l.id !== listId) });
    await apiDeleteNotecardList(listId);
  },

  loadListItems: async (listId) => {
    const currentListItems = await apiGetNotecardListItems(listId);
    set({ currentListItems });
  },

  addToList: async (listId, userVocabId) => {
    await apiAddToNotecardList(listId, userVocabId);
    const lists = await apiGetNotecardLists();
    set({ lists });
  },

  removeFromList: async (listId, userVocabId) => {
    set({ currentListItems: get().currentListItems.filter((w) => w.id !== userVocabId) });
    await apiRemoveFromNotecardList(listId, userVocabId);
    const lists = await apiGetNotecardLists();
    set({ lists });
  },
}));
