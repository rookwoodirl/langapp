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
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArticle } from '../hooks/useArticle';
import LanguagePicker from '../components/LanguagePicker';
import { UserSettings, Article, UserVocabWord, DifficultyLevel, NotecardList } from '../types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE, DEFAULT_NATIVE_LANGUAGE, DIFFICULTIES, getLanguageName, getLearningLanguage } from '../constants/languages';
import { useArticleStore } from '../store/articleStore';
import { useVocabStore } from '../store/vocabStore';
import { useNotecardStore } from '../store/notecardStore';
import { useChatStore } from '../store/chatStore';
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
import WheelPicker from '../components/WheelPicker';

const WHEEL_YEAR_START = 2020;
const WHEEL_YEAR_END = new Date().getFullYear() + 1;
const WHEEL_YEAR_ITEMS = Array.from(
  { length: WHEEL_YEAR_END - WHEEL_YEAR_START + 1 },
  (_, i) => String(WHEEL_YEAR_START + i)
);
const WHEEL_MONTH_ITEMS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type VocabFilter =
  | { type: 'language'; value: string }
  | { type: 'contains'; value: string }
  | { type: 'before'; value: string }
  | { type: 'after'; value: string };

const SETTINGS_KEY = '@linguanews/settings';
const CONFIRMED_DEVICE_PAIRS_KEY = '@linguanews/confirmed_device_pairs';

// react-native-web's Alert.alert is a no-op (it never shows buttons or calls onPress),
// so anything with an actionable button needs a window.confirm/alert fallback on web.
function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : undefined, onPress: onConfirm },
  ]);
}

