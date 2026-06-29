import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ttsService } from '../services/tts';
import { useArticleStore } from '../store/articleStore';

interface Props {
  text: string;
  language: string;
}

export default function AudioPlayer({ text, language }: Props) {
  const { ttsPlaying, toggleTTS } = useArticleStore();

  useEffect(() => {
    if (ttsPlaying) {
      ttsService.speak(text, language, () => {
        useArticleStore.setState({ ttsPlaying: false });
      });
    } else {
      ttsService.stop();
    }
  }, [ttsPlaying]);

  // Stop playback when unmounted
  useEffect(() => () => { ttsService.stop(); }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={toggleTTS}>
        <Text style={styles.icon}>{ttsPlaying ? '⏹' : '▶'}</Text>
        <Text style={styles.label}>{ttsPlaying ? 'Stop' : 'Read aloud'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4A90D9',
    borderRadius: 10,
    paddingVertical: 12,
  },
  icon: { fontSize: 18, color: '#fff' },
  label: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
