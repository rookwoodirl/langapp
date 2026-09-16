import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import LanguagePicker from '../components/LanguagePicker';
import { useArticleStore } from '../store/articleStore';
import { useThemeStore, ThemeMode } from '../store/themeStore';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';
import { UserSettings } from '../types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE, DEFAULT_NATIVE_LANGUAGE } from '../constants/languages';
import { getAuthState, clearAuthState } from '../services/auth';

const SETTINGS_KEY = '@linguanews/settings';
const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'System' },
];

// react-native-web's Alert.alert is a no-op (it never shows buttons or calls onPress),
// so destructive confirmations need a window.confirm fallback on web.
function confirmDestructive(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<UserSettings>({
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    nativeLanguage: DEFAULT_NATIVE_LANGUAGE,
    difficulty: 'intermediate',
  });
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const { clearSavedArticles } = useArticleStore();
  const { mode, setMode } = useThemeStore();
  const colors = useColors();
  const styles = themedStyles(colors);

  useEffect(() => {
    getAuthState().then((s) => setAccountEmail(s?.email ?? null));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new fields are present even for old stored settings
        setSettings((prev) => ({ ...prev, ...parsed }));
      } catch {
        // Corrupted settings — ignore and keep current in-memory settings
      }
    });
  }, []);

  async function save(updated: UserSettings) {
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }

  function handleSignOut() {
    confirmDestructive(
      'Sign out?',
      'You will need to sign in again with Google.',
      'Sign out',
      async () => {
        await clearAuthState();
        router.replace('/login');
      }
    );
  }

  function handleClearArticles() {
    confirmDestructive(
      'Clear saved articles?',
      'This cannot be undone.',
      'Clear',
      async () => {
        await clearSavedArticles();
        if (Platform.OS === 'web') {
          window.alert('Saved articles cleared.');
        } else {
          Alert.alert('Done', 'Saved articles cleared.');
        }
      }
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.section}>Appearance</Text>
      <View style={styles.themeRow}>
        {THEME_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.mode}
            style={[styles.themeBtn, mode === opt.mode && styles.themeBtnActive]}
            onPress={() => setMode(opt.mode)}
            activeOpacity={0.75}
          >
            <Text style={[styles.themeBtnText, mode === opt.mode && styles.themeBtnTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Language preferences</Text>

      <LanguagePicker
        label="Your language (definitions will be in this language)"
        value={settings.nativeLanguage ?? DEFAULT_NATIVE_LANGUAGE}
        onChange={(v) => save({ ...settings, nativeLanguage: v })}
      />

      <LanguagePicker
        label="Source language (what you read)"
        value={settings.sourceLanguage}
        onChange={(v) => save({ ...settings, sourceLanguage: v })}
      />

      <LanguagePicker
        label="Target language (what you learn)"
        value={settings.targetLanguage}
        onChange={(v) => save({ ...settings, targetLanguage: v })}
      />

      <Text style={styles.section}>Data</Text>
      <TouchableOpacity style={styles.dangerButton} onPress={handleClearArticles}>
        <Text style={styles.dangerText}>Clear saved articles</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Account</Text>
      {accountEmail && <Text style={styles.accountEmail}>{accountEmail}</Text>}
      <TouchableOpacity style={styles.dangerButton} onPress={handleSignOut}>
        <Text style={styles.dangerText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Disclaimers</Text>
      <Text style={styles.disclaimer}>
        Vocabulary definitions are provided freely by Wiktionary contributors under the
        Creative Commons Attribution-ShareAlike License. When Wiktionary doesn't have an
        entry, definitions are generated by a large language model instead.
      </Text>
      <Text style={styles.disclaimer}>
        This app makes no guarantee that translations or definitions are verified or
        100% accurate — it offers the convenience of translation through popular LLM
        providers and Wiktionary, not a certified reference.
      </Text>
    </ScrollView>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { backgroundColor: colors.background },
  container: { padding: 24 },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 12,
  },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.chipBg,
  },
  themeBtnActive: { backgroundColor: colors.accent },
  themeBtnText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  themeBtnTextActive: { color: colors.accentText },
  accountEmail: { fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  dangerButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  disclaimer: { fontSize: 13, color: colors.textFaint, lineHeight: 19, marginBottom: 12 },
});
