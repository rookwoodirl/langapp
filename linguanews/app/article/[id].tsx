import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArticleStore } from '../../store/articleStore';
import { useVocabStore } from '../../store/vocabStore';
import VocabPopup from '../../components/VocabPopup';
import ParagraphCard from '../../components/ParagraphCard';
import { ttsService } from '../../services/tts';
import { getLanguageName } from '../../constants/languages';
import { getVerbConjugation } from '../../services/vocab';
import { calcCost, formatCost, formatTokens } from '../../utils/cost';
import { SentencePair, VerbConjugation } from '../../types';

const SETTINGS_KEY = '@linguanews/settings';

export default function ArticleScreen() {
  const { width } = useWindowDimensions();
  const cardWidth = width - 32;

  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentArticle, savedArticles, lookupWord, saveArticle, loadArticleById, vocabInputTokens, vocabOutputTokens, ttsPlaying, toggleTTS } = useArticleStore();
  const { addWord, words: vocabWords } = useVocabStore();

  const article = currentArticle?.id === id ? currentArticle : null;

  // Deep-link / reload fallback: fetch from backend if article isn't in local state
  useEffect(() => {
    if (!article && id) {
      loadArticleById(id).catch(() => {});
    }
  }, [id]);

  const pairs = useMemo<SentencePair[]>(() => article?.sentencePairs ?? [], [article?.sentencePairs]);

  const translatedText = useMemo(
    () => pairs.map((p) => p.translation).join(' '),
    [pairs]
  );

  const [saving, setSaving] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const isSaved = savedArticles.some((a) => a.id === id);

  useEffect(() => {
    if (ttsPlaying) {
      ttsService.speak(translatedText, article?.targetLanguage ?? 'en', () => {
        useArticleStore.setState({ ttsPlaying: false });
      });
    } else {
      ttsService.stop();
    }
  }, [ttsPlaying]);

  useEffect(() => () => { ttsService.stop(); }, []);

  const [popupVisible, setPopupVisible] = useState(false);
  const [popupWord, setPopupWord] = useState('');
  const [popupDefinition, setPopupDefinition] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<string | undefined>();
  const [popupGender, setPopupGender] = useState<string | undefined>();
  const [popupArticle, setPopupArticle] = useState<string | undefined>();
  const [popupLoading, setPopupLoading] = useState(false);

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
    setPopupGender(undefined);
    setPopupArticle(undefined);
    setPopupVisible(true);

    if (!definition) {
      setPopupLoading(true);
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        const settings = raw ? JSON.parse(raw) : {};
        const result = await lookupWord(word, settings);
        setPopupDefinition(result.definition);
        if (result.partOfSpeech) setPopupPos(result.partOfSpeech);
        if (result.gender) setPopupGender(result.gender);
        if (result.article) setPopupArticle(result.article);
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

    const isVerb = popupPos?.toLowerCase().includes('verb');
    let conjugation: VerbConjugation | undefined;
    let saveWord = popupWord;

    if (isVerb && apiKey) {
      conjugation = (await getVerbConjugation(popupWord, article.targetLanguage, apiKey)) ?? undefined;
      if (conjugation?.infinitive) saveWord = conjugation.infinitive;
    }

    await addWord({
      word: saveWord,
      language: article.targetLanguage,
      definition: popupDefinition ?? '',
      partOfSpeech: popupPos,
      gender: popupGender,
      article: popupArticle,
      conjugation,
    });
  }

  function handleGenerateAudio() {
    Alert.alert(
      'Generate audio?',
      `This will generate spoken audio for the article. Estimated cost: $0.00.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate audio',
          onPress: () => {
            setAudioReady(true);
            useArticleStore.setState({ ttsPlaying: true });
          },
        },
      ]
    );
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
        <Text style={styles.langText}>{fromName} → {toName}</Text>
        <TouchableOpacity
          style={[styles.saveButton, isSaved && styles.saveButtonDone]}
          disabled={isSaved || saving}
          onPress={async () => {
            setSaving(true);
            try {
              const newId = await saveArticle();
              if (newId && newId !== id) router.replace(`/article/${newId}`);
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

      <TouchableOpacity
        style={[styles.generateAudioBtn, audioReady && styles.generateAudioBtnActive]}
        onPress={audioReady ? toggleTTS : handleGenerateAudio}
      >
        <Text style={[styles.generateAudioText, audioReady && styles.generateAudioTextActive]}>
          {!audioReady ? '🔊 Generate audio' : ttsPlaying ? '⏹ Stop' : '▶ Read aloud'}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={pairs}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <ParagraphCard
            pair={item}
            vocabList={article.vocabList}
            cardWidth={cardWidth}
            onWordTap={handleWordTap}
          />
        )}
        contentContainerStyle={styles.listContent}
        style={styles.list}
      />

      <VocabPopup
        visible={popupVisible}
        word={popupWord}
        definition={popupDefinition}
        partOfSpeech={popupPos}
        gender={popupGender}
        article={popupArticle}
        isLoading={popupLoading}
        isAdded={isWordInVocab(popupWord)}
        onClose={() => setPopupVisible(false)}
        onAddToVocab={handleAddToVocab}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f4f8' },
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
  generateAudioBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f0f6ff',
    borderWidth: 1,
    borderColor: '#c8ddf5',
    alignItems: 'center',
  },
  generateAudioBtnActive: {
    backgroundColor: '#4A90D9',
    borderColor: '#4A90D9',
  },
  generateAudioText: { fontSize: 14, fontWeight: '600', color: '#4A90D9' },
  generateAudioTextActive: { color: '#fff' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 120 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { fontSize: 16, color: '#555' },
  link: { fontSize: 15, color: '#4A90D9' },
});
