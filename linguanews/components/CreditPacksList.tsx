import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useCreditStore } from '../store/creditStore';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

export default function CreditPacksList() {
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);
  const offerings = useCreditStore((s) => s.offerings);
  const purchasingProductId = useCreditStore((s) => s.purchasingProductId);
  const loadOfferings = useCreditStore((s) => s.loadOfferings);
  const purchase = useCreditStore((s) => s.purchase);

  useEffect(() => { loadOfferings(); }, []);

  if (offerings.length === 0) {
    return <Text style={styles.empty}>No credit packs available right now.</Text>;
  }

  return (
    <View style={styles.list}>
      {offerings.map((pkg: PurchasesPackage) => {
        const purchasing = purchasingProductId === pkg.product.identifier;
        return (
          <TouchableOpacity
            key={pkg.identifier}
            style={[styles.pack, purchasing && styles.packDisabled]}
            onPress={() => purchase(pkg)}
            disabled={!!purchasingProductId}
            activeOpacity={0.75}
          >
            <Text style={styles.packTitle}>{pkg.product.title || pkg.product.identifier}</Text>
            {purchasing
              ? <ActivityIndicator color={colors.accentText} size="small" />
              : <Text style={styles.packPrice}>{pkg.product.priceString}</Text>
            }
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  list: { gap: 10 },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  packDisabled: { opacity: 0.7 },
  packTitle: { fontSize: 15, fontWeight: '700', color: colors.accentText },
  packPrice: { fontSize: 15, fontWeight: '700', color: colors.accentText },
  empty: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 20 },
});
