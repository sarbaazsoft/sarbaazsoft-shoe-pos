import { useCallback, useEffect, useRef, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface UsePWAInstallOptions {
  autoPrompt?: boolean;
  allowIOSInstructions?: boolean;
  onShowIOSInstructions?: () => void;
}

export interface PwaPlatformInfo {
  isIOS: boolean;
  isIOSSafari: boolean;
  isSafari: boolean;
  isAndroid: boolean;
  isEdge: boolean;
  isChrome: boolean;
  isWindows: boolean;
}

export type DetectedInstallTarget = 'android' | 'apple' | 'desktop';

export interface InstallPlatformDescriptor {
  target: DetectedInstallTarget;
  buttonLabel: string;
  badgeLabel: string;
  tooltip: string;
}

export function resolveDetectedInstallPlatform(platform: {
  isAndroid: boolean;
  isIOS: boolean;
  isIOSSafari?: boolean;
  isSafari?: boolean;
  isWindows?: boolean;
}): InstallPlatformDescriptor {
  if (platform.isAndroid) {
    return {
      target: 'android',
      buttonLabel: 'Install App (APK)',
      badgeLabel: 'Android APK',
      tooltip: 'Download & install SarbaazSoft Shoe POS Android APK',
    };
  }
  if (platform.isIOS || platform.isSafari) {
    return {
      target: 'apple',
      buttonLabel: platform.isIOS ? 'Install App (iOS)' : 'Install App (Safari)',
      badgeLabel: 'Safari PWA',
      tooltip: 'Install SarbaazSoft Shoe POS via Apple Safari PWA',
    };
  }
  return {
    target: 'desktop',
    buttonLabel: 'Install App',
    badgeLabel: platform.isWindows ? 'Win • PWA' : 'Desktop PWA',
    tooltip: platform.isWindows
      ? 'Install SarbaazSoft Shoe POS Desktop PWA or Windows .EXE'
      : 'Install SarbaazSoft Shoe POS Desktop PWA',
  };
}

export const PWA_INSTALL_DISMISSED_KEY = 'pos_pwa_install_dismissed';
export const PWA_INSTALLED_KEY = 'pos_pwa_installed';

let memoryDismissed = false;
let memoryInstalled = false;
let hasAutoPromptedInSession = false;

function safeReadStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null) return val;
    }
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
  } catch {}
  return null;
}

function safeWriteStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
    }
  } catch {}
}

function safeRemoveStorage(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {}
}

export function detectPwaPlatform(
  nav: Partial<Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>> | undefined =
    typeof navigator !== 'undefined' ? navigator : undefined
): PwaPlatformInfo {
  const ua = String(nav?.userAgent || '').toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);
  const isAndroid = /android/.test(ua);
  const isEdge = /edg(e|a|ios)?\//.test(ua);
  const isChrome =
    /chrome|crios/.test(ua) && !/edg(e|a|ios)?\/|opr\/|opera|samsungbrowser/.test(ua);
  const isWindows = /windows/.test(ua);
  const isIOSSafari =
    isIOS && /safari/.test(ua) && !/crios|fxios|edgios|opios|yabrowser|gsa/.test(ua);
  const isSafari =
    !isAndroid &&
    /safari/.test(ua) &&
    !/chrome|crios|chromium|edg(e|a|ios)?\/|fxios|firefox|opr\/|opera|opios|samsungbrowser|yabrowser|gsa/.test(
      ua
    );

  return {
    isIOS,
    isIOSSafari,
    isSafari,
    isAndroid,
    isEdge,
    isChrome,
    isWindows,
  };
}

