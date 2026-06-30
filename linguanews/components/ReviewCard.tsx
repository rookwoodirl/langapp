import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { ReviewGrade, UserVocabWord } from '../types';
import { ttsService } from '../services/tts';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

interface Props {
  card: UserVocabWord;
  onGrade: (grade: ReviewGrade) => void;
  onShowConjugations?: () => void;
}

export default function ReviewCard({ card, onGrade, onShowConjugations }: Props) {
  const [flipped, setFlipped] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  function grade(g: ReviewGrade) {
    setFlipped(false);
    onGrade(g);
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => setFlipped((f) => !f)}
      >
        <ScrollView contentContainerStyle={styles.cardContent}>
          <View style={styles.wordRow}>
            <Text style={styles.word}>
              {card.article ? `${card.article} ` : ''}{card.word}
            </Text>
            <TouchableOpacity onPress={() => ttsService.speak(card.word, card.language)} hitSlop={8}>
              <Text style={styles.speak}>🔊</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.badgeRow}>
            {card.partOfSpeech ? <Text style={styles.badge}>{card.partOfSpeech}</Text> : null}
            {card.gender ? <Text style={styles.badge}>{card.gender}</Text> : null}
          </View>

          {flipped ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.definition}>{card.definition}</Text>
              {card.conjugation && onShowConjugations && (
                <TouchableOpacity style={styles.conjBtn} onPress={onShowConjugations}>
                  <Text style={styles.conjBtnText}>Conjugations</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={styles.tapHint}>Tap to reveal</Text>
          )}
        </ScrollView>
      </TouchableOpacity>

      {flipped ? (
        <View style={styles.gradeRow}>
          <TouchableOpacity style={[styles.gradeBtn, styles.gradeAgain]} onPress={() => grade('again')}>
            <Text style={styles.gradeText}>Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.gradeBtn, styles.gradeHard]} onPress={() => grade('hard')}>
            <Text style={styles.gradeText}>Hard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.gradeBtn, styles.gradeGood]} onPress={() => grade('good')}>
            <Text style={styles.gradeText}>Good</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.gradeBtn, styles.gradeEasy]} onPress={() => grade('easy')}>
            <Text style={styles.gradeText}>Easy</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.gradeRowPlaceholder} />
      )}
    </View>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    minHeight: 260,
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardContent: { alignItems: 'center', gap: 10 },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  word: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center' },
  speak: { fontSize: 20 },
  badgeRow: { flexDirection: 'row', gap: 8 },
  badge: {
    fontSize: 12, color: colors.textFaint, fontStyle: 'italic',
    backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  divider: { width: '100%', height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 14 },
  definition: { fontSize: 17, color: colors.textMuted, lineHeight: 24, textAlign: 'center' },
  tapHint: { fontSize: 13, color: colors.textFaint, marginTop: 18 },
  conjBtn: {
    marginTop: 14, borderWidth: 1.5, borderColor: colors.accent,
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16,
  },
  conjBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },
  gradeRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  gradeRowPlaceholder: { height: 20 + 44, marginTop: 20 },
  gradeBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  gradeAgain: { backgroundColor: colors.danger },
  gradeHard: { backgroundColor: '#d98a3d' },
  gradeGood: { backgroundColor: colors.success },
  gradeEasy: { backgroundColor: colors.accent },
  gradeText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
