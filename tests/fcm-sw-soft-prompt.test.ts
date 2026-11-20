import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SOFT_PROMPT_SNOOZE_DAYS,
  SOFT_PROMPT_DISMISSED_KEY,
  SOFT_PROMPT_STORAGE_KEY,
  dismissSoftPushPrompt,
  initNativeNotificationPrompt,
  isSoftPromptDismissed,
  shouldShowSoftPushPrompt,
} from '../src/services/pushNotificationClient.ts';

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

test('7-day soft prompt snooze expires cleanly in localStorage and defaults to 7 days', () => {
  const origWindow = (globalThis as any).window;
  const origLocalStorage = (globalThis as any).localStorage;
  const origNotification = (globalThis as any).Notification;
  const origCustomEvent = (globalThis as any).CustomEvent;
  const origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const storage = createMemoryStorage();
  class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  const MockNotification: any = function () {};
  Object.defineProperty(MockNotification, 'permission', {
    configurable: true,
    get: () => 'default',
  });

  const mockWin: any = {
    navigator: {
      userAgent: 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
      serviceWorker: {},
    },
    Notification: MockNotification,
    PushManager: function () {},
    matchMedia: () => ({ matches: false }),
    dispatchEvent: () => true,
  };

  (globalThis as any).window = mockWin;
  (globalThis as any).localStorage = storage;
  (globalThis as any).Notification = MockNotification;
  (globalThis as any).CustomEvent = MockCustomEvent;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockWin.navigator });

  try {
    assert.equal(DEFAULT_SOFT_PROMPT_SNOOZE_DAYS, 7);
    assert.equal(shouldShowSoftPushPrompt(), true);

    const before = Date.now();
    dismissSoftPushPrompt();
    const storedUntil = Number(storage.getItem(SOFT_PROMPT_STORAGE_KEY));
    assert.ok(storedUntil >= before + 6 * 86400000 && storedUntil <= before + 8 * 86400000);
    assert.equal(isSoftPromptDismissed(), true);
    assert.equal(shouldShowSoftPushPrompt(), false);

    // Simulate 7 days passing — snooze must automatically expire and clear keys
    storage.setItem(SOFT_PROMPT_STORAGE_KEY, String(Date.now() - 1000));
    assert.equal(isSoftPromptDismissed(), false);
    assert.equal(storage.getItem(SOFT_PROMPT_STORAGE_KEY), null);
    assert.equal(storage.getItem(SOFT_PROMPT_DISMISSED_KEY), null);
    assert.equal(shouldShowSoftPushPrompt(), true);
  } finally {
    (globalThis as any).window = origWindow;
    (globalThis as any).localStorage = origLocalStorage;
    (globalThis as any).Notification = origNotification;
    (globalThis as any).CustomEvent = origCustomEvent;
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    } else {
      delete (globalThis as any).navigator;
    }
  }
});

test('initNativeNotificationPrompt never calls requestPermission or getToken automatically on load or login', async () => {
  const origWindow = (globalThis as any).window;
  const origLocalStorage = (globalThis as any).localStorage;
  const origNotification = (globalThis as any).Notification;
  const origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origFetch = globalThis.fetch;

  const storage = createMemoryStorage();
  let requestPermissionCalls = 0;
  const fetchUrls: string[] = [];

  const MockNotification: any = function () {};
  Object.defineProperty(MockNotification, 'permission', {
    configurable: true,
    get: () => 'granted',
  });
  MockNotification.requestPermission = async () => {
    requestPermissionCalls++;
    return 'granted';
  };

  const mockWin: any = {
    navigator: {
      userAgent: 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
      serviceWorker: {
        getRegistration: async () => null,
        getRegistrations: async () => [],
        addEventListener: () => {},
      },
    },
    Notification: MockNotification,
    PushManager: function () {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };

  (globalThis as any).window = mockWin;
  (globalThis as any).localStorage = storage;
  (globalThis as any).Notification = MockNotification;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockWin.navigator });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchUrls.push(String(input));
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const cleanup = initNativeNotificationPrompt('ADMIN');
    await new Promise((r) => setTimeout(r, 25));
    cleanup();

    assert.equal(requestPermissionCalls, 0);
    assert.equal(
      fetchUrls.some((u) => u.includes('fcm-token')),
      false,
      'Page load/login warm-up must never register or sync FCM tokens automatically'
    );
  } finally {
    (globalThis as any).window = origWindow;
    (globalThis as any).localStorage = origLocalStorage;
    (globalThis as any).Notification = origNotification;
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    } else {
      delete (globalThis as any).navigator;
    }
    globalThis.fetch = origFetch;
  }
});

