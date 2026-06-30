import { create } from 'zustand';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = '@linguanews/theme_mode';

interface ThemeStore {
  mode: ThemeMode;
  isDark: boolean;
  load: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
}

function resolveIsDark(mode: ThemeMode): boolean {
  return mode === 'system' ? Appearance.getColorScheme() === 'dark' : mode === 'dark';
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: 'system',
  isDark: resolveIsDark('system'),

  load: async () => {
    const raw = await AsyncStorage.getItem(THEME_KEY);
    const mode: ThemeMode = raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
    set({ mode, isDark: resolveIsDark(mode) });
  },

  setMode: async (mode) => {
    set({ mode, isDark: resolveIsDark(mode) });
    await AsyncStorage.setItem(THEME_KEY, mode);
  },
}));

Appearance.addChangeListener(() => {
  if (useThemeStore.getState().mode === 'system') {
    useThemeStore.setState({ isDark: resolveIsDark('system') });
  }
});
