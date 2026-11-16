import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  PWA_INSTALLED_KEY,
  PWA_INSTALL_DISMISSED_KEY,
  attachFirstVisitAutoPrompt,
  checkInstalledRelatedAppsAsync,
  detectIsPwaInstalled,
  detectPwaPlatform,
  isPwaInstallDismissed,
  markPwaInstallDismissed,
  markPwaInstalled,
  resetPwaInstallStateForTests,
  triggerNativeInstallPrompt,
  type BeforeInstallPromptEvent,
} from '../src/hooks/usePWAInstall.ts';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

function createEventTargetWindow(options?: {
  standalone?: boolean;
  windowControlsOverlay?: boolean;
  navigatorStandalone?: boolean;
  userAgent?: string;
}) {
  const listeners = new Map<string, Set<{ fn: Function; capture: boolean }>>();
  const storage = createMemoryStorage();
  const sessionStorage = createMemoryStorage();

  const win: any = {
    localStorage: storage,
    sessionStorage,
    __pwaInstalled: false,
    __deferredPwaPrompt: null,
    navigator: {
      userAgent:
        options?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      standalone: options?.navigatorStandalone ?? false,
      platform: 'Win32',
      maxTouchPoints: 0,
    },
    matchMedia: (query: string) => ({
      matches:
        (query === '(display-mode: standalone)' && Boolean(options?.standalone)) ||
        (query === '(display-mode: window-controls-overlay)' &&
          Boolean(options?.windowControlsOverlay)),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: (type: string, fn: Function, capture = false) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add({ fn, capture: Boolean(capture) });
    },
    removeEventListener: (type: string, fn: Function, capture = false) => {
      const set = listeners.get(type);
      if (!set) return;
      for (const entry of set) {
        if (entry.fn === fn && entry.capture === Boolean(capture)) {
          set.delete(entry);
        }
      }
    },
    dispatchEvent: (event: any) => {
      const set = listeners.get(event.type);
      if (!set) return true;
      for (const entry of Array.from(set)) {
        entry.fn(event);
      }
      return true;
    },
    getListenerCount: (type: string) => listeners.get(type)?.size || 0,
  };

  return { win, storage, sessionStorage };
}

function setupGlobalEnv(win: any, doc: any = { referrer: '' }) {
  const origWindow = (globalThis as any).window;
  const origDocument = (globalThis as any).document;
  const origLocalStorage = (globalThis as any).localStorage;
  const origSessionStorage = (globalThis as any).sessionStorage;
  const origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  (globalThis as any).window = win;
  (globalThis as any).document = doc;
  (globalThis as any).localStorage = win.localStorage;
  (globalThis as any).sessionStorage = win.sessionStorage;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: win.navigator,
  });

  return () => {
    resetPwaInstallStateForTests();
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDocument;
    (globalThis as any).localStorage = origLocalStorage;
    (globalThis as any).sessionStorage = origSessionStorage;
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    } else {
      delete (globalThis as any).navigator;
    }
  };
}

function createMockBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  let promptCalls = 0;
  const event: BeforeInstallPromptEvent = {
    type: 'beforeinstallprompt',
    prompt: async () => {
      promptCalls += 1;
    },
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  } as unknown as BeforeInstallPromptEvent;

  return {
    event,
    getPromptCalls: () => promptCalls,
  };
}