test('firebaseConfig imports and invokes deleteToken() during unregisterFcmDeviceToken, legacy NotificationBanner is removed, and PushNotificationSoftPrompt implements 2-step soft prompt', () => {
  const firebaseCfgSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/firebaseConfig.ts'), 'utf8');
  assert.match(firebaseCfgSrc, /import\s*\{[^}]*\bdeleteToken\b[^}]*\}\s*from\s*'firebase\/messaging'/);
  assert.match(firebaseCfgSrc, /unregisterFcmDeviceToken[\s\S]*?deleteToken\(messagingInstance\)/);
  assert.match(firebaseCfgSrc, /unregisterFcmDeviceToken[\s\S]*?api\.notifications\.removeFcmToken\(token\)/);

  assert.equal(
    fs.existsSync(path.join(process.cwd(), 'src/components/notifications/NotificationBanner.tsx')),
    false,
    'Legacy duplicate NotificationBanner.tsx should be removed'
  );

  const softPromptSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/notifications/PushNotificationSoftPrompt.tsx'),
    'utf8'
  );
  assert.ok(softPromptSrc.includes('export const PushNotificationSoftPrompt'));
  assert.ok(softPromptSrc.includes('Enable Notifications'));
  assert.ok(softPromptSrc.includes('Maybe Later'));
  assert.ok(softPromptSrc.includes('dismissSoftPushPrompt'));
  assert.ok(softPromptSrc.includes('subscribeDeviceToWebPush'));
});

test('public/sw.js focuses existing matching window client before falling back to clients.openWindow', async () => {
  const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const focusedClients: string[] = [];
  const navigatedUrls: string[] = [];
  const openedWindows: string[] = [];

  let mockClientsList: any[] = [
    {
      url: 'https://sarbaazsoft.cloud.run/?tab=pos',
      focus: async () => {
        focusedClients.push('https://sarbaazsoft.cloud.run/?tab=pos');
      },
      navigate: async (url: string) => {
        navigatedUrls.push(url);
      },
      postMessage: () => {},
    },
    {
      url: 'https://sarbaazsoft.cloud.run/?tab=reports&invoice=INV-500',
      focus: async () => {
        focusedClients.push('https://sarbaazsoft.cloud.run/?tab=reports&invoice=INV-500');
      },
      navigate: async (url: string) => {
        navigatedUrls.push(url);
      },
      postMessage: () => {},
    },
  ];

  const sandbox: Record<string, any> = {
    URL,
    Promise,
    Response,
    fetch: async () => ({ ok: false }),
    importScripts: () => {},
    caches: { keys: async () => [], delete: async () => true },
  };

  sandbox.self = {
    location: { origin: 'https://sarbaazsoft.cloud.run' },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => mockClientsList,
      openWindow: async (url: string) => {
        openedWindows.push(url);
        return null;
      },
    },
    registration: {
      getNotifications: async () => [],
      showNotification: async () => {},
    },
    addEventListener: (name: string, fn: (event: any) => void) => {
      listeners.set(name, fn);
    },
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });
  const clickListener = listeners.get('notificationclick');
  assert.ok(clickListener);

  let waitPromise = Promise.resolve();
  clickListener({
    notification: {
      data: { url: '/?tab=reports&invoice=INV-500' },
      close: () => {},
    },
    action: '',
    waitUntil: (p: Promise<any>) => {
      waitPromise = p;
    },
  });
  await waitPromise;

  assert.deepEqual(focusedClients, ['https://sarbaazsoft.cloud.run/?tab=reports&invoice=INV-500']);
  assert.equal(navigatedUrls.length, 0, 'Exact matching client must focus without forced reload navigation');
  assert.equal(openedWindows.length, 0);

  // When no windows are open, fall back to clients.openWindow()
  mockClientsList = [];
  clickListener({
    notification: {
      data: { url: '/?tab=reports&invoice=INV-501' },
      close: () => {},
    },
    action: '',
    waitUntil: (p: Promise<any>) => {
      waitPromise = p;
    },
  });
  await waitPromise;

  assert.deepEqual(openedWindows, ['/?tab=reports&invoice=INV-501']);
});