export function detectIsPwaInstalled(
  win: any = typeof window !== 'undefined' ? window : undefined,
  doc: any = typeof document !== 'undefined' ? document : undefined
): boolean {
  if (memoryInstalled) return true;
  if (safeReadStorage(PWA_INSTALLED_KEY) === '1') return true;
  if (!win) return false;

  if (win.__pwaInstalled === true) return true;

  try {
    if (win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    if (win.matchMedia?.('(display-mode: window-controls-overlay)')?.matches) return true;
  } catch {}

  if ((win.navigator as { standalone?: boolean } | undefined)?.standalone === true) {
    return true;
  }

  try {
    if (String(doc?.referrer || '').startsWith('android-app://')) {
      return true;
    }
  } catch {}

  return false;
}

export async function checkInstalledRelatedAppsAsync(
  nav: any = typeof navigator !== 'undefined' ? navigator : undefined
): Promise<boolean> {
  try {
    if (typeof nav?.getInstalledRelatedApps === 'function') {
      const apps = await nav.getInstalledRelatedApps();
      return Array.isArray(apps) && apps.length > 0;
    }
  } catch {}
  return false;
}

export function isPwaInstallDismissed(): boolean {
  return memoryDismissed || safeReadStorage(PWA_INSTALL_DISMISSED_KEY) === '1';
}

export function markPwaInstallDismissed(): void {
  memoryDismissed = true;
  safeWriteStorage(PWA_INSTALL_DISMISSED_KEY, '1');
}

export function markPwaInstalled(): void {
  memoryInstalled = true;
  safeWriteStorage(PWA_INSTALLED_KEY, '1');
  if (typeof window !== 'undefined') {
    (window as any).__pwaInstalled = true;
    (window as any).__deferredPwaPrompt = null;
  }
}

export function getGlobalDeferredPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  return ((window as any).__deferredPwaPrompt as BeforeInstallPromptEvent | null) || null;
}

export function clearGlobalDeferredPrompt(): void {
  if (typeof window !== 'undefined') {
    (window as any).__deferredPwaPrompt = null;
  }
}

export function resetPwaInstallStateForTests(): void {
  memoryDismissed = false;
  memoryInstalled = false;
  hasAutoPromptedInSession = false;
  safeRemoveStorage(PWA_INSTALL_DISMISSED_KEY);
  safeRemoveStorage(PWA_INSTALLED_KEY);
  if (typeof window !== 'undefined') {
    (window as any).__pwaInstalled = false;
    (window as any).__deferredPwaPrompt = null;
  }
}

export async function triggerNativeInstallPrompt(
  promptEvent: BeforeInstallPromptEvent | null,
  options?: { isInstalled?: boolean }
): Promise<'accepted' | 'dismissed' | 'unavailable' | 'error'> {
  if (!promptEvent || options?.isInstalled || detectIsPwaInstalled()) {
    return 'unavailable';
  }

  try {
    // Must invoke prompt() synchronously inside user gesture call stack
    const promptResult = promptEvent.prompt();
    clearGlobalDeferredPrompt();
    await promptResult;
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      markPwaInstalled();
      return 'accepted';
    }
    markPwaInstallDismissed();
    return 'dismissed';
  } catch (err: any) {
    if (err?.name !== 'NotAllowedError') {
      clearGlobalDeferredPrompt();
    }
    console.error('PWA install prompt error:', err);
    return 'error';
  }
}

export interface AutoPromptControllerParams {
  enabled: boolean;
  isInstalled: boolean;
  isDismissed: boolean;
  deferredPrompt: BeforeInstallPromptEvent | null;
  isIOSSafari: boolean;
  allowIOSInstructions: boolean;
  win?: any;
  iosDelayMs?: number;
  onTriggerNativePrompt: (promptEvent: BeforeInstallPromptEvent) => void;
  onShowIOSInstructions?: () => void;
}

