import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArticle } from '../hooks/useArticle';
import LanguagePicker from '../components/LanguagePicker';
import { UserSettings } from '../types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from '../constants/languages';

const SETTINGS_KEY = '@linguanews/settings';

export default function HomeScreen() {
  const [url, setUrl] = useState('');
  const [showPasteText, setShowPasteText] = useState(true);
  const [pastedText, setPastedText] = useState('');
  const [settings, setSettings] = useState<UserSettings>({
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    apiKey: '',
  });

  const { fetchArticle, isLoading, loadingStep, error, currentArticle } = useArticle();

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (raw) setSettings(JSON.parse(raw));
    });
  }, []);

  useEffect(() => {
    if (currentArticle && !isLoading) {
      router.push(`/article/${currentArticle.id}`);
    }
  }, [currentArticle, isLoading]);

  useEffect(() => {
    if (error) Alert.alert('Error', error);
  }, [error]);

  async function updateSetting<K extends keyof UserSettings>(key: K, val: UserSettings[K]) {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }

  async function handleTranslate() {
    const input = showPasteText ? pastedText.trim() : url.trim();
    if (!input) {
      Alert.alert('Input required', showPasteText ? 'Please paste article text.' : 'Please enter a URL.');
      return;
    }
    await fetchArticle(input, !showPasteText, settings);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="always"
          bounces={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.appName}>LinguaNews</Text>
            <TouchableOpacity onPress={() => router.push('/settings')} hitSlop={12}>
              <Text style={styles.settingsIcon}>⚙</Text>
            </TouchableOpacity>
          </View>

          {/* URL bar — the main interaction */}
          <View style={styles.urlCard}>
            <Text style={styles.cardLabel}>Article URL</Text>
            <View style={styles.urlRow}>
              <TextInput
                style={styles.urlInput}
                placeholder="Paste a link here…"
                placeholderTextColor="#aaa"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleTranslate}
                editable={!isLoading}
              />
              {url.length > 0 && (
                <TouchableOpacity onPress={() => setUrl('')} hitSlop={8} style={styles.clearBtn}>
                  <Text style={styles.clearText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.urlTip}>
            Many sites block direct fetches. If it fails, paste the article text below.
          </Text>

          {/* Paste text toggle */}
          <TouchableOpacity
            style={styles.toggleBtn}
            onPress={() => setShowPasteText((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.toggleText}>
              {showPasteText ? '▲ Hide text input' : '▼ Paste article text instead'}
            </Text>
          </TouchableOpacity>

          {showPasteText && (
            <View style={styles.textCard}>
              <Text style={styles.cardLabel}>Article text</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Paste the full article text here…"
                placeholderTextColor="#aaa"
                value={pastedText}
                onChangeText={setPastedText}
                multiline
                editable={!isLoading}
              />
            </View>
          )}

          {/* Language pair */}
          <View style={styles.langCard}>
            <View style={styles.langCol}>
              <LanguagePicker
                label="Translate from"
                value={settings.sourceLanguage}
                onChange={(v) => updateSetting('sourceLanguage', v)}
              />
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={styles.langCol}>
              <LanguagePicker
                label="Into"
                value={settings.targetLanguage}
                onChange={(v) => updateSetting('targetLanguage', v)}
              />
            </View>
          </View>

          {/* Translate button / loading */}
          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#4A90D9" size="large" />
              <Text style={styles.loadingText}>{loadingStep}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.translateBtn}
              onPress={handleTranslate}
              activeOpacity={0.8}
            >
              <Text style={styles.translateBtnText}>Translate</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f4f8' },
  flex: { flex: 1 },
  scroll: { padding: 20, paddingTop: 12 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  appName: { fontSize: 22, fontWeight: '800', color: '#111' },
  settingsIcon: { fontSize: 22, color: '#888' },

  urlCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#4A90D9',
    borderRadius: 12,
    backgroundColor: '#f7fbff',
    paddingHorizontal: 14,
  },
  urlInput: {
    flex: 1,
    fontSize: 15,
    color: '#111',
    paddingVertical: 14,
  },
  clearBtn: { padding: 4 },
  clearText: { fontSize: 14, color: '#bbb' },

  toggleBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  toggleText: { fontSize: 13, color: '#4A90D9', fontWeight: '600' },

  textCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  textArea: {
    fontSize: 15,
    color: '#111',
    minHeight: 140,
    textAlignVertical: 'top',
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
  },

  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    marginTop: 10,
  },
  langCol: { flex: 1 },
  arrow: { fontSize: 20, color: '#aaa', marginTop: 16 },

  translateBtn: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#4A90D9',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  translateBtnText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },

  loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 14 },
  loadingText: { fontSize: 15, color: '#555' },
  urlTip: { fontSize: 12, color: '#aaa', textAlign: 'center', marginBottom: 4, marginTop: 6 },
});
