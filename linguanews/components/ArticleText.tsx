import React, { useMemo } from 'react';
import { Text, StyleSheet, ScrollView } from 'react-native';
import { VocabWord } from '../types';

interface Props {
  text: string;
  vocabList: VocabWord[];
  onWordTap: (word: string, definition?: string, partOfSpeech?: string) => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function ArticleText({ text, vocabList, onWordTap }: Props) {
  const vocabMap = useMemo(() => {
    const m: Record<string, VocabWord> = {};
    for (const v of vocabList) {
      m[v.word.toLowerCase()] = v;
    }
    return m;
  }, [vocabList]);

  const segments = useMemo(() => {
    if (!vocabList.length) return [{ text, isVocab: false }];

    const pattern = vocabList.map((v) => escapeRegex(v.word)).join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part) => ({
      text: part,
      isVocab: !!vocabMap[part.toLowerCase()],
    }));
  }, [text, vocabList, vocabMap]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        {segments.map((seg, i) => {
          if (!seg.text) return null;
          if (seg.isVocab) {
            const vocab = vocabMap[seg.text.toLowerCase()];
            return (
              <Text
                key={i}
                style={styles.highlight}
                onPress={() => onWordTap(seg.text, vocab?.definition, vocab?.partOfSpeech)}
              >
                {seg.text}
              </Text>
            );
          }
          // Split on whitespace to allow tapping individual plain words
          return (
            <Text key={i}>
              {seg.text.split(/(\s+)/).map((token, j) => {
                if (/^\s+$/.test(token) || !token) return token;
                return (
                  <Text
                    key={j}
                    style={styles.plainWord}
                    onPress={() => onWordTap(token.replace(/[^a-zA-ZÀ-ÿ]/g, ''))}
                  >
                    {token}
                  </Text>
                );
              })}
            </Text>
          );
        })}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 120 },
  body: { fontSize: 17, lineHeight: 28, color: '#111' },
  highlight: {
    color: '#1a56a4',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  plainWord: { color: '#111' },
});
