import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from '../store/themeStore';
import { useColors } from '../hooks/useColors';

export default function RootLayout() {
  const { load } = useThemeStore();
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => { load(); }, []);

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
        <Stack.Screen name="article/[id]" options={{ title: 'Article' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
        <Stack.Screen name="review" options={{ title: 'Review', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
