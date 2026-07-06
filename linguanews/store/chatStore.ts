import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatMessage, ChatSession, DifficultyLevel } from '../types';
import { apiSendChatMessage } from '../services/api';

const CHAT_SESSIONS_KEY = '@linguanews/chat_sessions';

interface CreateSessionParams {
  mode: 'article' | 'vocab';
  difficulty: DifficultyLevel;
  targetLanguage: string;
  nativeLanguage: string;
  articleId?: string;
  articleTitle?: string;
  vocabWords?: string[];
  vocabLabel?: string;
}

interface ChatStore {
  sessions: ChatSession[];
  loaded: boolean;
  load: () => Promise<void>;
  createSession: (params: CreateSessionParams) => Promise<string>;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

async function persist(sessions: ChatSession[]) {
  await AsyncStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  loaded: false,

  load: async () => {
    const raw = await AsyncStorage.getItem(CHAT_SESSIONS_KEY);
    const sessions: ChatSession[] = raw ? JSON.parse(raw) : [];
    set({ sessions, loaded: true });
  },

  createSession: async (params) => {
    const session: ChatSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      mode: params.mode,
      difficulty: params.difficulty,
      targetLanguage: params.targetLanguage,
      nativeLanguage: params.nativeLanguage,
      articleId: params.articleId,
      articleTitle: params.articleTitle,
      vocabWords: params.vocabWords,
      vocabLabel: params.vocabLabel,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const sessions = [session, ...get().sessions];
    set({ sessions });
    await persist(sessions);
    return session.id;
  },

  sendMessage: async (sessionId, text) => {
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    let sessions = get().sessions.map((s) =>
      s.id === sessionId ? { ...s, messages: [...s.messages, userMsg], updatedAt: Date.now() } : s
    );
    set({ sessions });
    await persist(sessions);

    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const result = await apiSendChatMessage({
      mode: session.mode,
      difficulty: session.difficulty,
      targetLanguage: session.targetLanguage,
      nativeLanguage: session.nativeLanguage,
      messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
      articleId: session.articleId,
      vocabWords: session.vocabWords,
      vocabLabel: session.vocabLabel,
    });

    const assistantMsg: ChatMessage = { role: 'assistant', content: result.reply, timestamp: Date.now() };
    sessions = get().sessions.map((s) =>
      s.id === sessionId ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: Date.now() } : s
    );
    set({ sessions });
    await persist(sessions);
  },

  deleteSession: async (sessionId) => {
    const sessions = get().sessions.filter((s) => s.id !== sessionId);
    set({ sessions });
    await persist(sessions);
  },
}));
