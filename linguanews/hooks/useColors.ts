import { useThemeStore } from '../store/themeStore';
import { lightColors, darkColors, ThemeColors } from '../constants/theme';

export function useColors(): ThemeColors {
  const isDark = useThemeStore((s) => s.isDark);
  return isDark ? darkColors : lightColors;
}
