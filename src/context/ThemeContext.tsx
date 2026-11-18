import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ACCENT_THEME_LIST,
  ACCENT_THEME_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  type AccentThemeId,
  type AccentThemePalette,
  DEFAULT_ACCENT_THEME,
  applyAccentThemeToDOM,
  getStoredAccentTheme,
  isValidAccentTheme,
  persistAccentTheme,
  resolveAccentPalette,
} from '../utils/themePalettes.ts';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type Theme = ResolvedTheme; // backward compatibility

interface ThemeContextType {
  theme: ResolvedTheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  accentTheme: AccentThemeId;
  accentPalette: AccentThemePalette;
  availableAccents: AccentThemePalette[];
  pwaThemeColor: string;
  setAccentTheme: (accent: AccentThemeId) => void;
}

const defaultPalette = resolveAccentPalette(DEFAULT_ACCENT_THEME);

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  themeMode: 'light',
  setThemeMode: () => {},
  setTheme: () => {},
  toggleTheme: () => {},
  accentTheme: DEFAULT_ACCENT_THEME,
  accentPalette: defaultPalette,
  availableAccents: ACCENT_THEME_LIST,
  pwaThemeColor: defaultPalette.baseHex,
  setAccentTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const getSystemPreference = (): ResolvedTheme => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        return stored;
      }
      return 'light';
    } catch {
      return 'light';
    }
  });

  const [theme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    try {
      const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY);
      if (stored === 'dark') return 'dark';
      if (stored === 'light') return 'light';
      if (stored === 'system') {
        return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      }
      return 'light';
    } catch {
      return 'light';
    }
  });

  const [accentTheme, setAccentThemeState] = useState<AccentThemeId>(() => getStoredAccentTheme());

  const accentPalette = resolveAccentPalette(accentTheme);

  const isFirstMount = useRef(true);
  const transitionTimeoutRef = useRef<number | null>(null);
  const themeModeRef = useRef<ThemeMode>(themeMode);
  const accentThemeRef = useRef<AccentThemeId>(accentTheme);

  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  useEffect(() => {
    accentThemeRef.current = accentTheme;
  }, [accentTheme]);

  const applyThemeToDOM = (resolved: ResolvedTheme, animate = true) => {
    try {
      const root = document.documentElement;
      const body = document.body;

      // Trigger subtle cross-fade transition class on theme switch
      if (animate && !isFirstMount.current) {
        root.classList.add('theme-transitioning');
        if (body) {
          body.classList.add('theme-transitioning');
        }
        if (transitionTimeoutRef.current) {
          window.clearTimeout(transitionTimeoutRef.current);
        }
        transitionTimeoutRef.current = window.setTimeout(() => {
          root.classList.remove('theme-transitioning');
          if (body) {
            body.classList.remove('theme-transitioning');
          }
        }, 450);
      }

      if (resolved === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
        root.style.colorScheme = 'dark';
        root.setAttribute('data-theme', 'dark');
        if (body) {
          body.classList.add('dark');
          body.classList.remove('light');
          body.style.colorScheme = 'dark';
        }
      } else {
        root.classList.remove('dark');
        root.classList.add('light');
        root.style.colorScheme = 'light';
        root.setAttribute('data-theme', 'light');
        if (body) {
          body.classList.remove('dark');
          body.classList.add('light');
          body.style.colorScheme = 'light';
        }
      }
      window.dispatchEvent(
        new CustomEvent('pos:theme-changed', {
          detail: {
            theme: resolved,
            accentTheme: accentThemeRef.current,
            pwaThemeColor: resolveAccentPalette(accentThemeRef.current).baseHex,
          },
        })
      );
    } catch (e) {
      console.error('Error applying theme:', e);
    }
  };

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    } catch (_) {}
    const resolved = mode === 'system' ? getSystemPreference() : mode;
    setResolvedTheme(resolved);
    applyThemeToDOM(resolved, true);
  };

  const setTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
  };

  const toggleTheme = () => {
    // If currently dark, switch to light, else dark
    const nextMode: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setThemeMode(nextMode);
  };

  const setAccentTheme = (nextAccent: AccentThemeId) => {
    const valid = persistAccentTheme(nextAccent);
    setAccentThemeState(valid);
    const applied = applyAccentThemeToDOM(valid);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pos:theme-changed', {
          detail: {
            theme,
            accentTheme: valid,
            pwaThemeColor: applied.baseHex,
          },
        })
      );
    }
  };

  // Synchronize on mount and whenever themeMode changes
  useEffect(() => {
    const resolved = themeMode === 'system' ? getSystemPreference() : themeMode;
    setResolvedTheme(resolved);
    applyThemeToDOM(resolved, !isFirstMount.current);
    if (isFirstMount.current) {
      isFirstMount.current = false;
    }
  }, [themeMode]);

  // Apply accent CSS variables + PWA meta[name="theme-color"] on mount and whenever accentTheme changes
  useEffect(() => {
    applyAccentThemeToDOM(accentTheme);
  }, [accentTheme]);

  // Real-time OS theme change listener when "system" is selected
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      if (themeModeRef.current === 'system') {
        const newResolved: ResolvedTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newResolved);
        applyThemeToDOM(newResolved, true);
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Synchronize theme & accent changes across tabs/windows
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === null) {
        setThemeModeState('light');
        setAccentThemeState(DEFAULT_ACCENT_THEME);
        return;
      }
      if (e.key === THEME_MODE_STORAGE_KEY) {
        if (e.newValue === 'dark' || e.newValue === 'light' || e.newValue === 'system') {
          setThemeModeState(e.newValue as ThemeMode);
        } else if (e.newValue === null) {
          setThemeModeState('light');
        }
      }
      if (e.key === ACCENT_THEME_STORAGE_KEY) {
        if (isValidAccentTheme(e.newValue)) {
          setAccentThemeState(e.newValue);
        } else if (e.newValue === null) {
          setAccentThemeState(DEFAULT_ACCENT_THEME);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeMode,
        setThemeMode,
        setTheme,
        toggleTheme,
        accentTheme,
        accentPalette,
        availableAccents: ACCENT_THEME_LIST,
        pwaThemeColor: accentPalette.baseHex,
        setAccentTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);



