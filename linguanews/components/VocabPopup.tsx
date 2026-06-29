import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Pressable,
} from 'react-native';

interface Props {
  visible: boolean;
  word: string;
  definition: string | null;
  partOfSpeech?: string;
  isLoading?: boolean;
  onClose: () => void;
}

export default function VocabPopup({
  visible,
  word,
  definition,
  partOfSpeech,
  isLoading,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.word}>{word}</Text>
          {partOfSpeech ? <Text style={styles.pos}>{partOfSpeech}</Text> : null}
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator style={styles.loader} color="#4A90D9" />
        ) : (
          <Text style={styles.definition}>{definition ?? 'No definition available.'}</Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    minHeight: 160,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  word: { fontSize: 22, fontWeight: '700', color: '#111', flex: 1 },
  pos: {
    fontSize: 13,
    color: '#888',
    fontStyle: 'italic',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  closeButton: { padding: 4 },
  closeText: { fontSize: 18, color: '#999' },
  definition: { fontSize: 16, lineHeight: 24, color: '#333' },
  loader: { marginTop: 12 },
});
