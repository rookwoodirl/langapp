import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { VerbConjugation } from '../types';
import ConjugationModal from './ConjugationModal';

interface Props {
  visible: boolean;
  word: string;
  definition: string | null;
  partOfSpeech?: string;
  gender?: string;
  article?: string;
  conjugation?: VerbConjugation;
  isLoading?: boolean;
  isAdded?: boolean;
  onClose: () => void;
  onAddToVocab?: () => Promise<void>;
}

export default function VocabPopup({
  visible,
  word,
  definition,
  partOfSpeech,
  gender,
  article,
  conjugation,
  isLoading,
  isAdded,
  onClose,
  onAddToVocab,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [conjVisible, setConjVisible] = useState(false);

  async function handleAdd() {
    if (!onAddToVocab || adding || isAdded) return;
    setAdding(true);
    try {
      await onAddToVocab();
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.word}>{word}</Text>
            <View style={styles.badges}>
              {article ? <Text style={styles.article}>{article}</Text> : null}
              {partOfSpeech ? <Text style={styles.pos}>{partOfSpeech}</Text> : null}
              {gender ? <Text style={styles.gender}>{gender}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <ActivityIndicator style={styles.loader} color="#4A90D9" />
          ) : (
            <Text style={styles.definition}>{definition ?? 'No definition available.'}</Text>
          )}

          {conjugation && (
            <TouchableOpacity style={styles.conjBtn} onPress={() => setConjVisible(true)}>
              <Text style={styles.conjBtnText}>Conjugations</Text>
            </TouchableOpacity>
          )}

          {onAddToVocab && (
            <TouchableOpacity
              style={[styles.addBtn, (isAdded || adding) && styles.addBtnDone]}
              onPress={handleAdd}
              disabled={isAdded || adding}
              activeOpacity={0.75}
            >
              {adding ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.addBtnText}>{isAdded ? '✓ In vocab' : 'Add to vocab'}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      {conjugation && (
        <ConjugationModal
          visible={conjVisible}
          infinitive={conjugation.infinitive}
          conjugation={conjugation}
          onClose={() => setConjVisible(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
    minHeight: 180,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#ddd',
    alignSelf: 'center', marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  word: { fontSize: 22, fontWeight: '700', color: '#111', flex: 1 },
  badges: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  article: {
    fontSize: 13, color: '#6b48a2', fontStyle: 'italic',
    backgroundColor: '#f3eeff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4,
  },
  pos: {
    fontSize: 13, color: '#888', fontStyle: 'italic',
    backgroundColor: '#f5f5f5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4,
  },
  gender: {
    fontSize: 13, color: '#4A90D9', fontStyle: 'italic',
    backgroundColor: '#eef4fd', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4,
  },
  closeButton: { padding: 4 },
  closeText: { fontSize: 18, color: '#999' },
  definition: { fontSize: 16, lineHeight: 24, color: '#333' },
  loader: { marginTop: 12 },
  conjBtn: {
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: '#4A90D9',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  conjBtnText: { fontSize: 14, fontWeight: '600', color: '#4A90D9' },
  addBtn: {
    marginTop: 12,
    backgroundColor: '#4A90D9',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addBtnDone: { backgroundColor: '#e8f5e9' },
  addBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
