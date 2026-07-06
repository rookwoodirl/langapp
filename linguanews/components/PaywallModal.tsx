import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity } from 'react-native';
import { useCreditStore } from '../store/creditStore';
import CreditPacksList from './CreditPacksList';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

export function PaywallModal() {
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);
  const visible = useCreditStore((s) => s.paywallVisible);
  const hidePaywall = useCreditStore((s) => s.hidePaywall);
  const balanceUsd = useCreditStore((s) => s.balanceUsd);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={hidePaywall}>
      <Pressable style={styles.backdrop} onPress={hidePaywall} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Out of credits</Text>
        <Text style={styles.subtitle}>
          {balanceUsd != null
            ? `Your balance is $${balanceUsd.toFixed(2)}. Buy more credits to keep translating, looking up words, and chatting.`
            : 'Buy more credits to keep translating, looking up words, and chatting.'}
        </Text>
        <CreditPacksList />
        <TouchableOpacity style={styles.closeBtn} onPress={hidePaywall}>
          <Text style={styles.closeBtnText}>Not now</Text>
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
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 20, lineHeight: 20 },
  closeBtn: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  closeBtnText: { fontSize: 14, fontWeight: '600', color: colors.textFaint },
});
