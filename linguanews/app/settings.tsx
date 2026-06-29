import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LanguagePicker from '../components/LanguagePicker';
import { useArticleStore } from '../store/articleStore';
import { UserSettings } from '../types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from '../constants/languages';

const SETTINGS_KEY = '@linguanews/settings';

export default function SettingsScreen() {
  const [settings, setSettings] = useState<UserSettings>({
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    apiKey: '',
  });
  const { clearSavedArticles } = useArticleStore();

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (raw) setSettings(JSON.parse(raw));
    });
  }, []);

  async function save(updated: UserSettings) {
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }

  function handleClearArticles() {
    Alert.alert('Clear saved articles?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearSavedArticles();
          Alert.alert('Done', 'Saved articles cleared.');
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.section}>Language preferences</Text>

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

      <Text style={styles.section}>Anthropic API key</Text>
      <Text style={styles.hint}>
        Your key is stored locally only. Get one at console.anthropic.com.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="sk-ant-..."
        placeholderTextColor="#aaa"
        value={settings.apiKey}
        onChangeText={(v) => save({ ...settings, apiKey: v })}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.section}>Data</Text>
      <TouchableOpacity style={styles.dangerButton} onPress={handleClearArticles}>
        <Text style={styles.dangerText}>Clear saved articles</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24 },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 12,
  },
  hint: { fontSize: 13, color: '#999', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#111',
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#e53935',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerText: { color: '#e53935', fontSize: 15, fontWeight: '600' },
});
