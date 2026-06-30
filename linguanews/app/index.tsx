import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
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
import { UserSettings, Article, UserVocabWord, DifficultyLevel } from '../types';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE } from '../constants/languages';
import { useArticleStore } from '../store/articleStore';
import { useVocabStore } from '../store/vocabStore';
import { calcCost, formatCost, formatTokens } from '../utils/cost';
import { generateRecommendedVocab } from '../services/vocab';
import ConjugationModal from '../components/ConjugationModal';
import { VerbConjugation } from '../types';
import { useUsageStore } from '../store/usageStore';
import { recordApiCost } from '../services/apiCosts';

const DIFFICULTIES: DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];

const SETTINGS_KEY = '@linguanews/settings';

const TABS = ['Translate', 'Articles', 'Vocab'] as const;
type Tab = (typeof TABS)[number];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState<number>(0);

  const [url, setUrl] = useState('');
  const [settings, setSettings] = useState<UserSettings>({
    sourceLanguage: DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    apiKey: '',
    difficulty: 'intermediate',
  });

  const { fetchArticle, isLoading, loadingStep, error, currentArticle } = useArticle();
  const pendingSourceRef = useRef<'article' | 'article-regeneration'>('article');
  const { savedArticles, loadSavedArticles, setCurrentArticle, deleteArticle } = useArticleStore();
  const { words: vocabWords, loadVocab, removeWord, addWord } = useVocabStore();

  const { article: articleUsage, vocab: vocabUsage, audio: audioUsage, load: loadUsage } = useUsageStore();

  const [vocabModalArticle, setVocabModalArticle] = useState<Article | null>(null);
  const [contextMenu, setContextMenu] = useState<Article | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [conjModal, setConjModal] = useState<{ infinitive: string; conjugation: VerbConjugation } | null>(null);

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
  }, [activeTab]);

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
    const apiKey = settings.apiKey || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
    if (!apiKey) { Alert.alert('No API key', 'Add your Anthropic API key in Settings.'); return; }
    setRegenLoading(true);
    try {
      const existing = vocabWords.map((w) => w.word);
      const articleText = article.sentencePairs.map((p) => p.translation).join(' ');
      const result = await generateRecommendedVocab(
        articleText, article.targetLanguage, article.sourceLanguage, existing, apiKey
      );
      useUsageStore.getState().addVocab(result.inputTokens, result.outputTokens);
      recordApiCost({
        source: 'vocab',
        model: 'claude-sonnet-4-6',
        inputCreditRate: 3.0,
        totalInputCredits: result.inputTokens,
        outputCreditRate: 15.0,
        totalOutputCredits: result.outputTokens,
      });
      const settled = await Promise.allSettled(
        result.words.map((word) =>
          addWord({ word: word.word, language: article.targetLanguage, definition: word.definition, partOfSpeech: word.partOfSpeech })
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
          <ActivityIndicator color="#4A90D9" size="large" />
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
  const articleCost = calcCost(articleUsage.input, articleUsage.output);
  const vocabCost = calcCost(vocabUsage.input, vocabUsage.output);
  const audioCost = calcCost(audioUsage.input, audioUsage.output);
  const lifetimeCost = articleCost + vocabCost + audioCost;

  const articlesPage = (
    <FlatList
      style={{ width }}
      contentContainerStyle={savedArticles.length === 0 ? styles.emptyContainer : styles.listContent}
      data={savedArticles}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <View style={styles.statsBanner}>
          <View style={styles.statsTopRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{savedArticles.length}</Text>
              <Text style={styles.statLabel}>saved</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatCost(lifetimeCost)}</Text>
              <Text style={styles.statLabel}>lifetime total</Text>
            </View>
          </View>
          {lifetimeCost > 0 && (
            <View style={styles.statsBreakdown}>
              <Text style={styles.breakdownItem}>Articles {formatCost(articleCost)}</Text>
              <Text style={styles.breakdownDot}>·</Text>
              <Text style={styles.breakdownItem}>Vocab {formatCost(vocabCost)}</Text>
              {audioCost > 0 && (
                <>
                  <Text style={styles.breakdownDot}>·</Text>
                  <Text style={styles.breakdownItem}>Audio {formatCost(audioCost)}</Text>
                </>
              )}
            </View>
          )}
        </View>
      }
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
  const vocabPage = (
    <FlatList
      style={{ width }}
      contentContainerStyle={vocabWords.length === 0 ? styles.emptyContainer : styles.listContent}
      data={vocabWords}
      keyExtractor={(w) => w.id}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📖</Text>
          <Text style={styles.emptyTitle}>No vocab words yet</Text>
          <Text style={styles.emptySubtitle}>Tap any highlighted word while reading and hit "Add to vocab".</Text>
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
            <TouchableOpacity onPress={() => removeWord(item.id)} hitSlop={8}>
              <Text style={styles.vocabRemove}>✕</Text>
            </TouchableOpacity>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f4f8' },
  pager: { flex: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  appName: { fontSize: 22, fontWeight: '800', color: '#111' },
  settingsIcon: { fontSize: 22, color: '#888' },

  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#e8ecf0',
    borderRadius: 12,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { fontSize: 13, fontWeight: '600', color: '#888' },
  tabTextActive: { color: '#111' },

  // Pages
  pageContent: { padding: 16, paddingTop: 8 },
  listContent: { padding: 16, paddingTop: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },

  // Translate page
  pasteCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
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
  urlPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f7fbff',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#4A90D9',
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  urlText: { flex: 1, fontSize: 14, color: '#333' },
  urlPlaceholder: { fontSize: 14, color: '#bbb', marginBottom: 12 },
  clearBtn: { padding: 2 },
  clearText: { fontSize: 14, color: '#bbb' },
  pasteBtn: {
    backgroundColor: '#4A90D9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pasteBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  langCol: { flex: 1 },
  arrow: { fontSize: 20, color: '#aaa', marginTop: 16 },

  difficultyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
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
    backgroundColor: '#f0f2f5',
  },
  difficultyBtnActive: {
    backgroundColor: '#4A90D9',
  },
  difficultyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  difficultyTextActive: {
    color: '#fff',
  },
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

  // Articles page
  emptyState: { alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  emptySubtitle: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20 },

  statsBanner: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
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
  statValue: { fontSize: 18, fontWeight: '800', color: '#111' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 32, backgroundColor: '#eee' },
  statsBreakdown: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 6,
  },
  breakdownItem: { fontSize: 12, color: '#777' },
  breakdownDot: { fontSize: 12, color: '#ccc' },

  articleCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  articleMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  articleLang: { fontSize: 12, fontWeight: '700', color: '#4A90D9' },
  articleDate: { fontSize: 12, color: '#aaa' },
  articleUrl: { fontSize: 12, color: '#999', marginBottom: 6 },
  articlePreview: { fontSize: 14, color: '#444', lineHeight: 20 },
  articleCost: { fontSize: 11, color: '#aaa', marginTop: 6 },

  // Vocab page
  vocabCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  vocabHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  vocabWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  vocabWord: { fontSize: 18, fontWeight: '700', color: '#111' },
  vocabPos: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  vocabRemove: { fontSize: 16, color: '#ccc', padding: 2 },
  vocabDefinition: { fontSize: 14, color: '#444', lineHeight: 20 },
  conjugationBox: {
    marginTop: 10,
    backgroundColor: '#f7fbff',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  vocabGender: {
    fontSize: 12, color: '#4A90D9', fontStyle: 'italic',
    backgroundColor: '#eef4fd', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  conjBtn: {
    marginTop: 10, borderWidth: 1.5, borderColor: '#4A90D9',
    borderRadius: 8, paddingVertical: 7, alignItems: 'center',
  },
  conjBtnText: { fontSize: 13, fontWeight: '600', color: '#4A90D9' },

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
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    paddingTop: 12,
    overflow: 'hidden',
  },
  menuHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#ddd',
    alignSelf: 'center', marginBottom: 8,
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  menuItemText: { fontSize: 16, color: '#111' },
  menuItemDestructive: { color: '#d9311a' },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginHorizontal: 24 },
  menuSectionGap: { marginTop: 8 },

  // Vocab modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#ddd',
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 12 },
  modalList: { maxHeight: 420 },
  modalVocabItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  modalEmpty: { fontSize: 14, color: '#aaa', textAlign: 'center', paddingVertical: 20 },
  modalDoneBtn: {
    marginTop: 16, backgroundColor: '#4A90D9', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  modalDoneBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
