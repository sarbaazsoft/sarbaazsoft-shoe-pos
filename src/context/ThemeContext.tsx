import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.ts';
import {
  ACCENT_THEME_LIST,
  ACCENT_THEME_STORAGE_KEY,
  CUSTOM_ACCENT_HEX_STORAGE_KEY,
  DEFAULT_ACCENT_THEME,
  DEFAULT_CUSTOM_ACCENT_HEX,
  GUEST_ACCENT_THEME_STORAGE_KEY,
  GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY,
  GUEST_THEME_MODE_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  type AccentThemeId,
  type AccentThemePalette,
  type ThemeModePreference,
  type ThemePreferencesSnapshot,
  applyAccentThemeToDOM,
  getStoredGuestThemePreferences,
  getUserThemeCacheKey,
  migrateLegacyGuestThemeIfNeeded,
  normalizeAccentThemeId,
  normalizeHexColor,
  normalizeThemeMode,
  parseUserThemePreference,
  persistActiveHydrationMirror,
  persistGuestThemePreferences,
  resolveAccentPalette,
  serializeUserThemePreference,
} from '../utils/themePalettes.ts';
import {
  EMPTY_SCREEN_IMAGES,
  type ScreenImageSlot,
  type ScreenImagesMap,
  readCachedScreenImages,
  writeCachedScreenImages,
} from '../utils/screenImages.ts';

export type ThemeMode = ThemeModePreference;
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
  customAccentHex: string;
  pwaThemeColor: string;
  setAccentTheme: (accent: AccentThemeId) => void;
  setCustomAccentColor: (hex: string) => void;

  // Smart persistence & live preview controls
  isAuthenticatedSession: boolean;
  isPreviewActive: boolean;
  hasUnsavedColorPreview: boolean;
  hasUnsavedImagePreview: boolean;
  isSavingAppearance: boolean;
  appearanceSaveError: string | null;
  clearAppearanceSaveError: () => void;
  committedPreferences: ThemePreferencesSnapshot;
  updatePreview: (partial: Partial<ThemePreferencesSnapshot>) => void;
  cancelPreview: () => void;
  applyAndSaveAppearance: (options?: { canSaveScreenImages?: boolean }) => Promise<void>;
  resetAppearanceToDefault: (options?: { persistImmediately?: boolean }) => Promise<void>;
  syncUserThemeFromAuth: (user: any | null) => void;
  restoreGuestThemeOnLogout: () => void;

  // Authentication & Loading Screen Images
  screenImages: ScreenImagesMap;
  effectiveScreenImages: ScreenImagesMap;
  getEffectiveScreenImage: (slot: ScreenImageSlot) => string;
  updateScreenImagesPreview: (partial: Partial<ScreenImagesMap>) => void;
  refreshScreenImages: () => Promise<void>;
}

const defaultPalette = resolveAccentPalette(DEFAULT_ACCENT_THEME);
const defaultPrefs: ThemePreferencesSnapshot = {
  themeMode: 'light',
  accentTheme: DEFAULT_ACCENT_THEME,
  customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
};

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  themeMode: 'light',
  setThemeMode: () => {},
  setTheme: () => {},
  toggleTheme: () => {},
  accentTheme: DEFAULT_ACCENT_THEME,
  accentPalette: defaultPalette,
  availableAccents: ACCENT_THEME_LIST,
  customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
  pwaThemeColor: defaultPalette.baseHex,
  setAccentTheme: () => {},
  setCustomAccentColor: () => {},
  isAuthenticatedSession: false,
  isPreviewActive: false,
  hasUnsavedColorPreview: false,
  hasUnsavedImagePreview: false,
  isSavingAppearance: false,
  appearanceSaveError: null,
  clearAppearanceSaveError: () => {},
  committedPreferences: defaultPrefs,
  updatePreview: () => {},
  cancelPreview: () => {},
  applyAndSaveAppearance: async () => {},
  resetAppearanceToDefault: async () => {},
  syncUserThemeFromAuth: () => {},
  restoreGuestThemeOnLogout: () => {},
  screenImages: EMPTY_SCREEN_IMAGES,
  effectiveScreenImages: EMPTY_SCREEN_IMAGES,
  getEffectiveScreenImage: () => '',
  updateScreenImagesPreview: () => {},
  refreshScreenImages: async () => {},
});

