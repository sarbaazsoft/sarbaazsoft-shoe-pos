import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANDROID_SYSTEM_DISABLED_KEY,
  ANDROID_SYSTEM_DISABLED_REASON_KEY,
  FCM_TOKEN_KEY,
  PUSH_ENABLED_KEY,
  PUSH_PERMISSION_DENIED_KEY,
  requestFcmPermissionAndToken,
} from '../src/services/firebaseConfig.ts';
import {
  getDetailedPushPermissionStatus,
  isDeviceSubscribedToPush,
  resolveEffectivePermissionSnapshot,
  shouldShowSoftPushPrompt,
  shouldShowSoftPushPromptAsync,
} from '../src/services/pushNotificationClient.ts';
import { showGroupedShadeNotification } from '../src/utils/notificationShade.ts';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function setupMockBrowserEnv(options: {
  permission: NotificationPermission;
  requestPermissionResult?: NotificationPermission;
  permissionsApiState?: PermissionState;
  pushManagerState?: PermissionState;
  hasSubscription?: boolean;
  isAndroid?: boolean;
  isAndroidTwa?: boolean;
  showNotificationError?: Error | null;
}) {
  const storage = createMemoryStorage();
  const dispatchedEvents: Array<{ type: string; detail?: any }> = [];
  let requestPermissionCalls = 0;
  let unsubscribeCalls = 0;

  const mockSubscription = options.hasSubscription
    ? {
        endpoint: 'https://fcm.googleapis.com/fcm/send/mock-sub',
        options: {},
        async unsubscribe() {
          unsubscribeCalls++;
          return true;
        },
      }
    : null;

  const mockSwRegistration = {
    active: { state: 'activated' },
    pushManager: {
      async getSubscription() {
        return mockSubscription;
      },
      async permissionState() {
        return options.pushManagerState ?? (options.permission === 'granted' ? 'granted' : 'prompt');
      },
    },
    async showNotification() {
      if (options.showNotificationError) {
        throw options.showNotificationError;
      }
    },
  };

  class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  const mockNotification = function MockNotification() {} as any;
  Object.defineProperty(mockNotification, 'permission', {
    configurable: true,
    get() {
      return options.permission;
    },
  });
  mockNotification.requestPermission = async () => {
    requestPermissionCalls++;
    const next = options.requestPermissionResult ?? options.permission;
    options.permission = next;
    return next;
  };

  const mockWindow: any = {
    location: { pathname: '/pos', origin: 'https://sarbaazsoft.cloud.run', search: '' },
    navigator: {
      userAgent: options.isAndroid
        ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      platform: options.isAndroid ? 'Linux armv8l' : 'Win32',
      maxTouchPoints: options.isAndroid ? 5 : 0,
      serviceWorker: {
        controller: mockSwRegistration.active,
        ready: Promise.resolve(mockSwRegistration),
        async getRegistration() {
          return mockSwRegistration;
        },
      },
      permissions: {
        async query() {
          return {
            state:
              options.permissionsApiState ??
              (options.permission === 'granted'
                ? 'granted'
                : options.permission === 'denied'
                ? 'denied'
                : 'prompt'),
            onchange: null,
          };
        },
      },
    },
    Notification: mockNotification,
    PushManager: function MockPushManager() {},
    matchMedia: (query: string) => ({
      matches: Boolean(options.isAndroidTwa && query.includes('standalone')),
    }),
    dispatchEvent(evt: any) {
      dispatchedEvents.push({ type: evt.type, detail: evt.detail });
      return true;
    },
  };

  const mockDocument: any = {
    referrer: options.isAndroidTwa ? 'android-app://com.sarbaazsoft.shoepos' : '',
    hidden: false,
    hasFocus: () => true,
  };

  const originals = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    localStorage: (globalThis as any).localStorage,
    Notification: (globalThis as any).Notification,
    CustomEvent: (globalThis as any).CustomEvent,
  };

  (globalThis as any).window = mockWindow;
  (globalThis as any).document = mockDocument;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: mockWindow.navigator,
  });
  (globalThis as any).localStorage = storage;
  (globalThis as any).Notification = mockNotification;
  (globalThis as any).CustomEvent = MockCustomEvent;

  return {
    storage,
    dispatchedEvents,
    getRequestPermissionCalls: () => requestPermissionCalls,
    getUnsubscribeCalls: () => unsubscribeCalls,
    restore() {
      (globalThis as any).window = originals.window;
      (globalThis as any).document = originals.document;
      if (originals.navigator) {
        Object.defineProperty(globalThis, 'navigator', originals.navigator);
      } else {
        delete (globalThis as any).navigator;
      }
      (globalThis as any).localStorage = originals.localStorage;
      (globalThis as any).Notification = originals.Notification;
      (globalThis as any).CustomEvent = originals.CustomEvent;
    },
  };
}

