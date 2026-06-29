import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArticleStore } from '../../store/articleStore';
import { useVocabStore } from '../../store/vocabStore';
import ArticleText from '../../components/ArticleText';
import VocabPopup from '../../components/VocabPopup';
import AudioPlayer from '../../components/AudioPlayer';
import { getLanguageName } from '../../constants/languages';
import { getVerbConjugation } from '../../services/vocab';
import { calcCost, formatCost, formatTokens } from '../../utils/cost';

const SETTINGS_KEY = '@linguanews/settings';

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentArticle, savedArticles, lookupWord, saveArticle, vocabInputTokens, vocabOutputTokens } = useArticleStore();
  const { addWord, words: vocabWords } = useVocabStore();

  const article = currentArticle?.id === id ? currentArticle : null;

  const [saving, setSaving] = useState(false);
  const isSaved = savedArticles.some((a) => a.id === id);

  const [popupVisible, setPopupVisible] = useState(false);
  const [popupWord, setPopupWord] = useState('');
  const [popupDefinition, setPopupDefinition] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<string | undefined>();
  const [popupLoading, setPopupLoading] = useState(false);

  // Track which words the user has already added to vocab this session
  const isWordInVocab = (word: string) =>
    vocabWords.some((w) => w.word.toLowerCase() === word.toLowerCase());

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
        const result = await lookupWord(word, settings);
        setPopupDefinition(result.definition);
        if (result.partOfSpeech) setPopupPos(result.partOfSpeech);
      } catch (err) {
        setPopupDefinition('Could not load definition.');
        Alert.alert('Lookup failed', err instanceof Error ? err.message : String(err));
      } finally {
        setPopupLoading(false);
      }
    }
  }

  async function handleAddToVocab() {
    if (!article) return;
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const settings = raw ? JSON.parse(raw) : {};
    const apiKey = settings.apiKey || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';

    let conjugation: { infinitive: string; present: string[] } | undefined;
    const isVerb = popupPos?.toLowerCase().includes('verb');
    if (isVerb && apiKey) {
      conjugation = (await getVerbConjugation(popupWord, article.targetLanguage, apiKey)) ?? undefined;
    }

    await addWord({
      word: popupWord,
      language: article.targetLanguage,
      definition: popupDefinition ?? '',
      partOfSpeech: popupPos,
      conjugation,
    });
  }

  const fromName = getLanguageName(article.sourceLanguage);
  const toName = getLanguageName(article.targetLanguage);
  const cost = calcCost(article.inputTokens ?? 0, article.outputTokens ?? 0);
  const totalTokens = (article.inputTokens ?? 0) + (article.outputTokens ?? 0);
  const vocabCost = calcCost(vocabInputTokens, vocabOutputTokens);
  const vocabTotalTokens = vocabInputTokens + vocabOutputTokens;

  return (
    <View style={styles.container}>
      <View style={styles.langBar}>
        <Text style={styles.langText}>
          {fromName} → {toName}
        </Text>
        <TouchableOpacity
          style={[styles.saveButton, isSaved && styles.saveButtonDone]}
          disabled={isSaved || saving}
          onPress={async () => {
            setSaving(true);
            try {
              await saveArticle();
            } catch (err) {
              Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Text style={[styles.saveText, isSaved && styles.saveTextDone]}>
            {isSaved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {totalTokens > 0 && (
        <View style={styles.costBar}>
          <Text style={styles.costText}>
            Translation: {formatTokens(totalTokens)} tokens · {formatCost(cost)}
            {vocabTotalTokens > 0
              ? `  |  Lookups: ${formatTokens(vocabTotalTokens)} tokens · ${formatCost(vocabCost)}`
              : ''}
          </Text>
        </View>
      )}

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
        isAdded={isWordInVocab(popupWord)}
        onClose={() => setPopupVisible(false)}
        onAddToVocab={handleAddToVocab}
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
  saveButton: {
    backgroundColor: '#4A90D9',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveButtonDone: { backgroundColor: '#e8f5e9' },
  saveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  saveTextDone: { color: '#2e7d32' },
  costBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  costText: { fontSize: 12, color: '#aaa' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { fontSize: 16, color: '#555' },
  link: { fontSize: 15, color: '#4A90D9' },
});
