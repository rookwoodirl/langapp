import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useArticleStore } from '../../store/articleStore';
import ArticleText from '../../components/ArticleText';
import VocabPopup from '../../components/VocabPopup';
import AudioPlayer from '../../components/AudioPlayer';
import { getLanguageName } from '../../constants/languages';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@linguanews/settings';

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentArticle, lookupWord } = useArticleStore();

  const article = currentArticle?.id === id ? currentArticle : null;

  const [popupVisible, setPopupVisible] = useState(false);
  const [popupWord, setPopupWord] = useState('');
  const [popupDefinition, setPopupDefinition] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<string | undefined>();
  const [popupLoading, setPopupLoading] = useState(false);

  if (!article) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Article not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handleWordTap(word: string, definition?: string, partOfSpeech?: string) {
    if (!word.trim()) return;

    setPopupWord(word);
    setPopupDefinition(definition ?? null);
    setPopupPos(partOfSpeech);
    setPopupVisible(true);

    if (!definition) {
      setPopupLoading(true);
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        const settings = raw ? JSON.parse(raw) : {};
        const def = await lookupWord(word, settings);
        setPopupDefinition(def);
      } catch (err) {
        setPopupDefinition('Could not load definition.');
        Alert.alert('Lookup failed', err instanceof Error ? err.message : String(err));
      } finally {
        setPopupLoading(false);
      }
    }
  }

  const fromName = getLanguageName(article.sourceLanguage);
  const toName = getLanguageName(article.targetLanguage);

  return (
    <View style={styles.container}>
      <View style={styles.langBar}>
        <Text style={styles.langText}>
          {fromName} → {toName}
        </Text>
        {/* TODO: share/export */}
        <TouchableOpacity disabled style={styles.shareButton}>
          <Text style={styles.shareText}>Share</Text>
        </TouchableOpacity>
      </View>

      <ArticleText
        text={article.translatedText}
        vocabList={article.vocabList}
        onWordTap={handleWordTap}
      />

      <AudioPlayer text={article.translatedText} language={article.targetLanguage} />

      <VocabPopup
        visible={popupVisible}
        word={popupWord}
        definition={popupDefinition}
        partOfSpeech={popupPos}
        isLoading={popupLoading}
        onClose={() => setPopupVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  langBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  langText: { fontSize: 14, color: '#555' },
  shareButton: { opacity: 0.4 },
  shareText: { fontSize: 14, color: '#4A90D9' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { fontSize: 16, color: '#555' },
  link: { fontSize: 15, color: '#4A90D9' },
});
