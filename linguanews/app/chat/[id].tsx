import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useChatStore } from '../../store/chatStore';
import { ChatMessage } from '../../types';
import { getLanguageName } from '../../constants/languages';
import { useColors } from '../../hooks/useColors';
import { ThemeColors } from '../../constants/theme';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);

  const session = useChatStore((s) => s.sessions.find((sess) => sess.id === id));
  const sendMessage = useChatStore((s) => s.sendMessage);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || !session || sending) return;
    setInput('');
    setSending(true);
    try {
      await sendMessage(session.id, text);
    } catch (err) {
      Alert.alert('Failed to send', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (!session) {
    return (
      <View style={styles.missingContainer}>
        <Text style={styles.missingText}>Chat not found.</Text>
        <TouchableOpacity style={styles.missingBtn} onPress={() => router.back()}>
          <Text style={styles.missingBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const title = session.mode === 'article' ? (session.articleTitle ?? 'Article chat') : (session.vocabLabel ?? 'Vocab chat');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.headerSubtitle}>
          {getLanguageName(session.targetLanguage)} · {session.difficulty.charAt(0).toUpperCase() + session.difficulty.slice(1)}
        </Text>
      </View>

      <FlatList
        ref={listRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        data={session.messages}
        keyExtractor={(_, i) => String(i)}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>Say hello to get the conversation started.</Text>
          </View>
        }
        renderItem={({ item }: { item: ChatMessage }) => (
          <View style={[styles.bubbleRow, item.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
            <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
              <Text style={[styles.bubbleText, item.role === 'user' && styles.bubbleTextUser]}>{item.content}</Text>
            </View>
          </View>
        )}
      />

      {sending && (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color={colors.textFaint} />
          <Text style={styles.typingText}>Thinking…</Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={`Type in ${getLanguageName(session.targetLanguage)}…`}
          placeholderTextColor={colors.textFaint}
          multiline
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 13, color: colors.textFaint, marginTop: 2 },
  messageList: { flex: 1 },
  messageListContent: { padding: 16, flexGrow: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 60 },
  emptyIcon: { fontSize: 36 },
  emptyText: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  bubbleRow: { flexDirection: 'row', marginBottom: 10 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAssistant: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21, color: colors.text },
  bubbleTextUser: { color: colors.accentText },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 6 },
  typingText: { fontSize: 13, color: colors.textFaint },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: colors.accentText },
  missingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  missingText: { fontSize: 16, color: colors.textFaint },
  missingBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  missingBtnText: { fontSize: 14, fontWeight: '700', color: colors.accentText },
});
