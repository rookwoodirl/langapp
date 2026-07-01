import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
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
import { useColors } from '../../hooks/useColors';
import { ThemeColors } from '../../constants/theme';
import { apiPollArticleSentences } from '../../services/api';

const SETTINGS_KEY = '@linguanews/settings';

export default function ArticleScreen() {
  const { width } = useWindowDimensions();
  const cardWidth = width - 32;
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentArticle, savedArticles, lookupWord, loadArticleById, continueTranslation, appendSentences, isLoading, loadingStep, vocabInputTokens, vocabOutputTokens, ttsPlaying, toggleTTS } = useArticleStore();
  const { addWord, words: vocabWords } = useVocabStore();

  const article = currentArticle?.id === id
    ? currentArticle
    : savedArticles.find((a) => a.id === id) ?? null;

  // Fetch full content from backend if:
  // - article not in local state at all (deep-link / cold start), OR
  // - article is a list stub with no sentences (new streaming articles have content in article_text, not the JSONB list columns)
  useEffect(() => {
    if (!id) return;
    const isMissingContent =
      !article ||
      (article.sentencePairs.length === 0 && article.status !== 'translating');
    if (isMissingContent) {
      loadArticleById(id).catch(() => {});
    }
  }, [id]);

  // Poll for new sentences while the article is still being translated server-side
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!id || article?.status !== 'translating') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    async function poll() {
      const state = useArticleStore.getState();
      const currentPairs = state.currentArticle?.id === id
        ? state.currentArticle!.sentencePairs
        : state.savedArticles.find((a) => a.id === id)?.sentencePairs ?? [];

      try {
        const result = await apiPollArticleSentences(id!, currentPairs.length);
        if (result.sentences.length > 0 || result.status !== 'translating') {
          appendSentences(id!, result.sentences, result.status);
        }
        if (result.status !== 'translating') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          // Reload article to get final token counts
          loadArticleById(id!).catch(() => {});
        }
      } catch {
        // Silently retry on network errors
      }
    }

    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [id, article?.status]);

  const pairs = useMemo<SentencePair[]>(() => article?.sentencePairs ?? [], [article?.sentencePairs]);

  const translatedText = useMemo(
    () => pairs.map((p) => p.translation).join(' '),
    [pairs]
  );

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
        <ActivityIndicator size="large" />
        <Text style={styles.errorText}>Loading article…</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (article.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Translation failed.</Text>
        <Text style={[styles.errorText, { fontSize: 13, marginTop: 4 }]}>{article.statusMessage ?? ''}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
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
        if (result.infinitive) setPopupWord(result.infinitive);
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

    const isVerb = popupPos?.toLowerCase().includes('verb');
    let conjugation: VerbConjugation | undefined;
    let saveWord = popupWord;

    if (isVerb) {
      conjugation = (await getVerbConjugation(popupWord, article.targetLanguage)) ?? undefined;
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


  const fromName = getLanguageName(article.sourceLanguage);
  const toName = getLanguageName(article.targetLanguage);
  const cost = calcCost(article.inputTokens ?? 0, article.outputTokens ?? 0);
  const totalTokens = (article.inputTokens ?? 0) + (article.outputTokens ?? 0);
  const vocabCost = calcCost(vocabInputTokens, vocabOutputTokens);
  const vocabTotalTokens = vocabInputTokens + vocabOutputTokens;

  return (
    <View style={styles.container}>
      <View style={styles.langBar}>
        <View style={{ flex: 1 }}>
          {article.title ? (
            <Text style={styles.articleTitle} numberOfLines={2}>{article.title}</Text>
          ) : null}
          <Text style={styles.langText}>{fromName} → {toName}</Text>
        </View>
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
        style={[styles.generateAudioBtn, ttsPlaying && styles.generateAudioBtnActive]}
        onPress={toggleTTS}
      >
        <Text style={[styles.generateAudioText, ttsPlaying && styles.generateAudioTextActive]}>
          {ttsPlaying ? '⏹ Stop' : '▶ Read aloud'}
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
            language={article.targetLanguage}
            sourceLanguage={article.sourceLanguage}
            onWordTap={handleWordTap}
          />
        )}
        contentContainerStyle={styles.listContent}
        style={styles.list}
        ListFooterComponent={
          article.status === 'translating' ? (
            <View style={styles.translatingBanner}>
              <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 10 }} />
              <Text style={styles.translatingText}>Translating…</Text>
            </View>
          ) : article.remainingText ? (
            <TouchableOpacity
              style={styles.continueBtn}
              onPress={async () => {
                const raw = await AsyncStorage.getItem(SETTINGS_KEY);
                const settings = raw ? JSON.parse(raw) : {};
                await continueTranslation(settings);
              }}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text style={styles.continueBtnText}>
                  {loadingStep || 'Keep translating'}
                </Text>
              )}
            </TouchableOpacity>
          ) : null
        }
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

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  langBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  articleTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  langText: { fontSize: 14, color: colors.textMuted },
  costBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  costText: { fontSize: 12, color: colors.textFaint },
  generateAudioBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  generateAudioBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  generateAudioText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  generateAudioTextActive: { color: colors.accentText },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 32 },
  continueBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 40,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  continueBtnText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
  translatingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 40,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  translatingText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { fontSize: 16, color: colors.textMuted },
  link: { fontSize: 15, color: colors.accent },
});
