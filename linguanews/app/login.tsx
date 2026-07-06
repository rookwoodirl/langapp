import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { saveAuthState, getAuthState } from '../services/auth';
import { initPurchases } from '../services/purchases';
import { useColors } from '../hooks/useColors';
import { ThemeColors } from '../constants/theme';

WebBrowser.maybeCompleteAuthSession();

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');

export default function LoginScreen() {
  const colors = useColors();
  const styles = useMemo(() => themedStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setError(null);
    setLoading(true);
    try {
      // makeRedirectUri() returns exp://... in Expo Go and linguanews://... in a native build.
      // The backend validates this against an allowlist before using it as the final redirect.
      const redirectTo = makeRedirectUri();
      const state = btoa(redirectTo);
      const authUrl = `${BACKEND_URL}/auth/google?state=${encodeURIComponent(state)}`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);

      if (result.type === 'success') {
        const parsed = Linking.parse(result.url);
        const token = parsed.queryParams?.token as string | undefined;
        if (token) {
          await saveAuthState(token);
          const auth = await getAuthState();
          if (auth) initPurchases(auth.userId);
          router.replace('/');
          return;
        }
        const err = parsed.queryParams?.error as string | undefined;
        setError(err === 'server_error' ? 'Server error. Try again.' : 'Sign-in failed. Try again.');
      }
      // type === 'cancel' / 'dismiss' — user closed the browser, do nothing
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.appName}>LinguaNews</Text>
        <Text style={styles.tagline}>Read the news, learn a language.</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.googleBtn, loading && styles.googleBtnDisabled]}
          disabled={loading}
          onPress={signInWithGoogle}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.googleBtnText}>Sign in with Google</Text>
          }
        </TouchableOpacity>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </View>
  );
}

const themedStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 120,
    paddingBottom: 64,
  },
  hero: { alignItems: 'center', gap: 12 },
  appName: { fontSize: 36, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  tagline: { fontSize: 16, color: colors.textMuted, textAlign: 'center' },
  actions: { gap: 12 },
  googleBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  googleBtnDisabled: { opacity: 0.5 },
  googleBtnText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center' },
});