test('detectPwaPlatform: accurately identifies Android, Chrome, Edge, Windows, and iOS Safari', () => {
  const androidChrome = detectPwaPlatform({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
  });
  assert.equal(androidChrome.isAndroid, true);
  assert.equal(androidChrome.isChrome, true);
  assert.equal(androidChrome.isIOS, false);
  assert.equal(androidChrome.isIOSSafari, false);

  const windowsEdge = detectPwaPlatform({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    platform: 'Win32',
    maxTouchPoints: 0,
  });
  assert.equal(windowsEdge.isWindows, true);
  assert.equal(windowsEdge.isEdge, true);
  assert.equal(windowsEdge.isChrome, false);
  assert.equal(windowsEdge.isIOSSafari, false);

  const iosSafari = detectPwaPlatform({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(iosSafari.isIOS, true);
  assert.equal(iosSafari.isIOSSafari, true);
  assert.equal(iosSafari.isAndroid, false);

  const ipadOSSafari = detectPwaPlatform({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  assert.equal(ipadOSSafari.isIOS, true);
  assert.equal(ipadOSSafari.isIOSSafari, true);

  const iosChrome = detectPwaPlatform({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(iosChrome.isIOS, true);
  assert.equal(iosChrome.isIOSSafari, false);
});

test('detectIsPwaInstalled & getInstalledRelatedApps: detects installed state and never prompts', async () => {
  // 1. Standalone display-mode
  {
    const { win } = createEventTargetWindow({ standalone: true });
    const restore = setupGlobalEnv(win);
    try {
      assert.equal(detectIsPwaInstalled(win, { referrer: '' }), true);
      const mockPrompt = createMockBeforeInstallPrompt('accepted');
      let iosShown = false;
      const cleanup = attachFirstVisitAutoPrompt({
        enabled: true,
        isInstalled: true,
        isDismissed: false,
        deferredPrompt: mockPrompt.event,
        isIOSSafari: true,
        allowIOSInstructions: true,
        win,
        iosDelayMs: 0,
        onTriggerNativePrompt: (p) => {
          void triggerNativeInstallPrompt(p);
        },
        onShowIOSInstructions: () => {
          iosShown = true;
        },
      });
      win.dispatchEvent({ type: 'click', target: {} });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(mockPrompt.getPromptCalls(), 0);
      assert.equal(iosShown, false);
      cleanup();
    } finally {
      restore();
    }
  }

  // 2. iOS navigator.standalone === true
  {
    const { win } = createEventTargetWindow({ navigatorStandalone: true });
    const restore = setupGlobalEnv(win);
    try {
      assert.equal(detectIsPwaInstalled(win, { referrer: '' }), true);
    } finally {
      restore();
    }
  }

  // 3. Android TWA referrer
  {
    const { win } = createEventTargetWindow();
    const restore = setupGlobalEnv(win, { referrer: 'android-app://com.sarbaazsoft.shoepos' });
    try {
      assert.equal(
        detectIsPwaInstalled(win, { referrer: 'android-app://com.sarbaazsoft.shoepos' }),
        true
      );
    } finally {
      restore();
    }
  }

  // 4. getInstalledRelatedApps returns installed app
  {
    const hasRelated = await checkInstalledRelatedAppsAsync({
      getInstalledRelatedApps: async () => [{ platform: 'webapp', url: 'https://pos.example.com/' }],
    });
    assert.equal(hasRelated, true);
    const noRelated = await checkInstalledRelatedAppsAsync({
      getInstalledRelatedApps: async () => [],
    });
    assert.equal(noRelated, false);
  }
});

test('beforeinstallprompt respects browser gesture requirements and triggers native prompt once on first visit', async () => {
  const { win } = createEventTargetWindow();
  const restore = setupGlobalEnv(win);

  try {
    const mockPrompt = createMockBeforeInstallPrompt('accepted');
    win.__deferredPwaPrompt = mockPrompt.event;

    let promptOutcomePromise: Promise<string> | null = null;
    const cleanup = attachFirstVisitAutoPrompt({
      enabled: true,
      isInstalled: false,
      isDismissed: false,
      deferredPrompt: mockPrompt.event,
      isIOSSafari: false,
      allowIOSInstructions: false,
      win,
      onTriggerNativePrompt: (p) => {
        promptOutcomePromise = triggerNativeInstallPrompt(p);
      },
    });

    // Must NOT prompt without a user gesture
    assert.equal(mockPrompt.getPromptCalls(), 0);
    assert.equal(win.getListenerCount('click'), 1);
    assert.equal(win.getListenerCount('keydown'), 1);

    // Modifier-only / Tab / Escape keys and manual install buttons must NOT consume auto-prompt
    win.dispatchEvent({ type: 'keydown', key: 'Tab' });
    win.dispatchEvent({ type: 'keydown', key: 'Escape' });
    win.dispatchEvent({ type: 'keydown', key: 'Shift' });
    win.dispatchEvent({
      type: 'click',
      target: { closest: () => ({ id: 'sidebar-install-app-btn' }) },
    });
    assert.equal(mockPrompt.getPromptCalls(), 0);

    // Valid user click triggers native prompt() synchronously and cleans up listeners
    win.dispatchEvent({ type: 'click', target: { closest: () => null } });
    assert.equal(mockPrompt.getPromptCalls(), 1);
    assert.equal(win.getListenerCount('click'), 0);
    assert.equal(win.getListenerCount('keydown'), 0);
    assert.equal(win.__deferredPwaPrompt, null);

    const outcome = await promptOutcomePromise;
    assert.equal(outcome, 'accepted');
    assert.equal(win.localStorage.getItem(PWA_INSTALLED_KEY), '1');
    assert.equal(detectIsPwaInstalled(win, { referrer: '' }), true);

    // Second gesture must never prompt again
    win.dispatchEvent({ type: 'click', target: { closest: () => null } });
    assert.equal(mockPrompt.getPromptCalls(), 1);
    cleanup();
  } finally {
    restore();
  }
});

test('dismissal prevents repeated prompts across sessions', async () => {
  const { win } = createEventTargetWindow();
  const restore = setupGlobalEnv(win);

  try {
    const firstPrompt = createMockBeforeInstallPrompt('dismissed');
    const result = await triggerNativeInstallPrompt(firstPrompt.event);
    assert.equal(result, 'dismissed');
    assert.equal(isPwaInstallDismissed(), true);
    assert.equal(win.localStorage.getItem(PWA_INSTALL_DISMISSED_KEY), '1');

    // Subsequent session / mount must not attach auto-prompt or trigger native prompt
    const secondPrompt = createMockBeforeInstallPrompt('accepted');
    let iosShown = false;
    const cleanup = attachFirstVisitAutoPrompt({
      enabled: true,
      isInstalled: false,
      isDismissed: isPwaInstallDismissed(),
      deferredPrompt: secondPrompt.event,
      isIOSSafari: true,
      allowIOSInstructions: true,
      win,
      iosDelayMs: 0,
      onTriggerNativePrompt: () => {
        void triggerNativeInstallPrompt(secondPrompt.event);
      },
      onShowIOSInstructions: () => {
        iosShown = true;
      },
    });
    win.dispatchEvent({ type: 'click', target: {} });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(secondPrompt.getPromptCalls(), 0);
    assert.equal(iosShown, false);
    cleanup();
  } finally {
    restore();
  }
});

test('appinstalled marks PWA installed, clears deferred prompt, and prevents future prompts', async () => {
  const { win } = createEventTargetWindow();
  const restore = setupGlobalEnv(win);

  try {
    const mockPrompt = createMockBeforeInstallPrompt('accepted');
    win.__deferredPwaPrompt = mockPrompt.event;
    markPwaInstalled();

    assert.equal(win.__pwaInstalled, true);
    assert.equal(win.__deferredPwaPrompt, null);
    assert.equal(win.localStorage.getItem(PWA_INSTALLED_KEY), '1');
    assert.equal(detectIsPwaInstalled(win, { referrer: '' }), true);

    const unavailableResult = await triggerNativeInstallPrompt(mockPrompt.event);
    assert.equal(unavailableResult, 'unavailable');
    assert.equal(mockPrompt.getPromptCalls(), 0);
  } finally {
    restore();
  }
});

test('iOS Safari triggers existing Add to Home Screen instructions once and respects dismissal', async () => {
  const { win } = createEventTargetWindow({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  const restore = setupGlobalEnv(win);

  try {
    let showCount = 0;
    const cleanup = attachFirstVisitAutoPrompt({
      enabled: true,
      isInstalled: false,
      isDismissed: false,
      deferredPrompt: null,
      isIOSSafari: true,
      allowIOSInstructions: true,
      win,
      iosDelayMs: 5,
      onTriggerNativePrompt: () => {},
      onShowIOSInstructions: () => {
        showCount += 1;
      },
    });

    await new Promise((r) => setTimeout(r, 25));
    assert.equal(showCount, 1);

    // Dismissing persists preference and prevents any subsequent automatic prompt
    markPwaInstallDismissed();
    assert.equal(isPwaInstallDismissed(), true);

    const cleanupSecond = attachFirstVisitAutoPrompt({
      enabled: true,
      isInstalled: false,
      isDismissed: isPwaInstallDismissed(),
      deferredPrompt: null,
      isIOSSafari: true,
      allowIOSInstructions: true,
      win,
      iosDelayMs: 5,
      onTriggerNativePrompt: () => {},
      onShowIOSInstructions: () => {
        showCount += 1;
      },
    });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(showCount, 1);
    cleanup();
    cleanupSecond();
  } finally {
    restore();
  }
});

test('App.tsx, index.html, and InstallAppModal reuse existing PWA flow with no duplicate popups', () => {
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('usePWAInstall'));
  assert.ok(appSrc.includes('InstallAppModal'));

  const indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('beforeinstallprompt'));
  assert.ok(indexHtml.includes('appinstalled'));
  assert.ok(indexHtml.includes('pos_pwa_installed'));

  const modalSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/common/InstallAppModal.tsx'),
    'utf8'
  );
  assert.ok(modalSrc.includes('Add to Home Screen'));
});
