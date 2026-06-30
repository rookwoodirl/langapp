import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  FlatList,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArticle } from '../hooks/useArticle';
import LanguagePicker from '../components/LanguagePicker';
import { UserSettings, Article, UserVocabWord, DifficultyLevel, NotecardList } from '../types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE, getLanguageName } from '../constants/languages';
import { useArticleStore } from '../store/articleStore';
import { useVocabStore } from '../store/vocabStore';
import { useNotecardStore } from '../store/notecardStore';
import { calcCost, formatCost, formatTokens } from '../utils/cost';
import { selectVocabWords, lookupWordDefinition, getVerbConjugation } from '../services/vocab';
import ConjugationModal from '../components/ConjugationModal';
import { VerbConjugation } from '../types';
import { useUsageStore } from '../store/usageStore';
import { ttsService } from '../services/tts';
import { exportNotecardsToAnki } from '../services/ankiExport';
import { apiGetNotecardListItems, apiGetCostEvents, CostEvent } from '../services/api';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';
import { SOURCE_ORDER, SOURCE_LABELS } from '../constants/costs';

const DIFFICULTIES: DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];

const SETTINGS_KEY = '@linguanews/settings';

const TABS = ['Translate', 'Articles', 'Vocab', 'Review', 'Cost'] as const;
const COST_TIME_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All time', days: null },
] as const;
type Tab = (typeof TABS)[number];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<number>(0);
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  const [url, setUrl] = useState('');
  const [settings, setSettings] = useState<UserSettings>({
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    difficulty: 'intermediate',
  });

  const { fetchArticle, isLoading, loadingStep, error, currentArticle } = useArticle();
  const pendingSourceRef = useRef<'article' | 'article-regeneration'>('article');
  const { savedArticles, loadSavedArticles, setCurrentArticle, deleteArticle } = useArticleStore();
  const { words: vocabWords, loadVocab, removeWord, addWord, updateWord } = useVocabStore();
  const { lists, loadLists, createList, updateList, deleteList, addToList } = useNotecardStore();

  const { load: loadUsage } = useUsageStore();

  const [vocabModalArticle, setVocabModalArticle] = useState<Article | null>(null);
  const [contextMenu, setContextMenu] = useState<Article | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [conjModal, setConjModal] = useState<{ infinitive: string; conjugation: VerbConjugation } | null>(null);
  const [vocabLangFilter, setVocabLangFilter] = useState<string | null>(null);
  const [vocabSearch, setVocabSearch] = useState('');
  const [editingWord, setEditingWord] = useState<UserVocabWord | null>(null);
  const [editForm, setEditForm] = useState({ word: '', definition: '', partOfSpeech: '', gender: '', article: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [reviewLangFilter, setReviewLangFilter] = useState<string | null>(null);
  const [pickerWord, setPickerWord] = useState<UserVocabWord | null>(null);
  const [listModal, setListModal] = useState<{ mode: 'create' | 'rename'; list?: NotecardList } | null>(null);
  const [listForm, setListForm] = useState({ name: '', language: '' });
  const [pendingAddWord, setPendingAddWord] = useState<UserVocabWord | null>(null);
  const [savingList, setSavingList] = useState(false);
  const [costEvents, setCostEvents] = useState<CostEvent[]>([]);
  const [costRangeIndex, setCostRangeIndex] = useState(3); // "All time"
  const [costSourceFilter, setCostSourceFilter] = useState<string | null>(null);

  async function loadCostEvents() {
    const days = COST_TIME_RANGES[costRangeIndex].days;
    const since = days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
    const events = await apiGetCostEvents({ since, source: costSourceFilter ?? undefined });
    setCostEvents(events);
  }

  function openCreateList(prefillLanguage?: string) {
    setPendingAddWord(null);
    setListModal({ mode: 'create' });
    setListForm({ name: '', language: prefillLanguage ?? '' });
  }

  function openCreateListFromPicker() {
    setPendingAddWord(pickerWord);
    setListModal({ mode: 'create' });
    setListForm({ name: '', language: pickerWord?.language ?? '' });
  }

  function openRenameList(list: NotecardList) {
    setPendingAddWord(null);
    setListModal({ mode: 'rename', list });
    setListForm({ name: list.name, language: list.language ?? '' });
  }

  async function handleSaveList() {
    if (!listModal) return;
    const name = listForm.name.trim();
    if (!name) { Alert.alert('Name required', 'Give the list a name.'); return; }
    setSavingList(true);
    try {
      const language = listForm.language.trim() || undefined;
      if (listModal.mode === 'create') {
        await createList(name, language);
        if (pendingAddWord) {
          const created = useNotecardStore.getState().lists.find((l) => l.name === name);
          if (created) await addToList(created.id, pendingAddWord.id);
          setPendingAddWord(null);
          setPickerWord(null);
        }
      } else if (listModal.list) {
        await updateList(listModal.list.id, { name, language });
      }
      setListModal(null);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save list.');
    } finally {
      setSavingList(false);
    }
  }

  function handleDeleteList(list: NotecardList) {
    Alert.alert('Delete list?', `"${list.name}" will be removed. The words themselves stay in your vocab.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteList(list.id) },
    ]);
  }

  async function handleAddToList(listId: string) {
    if (!pickerWord) return;
    await addToList(listId, pickerWord.id);
    setPickerWord(null);
  }

  async function handleExportToAnki(words: UserVocabWord[]) {
    try {
      await exportNotecardsToAnki(words);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Could not export to Anki.');
    }
  }

  async function handleExportList(list: NotecardList) {
    try {
      const items = await apiGetNotecardListItems(list.id);
      await exportNotecardsToAnki(items, `${list.name.replace(/[^\w-]+/g, '_')}.txt`);
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Could not export to Anki.');
    }
  }

  function openEditModal(word: UserVocabWord) {
    setEditingWord(word);
    setEditForm({
      word: word.word,
      definition: word.definition,
      partOfSpeech: word.partOfSpeech ?? '',
      gender: word.gender ?? '',
      article: word.article ?? '',
    });
  }

  async function handleSaveEdit() {
    if (!editingWord) return;
    setSavingEdit(true);
    try {
      await updateWord(editingWord.vocabWordId, {
        word: editForm.word.trim(),
        definition: editForm.definition.trim(),
        partOfSpeech: editForm.partOfSpeech.trim() || undefined,
        gender: editForm.gender.trim() || undefined,
        article: editForm.article.trim() || undefined,
      });
      setEditingWord(null);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update word.');
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (raw) setSettings(JSON.parse(raw));
    });
    loadUsage();
  }, []);

  useEffect(() => {
    if (currentArticle && !isLoading) {
      router.push(`/article/${currentArticle.id}`);
    }
  }, [currentArticle, isLoading]);

  useEffect(() => {
    if (error) Alert.alert('Error', error);
  }, [error]);

  // Load data when switching tabs
  useEffect(() => {
    if (activeTab === 1) loadSavedArticles();
    if (activeTab === 2) loadVocab();
    if (activeTab === 3) loadLists();
    if (activeTab === 4) loadCostEvents();
  }, [activeTab]);

  // Refetch cost events when their filters change (while on the Cost tab)
  useEffect(() => {
    if (activeTab === 4) loadCostEvents();
  }, [costRangeIndex, costSourceFilter]);

  async function updateSetting<K extends keyof UserSettings>(key: K, val: UserSettings[K]) {
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }

  async function handlePaste() {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setUrl(text.trim());
    } else {
      Alert.alert('Nothing to paste', 'Your clipboard is empty.');
    }
  }

  async function handleTranslate() {
    if (!url.trim()) {
      Alert.alert('Paste a URL first', 'Tap the Paste button to load a link from your clipboard.');
      return;
    }
    // Capture and reset source before showing the alert so a Cancel can never leave a stale value
    const src = pendingSourceRef.current;
    pendingSourceRef.current = 'article';
    Alert.alert(
      'Translate article?',
      'This will send the article to Claude for translation. Estimated cost: max $1.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Translate', onPress: () => { fetchArticle(url.trim(), true, settings, src); } },
      ]
    );
  }

  async function handleGenerateVocab(article: Article) {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
    if (!apiKey) { Alert.alert('Missing configuration', 'No Anthropic API key is configured for this app.'); return; }
    setRegenLoading(true);
    try {
      const existing = vocabWords.map((w) => w.word);
      const articleText = article.sentencePairs.map((p) => p.translation).join(' ');

      // Step 1: pick words (cheap selection call)
      const selection = await selectVocabWords(
        articleText, article.targetLanguage, article.sourceLanguage, existing, apiKey
      );
      useUsageStore.getState().addVocab(selection.inputTokens, selection.outputTokens);

      // Step 2: look up each word through the same pipeline as word taps
      const lookups = await Promise.all(
        selection.words.map((word) =>
          lookupWordDefinition(word, article.targetLanguage, article.sourceLanguage, apiKey, articleText)
        )
      );
      useUsageStore.getState().addVocab(
        lookups.reduce((s, r) => s + r.inputTokens, 0),
        lookups.reduce((s, r) => s + r.outputTokens, 0),
      );

      // Step 3: conjugations for verbs, same as handleAddToVocab
      const enriched = await Promise.all(
        lookups.map(async (lookup, i) => {
          const isVerb = lookup.partOfSpeech?.toLowerCase().includes('verb');
          const wordCandidate = lookup.infinitive ?? selection.words[i];
          const conjugation = isVerb
            ? (await getVerbConjugation(wordCandidate, article.targetLanguage, apiKey)) ?? undefined
            : undefined;
          // Mirror tap flow: conjugation.infinitive takes priority, then lookup.infinitive, then selected word
          const saveWord = conjugation?.infinitive ?? lookup.infinitive ?? selection.words[i];
          return { lookup, saveWord, conjugation };
        })
      );

      const settled = await Promise.allSettled(
        enriched.map(({ lookup, saveWord, conjugation }) =>
          addWord({
            word: saveWord,
            language: article.targetLanguage,
            definition: lookup.definition,
            partOfSpeech: lookup.partOfSpeech,
            gender: lookup.gender,
            article: lookup.article,
            conjugation,
          })
        )
      );
      const saved = settled.filter((r) => r.status === 'fulfilled').length;
      const failed = settled.filter((r) => r.status === 'rejected').length;
      Alert.alert('Vocab added', `Added ${saved} word${saved !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}.`);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to generate vocab.');
    } finally {
      setRegenLoading(false);
    }
  }

  function handleRetranslate(article: Article) {
    if (!article.sourceUrl) {
      Alert.alert('No URL', 'This article was pasted as text and has no URL to re-translate from.');
      return;
    }
    pendingSourceRef.current = 'article-regeneration';
    setUrl(article.sourceUrl);
    scrollToTab(0);
  }

  async function handleDeleteArticle(article: Article) {
    Alert.alert('Delete article?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try { await deleteArticle(article.id); }
          catch { Alert.alert('Error', 'Could not delete article.'); }
        },
      },
    ]);
  }

  function scrollToTab(index: number) {
    pagerRef.current?.scrollTo({ x: index * width, animated: true });
    setActiveTab(index);
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== activeTab) setActiveTab(page);
  }

  function handleArticleTap(article: Article) {
    setCurrentArticle(article);
    router.push(`/article/${article.id}`);
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Translate page ──────────────────────────────────────────────────────────
  const translatePage = (
    <ScrollView
      style={{ width }}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="always"
      bounces={false}
    >
      {/* Paste button */}
      <View style={styles.pasteCard}>
        <Text style={styles.cardLabel}>Article URL</Text>
        {url ? (
          <View style={styles.urlPreview}>
            <Text style={styles.urlText} numberOfLines={2}>{url}</Text>
            <TouchableOpacity onPress={() => setUrl('')} hitSlop={8} style={styles.clearBtn}>
              <Text style={styles.clearText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.urlPlaceholder}>Tap Paste to load a link from your clipboard</Text>
        )}
        <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste} activeOpacity={0.8}>
          <Text style={styles.pasteBtnText}>Paste</Text>
        </TouchableOpacity>
      </View>

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

      <View style={styles.difficultyCard}>
        <Text style={styles.cardLabel}>Reading Level</Text>
        <View style={styles.difficultyRow}>
          {DIFFICULTIES.map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.difficultyBtn, settings.difficulty === d && styles.difficultyBtnActive]}
              onPress={() => updateSetting('difficulty', d)}
              activeOpacity={0.75}
            >
              <Text style={[styles.difficultyText, settings.difficulty === d && styles.difficultyTextActive]}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>{loadingStep}</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.translateBtn} onPress={handleTranslate} activeOpacity={0.8}>
          <Text style={styles.translateBtnText}>Translate</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );

  // ── Articles page ───────────────────────────────────────────────────────────
  const articlesPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={savedArticles.length === 0 ? styles.emptyContainer : styles.listContent}
      data={savedArticles}
      keyExtractor={(a) => a.id}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📰</Text>
          <Text style={styles.emptyTitle}>No saved articles</Text>
          <Text style={styles.emptySubtitle}>Translate an article and tap Save to keep it here.</Text>
        </View>
      }
      renderItem={({ item }) => {
        const articleCost = calcCost(item.inputTokens ?? 0, item.outputTokens ?? 0);
        const articleTokens = (item.inputTokens ?? 0) + (item.outputTokens ?? 0);
        return (
          <TouchableOpacity
            style={styles.articleCard}
            onPress={() => handleArticleTap(item)}
            onLongPress={() => setContextMenu(item)}
            activeOpacity={0.8}
          >
            <View style={styles.articleMeta}>
              <Text style={styles.articleLang}>{item.sourceLanguage} → {item.targetLanguage}</Text>
              <Text style={styles.articleDate}>{formatDate(item.createdAt)}</Text>
            </View>
            {item.sourceUrl ? (
              <Text style={styles.articleUrl} numberOfLines={1}>{item.sourceUrl}</Text>
            ) : null}
            <Text style={styles.articlePreview} numberOfLines={3}>
              {item.sentencePairs.map((p) => p.translation).join(' ')}
            </Text>
            {articleTokens > 0 && (
              <Text style={styles.articleCost}>
                {formatTokens(articleTokens)} tokens · {formatCost(articleCost)}
              </Text>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );

  // ── Vocab page ──────────────────────────────────────────────────────────────
  const vocabLanguages = Array.from(new Set(vocabWords.map((w) => w.language)));
  const searchTerm = vocabSearch.trim().toLowerCase();
  const filteredVocabWords = vocabWords
    .filter((w) => !vocabLangFilter || w.language === vocabLangFilter)
    .filter((w) => !searchTerm || w.word.toLowerCase().includes(searchTerm) || w.definition.toLowerCase().includes(searchTerm));

  const vocabPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={filteredVocabWords.length === 0 ? styles.emptyContainer : styles.listContent}
      data={filteredVocabWords}
      keyExtractor={(w) => w.id}
      ListHeaderComponent={
        <View>
          {vocabWords.length > 0 && (
            <TextInput
              style={styles.vocabSearchInput}
              placeholder="Search words or definitions…"
              placeholderTextColor={colors.textFaint}
              value={vocabSearch}
              onChangeText={setVocabSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          {vocabLanguages.length > 1 && (
            <View style={styles.langFilterRow}>
              <TouchableOpacity
                style={[styles.langFilterChip, !vocabLangFilter && styles.langFilterChipActive]}
                onPress={() => setVocabLangFilter(null)}
              >
                <Text style={[styles.langFilterText, !vocabLangFilter && styles.langFilterTextActive]}>All</Text>
              </TouchableOpacity>
              {vocabLanguages.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.langFilterChip, vocabLangFilter === lang && styles.langFilterChipActive]}
                  onPress={() => setVocabLangFilter(lang)}
                >
                  <Text style={[styles.langFilterText, vocabLangFilter === lang && styles.langFilterTextActive]}>
                    {getLanguageName(lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {filteredVocabWords.length > 0 && (
            <TouchableOpacity style={styles.exportBtn} onPress={() => handleExportToAnki(filteredVocabWords)}>
              <Text style={styles.exportBtnText}>Export to Anki ({filteredVocabWords.length})</Text>
            </TouchableOpacity>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📖</Text>
          <Text style={styles.emptyTitle}>
            {vocabWords.length === 0 ? 'No vocab words yet' : 'No matches'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {vocabWords.length === 0
              ? 'Tap any highlighted word while reading and hit "Add to vocab".'
              : 'Try a different search term or language filter.'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.vocabCard}>
          <View style={styles.vocabHeader}>
            <View style={styles.vocabWordRow}>
              <Text style={styles.vocabWord}>
                {item.article ? `${item.article} ` : ''}{item.word}
              </Text>
              {item.partOfSpeech ? <Text style={styles.vocabPos}>{item.partOfSpeech}</Text> : null}
              {item.gender ? <Text style={styles.vocabGender}>{item.gender}</Text> : null}
            </View>
            <View style={styles.vocabCardActions}>
              <TouchableOpacity onPress={() => ttsService.speak(item.word, item.language)} hitSlop={8}>
                <Text style={styles.vocabSpeak}>🔊</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPickerWord(item)} hitSlop={8}>
                <Text style={styles.vocabEdit}>📋</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEditModal(item)} hitSlop={8}>
                <Text style={styles.vocabEdit}>✎</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeWord(item.id)} hitSlop={8}>
                <Text style={styles.vocabRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.vocabDefinition}>{item.definition}</Text>
          {item.conjugation && (
            <TouchableOpacity
              style={styles.conjBtn}
              onPress={() => setConjModal({ infinitive: item.conjugation!.infinitive, conjugation: item.conjugation! })}
            >
              <Text style={styles.conjBtnText}>Conjugations</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    />
  );

  // ── Review page ─────────────────────────────────────────────────────────────
  const reviewPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={lists.length === 0 ? styles.emptyContainer : styles.listContent}
      data={lists}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={
        <View>
          <TouchableOpacity
            style={styles.reviewCta}
            onPress={() => router.push({ pathname: '/review', params: reviewLangFilter ? { language: reviewLangFilter } : {} })}
            activeOpacity={0.8}
          >
            <Text style={styles.reviewCtaText}>▶ Review due cards</Text>
          </TouchableOpacity>
          {vocabLanguages.length > 1 && (
            <View style={styles.langFilterRow}>
              <TouchableOpacity
                style={[styles.langFilterChip, !reviewLangFilter && styles.langFilterChipActive]}
                onPress={() => setReviewLangFilter(null)}
              >
                <Text style={[styles.langFilterText, !reviewLangFilter && styles.langFilterTextActive]}>All</Text>
              </TouchableOpacity>
              {vocabLanguages.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.langFilterChip, reviewLangFilter === lang && styles.langFilterChipActive]}
                  onPress={() => setReviewLangFilter(lang)}
                >
                  <Text style={[styles.langFilterText, reviewLangFilter === lang && styles.langFilterTextActive]}>
                    {getLanguageName(lang)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={styles.cardLabel}>Lists</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🗂️</Text>
          <Text style={styles.emptyTitle}>No lists yet</Text>
          <Text style={styles.emptySubtitle}>Create a list to group notecards into a deck.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.vocabCard}>
          <View style={styles.vocabHeader}>
            <View style={styles.vocabWordRow}>
              <Text style={styles.vocabWord}>{item.name}</Text>
            </View>
            <View style={styles.vocabCardActions}>
              <TouchableOpacity onPress={() => handleExportList(item)} hitSlop={8}>
                <Text style={styles.vocabSpeak}>📤</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openRenameList(item)} hitSlop={8}>
                <Text style={styles.vocabEdit}>✎</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteList(item)} hitSlop={8}>
                <Text style={styles.vocabRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.vocabDefinition}>
            {item.itemCount ?? 0} word{item.itemCount === 1 ? '' : 's'}
            {item.language ? ` · ${getLanguageName(item.language)}` : ''}
          </Text>
          <TouchableOpacity
            style={styles.conjBtn}
            onPress={() => router.push({ pathname: '/review', params: { listId: item.id } })}
          >
            <Text style={styles.conjBtnText}>Review this list</Text>
          </TouchableOpacity>
        </View>
      )}
      ListFooterComponent={
        <TouchableOpacity style={styles.newListBtn} onPress={() => openCreateList()}>
          <Text style={styles.newListBtnText}>+ New list</Text>
        </TouchableOpacity>
      }
    />
  );

  // ── Cost page ───────────────────────────────────────────────────────────────
  const costTotalCost = costEvents.reduce((sum, e) => sum + e.cost, 0);
  const costTotalInputCredits = costEvents.reduce((sum, e) => sum + e.inputCredits, 0);
  const costTotalOutputCredits = costEvents.reduce((sum, e) => sum + e.outputCredits, 0);
  const costSources = SOURCE_ORDER.filter((src) => costEvents.some((e) => e.source === src));

  const costPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={costEvents.length === 0 ? styles.emptyContainer : styles.listContent}
      data={costEvents}
      keyExtractor={(e) => e.id}
      ListHeaderComponent={
        <View>
          <View style={styles.statsBanner}>
            <View style={styles.statsTopRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatCost(costTotalCost)}</Text>
                <Text style={styles.statLabel}>total cost</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatTokens(costTotalInputCredits)}</Text>
                <Text style={styles.statLabel}>input credits</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatTokens(costTotalOutputCredits)}</Text>
                <Text style={styles.statLabel}>output credits</Text>
              </View>
            </View>
          </View>
          <View style={styles.langFilterRow}>
            {COST_TIME_RANGES.map((range, i) => (
              <TouchableOpacity
                key={range.label}
                style={[styles.langFilterChip, costRangeIndex === i && styles.langFilterChipActive]}
                onPress={() => setCostRangeIndex(i)}
              >
                <Text style={[styles.langFilterText, costRangeIndex === i && styles.langFilterTextActive]}>
                  {range.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {costSources.length > 1 && (
            <View style={styles.langFilterRow}>
              <TouchableOpacity
                style={[styles.langFilterChip, !costSourceFilter && styles.langFilterChipActive]}
                onPress={() => setCostSourceFilter(null)}
              >
                <Text style={[styles.langFilterText, !costSourceFilter && styles.langFilterTextActive]}>All</Text>
              </TouchableOpacity>
              {costSources.map((src) => (
                <TouchableOpacity
                  key={src}
                  style={[styles.langFilterChip, costSourceFilter === src && styles.langFilterChipActive]}
                  onPress={() => setCostSourceFilter(src)}
                >
                  <Text style={[styles.langFilterText, costSourceFilter === src && styles.langFilterTextActive]}>
                    {SOURCE_LABELS[src]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💳</Text>
          <Text style={styles.emptyTitle}>No costs recorded</Text>
          <Text style={styles.emptySubtitle}>Nothing for this filter yet.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.costEventCard}>
          <View style={styles.costEventRow}>
            <Text style={styles.costEventSource}>{SOURCE_LABELS[item.source] ?? item.source}</Text>
            <Text style={styles.costEventCost}>{formatCost(item.cost)}</Text>
          </View>
          <Text style={styles.costEventMeta}>
            {item.model} · {formatTokens(item.inputCredits)} in / {formatTokens(item.outputCredits)} out
            {item.language ? ` · ${getLanguageName(item.language)}` : ''}
          </Text>
          <Text style={styles.costEventDate}>{formatDate(item.createdAt)}</Text>
        </View>
      )}
    />
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appName}>LinguaNews</Text>
        <TouchableOpacity onPress={() => router.push('/settings')} hitSlop={12}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === i && styles.tabActive]}
            onPress={() => scrollToTab(i)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Pager */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleScroll}
        style={styles.pager}
        keyboardShouldPersistTaps="always"
      >
        {translatePage}
        {articlesPage}
        {vocabPage}
        {reviewPage}
        {costPage}
      </ScrollView>

      {/* Regen loading overlay */}
      {regenLoading && (
        <View style={styles.regenOverlay}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.regenText}>Generating vocab…</Text>
        </View>
      )}

      {/* Conjugation modal (vocab tab) */}
      {conjModal && (
        <ConjugationModal
          visible={!!conjModal}
          infinitive={conjModal.infinitive}
          conjugation={conjModal.conjugation}
          onClose={() => setConjModal(null)}
        />
      )}

      {/* Article long-press context menu */}
      <Modal
        visible={!!contextMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setContextMenu(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setContextMenu(null)} />
        <View style={styles.menuSheet}>
          <View style={styles.menuHandle} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setVocabModalArticle(contextMenu); setContextMenu(null); }}>
            <Text style={styles.menuItemText}>View Vocab</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { const a = contextMenu; setContextMenu(null); handleGenerateVocab(a!); }}>
            <Text style={styles.menuItemText}>Generate Recommended Vocab</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { const a = contextMenu; setContextMenu(null); handleRetranslate(a!); }}>
            <Text style={styles.menuItemText}>Re-translate</Text>
          </TouchableOpacity>
          {contextMenu?.sourceUrl ? (
            <>
              <View style={styles.menuDivider} />
              <TouchableOpacity style={styles.menuItem} onPress={() => { Clipboard.setStringAsync(contextMenu.sourceUrl); setContextMenu(null); }}>
                <Text style={styles.menuItemText}>Copy Link</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <View style={[styles.menuDivider, styles.menuSectionGap]} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { const a = contextMenu; setContextMenu(null); handleDeleteArticle(a!); }}>
            <Text style={[styles.menuItemText, styles.menuItemDestructive]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Article vocab modal */}
      <Modal
        visible={!!vocabModalArticle}
        transparent
        animationType="slide"
        onRequestClose={() => setVocabModalArticle(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setVocabModalArticle(null)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Article Vocab</Text>
          <FlatList
            data={vocabModalArticle?.vocabList ?? []}
            keyExtractor={(w, i) => `${w.word}-${i}`}
            renderItem={({ item: w }) => (
              <View style={styles.modalVocabItem}>
                <View style={styles.vocabWordRow}>
                  <Text style={styles.vocabWord}>{w.word}</Text>
                  {w.partOfSpeech ? <Text style={styles.vocabPos}>{w.partOfSpeech}</Text> : null}
                </View>
                <Text style={styles.vocabDefinition}>{w.definition}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.modalEmpty}>No vocab for this article.</Text>}
            style={styles.modalList}
          />
          <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setVocabModalArticle(null)}>
            <Text style={styles.modalDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Edit notecard modal */}
      <Modal
        visible={!!editingWord}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingWord(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setEditingWord(null)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Edit Notecard</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.editLabel}>Word</Text>
            <TextInput
              style={styles.editInput}
              value={editForm.word}
              onChangeText={(v) => setEditForm({ ...editForm, word: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.editLabel}>Definition</Text>
            <TextInput
              style={[styles.editInput, styles.editInputMultiline]}
              value={editForm.definition}
              onChangeText={(v) => setEditForm({ ...editForm, definition: v })}
              multiline
            />
            <Text style={styles.editLabel}>Part of speech</Text>
            <TextInput
              style={styles.editInput}
              value={editForm.partOfSpeech}
              onChangeText={(v) => setEditForm({ ...editForm, partOfSpeech: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.editLabel}>Gender</Text>
            <TextInput
              style={styles.editInput}
              value={editForm.gender}
              onChangeText={(v) => setEditForm({ ...editForm, gender: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.editLabel}>Article</Text>
            <TextInput
              style={styles.editInput}
              value={editForm.article}
              onChangeText={(v) => setEditForm({ ...editForm, article: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ScrollView>
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.editCancelBtn} onPress={() => setEditingWord(null)}>
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editSaveBtn} onPress={handleSaveEdit} disabled={savingEdit}>
              <Text style={styles.editSaveText}>{savingEdit ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add-to-list picker */}
      <Modal
        visible={!!pickerWord}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerWord(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerWord(null)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Add "{pickerWord?.word}" to a list</Text>
          <FlatList
            data={lists}
            keyExtractor={(l) => l.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerItem} onPress={() => handleAddToList(item.id)}>
                <Text style={styles.pickerItemText}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.modalEmpty}>No lists yet.</Text>}
            style={styles.modalList}
          />
          <TouchableOpacity style={styles.newListBtn} onPress={openCreateListFromPicker}>
            <Text style={styles.newListBtnText}>+ New list</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Create / rename list modal */}
      <Modal
        visible={!!listModal}
        transparent
        animationType="slide"
        onRequestClose={() => setListModal(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setListModal(null)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{listModal?.mode === 'rename' ? 'Rename List' : 'New List'}</Text>
          <Text style={styles.editLabel}>Name</Text>
          <TextInput
            style={styles.editInput}
            value={listForm.name}
            onChangeText={(v) => setListForm({ ...listForm, name: v })}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.editLabel}>Language (optional)</Text>
          <TextInput
            style={styles.editInput}
            value={listForm.language}
            onChangeText={(v) => setListForm({ ...listForm, language: v })}
            placeholder="e.g. es"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.editCancelBtn} onPress={() => setListModal(null)}>
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editSaveBtn} onPress={handleSaveList} disabled={savingList}>
              <Text style={styles.editSaveText}>{savingList ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  pager: { flex: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  appName: { fontSize: 22, fontWeight: '800', color: colors.text },
  settingsIcon: { fontSize: 22, color: colors.textFaint },

  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.chipBg,
    borderRadius: 12,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: { backgroundColor: colors.surface, shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textFaint },
  tabTextActive: { color: colors.text },

  // Pages
  pageContent: { padding: 16, paddingTop: 8 },
  listContent: { padding: 16, paddingTop: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },

  // Translate page
  pasteCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  urlPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.accent,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  urlText: { flex: 1, fontSize: 14, color: colors.text },
  urlPlaceholder: { fontSize: 14, color: colors.textFaint, marginBottom: 12 },
  clearBtn: { padding: 2 },
  clearText: { fontSize: 14, color: colors.textFaint },
  pasteBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pasteBtnText: { fontSize: 15, fontWeight: '700', color: colors.accentText },

  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  langCol: { flex: 1 },
  arrow: { fontSize: 20, color: colors.textFaint, marginTop: 16 },

  difficultyCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  difficultyBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  difficultyBtnActive: {
    backgroundColor: colors.accent,
  },
  difficultyText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  difficultyTextActive: {
    color: colors.accentText,
  },
  translateBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  translateBtnText: { fontSize: 17, fontWeight: '800', color: colors.accentText, letterSpacing: 0.3 },
  loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 14 },
  loadingText: { fontSize: 15, color: colors.textMuted },

  // Articles page
  emptyState: { alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  emptySubtitle: { fontSize: 14, color: colors.textFaint, textAlign: 'center', lineHeight: 20 },

  statsBanner: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statsTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  articleCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  articleMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  articleLang: { fontSize: 12, fontWeight: '700', color: colors.accent },
  articleDate: { fontSize: 12, color: colors.textFaint },
  articleUrl: { fontSize: 12, color: colors.textFaint, marginBottom: 6 },
  articlePreview: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  articleCost: { fontSize: 11, color: colors.textFaint, marginTop: 6 },

  // Cost page
  costEventCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: colors.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  costEventRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  costEventSource: { fontSize: 14, fontWeight: '700', color: colors.text },
  costEventCost: { fontSize: 14, fontWeight: '700', color: colors.accent },
  costEventMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  costEventDate: { fontSize: 11, color: colors.textFaint, marginTop: 2 },

  // Review page
  reviewCta: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  reviewCtaText: { fontSize: 16, fontWeight: '800', color: colors.accentText },
  newListBtn: {
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newListBtnText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  pickerItem: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerItemText: { fontSize: 16, color: colors.text },

  // Vocab page
  vocabSearchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: colors.surface,
    color: colors.text,
    marginBottom: 12,
  },
  langFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  langFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.chipBg,
  },
  exportBtn: {
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  exportBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },
  langFilterChipActive: { backgroundColor: colors.accent },
  langFilterText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  langFilterTextActive: { color: colors.accentText },
  vocabCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  vocabHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  vocabWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  vocabWord: { fontSize: 18, fontWeight: '700', color: colors.text },
  vocabPos: {
    fontSize: 12,
    color: colors.textFaint,
    fontStyle: 'italic',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  vocabCardActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vocabSpeak: { fontSize: 15, padding: 2 },
  vocabEdit: { fontSize: 15, color: colors.textFaint, padding: 2 },
  vocabRemove: { fontSize: 16, color: colors.textFaint, padding: 2 },
  vocabDefinition: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  conjugationBox: {
    marginTop: 10,
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  vocabGender: {
    fontSize: 12, color: colors.accent, fontStyle: 'italic',
    backgroundColor: colors.accentSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  conjBtn: {
    marginTop: 10, borderWidth: 1.5, borderColor: colors.accent,
    borderRadius: 8, paddingVertical: 7, alignItems: 'center',
  },
  conjBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },

  // Regen loading overlay
  regenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  regenText: { fontSize: 15, color: '#fff', fontWeight: '600' },

  // Context menu
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    paddingTop: 12,
    overflow: 'hidden',
  },
  menuHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 8,
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  menuItemText: { fontSize: 16, color: colors.text },
  menuItemDestructive: { color: colors.danger },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 24 },
  menuSectionGap: { marginTop: 8 },

  // Vocab modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  modalList: { maxHeight: 420 },
  modalVocabItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalEmpty: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 20 },
  modalDoneBtn: {
    marginTop: 16, backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  modalDoneBtnText: { fontSize: 15, fontWeight: '700', color: colors.accentText },

  // Edit notecard modal
  editLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textFaint, textTransform: 'uppercase',
    letterSpacing: 0.6, marginTop: 14, marginBottom: 6,
  },
  editInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
    backgroundColor: colors.surfaceAlt, color: colors.text,
  },
  editInputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  editCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.chipBg,
  },
  editCancelText: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  editSaveBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.accent,
  },
  editSaveText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
});
