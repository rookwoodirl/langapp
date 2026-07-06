import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  PanResponder,
  Modal,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { VocabWord, SentencePair } from '../types';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

interface Props {
  pair: SentencePair;
  vocabList: VocabWord[];
  cardWidth: number;
  language: string;
  sourceLanguage?: string;
  onWordTap: (word: string, language: string, definition?: string, partOfSpeech?: string) => void;
}

// Chinese has no whitespace between words, so a non-vocab segment is otherwise
// treated as a single giant token. Split it into individual characters instead.
function isCharacterSegmented(language: string): boolean {
  return language.startsWith('zh');
}

type TokenKey = string; // `${segIdx}-${tokenIdx}`

interface Token {
  key: TokenKey;
  display: string;   // raw text including punctuation
  lookup: string;    // cleaned word for vocab
  isVocab: boolean;
  vocab?: VocabWord;
  isSpace: boolean;
}

type Layout = { x: number; y: number; width: number; height: number };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanToken(t: string): string {
  return t.replace(/[^a-zA-ZÀ-ÿÀ-ɏḀ-ỿ]/g, '');
}

export default function ParagraphCard({ pair, vocabList, cardWidth, language, sourceLanguage, onWordTap }: Props) {
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);
  const pagerRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const [page, setPage] = useState(0);
  const [phraseMode, setPhraseMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<TokenKey>>(new Set());

  // All mutable state accessed by PanResponder lives here to avoid stale closures
  const live = useRef({
    phraseMode: false,
    anchorKey: null as TokenKey | null,
    selectedKeys: new Set<TokenKey>(),
    sortedKeys: [] as TokenKey[],
    containerOffset: { x: 0, y: 0 },
  });

  const tokenLayouts = useRef<Map<TokenKey, Layout>>(new Map());

  const vocabMap = useMemo(() => {
    const m: Record<string, VocabWord> = {};
    for (const v of vocabList) m[v.word.toLowerCase()] = v;
    return m;
  }, [vocabList]);

  const segments = useMemo(() => {
    if (!vocabList.length) {
      return [{ text: pair.translation, isVocab: false, vocab: undefined as VocabWord | undefined }];
    }
    const pattern = vocabList.map((v) => escapeRegex(v.word)).join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');
    return pair.translation.split(regex).map((part) => ({
      text: part,
      isVocab: !!vocabMap[part.toLowerCase()],
      vocab: vocabMap[part.toLowerCase()],
    }));
  }, [pair.translation, vocabList, vocabMap]);

  const tokens: Token[] = useMemo(() => {
    const result: Token[] = [];
    segments.forEach((seg, si) => {
      if (!seg.text) return;
      if (seg.isVocab) {
        result.push({ key: `${si}-0`, display: seg.text, lookup: seg.text, isVocab: true, vocab: seg.vocab, isSpace: false });
      } else if (isCharacterSegmented(language)) {
        Array.from(seg.text).forEach((ch, ti) => {
          const isSpace = /^\s+$/.test(ch);
          result.push({ key: `${si}-${ti}`, display: ch, lookup: isSpace ? ' ' : ch, isVocab: false, isSpace });
        });
      } else {
        seg.text.split(/(\s+)/).forEach((tok, ti) => {
          if (!tok) return;
          const isSpace = /^\s+$/.test(tok);
          result.push({ key: `${si}-${ti}`, display: tok, lookup: isSpace ? ' ' : cleanToken(tok), isVocab: false, isSpace });
        });
      }
    });
    return result;
  }, [segments, language]);

  const sortedKeys = useMemo(() => tokens.filter((t) => !t.isSpace).map((t) => t.key), [tokens]);

  const originalTokens: Token[] = useMemo(() => {
    if (!pair.original) return [];
    const result: Token[] = [];
    const segLang = sourceLanguage ?? language;
    if (isCharacterSegmented(segLang)) {
      Array.from(pair.original).forEach((ch, i) => {
        const isSpace = /^\s+$/.test(ch);
        result.push({ key: `o-${i}`, display: ch, lookup: isSpace ? ' ' : ch, isVocab: false, isSpace });
      });
    } else {
      pair.original.split(/(\s+)/).forEach((tok, i) => {
        if (!tok) return;
        const isSpace = /^\s+$/.test(tok);
        result.push({ key: `o-${i}`, display: tok, lookup: isSpace ? ' ' : cleanToken(tok), isVocab: false, isSpace });
      });
    }
    return result;
  }, [pair.original, sourceLanguage, language]);

  // Keep live ref in sync with React state
  useEffect(() => { live.current.sortedKeys = sortedKeys; }, [sortedKeys]);
  useEffect(() => { live.current.phraseMode = phraseMode; }, [phraseMode]);
  useEffect(() => { live.current.selectedKeys = selectedKeys; }, [selectedKeys]);

  function findTokenAt(x: number, y: number): TokenKey | null {
    let best: TokenKey | null = null;
    let bestDist = Infinity;
    // First pass: tokens on the same row (y range matches)
    for (const [key, layout] of tokenLayouts.current) {
      if (y >= layout.y - 4 && y <= layout.y + layout.height + 4) {
        const dist = Math.abs(x - (layout.x + layout.width / 2));
        if (dist < bestDist) { bestDist = dist; best = key; }
      }
    }
    if (best) return best;
    // Second pass: nearest by 2D distance (finger between rows)
    bestDist = Infinity;
    for (const [key, layout] of tokenLayouts.current) {
      const cx = layout.x + layout.width / 2;
      const cy = layout.y + layout.height / 2;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bestDist) { bestDist = dist; best = key; }
    }
    return best;
  }

  function getRange(fromKey: TokenKey, toKey: TokenKey): Set<TokenKey> {
    const keys = live.current.sortedKeys;
    const a = keys.indexOf(fromKey);
    const b = keys.indexOf(toKey);
    if (a === -1) return new Set();
    if (b === -1) return new Set([fromKey]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return new Set(keys.slice(lo, hi + 1));
  }

  // Created once; reads from live ref to avoid stale-closure bugs
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gs) =>
          live.current.phraseMode && (Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2),
        onPanResponderGrant: () => {},
        onPanResponderMove: (evt) => {
          if (!live.current.phraseMode || !live.current.anchorKey) return;
          const touch = evt.nativeEvent.touches[0];
          if (!touch) return;
          const localX = touch.pageX - live.current.containerOffset.x;
          const localY = touch.pageY - live.current.containerOffset.y;
          const hovered = findTokenAt(localX, localY);
          if (!hovered) return;
          const next = getRange(live.current.anchorKey, hovered);
          const prev = live.current.selectedKeys;
          if (next.size !== prev.size || ![...next].every((k) => prev.has(k))) {
            live.current.selectedKeys = next;
            setSelectedKeys(new Set(next));
          }
        },
        onPanResponderRelease: () => {},
      }),
    [] // stable – reads live ref
  );

  function startPhrase(key: TokenKey) {
    containerRef.current?.measure((_x, _y, _w, _h, pageX, pageY) => {
      live.current.containerOffset = { x: pageX, y: pageY };
      live.current.phraseMode = true;
      live.current.anchorKey = key;
      const init = new Set([key]);
      live.current.selectedKeys = init;
      setPhraseMode(true);
      setSelectedKeys(init);
    });
  }

  function exitPhraseMode() {
    live.current.phraseMode = false;
    live.current.anchorKey = null;
    live.current.selectedKeys = new Set();
    setPhraseMode(false);
    setSelectedKeys(new Set());
  }

  function buildPhrase(): string {
    return live.current.sortedKeys
      .filter((k) => selectedKeys.has(k))
      .map((k) => tokens.find((t) => t.key === k)?.lookup ?? '')
      .filter(Boolean)
      .join(' ');
  }

  function commitPhrase() {
    const phrase = buildPhrase();
    exitPhraseMode();
    if (phrase.trim()) onWordTap(phrase, language);
  }

  function handleTokenPress(token: Token) {
    if (live.current.phraseMode) return;
    if (token.isVocab) {
      onWordTap(token.display, language, token.vocab?.definition, token.vocab?.partOfSpeech);
    } else if (token.lookup) {
      onWordTap(token.lookup, language);
    }
  }

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(e.nativeEvent.contentOffset.x / cardWidth));
  }

  const phrasePreview = phraseMode && selectedKeys.size > 0 ? buildPhrase() : '';

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleScroll}
        scrollEnabled={!phraseMode}
      >
        {/* Translation page */}
        <View style={{ width: cardWidth, padding: 14 }}>
          <Text style={styles.pageLabel}>Translation</Text>
          <View ref={containerRef} style={styles.bodyRow} {...panResponder.panHandlers}>
            {tokens.map((token) => {
              if (token.isSpace) {
                return <Text key={token.key} style={styles.space}>{token.display}</Text>;
              }
              const isSelected = selectedKeys.has(token.key);
              return (
                <Text
                  key={token.key}
                  style={[
                    styles.tokenBase,
                    token.isVocab ? styles.highlight : styles.plainWord,
                    isSelected && styles.selectedToken,
                  ]}
                  onLayout={(e) => tokenLayouts.current.set(token.key, e.nativeEvent.layout)}
                  onPress={() => handleTokenPress(token)}
                  onLongPress={() => startPhrase(token.key)}
                  suppressHighlighting
                >
                  {token.display}
                </Text>
              );
            })}
          </View>
        </View>

        {/* Original page */}
        <View style={{ width: cardWidth, padding: 14 }}>
          <Text style={styles.pageLabel}>Original</Text>
          {pair.original ? (
            <View style={styles.bodyRow}>
              {originalTokens.map((token) => {
                if (token.isSpace) {
                  return <Text key={token.key} style={styles.space}>{token.display}</Text>;
                }
                return (
                  <Text
                    key={token.key}
                    style={[styles.tokenBase, styles.plainWord]}
                    onPress={() => token.lookup && onWordTap(token.lookup, sourceLanguage ?? language)}
                    suppressHighlighting
                  >
                    {token.display}
                  </Text>
                );
              })}
            </View>
          ) : (
            <Text style={styles.unavailable}>Original not available</Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.dots}>
        <View style={[styles.dot, page === 0 && styles.dotActive]} />
        <View style={[styles.dot, page === 1 && styles.dotActive]} />
      </View>

      <Modal visible={phraseMode} transparent animationType="slide" onRequestClose={exitPhraseMode}>
        <View style={styles.phraseModalOuter} pointerEvents="box-none">
          <View style={styles.phraseBar}>
            <Text style={styles.phrasePreview} numberOfLines={1}>
              {phrasePreview || '…'}
            </Text>
            <View style={styles.phraseActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={exitPhraseMode}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lookupBtn, !phrasePreview && styles.lookupBtnDisabled]}
                onPress={commitPhrase}
                disabled={!phrasePreview}
              >
                <Text style={styles.lookupBtnText}>Look up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: 'hidden',
  },
  pageLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  bodyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  body: { fontSize: 17, lineHeight: 28, color: colors.text },
  tokenBase: { fontSize: 17, lineHeight: 28 },
  space: { fontSize: 17, lineHeight: 28, color: colors.text },
  highlight: {
    color: colors.highlight,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  plainWord: { color: colors.text },
  selectedToken: {
    backgroundColor: colors.selection,
    color: colors.selectionText,
    borderRadius: 3,
    overflow: 'hidden',
  },
  unavailable: { fontSize: 14, color: colors.textFaint, fontStyle: 'italic' },
  dots: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 8, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent },

  phraseModalOuter: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  phraseBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    padding: 12,
    paddingBottom: 28,
    gap: 8,
  },
  phrasePreview: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    fontStyle: 'italic',
  },
  phraseActions: { flexDirection: 'row', gap: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.chipBg,
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  lookupBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  lookupBtnDisabled: { backgroundColor: colors.textFaint },
  lookupBtnText: { fontSize: 14, fontWeight: '700', color: colors.accentText },
});