test('resolveEffectivePermissionSnapshot distinguishes granted, browser-denied, Android system-disabled, and user opt-out states', () => {
  const base = {
    supported: true,
    isAndroid: false,
    isAndroidTwa: false,
    isWindowsPwa: false,
    isStandalone: false,
    userOptedOut: false,
    storedDenialFlag: false,
    androidSystemBlockedFlag: false,
    androidSystemBlockedReason: null,
    hasStoredToken: true,
    hasPushSubscription: true,
    userExplicitlyEnabledFlag: true,
  };

  const grantedSnap = resolveEffectivePermissionSnapshot({
    ...base,
    browserPermission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
  });
  assert.equal(grantedSnap.effectiveStatus, 'granted');
  assert.equal(grantedSnap.canReceiveSystemNotifications, true);

  // Android TWA: browser says granted, but Android 13+ / OS permission or delegation is disabled
  const androidBlockedByPermissionsApi = resolveEffectivePermissionSnapshot({
    ...base,
    isAndroid: true,
    isAndroidTwa: true,
    isStandalone: true,
    browserPermission: 'granted',
    permissionsApiState: 'denied',
    pushManagerState: 'granted',
  });
  assert.equal(androidBlockedByPermissionsApi.effectiveStatus, 'android-system-disabled');
  assert.equal(androidBlockedByPermissionsApi.canReceiveSystemNotifications, false);

  const androidBlockedByDelivery = resolveEffectivePermissionSnapshot({
    ...base,
    isAndroid: true,
    isAndroidTwa: true,
    isStandalone: true,
    browserPermission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
    androidSystemBlockedFlag: true,
    androidSystemBlockedReason: 'delivery-rejected',
  });
  assert.equal(androidBlockedByDelivery.effectiveStatus, 'android-system-disabled');
  assert.equal(androidBlockedByDelivery.canReceiveSystemNotifications, false);

  const userDisabled = resolveEffectivePermissionSnapshot({
    ...base,
    browserPermission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
    userOptedOut: true,
  });
  assert.equal(userDisabled.effectiveStatus, 'disabled-by-user');
  assert.equal(userDisabled.canReceiveSystemNotifications, false);

  const browserDenied = resolveEffectivePermissionSnapshot({
    ...base,
    browserPermission: 'denied',
    permissionsApiState: 'denied',
  });
  assert.equal(browserDenied.effectiveStatus, 'browser-denied');
  assert.equal(browserDenied.canReceiveSystemNotifications, false);

  const twaDenied = resolveEffectivePermissionSnapshot({
    ...base,
    isAndroid: true,
    isAndroidTwa: true,
    isStandalone: true,
    browserPermission: 'denied',
    permissionsApiState: 'denied',
  });
  assert.equal(twaDenied.effectiveStatus, 'android-system-disabled');
  assert.equal(twaDenied.canReceiveSystemNotifications, false);
});

test('requestFcmPermissionAndToken never re-prompts when already denied and remembers denial without looping', async () => {
  const env = setupMockBrowserEnv({
    permission: 'denied',
    permissionsApiState: 'denied',
    isAndroid: false,
  });

  try {
    const res = await requestFcmPermissionAndToken('ADMIN');
    assert.equal(res.success, false);
    assert.equal(res.permission, 'denied');
    assert.equal(env.getRequestPermissionCalls(), 0, 'Must never call Notification.requestPermission() when denied');
    assert.equal(env.storage.getItem(PUSH_PERMISSION_DENIED_KEY), 'true');
    assert.equal(shouldShowSoftPushPrompt(), false);
  } finally {
    env.restore();
  }
});

test('requestFcmPermissionAndToken never prompts when already granted and reuses existing subscription cleanly', async () => {
  const env = setupMockBrowserEnv({
    permission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
    hasSubscription: true,
  });

  try {
    env.storage.setItem(FCM_TOKEN_KEY, 'existing-fcm-token-123');
    env.storage.setItem(PUSH_ENABLED_KEY, 'true');

    const res = await requestFcmPermissionAndToken('ADMIN');
    assert.equal(env.getRequestPermissionCalls(), 0, 'Must never call Notification.requestPermission() when already granted');
    assert.equal(env.getUnsubscribeCalls(), 0, 'Must preserve existing PushSubscription');
    assert.equal(res.permission, 'granted');
    assert.equal(await isDeviceSubscribedToPush(), true);
    assert.equal(shouldShowSoftPushPrompt(), false);
    assert.equal(await shouldShowSoftPushPromptAsync(), false);
  } finally {
    env.restore();
  }
});

test('Android TWA POST_NOTIFICATIONS dismissal keeps default prompt suppressed and detects OS restriction', async () => {
  const env = setupMockBrowserEnv({
    permission: 'default',
    requestPermissionResult: 'default',
    permissionsApiState: 'prompt',
    isAndroid: true,
    isAndroidTwa: true,
  });

  try {
    assert.equal(shouldShowSoftPushPrompt(), true);
    const res = await requestFcmPermissionAndToken('ADMIN');
    assert.equal(env.getRequestPermissionCalls(), 1, 'Only prompt once when genuinely default');
    assert.equal(res.success, false);
    assert.equal(res.androidSystemDisabled, true);
    assert.equal(env.storage.getItem(PUSH_PERMISSION_DENIED_KEY), 'true');
    assert.equal(env.storage.getItem(ANDROID_SYSTEM_DISABLED_KEY), 'true');
    assert.equal(env.storage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY), 'post-notifications');

    // Subsequent checks must suppress soft prompt and report android-system-disabled
    assert.equal(shouldShowSoftPushPrompt(), false);
    const snap = await getDetailedPushPermissionStatus();
    assert.equal(snap.effectiveStatus, 'android-system-disabled');
    assert.equal(snap.canReceiveSystemNotifications, false);
  } finally {
    env.restore();
  }
});

test('showGroupedShadeNotification detects Android OS rejection even when browser permission is granted', async () => {
  const err = new Error('Notifications disabled at OS level');
  err.name = 'NotAllowedError';
  const env = setupMockBrowserEnv({
    permission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
    isAndroid: true,
    isAndroidTwa: true,
    showNotificationError: err,
  });

  try {
    const shown = await showGroupedShadeNotification('POS Alert', { body: 'Sale completed' });
    assert.equal(shown, false);
    const blockedEvt = env.dispatchedEvents.find((e) => e.type === 'pos:notification-delivery-blocked');
    assert.ok(blockedEvt, 'Should emit pos:notification-delivery-blocked when showNotification rejects with NotAllowedError');
    assert.equal(blockedEvt?.detail?.reason, 'delivery-rejected');
  } finally {
    env.restore();
  }
});