export function attachFirstVisitAutoPrompt(params: AutoPromptControllerParams): () => void {
  const {
    enabled,
    isInstalled,
    isDismissed,
    deferredPrompt,
    isIOSSafari,
    allowIOSInstructions,
    win = typeof window !== 'undefined' ? window : undefined,
    iosDelayMs = 1200,
    onTriggerNativePrompt,
    onShowIOSInstructions,
  } = params;

  if (!win || !enabled || isInstalled || isDismissed || hasAutoPromptedInSession) {
    return () => {};
  }

  if (deferredPrompt) {
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      win.removeEventListener('click', handleUserGesture, true);
      win.removeEventListener('keydown', handleUserGesture, true);
    };

    const handleUserGesture = (event: any) => {
      if (cleanedUp || hasAutoPromptedInSession || detectIsPwaInstalled() || isPwaInstallDismissed()) {
        cleanup();
        return;
      }

      if (event?.type === 'keydown') {
        const key = String(event.key || '');
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          key === 'Shift' ||
          key === 'Control' ||
          key === 'Alt' ||
          key === 'Meta' ||
          key === 'Escape' ||
          key === 'Tab'
        ) {
          return;
        }
      }

      if (event?.type === 'click') {
        const target = event?.target as { closest?: (selector: string) => unknown } | undefined;
        if (target?.closest?.('#sidebar-install-app-btn, [data-pwa-manual-install]')) {
          return;
        }
      }

      hasAutoPromptedInSession = true;
      cleanup();
      onTriggerNativePrompt(deferredPrompt);
    };

    win.addEventListener('click', handleUserGesture, true);
    win.addEventListener('keydown', handleUserGesture, true);
    return cleanup;
  }

  if (isIOSSafari && allowIOSInstructions && onShowIOSInstructions) {
    const timer = setTimeout(() => {
      if (hasAutoPromptedInSession || detectIsPwaInstalled() || isPwaInstallDismissed()) {
        return;
      }
      hasAutoPromptedInSession = true;
      onShowIOSInstructions();
    }, iosDelayMs);

    return () => clearTimeout(timer);
  }

  return () => {};
}