function readInitialAuthUser(): any | null {
  if (typeof window === 'undefined') return null;
  try {
    const token =
      window.localStorage?.getItem('pos_auth_token') ||
      window.localStorage?.getItem('shoe_pos_jwt_token');
    const rawUser =
      window.localStorage?.getItem('pos_current_user') ||
      window.localStorage?.getItem('shoe_pos_user');
    if (!token || !rawUser) return null;
    const parsed = JSON.parse(rawUser);
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function resolveInitialCommittedPreferences(): {
  userId: number | null;
  prefs: ThemePreferencesSnapshot;
} {
  const user = readInitialAuthUser();
  if (user && user.id) {
    const uid = Number(user.id);
    const rawUserTheme = user.themeColor ?? user.theme_color;
    if (typeof rawUserTheme === 'string' && rawUserTheme.trim()) {
      return {
        userId: uid,
        prefs: parseUserThemePreference(rawUserTheme, defaultPrefs),
      };
    }
    try {
      const cachedRaw = window.localStorage?.getItem(getUserThemeCacheKey(uid));
      if (cachedRaw) {
        return {
          userId: uid,
          prefs: parseUserThemePreference(cachedRaw, defaultPrefs),
        };
      }
    } catch {}
    return { userId: uid, prefs: { ...defaultPrefs } };
  }

  migrateLegacyGuestThemeIfNeeded();
  const guestPrefs = getStoredGuestThemePreferences();

  return {
    userId: null,
    prefs: guestPrefs,
  };
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const getSystemPreference = (): ResolvedTheme => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  const initialSession = useMemo(() => resolveInitialCommittedPreferences(), []);

  const [activeUserId, setActiveUserId] = useState<number | null>(initialSession.userId);
  const [committedPreferences, setCommittedPreferences] = useState<ThemePreferencesSnapshot>(
    initialSession.prefs
  );
  const [previewPreferences, setPreviewPreferences] = useState<ThemePreferencesSnapshot | null>(null);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [appearanceSaveError, setAppearanceSaveError] = useState<string | null>(null);

  const [committedScreenImages, setCommittedScreenImages] = useState<ScreenImagesMap>(() =>
    readCachedScreenImages()
  );
  const [previewScreenImages, setPreviewScreenImages] = useState<ScreenImagesMap | null>(null);

  // Effective preferences drive the live DOM across the whole app
  const effectivePrefs = previewPreferences ?? committedPreferences;
  const effectiveScreenImages = previewScreenImages ?? committedScreenImages;
  const themeMode = effectivePrefs.themeMode;
  const accentTheme = effectivePrefs.accentTheme;
  const customAccentHex = effectivePrefs.customAccentHex;

  const [theme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (effectivePrefs.themeMode === 'dark') return 'dark';
    if (effectivePrefs.themeMode === 'light') return 'light';
    return getSystemPreference();
  });

  const accentPalette = resolveAccentPalette(accentTheme, customAccentHex);

  const isFirstMount = useRef(true);
  const transitionTimeoutRef = useRef<number | null>(null);
  const requestEpochRef = useRef(0);
  const activeUserIdRef = useRef<number | null>(activeUserId);
  const committedPrefsRef = useRef<ThemePreferencesSnapshot>(committedPreferences);
  const themeModeRef = useRef<ThemeMode>(themeMode);
  const accentThemeRef = useRef<AccentThemeId>(accentTheme);
  const customAccentHexRef = useRef<string>(customAccentHex);

  useEffect(() => {
    activeUserIdRef.current = activeUserId;
  }, [activeUserId]);

  useEffect(() => {
    committedPrefsRef.current = committedPreferences;
  }, [committedPreferences]);

  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  useEffect(() => {
    accentThemeRef.current = accentTheme;
  }, [accentTheme]);

  useEffect(() => {
    customAccentHexRef.current = customAccentHex;
  }, [customAccentHex]);

  const applyThemeToDOM = useCallback((resolved: ResolvedTheme, animate = true) => {
    try {
      const root = document.documentElement;
      const body = document.body;

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
            pwaThemeColor: resolveAccentPalette(accentThemeRef.current, customAccentHexRef.current).baseHex,
          },
        })
      );
    } catch (e) {
      console.error('Error applying theme:', e);
    }
  }, []);

  const persistUserThemeToDb = useCallback(
    async (userId: number, nextPrefs: ThemePreferencesSnapshot): Promise<boolean> => {
      const epoch = ++requestEpochRef.current;
      const serialized = serializeUserThemePreference(nextPrefs);
      try {
        const res = await api.auth.saveTheme(serialized);
        // Ignore stale completions if user switched accounts or logged out mid-flight
        if (requestEpochRef.current !== epoch || activeUserIdRef.current !== userId) {
          return false;
        }
        const authoritative = res?.themeColor ? parseUserThemePreference(res.themeColor, nextPrefs) : nextPrefs;
        setCommittedPreferences(authoritative);
        try {
          window.localStorage?.setItem(getUserThemeCacheKey(userId), serializeUserThemePreference(authoritative));
          const rawStoredUser = window.localStorage?.getItem('pos_current_user');
          if (rawStoredUser) {
            const parsedUser = JSON.parse(rawStoredUser);
            if (Number(parsedUser?.id) === userId) {
              parsedUser.themeColor = serializeUserThemePreference(authoritative);
              window.localStorage?.setItem('pos_current_user', JSON.stringify(parsedUser));
            }
          }
        } catch {}
        persistActiveHydrationMirror(authoritative);
        setAppearanceSaveError(null);
        return true;
      } catch (err: any) {
        if (requestEpochRef.current === epoch && activeUserIdRef.current === userId) {
          setAppearanceSaveError(err?.message || 'Failed to save appearance preferences to your account.');
        }
        return false;
      }
    },
    []
  );

  /**
   * Direct instant setter used by the header ThemeDropdown.
   * - For Guests: persists straight to pos_guest_* localStorage.
   * - For Authenticated Users: optimistically renders, persists to users.theme_color via DB,
   *   and syncs localStorage cache ONLY after DB confirmation (reverting on DB failure).
   */
  const commitQuickPreferenceChange = useCallback(
    (updater: (prev: ThemePreferencesSnapshot) => ThemePreferencesSnapshot) => {
      const prevCommitted = committedPrefsRef.current;
      const nextPrefs = updater(prevCommitted);
      const currentUid = activeUserIdRef.current;
      setPreviewPreferences(null);
      setAppearanceSaveError(null);
      setCommittedPreferences(nextPrefs);

      if (!currentUid) {
        persistGuestThemePreferences(nextPrefs);
        return;
      }

      void persistUserThemeToDb(currentUid, nextPrefs).then((ok) => {
        if (!ok && activeUserIdRef.current === currentUid) {
          // Database save failed: restore previously committed state and never pollute localStorage
          setCommittedPreferences(prevCommitted);
        }
      });
    },
    [persistUserThemeToDb]
  );

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      commitQuickPreferenceChange((prev) => ({
        ...prev,
        themeMode: normalizeThemeMode(mode, prev.themeMode),
      }));
    },
    [commitQuickPreferenceChange]
  );

  const setTheme = useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode);
    },
    [setThemeMode]
  );

  const toggleTheme = useCallback(() => {
    const nextMode: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setThemeMode(nextMode);
  }, [theme, setThemeMode]);

  const setAccentTheme = useCallback(
    (nextAccent: AccentThemeId) => {
      const validAccent = normalizeAccentThemeId(nextAccent) ?? DEFAULT_ACCENT_THEME;
      commitQuickPreferenceChange((prev) => ({
        ...prev,
        accentTheme: validAccent,
      }));
    },
    [commitQuickPreferenceChange]
  );

  const setCustomAccentColor = useCallback(
    (rawHex: string) => {
      const validHex = normalizeHexColor(rawHex, DEFAULT_CUSTOM_ACCENT_HEX);
      commitQuickPreferenceChange((prev) => ({
        ...prev,
        accentTheme: 'custom',
        customAccentHex: validHex,
      }));
    },
    [commitQuickPreferenceChange]
  );

  // Live Preview Actions (never mutate saved localStorage or database until Apply/Save)
  const updatePreview = useCallback((partial: Partial<ThemePreferencesSnapshot>) => {
    setAppearanceSaveError(null);
    setPreviewPreferences((prev) => {
      const base = prev ?? committedPrefsRef.current;
      return {
        themeMode: partial.themeMode !== undefined ? normalizeThemeMode(partial.themeMode, base.themeMode) : base.themeMode,
        accentTheme:
          partial.accentTheme !== undefined
            ? normalizeAccentThemeId(partial.accentTheme) ?? base.accentTheme
            : base.accentTheme,
        customAccentHex:
          partial.customAccentHex !== undefined
            ? normalizeHexColor(partial.customAccentHex, base.customAccentHex)
            : base.customAccentHex,
      };
    });
  }, []);

  const updateScreenImagesPreview = useCallback((partial: Partial<ScreenImagesMap>) => {
    setAppearanceSaveError(null);
    setPreviewScreenImages((prev) => {
      const base = prev ?? committedScreenImages;
      return {
        login: partial.login !== undefined ? partial.login : base.login,
        registration: partial.registration !== undefined ? partial.registration : base.registration,
        auth: partial.auth !== undefined ? partial.auth : base.auth,
        loading: partial.loading !== undefined ? partial.loading : base.loading,
      };
    });
  }, [committedScreenImages]);

  const cancelPreview = useCallback(() => {
    setPreviewPreferences(null);
    setPreviewScreenImages(null);
    setAppearanceSaveError(null);
  }, []);

  const hasUnsavedColorPreview = useMemo(() => {
    if (!previewPreferences) return false;
    return (
      previewPreferences.themeMode !== committedPreferences.themeMode ||
      previewPreferences.accentTheme !== committedPreferences.accentTheme ||
      (previewPreferences.accentTheme === 'custom' &&
        previewPreferences.customAccentHex !== committedPreferences.customAccentHex)
    );
  }, [previewPreferences, committedPreferences]);

  const hasUnsavedImagePreview = useMemo(() => {
    if (!previewScreenImages) return false;
    return (
      previewScreenImages.login !== committedScreenImages.login ||
      previewScreenImages.registration !== committedScreenImages.registration ||
      previewScreenImages.auth !== committedScreenImages.auth ||
      previewScreenImages.loading !== committedScreenImages.loading
    );
  }, [previewScreenImages, committedScreenImages]);

  const isPreviewActive = hasUnsavedColorPreview || hasUnsavedImagePreview;

  const applyAndSaveAppearance = useCallback(
    async (options?: { canSaveScreenImages?: boolean }) => {
      setIsSavingAppearance(true);
      setAppearanceSaveError(null);
      try {
        const targetPrefs = previewPreferences ?? committedPrefsRef.current;
        const uid = activeUserIdRef.current;
        const epoch = ++requestEpochRef.current;

        if (hasUnsavedColorPreview) {
          if (uid) {
            const serialized = serializeUserThemePreference(targetPrefs);
            const res = await api.auth.saveTheme(serialized);
            if (requestEpochRef.current !== epoch || activeUserIdRef.current !== uid) {
              return;
            }
            const savedPrefs = res?.themeColor
              ? parseUserThemePreference(res.themeColor, targetPrefs)
              : targetPrefs;
            setCommittedPreferences(savedPrefs);
            try {
              window.localStorage?.setItem(getUserThemeCacheKey(uid), serializeUserThemePreference(savedPrefs));
              const rawStoredUser = window.localStorage?.getItem('pos_current_user');
              if (rawStoredUser) {
                const parsedUser = JSON.parse(rawStoredUser);
                if (Number(parsedUser?.id) === uid) {
                  parsedUser.themeColor = serializeUserThemePreference(savedPrefs);
                  window.localStorage?.setItem('pos_current_user', JSON.stringify(parsedUser));
                }
              }
            } catch {}
            persistActiveHydrationMirror(savedPrefs);
          } else {
            setCommittedPreferences(targetPrefs);
            persistGuestThemePreferences(targetPrefs);
          }
          setPreviewPreferences(null);
        } else {
          setPreviewPreferences(null);
        }

        if (hasUnsavedImagePreview && options?.canSaveScreenImages) {
          const targetImages = previewScreenImages ?? committedScreenImages;
          const imgRes = await api.settings.saveScreenImages(targetImages);
          if (requestEpochRef.current !== epoch) return;
          const savedImages: ScreenImagesMap = {
            login: imgRes?.screenImages?.login ?? targetImages.login,
            registration: imgRes?.screenImages?.registration ?? targetImages.registration,
            auth: imgRes?.screenImages?.auth ?? targetImages.auth,
            loading: imgRes?.screenImages?.loading ?? targetImages.loading,
          };
          setCommittedScreenImages(savedImages);
          writeCachedScreenImages(savedImages);
          setPreviewScreenImages(null);
        } else if (!options?.canSaveScreenImages && previewScreenImages) {
          setPreviewScreenImages(null);
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to save appearance settings. Your previous saved settings remain intact.';
        setAppearanceSaveError(msg);
        throw err;
      } finally {
        setIsSavingAppearance(false);
      }
    },
    [previewPreferences, hasUnsavedColorPreview, hasUnsavedImagePreview, previewScreenImages, committedScreenImages]
  );

  const resetAppearanceToDefault = useCallback(
    async (options?: { persistImmediately?: boolean }) => {
      if (options?.persistImmediately) {
        setIsSavingAppearance(true);
        setAppearanceSaveError(null);
        try {
          const uid = activeUserIdRef.current;
          const epoch = ++requestEpochRef.current;
          const resetTarget: ThemePreferencesSnapshot = { ...defaultPrefs };
          if (uid) {
            await api.auth.saveTheme(serializeUserThemePreference(resetTarget));
            if (requestEpochRef.current !== epoch || activeUserIdRef.current !== uid) return;
            setCommittedPreferences(resetTarget);
            try {
              window.localStorage?.setItem(getUserThemeCacheKey(uid), serializeUserThemePreference(resetTarget));
            } catch {}
            persistActiveHydrationMirror(resetTarget);
          } else {
            setCommittedPreferences(resetTarget);
            persistGuestThemePreferences(resetTarget);
          }
          setPreviewPreferences(null);
        } catch (err: any) {
          setAppearanceSaveError(err?.message || 'Failed to reset theme preference.');
          throw err;
        } finally {
          setIsSavingAppearance(false);
        }
        return;
      }

      updatePreview({ ...defaultPrefs });
    },
    [updatePreview]
  );

  // Sync database preferences strictly on login / session refresh / account switch
  const syncUserThemeFromAuth = useCallback((user: any | null) => {
    requestEpochRef.current += 1;
    setAppearanceSaveError(null);
    setPreviewPreferences(null);

    if (!user || !user.id) {
      setActiveUserId(null);
      const guestPrefs = getStoredGuestThemePreferences();
      setCommittedPreferences(guestPrefs);
      persistActiveHydrationMirror(guestPrefs);
      return;
    }

    const uid = Number(user.id);
    setActiveUserId(uid);

    const dbRaw = user.themeColor ?? user.theme_color;
    let resolvedPrefs: ThemePreferencesSnapshot;
    if (typeof dbRaw === 'string' && dbRaw.trim()) {
      resolvedPrefs = parseUserThemePreference(dbRaw, defaultPrefs);
      try {
        window.localStorage?.setItem(getUserThemeCacheKey(uid), serializeUserThemePreference(resolvedPrefs));
      } catch {}
    } else {
      // Fresh DB user with empty theme_color starts cleanly with app defaults (never inheriting previous user/guest)
      resolvedPrefs = { ...defaultPrefs };
      try {
        window.localStorage?.removeItem(getUserThemeCacheKey(uid));
      } catch {}
    }

    setCommittedPreferences(resolvedPrefs);
    persistActiveHydrationMirror(resolvedPrefs);
  }, []);

  // Restore independent guest preferences immediately on logout
  const restoreGuestThemeOnLogout = useCallback(() => {
    requestEpochRef.current += 1;
    setActiveUserId(null);
    setPreviewPreferences(null);
    setPreviewScreenImages(null);
    setAppearanceSaveError(null);

    const guestPrefs = getStoredGuestThemePreferences();
    setCommittedPreferences(guestPrefs);
    persistActiveHydrationMirror(guestPrefs);
  }, []);

  const refreshScreenImages = useCallback(async () => {
    try {
      const res = await api.settings.getScreenImages();
      if (res?.screenImages) {
        const next: ScreenImagesMap = {
          login: String(res.screenImages.login || '').trim(),
          registration: String(res.screenImages.registration || '').trim(),
          auth: String(res.screenImages.auth || '').trim(),
          loading: String(res.screenImages.loading || '').trim(),
        };
        setCommittedScreenImages(next);
        writeCachedScreenImages(next);
      }
    } catch {
      // ignore transient offline fetch failures; cached images remain active
    }
  }, []);

  const getEffectiveScreenImage = useCallback(
    (slot: ScreenImageSlot) => effectiveScreenImages[slot] || '',
    [effectiveScreenImages]
  );

  // Fetch public screen images on initial mount
  useEffect(() => {
    void refreshScreenImages();
  }, [refreshScreenImages]);

  // Synchronize resolved Light/Dark DOM class whenever effective themeMode changes
  useEffect(() => {
    const resolved = themeMode === 'system' ? getSystemPreference() : themeMode;
    setResolvedTheme(resolved);
    applyThemeToDOM(resolved, !isFirstMount.current);
    if (isFirstMount.current) {
      isFirstMount.current = false;
    }
  }, [themeMode, applyThemeToDOM]);

  // Apply accent CSS variables + PWA meta[name="theme-color"] whenever effective accent/custom HEX changes
  useEffect(() => {
    applyAccentThemeToDOM(accentTheme, customAccentHex);
  }, [accentTheme, customAccentHex]);

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
  }, [applyThemeToDOM]);

  // Synchronize guest/active theme across browser tabs carefully without bleeding into different users
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === null) {
        setCommittedPreferences({ ...defaultPrefs });
        setPreviewPreferences(null);
        return;
      }
      if (!activeUserIdRef.current) {
        if (
          e.key === GUEST_THEME_MODE_STORAGE_KEY ||
          e.key === THEME_MODE_STORAGE_KEY
        ) {
          if (e.newValue === 'dark' || e.newValue === 'light' || e.newValue === 'system') {
            setCommittedPreferences((prev) => ({ ...prev, themeMode: e.newValue as ThemeMode }));
          }
        }
        if (
          e.key === GUEST_ACCENT_THEME_STORAGE_KEY ||
          e.key === ACCENT_THEME_STORAGE_KEY
        ) {
          const normalized = normalizeAccentThemeId(e.newValue);
          if (normalized) {
            setCommittedPreferences((prev) => ({ ...prev, accentTheme: normalized }));
          }
        }
        if (
          e.key === GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY ||
          e.key === CUSTOM_ACCENT_HEX_STORAGE_KEY
        ) {
          setCommittedPreferences((prev) => ({
            ...prev,
            customAccentHex: normalizeHexColor(e.newValue, DEFAULT_CUSTOM_ACCENT_HEX),
          }));
        }
      } else {
        const expectedUserCacheKey = getUserThemeCacheKey(activeUserIdRef.current);
        if (e.key === expectedUserCacheKey && e.newValue) {
          setCommittedPreferences(parseUserThemePreference(e.newValue, defaultPrefs));
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
        customAccentHex,
        pwaThemeColor: accentPalette.baseHex,
        setAccentTheme,
        setCustomAccentColor,
        isAuthenticatedSession: activeUserId !== null,
        isPreviewActive,
        hasUnsavedColorPreview,
        hasUnsavedImagePreview,
        isSavingAppearance,
        appearanceSaveError,
        clearAppearanceSaveError: () => setAppearanceSaveError(null),
        committedPreferences,
        updatePreview,
        cancelPreview,
        applyAndSaveAppearance,
        resetAppearanceToDefault,
        syncUserThemeFromAuth,
        restoreGuestThemeOnLogout,
        screenImages: committedScreenImages,
        effectiveScreenImages,
        getEffectiveScreenImage,
        updateScreenImagesPreview,
        refreshScreenImages,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
