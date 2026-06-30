import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  Pressable,
} from 'react-native';
import { LANGUAGES } from '../constants/languages';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

interface Props {
  label: string;
  value: string;
  onChange: (code: string) => void;
}

export default function LanguagePicker({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = LANGUAGES.find((l) => l.code === value);
  const colors = useColors();
  const styles = themedStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText}>{selected?.name ?? value}</Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide">
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{label}</Text>
          <FlatList
            data={LANGUAGES}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.option, item.code === value && styles.optionSelected]}
                onPress={() => {
                  onChange(item.code);
                  setOpen(false);
                }}
              >
                <Text style={styles.optionText}>{item.name}</Text>
                <Text style={styles.optionNative}>{item.nativeName}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { marginBottom: 12 },
  label: { fontSize: 12, color: colors.textFaint, marginBottom: 4, textTransform: 'uppercase' },
  button: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  buttonText: { fontSize: 16, color: colors.text },
  chevron: { fontSize: 14, color: colors.textFaint },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    maxHeight: '60%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
    color: colors.text,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionSelected: { backgroundColor: colors.accentSoft },
  optionText: { fontSize: 16, color: colors.text },
  optionNative: { fontSize: 14, color: colors.textFaint },
});
