import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { apiGetCostSummary, apiGetCostLanguages, CostSummaryRow } from '../services/api';
import { formatCost } from '../utils/cost';
import { getLanguageName } from '../constants/languages';
import { SOURCE_ORDER, SOURCE_LABELS } from '../constants/costs';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

const TIME_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All time', days: null },
] as const;

export default function CostsScreen() {
  const [costSummary, setCostSummary] = useState<Record<string, CostSummaryRow>>({});
  const [languages, setLanguages] = useState<string[]>([]);
  const [rangeIndex, setRangeIndex] = useState(3); // default to "All time"
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const colors = useColors();
  const styles = themedStyles(colors);

  const load = useCallback(async () => {
    const days = TIME_RANGES[rangeIndex].days;
    const since = days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
    const summary = await apiGetCostSummary({ language: langFilter ?? undefined, since });
    setCostSummary(summary);
  }, [rangeIndex, langFilter]);

  useEffect(() => {
    apiGetCostLanguages().then(setLanguages);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalCost = Object.values(costSummary).reduce((sum, row) => sum + row.totalCost, 0);
  const breakdownItems = SOURCE_ORDER.filter((src) => (costSummary[src]?.totalCost ?? 0) > 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.section}>Time range</Text>
      <View style={styles.chipRow}>
        {TIME_RANGES.map((range, i) => (
          <TouchableOpacity
            key={range.label}
            style={[styles.chip, rangeIndex === i && styles.chipActive]}
            onPress={() => setRangeIndex(i)}
          >
            <Text style={[styles.chipText, rangeIndex === i && styles.chipTextActive]}>{range.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {languages.length > 0 && (
        <>
          <Text style={styles.section}>Language</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, !langFilter && styles.chipActive]}
              onPress={() => setLangFilter(null)}
            >
              <Text style={[styles.chipText, !langFilter && styles.chipTextActive]}>All</Text>
            </TouchableOpacity>
            {languages.map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.chip, langFilter === lang && styles.chipActive]}
                onPress={() => setLangFilter(lang)}
              >
                <Text style={[styles.chipText, langFilter === lang && styles.chipTextActive]}>
                  {getLanguageName(lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <View style={styles.totalCard}>
        <Text style={styles.totalValue}>{formatCost(totalCost)}</Text>
        <Text style={styles.totalLabel}>total spend</Text>
      </View>

      {breakdownItems.length > 0 ? (
        <View style={styles.breakdownCard}>
          {breakdownItems.map((src) => (
            <View key={src} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{SOURCE_LABELS[src]}</Text>
              <Text style={styles.breakdownValue}>{formatCost(costSummary[src].totalCost)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No costs recorded for this filter.</Text>
      )}
    </ScrollView>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { backgroundColor: colors.background },
  container: { padding: 24 },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 12,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.chipBg,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  chipTextActive: { color: colors.accentText },

  totalCard: {
    marginTop: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  totalValue: { fontSize: 28, fontWeight: '800', color: colors.text },
  totalLabel: { fontSize: 12, color: colors.textFaint, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

  breakdownCard: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  breakdownLabel: { fontSize: 14, color: colors.textMuted },
  breakdownValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  empty: { fontSize: 14, color: colors.textFaint, textAlign: 'center', marginTop: 24 },
});
