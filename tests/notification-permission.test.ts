import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANDROID_SYSTEM_DISABLED_KEY,
  ANDROID_SYSTEM_DISABLED_REASON_KEY,
  FCM_TOKEN_KEY,
  PUSH_ENABLED_KEY,
  PUSH_PERMISSION_DENIED_KEY,
  PUSH_USER_OPTED_OUT_KEY,
  acquireAndSyncFcmToken,
  isExplicitUserPushOptOut,
  requestFcmPermissionAndToken,
} from '../src/services/firebaseConfig.ts';
import {
  connectRealtimeNotificationStream,
  getDetailedPushPermissionStatus,
  isDeviceSubscribedToPush,
  resolveEffectivePermissionSnapshot,
  resyncPushSubscriptionIfEnabled,
  shouldShowSoftPushPrompt,
  shouldShowSoftPushPromptAsync,
  triggerTestNotificationShadeFallback,
  unsubscribeDeviceFromWebPush,
} from '../src/services/pushNotificationClient.ts';
import {
  recordSwNotificationShown,
  resetNotificationDedupeCache,
} from '../src/utils/notificationDedupe.ts';
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
  hasSwRegistration?: boolean;
  isAndroid?: boolean;
  isAndroidTwa?: boolean;
  showNotificationError?: Error | null;
}) {
  const storage = createMemoryStorage();
  const dispatchedEvents: Array<{ type: string; detail?: any }> = [];
  const swShownNotifications: Array<{ title: string; options: any }> = [];
  const windowNotifications: Array<{ title: string; options: any }> = [];
  const eventSourceInstances: any[] = [];
  let requestPermissionCalls = 0;
  let permissionsQueryCalls = 0;
  let unsubscribeCalls = 0;

  const hasSw = options.hasSwRegistration !== false;

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

  const mockSwRegistration = hasSw
    ? {
        active: { state: 'activated' },
        pushManager: {
          async getSubscription() {
            return mockSubscription;
          },
          async permissionState() {
            return options.pushManagerState ?? (options.permission === 'granted' ? 'granted' : 'prompt');
          },
        },
        async getNotifications() {
          return [];
        },
        async showNotification(title: string, opts: any) {
          if (options.showNotificationError) {
            throw options.showNotificationError;
          }
          swShownNotifications.push({ title, options: opts });
        },
      }
    : undefined;

  class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  class MockEventSource {
    url: string;
    listeners: Record<string, Array<(evt: any) => void>> = {};
    onmessage: ((evt: any) => void) | null = null;
    onerror: ((evt: any) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      eventSourceInstances.push(this);
    }
    addEventListener(type: string, fn: (evt: any) => void) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    }
    emit(type: string, payload: any) {
      const evt = { data: JSON.stringify(payload) };
      for (const fn of this.listeners[type] || []) {
        fn(evt);
      }
    }
    close() {}
  }

  const mockNotification = function MockNotification(title: string, opts: any) {
    if (opts && 'actions' in opts) {
      throw new TypeError("Failed to construct 'Notification': Actions are only supported for persistent notifications shown using ServiceWorkerRegistration.showNotification().");
    }
    windowNotifications.push({ title, options: opts });
    return {
      title,
      close() {},
      onclick: null,
    };
  } as any;
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
        controller: mockSwRegistration?.active || null,
        ready: mockSwRegistration ? Promise.resolve(mockSwRegistration) : new Promise(() => {}),
        async getRegistration() {
          return mockSwRegistration;
        },
        async getRegistrations() {
          return mockSwRegistration ? [mockSwRegistration] : [];
        },
        addEventListener() {},
      },
      permissions: {
        async query() {
          permissionsQueryCalls++;
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
    EventSource: MockEventSource,
    matchMedia: (query: string) => ({
      matches: Boolean(options.isAndroidTwa && query.includes('standalone')),
    }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(evt: any) {
      dispatchedEvents.push({ type: evt.type, detail: evt.detail });
      return true;
    },
  };

  const mockDocument: any = {
    referrer: options.isAndroidTwa ? 'android-app://com.sarbaazsoft.shoepos' : '',
    hidden: false,
    visibilityState: 'visible',
    hasFocus: () => true,
    addEventListener() {},
    removeEventListener() {},
  };

  const originals = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    localStorage: (globalThis as any).localStorage,
    Notification: (globalThis as any).Notification,
    CustomEvent: (globalThis as any).CustomEvent,
    EventSource: (globalThis as any).EventSource,
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
  (globalThis as any).EventSource = MockEventSource;

  return {
    storage,
    dispatchedEvents,
    swShownNotifications,
    windowNotifications,
    eventSourceInstances,
    getRequestPermissionCalls: () => requestPermissionCalls,
    getPermissionsQueryCalls: () => permissionsQueryCalls,
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
      (globalThis as any).EventSource = originals.EventSource;
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

test('Granted permission with prompt Permissions/PushManager state (Android TWA Delegation & Chrome) is NOT falsely blocked', async () => {
  const twaPromptSnap = resolveEffectivePermissionSnapshot({
    supported: true,
    isAndroid: true,
    isAndroidTwa: true,
    isWindowsPwa: false,
    isStandalone: true,
    userOptedOut: false,
    storedDenialFlag: false,
    androidSystemBlockedFlag: false,
    androidSystemBlockedReason: null,
    hasStoredToken: false,
    hasPushSubscription: false,
    userExplicitlyEnabledFlag: false,
    browserPermission: 'granted',
    permissionsApiState: 'prompt',
    pushManagerState: 'prompt',
  });
  assert.equal(twaPromptSnap.effectiveStatus, 'granted');
  assert.equal(twaPromptSnap.canReceiveSystemNotifications, true);
  assert.equal(twaPromptSnap.androidSystemDisabled, false);

  // Also ensure stale 'permission-api' / 'push-manager' block markers clear automatically once granted
  const env = setupMockBrowserEnv({
    permission: 'granted',
    permissionsApiState: 'prompt',
    pushManagerState: 'prompt',
    isAndroid: true,
    isAndroidTwa: true,
  });

  try {
    env.storage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
    env.storage.setItem(ANDROID_SYSTEM_DISABLED_REASON_KEY, 'push-manager');

    const snap = await getDetailedPushPermissionStatus();
    assert.equal(snap.effectiveStatus, 'granted');
    assert.equal(snap.canReceiveSystemNotifications, true);
    assert.equal(env.storage.getItem(ANDROID_SYSTEM_DISABLED_KEY), null);

    const syncRes = await acquireAndSyncFcmToken('ADMIN');
    assert.notEqual(syncRes.androidSystemDisabled, true);
    assert.equal(env.storage.getItem(ANDROID_SYSTEM_DISABLED_KEY), null);
  } finally {
    env.restore();
  }
});

test('Prior denial does not permanently lock out notifications once re-allowed in Chrome or Android settings', async () => {
  const env = setupMockBrowserEnv({
    permission: 'denied',
    permissionsApiState: 'denied',
    pushManagerState: 'denied',
  });

  try {
    const deniedRes = await requestFcmPermissionAndToken('ADMIN');
    assert.equal(deniedRes.success, false);
    assert.equal(env.storage.getItem(PUSH_PERMISSION_DENIED_KEY), 'true');
    assert.notEqual(
      env.storage.getItem(PUSH_ENABLED_KEY),
      'false',
      'Browser/OS denial must not set user opt-out PUSH_ENABLED_KEY=false'
    );

    // Simulate legacy browser state where an older version had set PUSH_ENABLED_KEY='false' during denial
    env.storage.setItem(PUSH_ENABLED_KEY, 'false');

    // User re-enables notifications in Chrome / Android Settings (without setting PUSH_USER_OPTED_OUT_KEY)
    (env as any).restore();
  } finally {
    env.restore();
  }

  const healedEnv = setupMockBrowserEnv({
    permission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
  });

  try {
    healedEnv.storage.setItem(PUSH_ENABLED_KEY, 'false');
    healedEnv.storage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
    assert.equal(healedEnv.storage.getItem(PUSH_USER_OPTED_OUT_KEY), null);
    assert.equal(isExplicitUserPushOptOut(), false);

    const snap = await getDetailedPushPermissionStatus();
    assert.equal(snap.effectiveStatus, 'granted');
    assert.equal(snap.canReceiveSystemNotifications, true);
    assert.equal(healedEnv.storage.getItem(PUSH_ENABLED_KEY), null);
    assert.equal(healedEnv.storage.getItem(PUSH_PERMISSION_DENIED_KEY), null);

    const queriesBefore = healedEnv.getPermissionsQueryCalls();
    await resyncPushSubscriptionIfEnabled('ADMIN');
    assert.ok(
      healedEnv.getPermissionsQueryCalls() > queriesBefore,
      'Healed permission state must enter acquireAndSyncFcmToken rather than bailing out'
    );

    // Explicit opt-out via unsubscribe MUST prevent background resync
    await unsubscribeDeviceFromWebPush();
    assert.equal(healedEnv.storage.getItem(PUSH_USER_OPTED_OUT_KEY), 'true');
    assert.equal(isExplicitUserPushOptOut(), true);
    const queriesAfterOptOut = healedEnv.getPermissionsQueryCalls();
    const optedOutResync = await resyncPushSubscriptionIfEnabled('ADMIN');
    assert.equal(optedOutResync, false);
    assert.equal(healedEnv.getPermissionsQueryCalls(), queriesAfterOptOut);
  } finally {
    healedEnv.restore();
  }
});

test('Focused Chrome/APK windows show shade notification from SSE & Test Alert without throwing on SW-only actions', async () => {
  resetNotificationDedupeCache();

  // 1. Verify window Notification fallback strips SW-only `actions` when SW is unavailable
  const noSwEnv = setupMockBrowserEnv({
    permission: 'granted',
    hasSwRegistration: false,
  });

  try {
    const shownFallback = await showGroupedShadeNotification('Fallback Alert', {
      body: 'No SW active',
      actions: [{ action: 'open_pos', title: 'Open POS' }],
      vibrate: [200, 100],
      renotify: false,
    });
    assert.equal(shownFallback, true);
    assert.equal(noSwEnv.windowNotifications.length, 1);
    assert.equal('actions' in noSwEnv.windowNotifications[0].options, false);
  } finally {
    noSwEnv.restore();
  }

  // 2. Verify focused Chrome/APK displays SSE OS notification via SW when SW push did not claim it first
  resetNotificationDedupeCache();
  const sseEnv = setupMockBrowserEnv({
    permission: 'granted',
    permissionsApiState: 'granted',
    pushManagerState: 'granted',
    isAndroid: true,
    isAndroidTwa: true,
  });

  const receivedPayloads: any[] = [];
  const disconnect = connectRealtimeNotificationStream((p) => receivedPayloads.push(p));

  try {
    assert.equal(sseEnv.eventSourceInstances.length, 1);
    sseEnv.eventSourceInstances[0].emit('pos_action', {
      eventId: 'sale-fg-101',
      tag: 'sale-fg-101',
      type: 'SALE',
      title: 'Sale #INV-101',
      message: 'Rs. 2,500 completed',
      deepLinkUrl: '/?tab=reports',
    });

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(receivedPayloads.length, 1);
    assert.equal(sseEnv.swShownNotifications.length, 1);
    assert.equal(sseEnv.swShownNotifications[0].title, 'Sale #INV-101');

    // 3. Test Alert fallback delivers once and skips duplicate if SW already claimed the event
    const testShown = await triggerTestNotificationShadeFallback({
      eventId: 'test-fg-202',
      title: 'Test POS Alert',
      body: 'Operational',
      fcmSentCount: 0,
    });
    assert.equal(testShown, true);
    assert.equal(sseEnv.swShownNotifications.length, 2);

    recordSwNotificationShown({ eventId: 'test-sw-303', tag: 'test-sw-303', dedupeKey: 'id:test-sw-303' });
    const dedupedTestShown = await triggerTestNotificationShadeFallback({
      eventId: 'test-sw-303',
      title: 'Duplicate Test',
      body: 'Should skip',
      fcmSentCount: 0,
    });
    assert.equal(dedupedTestShown, false);
    assert.equal(sseEnv.swShownNotifications.length, 2);
  } finally {
    disconnect();
    sseEnv.restore();
  }
});

test('requestFcmPermissionAndToken strictly allows only 1 permission prompt across concurrent clicks and dismissed retries', async () => {
  const env = setupMockBrowserEnv({
    permission: 'default',
    requestPermissionResult: 'default',
    permissionsApiState: 'prompt',
    isAndroid: true,
    isAndroidTwa: false,
  });

  try {
    assert.equal(shouldShowSoftPushPrompt(), true);

    // Concurrent rapid clicks must coalesce onto a single Notification.requestPermission() call
    const [first, second] = await Promise.all([
      requestFcmPermissionAndToken('ADMIN'),
      requestFcmPermissionAndToken('ADMIN'),
    ]);

    assert.equal(env.getRequestPermissionCalls(), 1, 'Concurrent triggers must prompt strictly once');
    assert.equal(first.success, false);
    assert.equal(second.success, false);
    assert.equal(shouldShowSoftPushPrompt(), false, 'Soft prompt must hide immediately after 1 dismissed prompt');

    // Subsequent manual retries while browser still reports default must NOT invoke requestPermission() again
    const third = await requestFcmPermissionAndToken('ADMIN');
    assert.equal(env.getRequestPermissionCalls(), 1, 'Must never prompt a second time after dismissal');
    assert.equal(third.alreadyPrompted, true);
  } finally {
    env.restore();
  }
});

