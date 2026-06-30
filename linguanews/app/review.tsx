import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useNotecardStore } from '../store/notecardStore';
import ReviewCard from '../components/ReviewCard';
import ConjugationModal from '../components/ConjugationModal';
import { ReviewGrade, VerbConjugation } from '../types';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

export default function ReviewScreen() {
  const { language, listId } = useLocalSearchParams<{ language?: string; listId?: string }>();
  const { dueCards, loadDueCards, reviewCard } = useNotecardStore();
  const [loading, setLoading] = useState(true);
  const [conjModal, setConjModal] = useState<{ infinitive: string; conjugation: VerbConjugation } | null>(null);
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadDueCards({ language, listId });
      setLoading(false);
    })();
  }, [language, listId]);

  const current = dueCards[0];

  function handleGrade(grade: ReviewGrade) {
    if (current) reviewCard(current.id, grade);
  }

  return (
    <View style={styles.container}>
      {!loading && (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>
            {dueCards.length > 0 ? `${dueCards.length} card${dueCards.length !== 1 ? 's' : ''} remaining` : ''}
          </Text>
        </View>
      )}

      {!loading && current && (
        <ReviewCard
          card={current}
          onGrade={handleGrade}
          onShowConjugations={
            current.conjugation
              ? () => setConjModal({ infinitive: current.conjugation!.infinitive, conjugation: current.conjugation! })
              : undefined
          }
        />
      )}

      {!loading && !current && (
        <View style={styles.doneState}>
          <Text style={styles.doneIcon}>🎉</Text>
          <Text style={styles.doneTitle}>All caught up!</Text>
          <Text style={styles.doneSubtitle}>No cards due for review right now.</Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {conjModal && (
        <ConjugationModal
          visible={!!conjModal}
          infinitive={conjModal.infinitive}
          conjugation={conjModal.conjugation}
          onClose={() => setConjModal(null)}
        />
      )}
    </View>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  statusBar: { paddingHorizontal: 20, paddingTop: 14, alignItems: 'center' },
  statusText: { fontSize: 13, fontWeight: '600', color: colors.textFaint },
  doneState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  doneIcon: { fontSize: 40 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  doneSubtitle: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  doneBtn: {
    marginTop: 16, backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center',
  },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
});