function notifyWeb(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

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
    nativeLanguage: DEFAULT_NATIVE_LANGUAGE,
    difficulty: 'intermediate',
  });

  const { fetchArticle, isLoading, loadingStep, error, currentArticle } = useArticle();
  const pendingSourceRef = useRef<'article' | 'article-regeneration'>('article');
  const { savedArticles, loadSavedArticles, setCurrentArticle, deleteArticle } = useArticleStore();
  const { words: vocabWords, loadVocab, removeWord, addWord, updateWord } = useVocabStore();
  const { lists, loadLists, createList, updateList, deleteList, addToList, loadListItems, currentListItems } = useNotecardStore();
  const { sessions: chatSessions, load: loadChatSessions, deleteSession } = useChatStore();
  const [reviewSection, setReviewSection] = useState<'menu' | 'srs'>('menu');

  const { load: loadUsage } = useUsageStore();

  const [vocabModalArticle, setVocabModalArticle] = useState<Article | null>(null);
  const [contextMenu, setContextMenu] = useState<Article | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [conjModal, setConjModal] = useState<{ infinitive: string; conjugation: VerbConjugation } | null>(null);
  const [vocabFilters, setVocabFilters] = useState<VocabFilter[]>([]);
  const [showVocabFilters, setShowVocabFilters] = useState(false);
  const [filterModalPage, setFilterModalPage] = useState<'list' | 'pick' | VocabFilter['type']>('list');
  const [filterInputValue, setFilterInputValue] = useState('');
  const [filterYear, setFilterYear] = useState(() => new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState(() => new Date().getMonth() + 1);
  const [filterDay, setFilterDay] = useState(() => new Date().getDate());
  const [editingWord, setEditingWord] = useState<UserVocabWord | null>(null);
  const [editForm, setEditForm] = useState({ word: '', definition: '', partOfSpeech: '', gender: '', article: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [reviewLangFilter, setReviewLangFilter] = useState<string | null>(null);
  const [pickerWord, setPickerWord] = useState<UserVocabWord | null>(null);
  const [listModal, setListModal] = useState<{ mode: 'create' | 'rename'; list?: NotecardList } | null>(null);
  const [listForm, setListForm] = useState({ name: '', language: '' });
  const [pendingAddWord, setPendingAddWord] = useState<UserVocabWord | null>(null);
  const [createVocabModal, setCreateVocabModal] = useState(false);
  const [createVocabForm, setCreateVocabForm] = useState({
    word: '', wordLanguage: DEFAULT_TARGET_LANGUAGE, definitionLanguage: DEFAULT_NATIVE_LANGUAGE,
    definition: '', partOfSpeech: '', gender: '', article: '',
  });
  const [createVocabConjugation, setCreateVocabConjugation] = useState<VerbConjugation | undefined>(undefined);
  const [createVocabLookupLoading, setCreateVocabLookupLoading] = useState(false);
  const [savingCreateVocab, setSavingCreateVocab] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [viewingList, setViewingList] = useState<NotecardList | null>(null);
  const [listBrowseLoading, setListBrowseLoading] = useState(false);
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

  function addVocabFilter(filter: VocabFilter) {
    setVocabFilters((prev) => {
      if (filter.type === 'contains') return [...prev, filter];
      return [...prev.filter((f) => f.type !== filter.type), filter];
    });
  }

  function removeVocabFilter(index: number) {
    setVocabFilters((prev) => prev.filter((_, i) => i !== index));
  }

  function vocabFilterLabel(f: VocabFilter): string {
    if (f.type === 'language') return `Language: ${getLanguageName(f.value)}`;
    if (f.type === 'contains') return `Contains: "${f.value}"`;
    if (f.type === 'before') return `Before: ${f.value}`;
    if (f.type === 'after') return `After: ${f.value}`;
    return '';
  }

  function filterTypeLabel(type: VocabFilter['type']): string {
    switch (type) {
      case 'language': return 'Language';
      case 'contains': return 'Contains keyword';
      case 'before': return 'Added before date';
      case 'after': return 'Added after date';
    }
  }

  function handleAddCurrentFilter() {
    const type = filterModalPage as VocabFilter['type'];
    if (type === 'contains') {
      if (!filterInputValue.trim()) return;
      addVocabFilter({ type: 'contains', value: filterInputValue.trim() });
      setFilterInputValue('');
    } else if (type === 'before' || type === 'after') {
      const dateStr = `${filterYear}-${String(filterMonth).padStart(2, '0')}-${String(filterDay).padStart(2, '0')}`;
      addVocabFilter({ type, value: dateStr });
    }
    setFilterModalPage('list');
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

  function openCreateVocabModal() {
    setCreateVocabForm({
      word: '',
      wordLanguage: settings.targetLanguage,
      definitionLanguage: settings.nativeLanguage ?? 'en',
      definition: '', partOfSpeech: '', gender: '', article: '',
    });
    setCreateVocabConjugation(undefined);
    setCreateVocabModal(true);
  }

  async function handleAutoFillCreateVocab() {
    const word = createVocabForm.word.trim();
    if (!word) {
      Alert.alert('Enter a word first', 'Type the word you want to look up.');
      return;
    }
    setCreateVocabLookupLoading(true);
    try {
      const lookup = await lookupWordDefinition(word, createVocabForm.wordLanguage, createVocabForm.definitionLanguage);
      useUsageStore.getState().addVocab(lookup.inputTokens, lookup.outputTokens);
      const isVerb = lookup.partOfSpeech?.toLowerCase().includes('verb');
      const wordCandidate = lookup.infinitive ?? word;
      const conjugation = isVerb
        ? (await getVerbConjugation(wordCandidate, createVocabForm.wordLanguage)) ?? undefined
        : undefined;
      setCreateVocabConjugation(conjugation);
      setCreateVocabForm((prev) => ({
        ...prev,
        word: conjugation?.infinitive ?? lookup.infinitive ?? prev.word,
        definition: lookup.definition ?? prev.definition,
        partOfSpeech: lookup.partOfSpeech ?? prev.partOfSpeech,
        gender: lookup.gender ?? prev.gender,
        article: lookup.article ?? prev.article,
      }));
    } catch (err) {
      Alert.alert('Lookup failed', err instanceof Error ? err.message : 'Could not look up this word.');
    } finally {
      setCreateVocabLookupLoading(false);
    }
  }

  async function handleSaveCreateVocab() {
    const word = createVocabForm.word.trim();
    if (!word) {
      Alert.alert('Word required', 'Enter a word before saving.');
      return;
    }
    if (!createVocabForm.definition.trim()) {
      Alert.alert('Definition required', 'Enter a definition, or tap Auto-fill to look one up.');
      return;
    }
    setSavingCreateVocab(true);
    try {
      await addWord({
        word,
        language: createVocabForm.wordLanguage,
        definition: createVocabForm.definition.trim(),
        partOfSpeech: createVocabForm.partOfSpeech.trim() || undefined,
        gender: createVocabForm.gender.trim() || undefined,
        article: createVocabForm.article.trim() || undefined,
        conjugation: createVocabConjugation,
      });
      setCreateVocabForm((prev) => ({
        ...prev,
        word: '', definition: '', partOfSpeech: '', gender: '', article: '',
      }));
      setCreateVocabConjugation(undefined);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save word.');
    } finally {
      setSavingCreateVocab(false);
    }
  }

  useEffect(() => { loadUsage(); }, []);

  useFocusEffect(
    React.useCallback(() => {
      AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
        if (!raw) return;
        try {
          setSettings((prev) => ({ ...prev, ...JSON.parse(raw) }));
        } catch {
          // Corrupted settings — ignore and keep current in-memory settings
        }
      });
    }, []),
  );

  // No auto-navigate: translation now starts a background job on the server.
  // Navigation is handled explicitly in handleTranslate.

  useEffect(() => {
    if (error) Alert.alert('Error', error);
  }, [error]);

  // Load data when switching tabs
  useEffect(() => {
    if (activeTab === 1) loadSavedArticles();
    if (activeTab === 2) loadVocab();
    if (activeTab === 3) { loadLists(); loadChatSessions(); }
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
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setUrl(text.trim());
      } else {
        Alert.alert('Nothing to paste', 'Your clipboard is empty.');
      }
    } catch {
      Alert.alert('Paste unavailable', 'Your browser blocked clipboard access. You can type or paste the URL directly into the field instead.');
    }
  }

  async function handleTranslate() {
    if (!url.trim()) {
      notifyWeb('Paste a URL first', 'Tap the Paste button to load a link from your clipboard.');
      return;
    }
    const src = pendingSourceRef.current;
    pendingSourceRef.current = 'article';
    const usingLLM = settings.useLLM !== false;

    async function doTranslate() {
      await fetchArticle(url.trim(), true, settings, src);
      if (useArticleStore.getState().error) return;
      confirmAction(
        'Translation started',
        'Your article is being translated sentence by sentence. It will appear in the Articles section as it comes in.',
        'Go to Articles',
        () => { scrollToTab(1); loadSavedArticles(); },
      );
    }

    if (!usingLLM) {
      const pairKey = `${settings.sourceLanguage}|${settings.targetLanguage}`;
      const raw = await AsyncStorage.getItem(CONFIRMED_DEVICE_PAIRS_KEY);
      const confirmed: string[] = raw ? JSON.parse(raw) : [];
      if (!confirmed.includes(pairKey)) {
        const fromName = getLanguageName(settings.sourceLanguage);
        const toName = getLanguageName(settings.targetLanguage);
        confirmAction(
          'Set up language pair?',
          `Enable on-device translation for ${fromName} → ${toName}? When you later move to native builds, a language pack (~30MB) will be downloaded here once per pair.`,
          'Enable',
          async () => {
            await AsyncStorage.setItem(
              CONFIRMED_DEVICE_PAIRS_KEY,
              JSON.stringify([...confirmed, pairKey]),
            );
            doTranslate();
          },
        );
        return;
      }
    }

    doTranslate();
  }

  async function handleGenerateVocab(article: Article) {
    setRegenLoading(true);
    try {
      const existing = vocabWords.map((w) => w.word);
      const nativeLanguage = settings.nativeLanguage ?? 'en';
      const learningLanguage = getLearningLanguage(article.sourceLanguage, article.targetLanguage, nativeLanguage);
      const articleText = (
        learningLanguage === article.sourceLanguage
          ? article.sentencePairs.map((p) => p.original)
          : article.sentencePairs.map((p) => p.translation)
      ).join(' ');

      // Step 1: pick words (cheap selection call)
      const selection = await selectVocabWords(
        articleText, learningLanguage, nativeLanguage, existing
      );
      useUsageStore.getState().addVocab(selection.inputTokens, selection.outputTokens);

      // Step 2: look up each word through the same pipeline as word taps
      const lookups = await Promise.all(
        selection.words.map((word) =>
          lookupWordDefinition(word, learningLanguage, nativeLanguage, articleText)
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
            ? (await getVerbConjugation(wordCandidate, learningLanguage)) ?? undefined
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
            language: learningLanguage,
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

  async function handleViewList(list: NotecardList) {
    setViewingList(list);
    setListBrowseLoading(true);
    try {
      await loadListItems(list.id);
    } finally {
      setListBrowseLoading(false);
    }
  }

  async function handleDeleteArticle(article: Article) {
    confirmAction(
      'Delete article?',
      'This cannot be undone.',
      'Delete',
      async () => {
        try { await deleteArticle(article.id); }
        catch { notifyWeb('Error', 'Could not delete article.'); }
      },
      true,
    );
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
      {/* Article URL */}
      <View style={styles.pasteCard}>
        <Text style={styles.cardLabel}>Article URL</Text>
        <View style={styles.urlInputRow}>
          <TextInput
            style={styles.urlInput}
            value={url}
            onChangeText={setUrl}
            placeholder="Paste or type an article URL"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {url ? (
            <TouchableOpacity onPress={() => setUrl('')} hitSlop={8} style={styles.clearBtn}>
              <Text style={styles.clearText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste} activeOpacity={0.8}>
          <Text style={styles.pasteBtnText}>Paste from clipboard</Text>
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

      <View style={styles.difficultyCard}>
        <View style={styles.translationModeHeader}>
          <Text style={styles.cardLabel}>Translation</Text>
          <TouchableOpacity
            hitSlop={8}
            onPress={() => Alert.alert(
              'Translation mode',
              'On-device translation is free but may be less accurate.\n\nLLM translation (Claude) produces higher quality results but has an associated cost per article.',
            )}
          >
            <Text style={styles.infoIcon}>ⓘ</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.difficultyRow}>
          {([['llm', 'Claude (LLM)'], ['device', 'On-device (free)']] as const).map(([mode, label]) => {
            const active = mode === 'llm' ? settings.useLLM !== false : settings.useLLM === false;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.difficultyBtn, active && styles.difficultyBtnActive]}
                onPress={() => updateSetting('useLLM', mode === 'llm')}
                activeOpacity={0.75}
              >
                <Text style={[styles.difficultyText, active && styles.difficultyTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
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
            {item.title ? (
              <Text style={styles.articleTitle} numberOfLines={2}>{item.title}</Text>
            ) : null}
            {item.status === 'translating' ? (
              <Text style={styles.articleTranslating}>Translating…</Text>
            ) : item.status === 'error' ? (
              <Text style={[styles.articlePreview, { color: colors.danger }]} numberOfLines={1}>
                Translation failed
              </Text>
            ) : (
              <Text style={styles.articlePreview} numberOfLines={3}>
                {item.sentencePairs.map((p) => p.translation).join(' ')}
              </Text>
            )}
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
  const daysInMonth = new Date(filterYear, filterMonth, 0).getDate();
  const dayItems = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0')),
    [daysInMonth]
  );
  useEffect(() => {
    setFilterDay((d) => Math.min(d, daysInMonth));
  }, [daysInMonth]);
  const filteredVocabWords = vocabWords.filter((w) => {
    for (const f of vocabFilters) {
      if (f.type === 'language' && w.language !== f.value) return false;
      if (f.type === 'contains') {
        const term = f.value.toLowerCase();
        if (!w.word.toLowerCase().includes(term) && !w.definition.toLowerCase().includes(term)) return false;
      }
      if (f.type === 'before') {
        const cutoff = new Date(f.value).getTime();
        if (w.addedAt >= cutoff) return false;
      }
      if (f.type === 'after') {
        const cutoff = new Date(f.value).getTime();
        if (w.addedAt <= cutoff) return false;
      }
    }
    return true;
  });

  const vocabPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={filteredVocabWords.length === 0 ? styles.emptyContainer : styles.listContent}
      data={filteredVocabWords}
      keyExtractor={(w) => w.id}
      ListHeaderComponent={
        <View>
          <TouchableOpacity style={styles.createVocabBtn} onPress={openCreateVocabModal}>
            <Text style={styles.createVocabBtnText}>+ Create vocab</Text>
          </TouchableOpacity>
          {vocabFilters.length > 0 && (
            <View style={styles.langFilterRow}>
              {vocabFilters.map((f, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.langFilterChip, styles.langFilterChipActive]}
                  onPress={() => removeVocabFilter(i)}
                >
                  <Text style={[styles.langFilterText, styles.langFilterTextActive]}>
                    {vocabFilterLabel(f)} ×
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {vocabWords.length > 0 && (
            <View style={styles.vocabActionRow}>
              <TouchableOpacity
                style={[styles.exportBtn, { flex: 1 }]}
                onPress={() => handleExportToAnki(filteredVocabWords)}
              >
                <Text style={styles.exportBtnText}>Export to Anki ({filteredVocabWords.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.exportBtn, styles.filtersBtn]}
                onPress={() => setShowVocabFilters(true)}
              >
                <Text style={styles.exportBtnText}>
                  Filters{vocabFilters.length > 0 ? ` (${vocabFilters.length})` : ''}
                </Text>
              </TouchableOpacity>
            </View>
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
              : 'Try adjusting or removing your filters.'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.vocabCard}>
          <View style={styles.vocabCardBody}>
            <View style={styles.vocabCardLeft}>
              <View style={styles.vocabWordRow}>
                <Text style={styles.vocabWord}>
                  {item.article ? `${item.article} ` : ''}{item.word}
                </Text>
                {item.partOfSpeech ? <Text style={styles.vocabPos}>{item.partOfSpeech}</Text> : null}
                {item.gender ? <Text style={styles.vocabGender}>{item.gender}</Text> : null}
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
            <View style={styles.vocabIconGrid}>
              <View style={styles.vocabActionsRow}>
                <TouchableOpacity onPress={() => openEditModal(item)} hitSlop={8}>
                  <Text style={styles.vocabEdit}>✎</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeWord(item.id)} hitSlop={8}>
                  <Text style={styles.vocabRemove}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.vocabActionsRow}>
                <TouchableOpacity onPress={() => ttsService.speak(item.word, item.language)} hitSlop={8}>
                  <Text style={styles.vocabSpeak}>🔊</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPickerWord(item)} hitSlop={8}>
                  <Text style={styles.vocabEdit}>📋</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}
    />
  );

  // ── Review page ─────────────────────────────────────────────────────────────
  const reviewMenuPage = (
    <ScrollView style={{ width }} nestedScrollEnabled contentContainerStyle={styles.listContent}>
      <TouchableOpacity
        style={styles.reviewMenuCard}
        onPress={() => setReviewSection('srs')}
        activeOpacity={0.8}
      >
        <Text style={styles.reviewMenuIcon}>🧠</Text>
        <View style={styles.reviewMenuTextCol}>
          <Text style={styles.reviewMenuTitle}>Spaced Repetition</Text>
          <Text style={styles.reviewMenuSubtitle}>Review due flashcards from your saved vocab.</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.reviewMenuCard}
        onPress={() => router.push({ pathname: '/chat-setup', params: { mode: 'article' } })}
        activeOpacity={0.8}
      >
        <Text style={styles.reviewMenuIcon}>💬</Text>
        <View style={styles.reviewMenuTextCol}>
          <Text style={styles.reviewMenuTitle}>Chat about Article</Text>
          <Text style={styles.reviewMenuSubtitle}>Discuss one of your saved articles with an AI partner.</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.reviewMenuCard}
        onPress={() => router.push({ pathname: '/chat-setup', params: { mode: 'vocab' } })}
        activeOpacity={0.8}
      >
        <Text style={styles.reviewMenuIcon}>📚</Text>
        <View style={styles.reviewMenuTextCol}>
          <Text style={styles.reviewMenuTitle}>Chat through Vocab</Text>
          <Text style={styles.reviewMenuSubtitle}>Practice a conversation built around a vocab list.</Text>
        </View>
      </TouchableOpacity>

      {chatSessions.length > 0 && (
        <>
          <Text style={styles.cardLabel}>Recent chats</Text>
          {chatSessions.map((session) => (
            <TouchableOpacity
              key={session.id}
              style={styles.vocabCard}
              onPress={() => router.push(`/chat/${session.id}`)}
              activeOpacity={0.8}
            >
              <View style={styles.vocabHeader}>
                <View style={styles.vocabWordRow}>
                  <Text style={styles.vocabWord}>
                    {session.mode === 'article' ? (session.articleTitle ?? 'Article chat') : (session.vocabLabel ?? 'Vocab chat')}
                  </Text>
                </View>
                <View style={styles.vocabCardActions}>
                  <TouchableOpacity onPress={() => deleteSession(session.id)} hitSlop={8}>
                    <Text style={styles.vocabRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.vocabDefinition}>
                {session.difficulty.charAt(0).toUpperCase() + session.difficulty.slice(1)}
                {session.messages.length > 0 ? ` · ${session.messages[session.messages.length - 1].content.slice(0, 60)}` : ' · No messages yet'}
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );

  const reviewSrsPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={lists.length === 0 ? styles.emptyContainer : styles.listContent}
      data={lists}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={
        <View>
          <TouchableOpacity style={styles.reviewBackBtn} onPress={() => setReviewSection('menu')}>
            <Text style={styles.reviewBackText}>‹ Review options</Text>
          </TouchableOpacity>
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
        <TouchableOpacity style={styles.vocabCard} onPress={() => handleViewList(item)} activeOpacity={0.8}>
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
        </TouchableOpacity>
      )}
      ListFooterComponent={
        <TouchableOpacity style={styles.newListBtn} onPress={() => openCreateList()}>
          <Text style={styles.newListBtnText}>+ New list</Text>
        </TouchableOpacity>
      }
    />
  );

  const reviewPage = reviewSection === 'menu' ? reviewMenuPage : reviewSrsPage;

  // ── Cost page ───────────────────────────────────────────────────────────────
  // Aggregate article events by articleId so each article = 1 row.
  // Events without an articleId (old data) are kept as-is.
  const aggregatedCostEvents = useMemo(() => {
    const articleGroups = new Map<string, CostEvent>();
    const result: (CostEvent & { isAggregated?: boolean })[] = [];
    for (const e of costEvents) {
      if (e.source === 'article' && e.articleId) {
        const existing = articleGroups.get(e.articleId);
        if (existing) {
          existing.inputCredits += e.inputCredits;
          existing.outputCredits += e.outputCredits;
          existing.cost += e.cost;
          // Keep most recent date
          if (e.createdAt > existing.createdAt) existing.createdAt = e.createdAt;
        } else {
          const agg = { ...e, isAggregated: true };
          articleGroups.set(e.articleId, agg);
          result.push(agg);
        }
      } else {
        result.push(e);
      }
    }
    return result;
  }, [costEvents]);

  const costTotalCost = costEvents.reduce((sum, e) => sum + e.cost, 0);
  const costTotalInputCredits = costEvents.reduce((sum, e) => sum + e.inputCredits, 0);
  const costTotalOutputCredits = costEvents.reduce((sum, e) => sum + e.outputCredits, 0);
  const costSources = SOURCE_ORDER.filter((src) => costEvents.some((e) => e.source === src));

  const costPage = (
    <FlatList
      style={{ width }}
      nestedScrollEnabled
      contentContainerStyle={aggregatedCostEvents.length === 0 ? styles.emptyContainer : styles.listContent}
      data={aggregatedCostEvents}
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
          {item.description ? (
            <Text style={styles.costEventDescription} numberOfLines={1}>{item.description}</Text>
          ) : null}
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

      {/* Create vocab modal */}
      <Modal
        visible={createVocabModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateVocabModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCreateVocabModal(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Create Vocab</Text>
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.editCancelBtn} onPress={() => setCreateVocabModal(false)}>
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editSaveBtn} onPress={handleSaveCreateVocab} disabled={savingCreateVocab}>
              <Text style={styles.editSaveText}>{savingCreateVocab ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.createVocabLangRow}>
              <View style={{ flex: 1 }}>
                <LanguagePicker
                  label="Word language"
                  value={createVocabForm.wordLanguage}
                  onChange={(v) => setCreateVocabForm({ ...createVocabForm, wordLanguage: v })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <LanguagePicker
                  label="Definition language"
                  value={createVocabForm.definitionLanguage}
                  onChange={(v) => setCreateVocabForm({ ...createVocabForm, definitionLanguage: v })}
                />
              </View>
            </View>
            <Text style={styles.editLabel}>Word</Text>
            <TextInput
              style={styles.editInput}
              value={createVocabForm.word}
              onChangeText={(v) => setCreateVocabForm({ ...createVocabForm, word: v })}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. correr"
              placeholderTextColor={colors.textFaint}
            />
            <TouchableOpacity
              style={styles.createVocabAutoBtn}
              onPress={handleAutoFillCreateVocab}
              disabled={createVocabLookupLoading}
            >
              <Text style={styles.createVocabAutoBtnText}>
                {createVocabLookupLoading ? 'Looking up…' : 'Auto-fill from Wiktionary'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.editLabel}>Definition</Text>
            <TextInput
              style={[styles.editInput, styles.editInputMultiline]}
              value={createVocabForm.definition}
              onChangeText={(v) => setCreateVocabForm({ ...createVocabForm, definition: v })}
              multiline
            />
            <Text style={styles.editLabel}>Part of speech</Text>
            <TextInput
              style={styles.editInput}
              value={createVocabForm.partOfSpeech}
              onChangeText={(v) => setCreateVocabForm({ ...createVocabForm, partOfSpeech: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.editLabel}>Gender</Text>
            <TextInput
              style={styles.editInput}
              value={createVocabForm.gender}
              onChangeText={(v) => setCreateVocabForm({ ...createVocabForm, gender: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.editLabel}>Article</Text>
            <TextInput
              style={styles.editInput}
              value={createVocabForm.article}
              onChangeText={(v) => setCreateVocabForm({ ...createVocabForm, article: v })}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ScrollView>
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.editCancelBtn} onPress={() => setCreateVocabModal(false)}>
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editSaveBtn} onPress={handleSaveCreateVocab} disabled={savingCreateVocab}>
              <Text style={styles.editSaveText}>{savingCreateVocab ? 'Saving…' : 'Save'}</Text>
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

      {/* List browse modal */}
      <Modal
        visible={!!viewingList}
        transparent
        animationType="slide"
        onRequestClose={() => setViewingList(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setViewingList(null)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{viewingList?.name}</Text>
          {listBrowseLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 32 }} />
          ) : (
            <FlatList
              data={currentListItems}
              keyExtractor={(w) => w.id}
              renderItem={({ item: w }) => (
                <View style={styles.modalVocabItem}>
                  <View style={styles.vocabWordRow}>
                    <Text style={styles.vocabWord}>{w.article ? `${w.article} ` : ''}{w.word}</Text>
                    {w.partOfSpeech ? <Text style={styles.vocabPos}>{w.partOfSpeech}</Text> : null}
                    {w.gender ? <Text style={styles.vocabGender}>{w.gender}</Text> : null}
                  </View>
                  <Text style={styles.vocabDefinition}>{w.definition}</Text>
                  {w.conjugation && (
                    <TouchableOpacity
                      style={styles.conjBtn}
                      onPress={() => setConjModal({ infinitive: w.conjugation!.infinitive, conjugation: w.conjugation! })}
                    >
                      <Text style={styles.conjBtnText}>Conjugations</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              ListEmptyComponent={<Text style={styles.modalEmpty}>No words in this list yet.</Text>}
              style={styles.modalList}
            />
          )}
          <TouchableOpacity
            style={styles.modalDoneBtn}
            onPress={() => {
              const id = viewingList!.id;
              setViewingList(null);
              router.push({ pathname: '/review', params: { listId: id } });
            }}
          >
            <Text style={styles.modalDoneBtnText}>Review this list</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.editCancelBtn, { marginTop: 10 }]} onPress={() => setViewingList(null)}>
            <Text style={styles.editCancelText}>Done</Text>
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
      {/* Vocab filters modal */}
      <Modal
        visible={showVocabFilters}
        transparent
        animationType="slide"
        onRequestClose={() => setShowVocabFilters(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => { setShowVocabFilters(false); setFilterModalPage('list'); }} />
        <View style={styles.filtersSheet}>
          <View style={styles.modalHandle} />

          {/* Page: filter list */}
          {filterModalPage === 'list' && (
            <>
              <View style={styles.filtersSheetHeader}>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>Filters</Text>
                <TouchableOpacity onPress={() => { setShowVocabFilters(false); setFilterModalPage('list'); }}>
                  <Text style={styles.filterDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                {vocabFilters.length === 0 ? (
                  <Text style={styles.filterEmptyText}>No filters active</Text>
                ) : (
                  vocabFilters.map((f, i) => (
                    <View key={i} style={styles.filterRow}>
                      <Text style={styles.filterRowText}>{vocabFilterLabel(f)}</Text>
                      <TouchableOpacity onPress={() => removeVocabFilter(i)} hitSlop={8}>
                        <Text style={styles.filterRowRemove}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </ScrollView>
              <TouchableOpacity
                style={styles.filterAddFilterBtn}
                onPress={() => { setFilterInputValue(''); setFilterModalPage('pick'); }}
              >
                <Text style={styles.filterAddFilterBtnText}>+ Add filter</Text>
              </TouchableOpacity>
              {vocabFilters.length > 0 && (
                <TouchableOpacity onPress={() => setVocabFilters([])} style={{ marginTop: 12 }}>
                  <Text style={[styles.filterSectionLabel, { color: colors.danger, textAlign: 'center' }]}>
                    Clear all
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Page: pick filter type */}
          {filterModalPage === 'pick' && (
            <>
              <View style={styles.filtersSheetHeader}>
                <TouchableOpacity onPress={() => setFilterModalPage('list')}>
                  <Text style={styles.filterBackText}>← Back</Text>
                </TouchableOpacity>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>Add filter</Text>
                <View style={{ width: 52 }} />
              </View>
              {(['language', 'contains', 'before', 'after'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={styles.filterTypeRow}
                  onPress={() => { setFilterInputValue(''); setFilterModalPage(type); }}
                >
                  <Text style={styles.filterTypeLabel}>{filterTypeLabel(type)}</Text>
                  <Text style={styles.filterTypeArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {/* Page: enter language value */}
          {filterModalPage === 'language' && (
            <>
              <View style={styles.filtersSheetHeader}>
                <TouchableOpacity onPress={() => setFilterModalPage('pick')}>
                  <Text style={styles.filterBackText}>← Back</Text>
                </TouchableOpacity>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>Language</Text>
                <View style={{ width: 52 }} />
              </View>
              <View style={styles.langFilterRow}>
                {vocabLanguages.map((lang) => (
                  <TouchableOpacity
                    key={lang}
                    style={styles.langFilterChip}
                    onPress={() => {
                      addVocabFilter({ type: 'language', value: lang });
                      setFilterModalPage('list');
                    }}
                  >
                    <Text style={styles.langFilterText}>{getLanguageName(lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Page: enter keyword value */}
          {filterModalPage === 'contains' && (
            <>
              <View style={styles.filtersSheetHeader}>
                <TouchableOpacity onPress={() => setFilterModalPage('pick')}>
                  <Text style={styles.filterBackText}>← Back</Text>
                </TouchableOpacity>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{filterTypeLabel(filterModalPage)}</Text>
                <View style={{ width: 52 }} />
              </View>
              <TextInput
                style={styles.vocabSearchInput}
                placeholder="e.g. essen"
                placeholderTextColor={colors.textFaint}
                value={filterInputValue}
                onChangeText={setFilterInputValue}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onSubmitEditing={handleAddCurrentFilter}
              />
              <TouchableOpacity style={styles.filterAddBtn} onPress={handleAddCurrentFilter}>
                <Text style={styles.filterAddBtnText}>Add filter</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Page: date wheel picker (before / after) */}
          {(filterModalPage === 'before' || filterModalPage === 'after') && (
            <>
              <View style={styles.filtersSheetHeader}>
                <TouchableOpacity onPress={() => setFilterModalPage('pick')}>
                  <Text style={styles.filterBackText}>← Back</Text>
                </TouchableOpacity>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{filterTypeLabel(filterModalPage)}</Text>
                <View style={{ width: 52 }} />
              </View>
              <View style={styles.wheelRow}>
                <WheelPicker
                  key={`year-${filterModalPage}`}
                  items={WHEEL_YEAR_ITEMS}
                  selectedIndex={filterYear - WHEEL_YEAR_START}
                  onChange={(i) => setFilterYear(WHEEL_YEAR_START + i)}
                />
                <WheelPicker
                  key={`month-${filterModalPage}`}
                  items={WHEEL_MONTH_ITEMS}
                  selectedIndex={filterMonth - 1}
                  onChange={(i) => setFilterMonth(i + 1)}
                />
                <WheelPicker
                  key={`day-${filterModalPage}-${daysInMonth}`}
                  items={dayItems}
                  selectedIndex={Math.min(filterDay - 1, daysInMonth - 1)}
                  onChange={(i) => setFilterDay(i + 1)}
                />
              </View>
              <TouchableOpacity style={styles.filterAddBtn} onPress={handleAddCurrentFilter}>
                <Text style={styles.filterAddBtnText}>Add filter</Text>
              </TouchableOpacity>
            </>
          )}
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
  urlInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  urlInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 12 },
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
  translationModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoIcon: { fontSize: 16, color: colors.textFaint, marginTop: -1 },
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
  articleTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4, lineHeight: 20 },
  articlePreview: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  articleTranslating: { fontSize: 14, color: colors.accent, fontStyle: 'italic' },
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
  costEventDescription: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  costEventMeta: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  costEventDate: { fontSize: 11, color: colors.textFaint, marginTop: 2 },

  // Review page
  reviewMenuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
  reviewMenuIcon: { fontSize: 28 },
  reviewMenuTextCol: { flex: 1 },
  reviewMenuTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 2 },
  reviewMenuSubtitle: { fontSize: 13, color: colors.textFaint, lineHeight: 18 },
  reviewBackBtn: { marginBottom: 12 },
  reviewBackText: { fontSize: 14, fontWeight: '600', color: colors.accent },
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
  vocabActionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filtersBtn: { paddingHorizontal: 18, flex: undefined },
  createVocabBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  createVocabBtnText: { fontSize: 13, fontWeight: '700', color: colors.accentText },
  createVocabLangRow: { flexDirection: 'row', gap: 8 },
  createVocabAutoBtn: {
    marginTop: 10, borderWidth: 1.5, borderColor: colors.accent,
    borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  createVocabAutoBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },
  filtersSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  filtersSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  filterDoneText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  filterSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  filterEmptyText: {
    fontSize: 14,
    color: colors.textFaint,
    textAlign: 'center',
    paddingVertical: 24,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterRowText: { fontSize: 15, color: colors.text, flex: 1 },
  filterRowRemove: { fontSize: 20, color: colors.textMuted, paddingLeft: 12 },
  filterAddFilterBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  filterAddFilterBtnText: { fontSize: 14, fontWeight: '700', color: colors.accent },
  filterBackText: { fontSize: 15, fontWeight: '600', color: colors.accent, width: 52 },
  filterTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterTypeLabel: { fontSize: 16, color: colors.text },
  filterTypeArrow: { fontSize: 20, color: colors.textFaint },
  wheelRow: { flexDirection: 'row', gap: 4, marginVertical: 16 },
  filterAddBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  filterAddBtnText: { fontSize: 14, fontWeight: '700', color: colors.accentText },
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
  vocabCardBody: { flexDirection: 'row', alignItems: 'flex-start' },
  vocabCardLeft: { flex: 1, marginRight: 10 },
  vocabIconGrid: { flexDirection: 'column', gap: 8, alignItems: 'flex-end' },
  vocabActionsRow: { flexDirection: 'row', gap: 10 },
  vocabWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
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
