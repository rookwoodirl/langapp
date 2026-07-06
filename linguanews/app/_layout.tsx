import { useEffect, useState } from 'react';
import { Stack, router, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from '../store/themeStore';
import { useColors } from '../hooks/useColors';
import { getAuthState } from '../services/auth';
import { initPurchases } from '../services/purchases';
import { useCreditStore } from '../store/creditStore';
import { PaywallModal } from '../components/PaywallModal';

export default function RootLayout() {
  const { load } = useThemeStore();
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const navState = useRootNavigationState();

  useEffect(() => { load(); }, []);

  useEffect(() => {
    getAuthState().then((state) => {
      setIsAuthed(!!state);
      setAuthChecked(true);
      if (state) {
        initPurchases(state.userId);
        useCreditStore.getState().loadBalance();
      }
    });
  }, []);

  // Only redirect once both the navigation is mounted and the auth check is done
  useEffect(() => {
    if (!navState?.key || !authChecked) return;
    if (!isAuthed) router.replace('/login');
  }, [navState?.key, authChecked, isAuthed]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="article/[id]" options={{ title: 'Article' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
        <Stack.Screen name="review" options={{ title: 'Review', presentation: 'modal' }} />
        <Stack.Screen name="chat-setup" options={{ title: 'New Chat', presentation: 'modal' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      </Stack>
      <PaywallModal />
    </>
  );
}
