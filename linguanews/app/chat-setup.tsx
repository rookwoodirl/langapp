import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Modal, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArticleStore } from '../store/articleStore';
import { useVocabStore } from '../store/vocabStore';
import { useNotecardStore } from '../store/notecardStore';
import { useChatStore } from '../store/chatStore';
import { apiGetNotecardListItems } from '../services/api';
import { DIFFICULTIES, DEFAULT_NATIVE_LANGUAGE, getLanguageName } from '../constants/languages';
import { Article, DifficultyLevel, NotecardList, UserSettings } from '../types';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

const SETTINGS_KEY = '@linguanews/settings';

type VocabSource = { type: 'list'; list: NotecardList } | { type: 'all'; language: string };

export default function ChatSetupScreen() {
  const { mode } = useLocalSearchParams<{ mode: 'article' | 'vocab' }>();
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  const { savedArticles, loadSavedArticles } = useArticleStore();
  const { words: vocabWords, loadVocab } = useVocabStore();
  const { lists, loadLists } = useNotecardStore();
  const { createSession } = useChatStore();

  const [nativeLanguage, setNativeLanguage] = useState(DEFAULT_NATIVE_LANGUAGE);
  const [dialogArticle, setDialogArticle] = useState<Article | null>(null);
  const [vocabSource, setVocabSource] = useState<VocabSource | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('intermediate');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadSavedArticles();
    loadVocab();
    loadLists();
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UserSettings>;
        if (parsed.nativeLanguage) setNativeLanguage(parsed.nativeLanguage);
      }
    });
  }, []);

  const completedArticles = savedArticles.filter(
    (a) => a.status !== 'translating' && a.status !== 'error' && a.sentencePairs.length > 0
  );
  const vocabLanguages = Array.from(new Set(vocabWords.map((w) => w.language)));

  async function handleStart() {
    if (mode === 'article') {
      if (!dialogArticle) return;
      setStarting(true);
      try {
        const id = await createSession({
          mode: 'article',
          difficulty,
          targetLanguage: dialogArticle.targetLanguage,
          nativeLanguage,
          articleId: dialogArticle.id,
          articleTitle: dialogArticle.title ?? 'Untitled article',
        });
        router.replace(`/chat/${id}`);
      } finally {
        setStarting(false);
      }
    } else {
      if (!vocabSource) return;
      setStarting(true);
      try {
        let words: string[];
        let language: string;
        let vocabLabel: string;
        if (vocabSource.type === 'list') {
          const items = await apiGetNotecardListItems(vocabSource.list.id);
          words = items.map((w) => w.word);
          language = vocabSource.list.language ?? items[0]?.language ?? nativeLanguage;
          vocabLabel = vocabSource.list.name;
        } else {
          words = vocabWords.filter((w) => w.language === vocabSource.language).map((w) => w.word);
          language = vocabSource.language;
          vocabLabel = `All ${getLanguageName(vocabSource.language)} vocab`;
        }
        if (words.length === 0) {
          Alert.alert('No words', 'This source has no vocab words yet.');
          return;
        }
        const id = await createSession({
          mode: 'vocab',
          difficulty,
          targetLanguage: language,
          nativeLanguage,
          vocabWords: words,
          vocabLabel,
        });
        router.replace(`/chat/${id}`);
      } finally {
        setStarting(false);
      }
    }
  }

  const canStart = !!vocabSource;

  const difficultyPicker = (
    <View style={styles.difficultyRow}>
      {DIFFICULTIES.map((d) => (
        <TouchableOpacity
          key={d}
          style={[styles.difficultyBtn, difficulty === d && styles.difficultyBtnActive]}
          onPress={() => setDifficulty(d)}
        >
          <Text style={[styles.difficultyText, difficulty === d && styles.difficultyTextActive]}>
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {mode === 'article' ? (
          <>
            <Text style={styles.sectionTitle}>Pick an article</Text>
            {completedArticles.length === 0 ? (
              <Text style={styles.emptyText}>No saved articles yet. Translate one first.</Text>
            ) : (
              completedArticles.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.optionRow, dialogArticle?.id === a.id && styles.optionRowActive]}
                  onPress={() => setDialogArticle(a)}
                >
                  <Text style={[styles.optionTitle, dialogArticle?.id === a.id && styles.optionTitleActive]}>
                    {a.title ?? 'Untitled article'}
                  </Text>
                  <Text style={styles.optionSubtitle}>
                    {getLanguageName(a.sourceLanguage)} → {getLanguageName(a.targetLanguage)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Pick a vocab source</Text>
            {vocabLanguages.length === 0 && lists.length === 0 ? (
              <Text style={styles.emptyText}>No saved vocab yet. Add some words first.</Text>
            ) : (
              <>
                {vocabLanguages.map((lang) => {
                  const active = vocabSource?.type === 'all' && vocabSource.language === lang;
                  return (
                    <TouchableOpacity
                      key={`all-${lang}`}
                      style={[styles.optionRow, active && styles.optionRowActive]}
                      onPress={() => setVocabSource({ type: 'all', language: lang })}
                    >
                      <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>
                        All {getLanguageName(lang)} vocab
                      </Text>
                      <Text style={styles.optionSubtitle}>
                        {vocabWords.filter((w) => w.language === lang).length} words
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {lists.map((list) => {
                  const active = vocabSource?.type === 'list' && vocabSource.list.id === list.id;
                  return (
                    <TouchableOpacity
                      key={list.id}
                      style={[styles.optionRow, active && styles.optionRowActive]}
                      onPress={() => setVocabSource({ type: 'list', list })}
                    >
                      <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{list.name}</Text>
                      <Text style={styles.optionSubtitle}>
                        {list.itemCount ?? 0} word{list.itemCount === 1 ? '' : 's'}
                        {list.language ? ` · ${getLanguageName(list.language)}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </>
        )}

        {mode === 'vocab' && (
          <>
            <Text style={styles.sectionTitle}>Difficulty</Text>
            {difficultyPicker}

            <TouchableOpacity
              style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
              disabled={!canStart || starting}
              onPress={handleStart}
            >
              {starting ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.startBtnText}>Start Chat</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {mode === 'article' && (
        <Modal
          visible={!!dialogArticle}
          transparent
          animationType="slide"
          onRequestClose={() => setDialogArticle(null)}
        >
          <Pressable style={styles.dialogBackdrop} onPress={() => setDialogArticle(null)} />
          <View style={styles.dialogSheet}>
            <View style={styles.dialogHandle} />
            <Text style={styles.dialogTitle} numberOfLines={2}>
              {dialogArticle?.title ?? 'Untitled article'}
            </Text>
            <Text style={styles.sectionTitle}>Difficulty</Text>
            {difficultyPicker}
            <TouchableOpacity style={styles.startBtn} disabled={starting} onPress={handleStart}>
              {starting ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.startBtnText}>Start Chat</Text>}
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 8, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: { fontSize: 14, color: colors.textFaint, marginBottom: 8 },
  optionRow: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  optionRowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  optionTitleActive: { color: colors.accent },
  optionSubtitle: { fontSize: 13, color: colors.textFaint, marginTop: 2 },
  difficultyRow: { flexDirection: 'row', gap: 8 },
  difficultyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
  },
  difficultyBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  difficultyText: { fontSize: 14, fontWeight: '600', color: colors.text },
  difficultyTextActive: { color: colors.accent },
  startBtn: {
    marginTop: 24,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnDisabled: { opacity: 0.5 },
  startBtnText: { fontSize: 16, fontWeight: '800', color: colors.accentText },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  dialogSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  dialogHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
});
