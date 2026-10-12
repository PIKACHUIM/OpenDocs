import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * UI appearance (light / dark / system) — independent from the canvas
 * drawing `ThemeColorMode` (default/colorful/soft/retro/dark/starry) which
 * only affects shapes drawn on the board.
 */
export type ColorScheme = 'light' | 'dark' | 'system';

/**
 * Brand / accent color presets. Each preset only changes `--color-primary*`
 * tokens in `styles/theme.scss`, so switching it instantly re-themes every
 * selected/active/hover state across the whole toolbar.
 */
export type ColorTheme = 'blue' | 'violet' | 'green' | 'orange' | 'pink' | 'teal';

export const COLOR_THEME_SWATCHES: Record<ColorTheme, string> = {
  blue: '#6698ff',
  violet: '#8b5cf6',
  green: '#22c55e',
  orange: '#f97316',
  pink: '#ec4899',
  teal: '#14b8a6',
};

export const COLOR_THEMES = Object.keys(COLOR_THEME_SWATCHES) as ColorTheme[];

const STORAGE_KEY_SCHEME = 'drawnix-color-scheme';
const STORAGE_KEY_THEME = 'drawnix-color-theme';

function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isColorTheme(value: unknown): value is ColorTheme {
  return typeof value === 'string' && (COLOR_THEMES as string[]).includes(value);
}

function readStored<T>(key: string, guard: (value: unknown) => value is T): T | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null && guard(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore write errors (private mode, storage quota, etc.)
  }
}

function getSystemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export interface ThemeModeContextType {
  colorScheme: ColorScheme;
  /** `colorScheme` resolved to an actual light/dark value (handles `system`). */
  resolvedColorScheme: 'light' | 'dark';
  setColorScheme: (value: ColorScheme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (value: ColorTheme) => void;
}

export const ThemeModeContext = createContext<ThemeModeContextType | undefined>(undefined);

export const useThemeMode = (): ThemeModeContextType => {
  const context = useContext(ThemeModeContext);

  if (!context) {
    throw new Error('useThemeMode must be used within Drawnix');
  }

  return context;
};

export interface UseThemeModeStateOptions {
  initialColorScheme?: ColorScheme;
  initialColorTheme?: ColorTheme;
  onColorSchemeChange?: (value: ColorScheme) => void;
  onColorThemeChange?: (value: ColorTheme) => void;
}

/**
 * Owns the actual appearance/color-theme state for a single `<Drawnix />`
 * instance: reads the initial value from the controlled prop (if provided)
 * or from localStorage, listens to OS-level scheme changes, and persists
 * updates back to localStorage so the preference survives reloads even when
 * the host app does not wire up the `initial*`/`on*Change` props.
 */
export const useThemeModeState = ({
  initialColorScheme,
  initialColorTheme,
  onColorSchemeChange,
  onColorThemeChange,
}: UseThemeModeStateOptions): ThemeModeContextType => {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(
    () => initialColorScheme ?? readStored(STORAGE_KEY_SCHEME, isColorScheme) ?? 'light'
  );
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(
    () => initialColorTheme ?? readStored(STORAGE_KEY_THEME, isColorTheme) ?? 'blue'
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(getSystemPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    media.addEventListener?.('change', handleChange);
    return () => media.removeEventListener?.('change', handleChange);
  }, []);

  const setColorScheme = useCallback(
    (value: ColorScheme) => {
      setColorSchemeState(value);
      writeStored(STORAGE_KEY_SCHEME, value);
      onColorSchemeChange?.(value);
    },
    [onColorSchemeChange]
  );

  const setColorTheme = useCallback(
    (value: ColorTheme) => {
      setColorThemeState(value);
      writeStored(STORAGE_KEY_THEME, value);
      onColorThemeChange?.(value);
    },
    [onColorThemeChange]
  );

  const resolvedColorScheme: 'light' | 'dark' =
    colorScheme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : colorScheme;

  return useMemo(
    () => ({ colorScheme, resolvedColorScheme, setColorScheme, colorTheme, setColorTheme }),
    [colorScheme, resolvedColorScheme, setColorScheme, colorTheme, setColorTheme]
  );
};