export function usePWAInstall(options: UsePWAInstallOptions = {}) {
  const { autoPrompt = false, allowIOSInstructions = true, onShowIOSInstructions } = options;

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (detectIsPwaInstalled()) return null;
    return getGlobalDeferredPrompt();
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(() => detectIsPwaInstalled());
  const [isDismissed, setIsDismissed] = useState<boolean>(() => isPwaInstallDismissed());
  const [isInstallCheckComplete, setIsInstallCheckComplete] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return typeof (navigator as any).getInstalledRelatedApps !== 'function';
  });

  const initialPlatform = detectPwaPlatform();
  const [isIOS, setIsIOS] = useState(initialPlatform.isIOS);
  const [isIOSSafari, setIsIOSSafari] = useState(initialPlatform.isIOSSafari);
  const [isSafari, setIsSafari] = useState(initialPlatform.isSafari);
  const [isAndroid, setIsAndroid] = useState(initialPlatform.isAndroid);
  const [isEdge, setIsEdge] = useState(initialPlatform.isEdge);
  const [isChrome, setIsChrome] = useState(initialPlatform.isChrome);
  const [isWindows, setIsWindows] = useState(initialPlatform.isWindows);

  const onShowIOSInstructionsRef = useRef(onShowIOSInstructions);
  onShowIOSInstructionsRef.current = onShowIOSInstructions;

  useEffect(() => {
    const platform = detectPwaPlatform();
    setIsIOS(platform.isIOS);
    setIsIOSSafari(platform.isIOSSafari);
    setIsSafari(platform.isSafari);
    setIsAndroid(platform.isAndroid);
    setIsEdge(platform.isEdge);
    setIsChrome(platform.isChrome);
    setIsWindows(platform.isWindows);

    const installedNow = detectIsPwaInstalled();
    setIsInstalled(installedNow);
    setIsDismissed(isPwaInstallDismissed());

    if (installedNow) {
      setDeferredPrompt(null);
      clearGlobalDeferredPrompt();
    } else {
      const earlyPrompt = getGlobalDeferredPrompt();
      if (earlyPrompt) {
        setDeferredPrompt(earlyPrompt);
      }
    }

    if (typeof window === 'undefined') {
      setIsInstallCheckComplete(true);
      return;
    }

    let cancelled = false;
    checkInstalledRelatedAppsAsync()
      .then((hasRelatedInstalled) => {
        if (cancelled) return;
        if (hasRelatedInstalled) {
          markPwaInstalled();
          setIsInstalled(true);
          setDeferredPrompt(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsInstallCheckComplete(true);
        }
      });

    const handlePromptCaptured = () => {
      if (detectIsPwaInstalled()) {
        clearGlobalDeferredPrompt();
        setDeferredPrompt(null);
        setIsInstalled(true);
        return;
      }
      const captured = getGlobalDeferredPrompt();
      if (captured) {
        setDeferredPrompt(captured);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (detectIsPwaInstalled()) {
        clearGlobalDeferredPrompt();
        setDeferredPrompt(null);
        setIsInstalled(true);
        return;
      }
      (window as any).__deferredPwaPrompt = e;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      markPwaInstalled();
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches || detectIsPwaInstalled()) {
        setIsInstalled(true);
        setDeferredPrompt(null);
        clearGlobalDeferredPrompt();
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-captured', handlePromptCaptured);
    window.addEventListener('appinstalled', handleAppInstalled);
    if (standaloneQuery?.addEventListener) {
      standaloneQuery.addEventListener('change', handleDisplayModeChange);
    } else if ((standaloneQuery as any)?.addListener) {
      (standaloneQuery as any).addListener(handleDisplayModeChange);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-captured', handlePromptCaptured);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (standaloneQuery?.removeEventListener) {
        standaloneQuery.removeEventListener('change', handleDisplayModeChange);
      } else if ((standaloneQuery as any)?.removeListener) {
        (standaloneQuery as any).removeListener(handleDisplayModeChange);
      }
    };
  }, []);

  const install = useCallback(async () => {
    if (isInstalled || detectIsPwaInstalled()) {
      setIsInstalled(true);
      setDeferredPrompt(null);
      clearGlobalDeferredPrompt();
      return false;
    }

    const promptEvent = deferredPrompt || getGlobalDeferredPrompt();
    if (!promptEvent) return false;

    const outcome = await triggerNativeInstallPrompt(promptEvent, { isInstalled });
    if (outcome !== 'error') {
      setDeferredPrompt(null);
    }
    if (outcome === 'accepted') {
      setIsInstalled(true);
      return true;
    }
    if (outcome === 'dismissed') {
      setIsDismissed(true);
      return false;
    }
    return false;
  }, [deferredPrompt, isInstalled]);

  const dismiss = useCallback(() => {
    markPwaInstallDismissed();
    setIsDismissed(true);
  }, []);

  useEffect(() => {
    const activePrompt = deferredPrompt || getGlobalDeferredPrompt();
    return attachFirstVisitAutoPrompt({
      enabled: autoPrompt && isInstallCheckComplete,
      isInstalled,
      isDismissed,
      deferredPrompt: activePrompt,
      isIOSSafari,
      allowIOSInstructions,
      onTriggerNativePrompt: (promptEvent) => {
        void triggerNativeInstallPrompt(promptEvent, { isInstalled }).then((outcome) => {
          if (outcome !== 'error') {
            setDeferredPrompt(null);
          }
          if (outcome === 'accepted') {
            setIsInstalled(true);
          } else if (outcome === 'dismissed') {
            setIsDismissed(true);
          }
        });
      },
      onShowIOSInstructions: () => {
        onShowIOSInstructionsRef.current?.();
      },
    });
  }, [
    autoPrompt,
    isInstallCheckComplete,
    isInstalled,
    isDismissed,
    deferredPrompt,
    isIOSSafari,
    allowIOSInstructions,
  ]);

  return {
    isInstallable: !isInstalled && !!(deferredPrompt || getGlobalDeferredPrompt()),
    isInstalled,
    isDismissed,
    isIOS,
    isIOSSafari,
    isSafari,
    isAndroid,
    isEdge,
    isChrome,
    isWindows,
    install,
    dismiss,
  };
}
