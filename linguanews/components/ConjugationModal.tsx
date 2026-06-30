import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, TouchableOpacity } from 'react-native';
import { VerbConjugation } from '../types';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

interface Props {
  visible: boolean;
  infinitive: string;
  conjugation: VerbConjugation;
  onClose: () => void;
}

export default function ConjugationModal({ visible, infinitive, conjugation, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  // Support both new tenses[] format and legacy present[] format
  const tenses =
    conjugation.tenses ??
    (conjugation.present ? [{ name: 'Present', forms: conjugation.present }] : []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.infinitive}>{infinitive}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {tenses.map((tense) => (
            <View key={tense.name} style={styles.tenseBlock}>
              <Text style={styles.tenseName}>{tense.name}</Text>
              {tense.forms.map((form, i) => (
                <Text key={i} style={styles.form}>{form}</Text>
              ))}
            </View>
          ))}
          {tenses.length === 0 && (
            <Text style={styles.empty}>No conjugation data available.</Text>
          )}
        </ScrollView>
        <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    maxHeight: '80%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  infinitive: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 16 },
  scroll: { maxHeight: 380 },
  tenseBlock: { marginBottom: 20 },
  tenseName: {
    fontSize: 11, fontWeight: '700', color: colors.accent,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  form: { fontSize: 15, color: colors.textMuted, lineHeight: 24 },
  empty: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 20 },
  doneBtn: {
    marginTop: 16, backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: colors.accentText },
});
