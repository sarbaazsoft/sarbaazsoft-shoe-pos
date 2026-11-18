import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { pgClient } from '../src/db/index.ts';
import {
  notifyPlatformAnnouncement,
  notifyPosAction,
  registerSseClient,
  resetServerNotificationDedupeCache,
  testFcmPush,
} from '../src/server/pushNotificationService.ts';
import { sendStaffWelcomeNotification, sendWelcomeMsg } from '../src/server/services/welcomeService.ts';
import {
  claimNotificationChannel,
  getNotificationDedupeKey,
  isNotificationChannelClaimed,
  resetNotificationDedupeCache,
} from '../src/utils/notificationDedupe.ts';
import {
  dismissSoftPushPrompt,
  getDetailedPushPermissionStatus,
  resetSoftPushPromptDismissal,
  shouldShowSoftPushPrompt,
} from '../src/services/pushNotificationClient.ts';
import {
  PUSH_PERMISSION_DENIED_KEY,
  PUSH_PERMISSION_PROMPTED_KEY,
  requestFcmPermissionAndToken,
} from '../src/services/firebaseConfig.ts';

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

test('platform_notifications enforces atomic event_id uniqueness on concurrent inserts & welcome messages', async () => {
  const tenantId = 901;
  const staffEmail = `staff-idem-${Date.now()}@example.com`;

  // Concurrent welcome tenant calls must result in a single row sharing the same notificationId
  const [w1, w2, w3] = await Promise.all([
    sendWelcomeMsg(tenantId, 'Welcome Partner'),
    sendWelcomeMsg(tenantId, 'Welcome Partner'),
    sendWelcomeMsg(tenantId, 'Welcome Partner'),
  ]);

  assert.ok(w1.notificationId);
  assert.equal(w1.notificationId, w2.notificationId);
  assert.equal(w2.notificationId, w3.notificationId);

  // Concurrent staff welcome notifications must return the same row via ON CONFLICT (event_id) DO NOTHING
  const [s1, s2] = await Promise.all([
    sendStaffWelcomeNotification({
      tenantId,
      staffName: 'Ali',
      email: staffEmail,
      role: 'CASHIER',
    }),
    sendStaffWelcomeNotification({
      tenantId,
      staffName: 'Ali',
      email: staffEmail,
      role: 'CASHIER',
    }),
  ]);
  assert.ok(s1.notificationId);
  assert.equal(s1.notificationId, s2.notificationId);

  // Direct INSERT without ON CONFLICT must reject duplicate event_id with Postgres error 23505
  const rawEventId = `direct-evt-${Date.now()}`;
  await pgClient.query(
    `INSERT INTO platform_notifications (tenant_id, target_role, title, message, type, action_url, action_label, event_id, created_at)
     VALUES ($1, 'ADMIN', $2, $3, 'INFO', '/pos', 'Open', $4, NOW())`,
    [tenantId, 'Notice A', 'Body A', rawEventId]
  );

  await assert.rejects(
    async () => {
      await pgClient.query(
        `INSERT INTO platform_notifications (tenant_id, target_role, title, message, type, action_url, action_label, event_id, created_at)
         VALUES ($1, 'ADMIN', $2, $3, 'INFO', '/pos', 'Open', $4, NOW())`,
        [tenantId, 'Notice A', 'Body A', rawEventId]
      );
    },
    (err: any) => err?.code === '23505'
  );
});

test('sales enforces atomic (tenant_id, client_tx_id) uniqueness to block offline/retry duplicate sales', async () => {
  const clientTxId = `offline-tx-${Date.now()}`;
  const insertParams = [
    77,
    'INV-IDEM-001',
    'RETAIL',
    null,
    1000,
    0,
    1000,
    0,
    '',
    '',
    '',
    0,
    1000,
    0,
    'CASH',
    1000,
    0,
    1,
    false,
    null,
    `[Offline Tx: ${clientTxId}]`,
    '2026-11-16',
    '',
    clientTxId,
  ];

  const first = await pgClient.query(
    `INSERT INTO sales (
      tenant_id, invoice_number, sale_type, customer_id, sale_date, subtotal, discount,
      total_amount, total_cartons, transport_name, bilty_number, booking_destination,
      previous_balance, paid_amount, remaining_balance,
      payment_method, cash_received, change_given,
      created_by, is_min_price_overridden, overridden_by, notes, transaction_id, client_tx_id
    ) VALUES ($1,$2,$3,$4,$22,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$23,$24)
    RETURNING id`,
    insertParams
  );
  assert.ok(first.rows[0]?.id);

  await assert.rejects(
    async () => {
      await pgClient.query(
        `INSERT INTO sales (
          tenant_id, invoice_number, sale_type, customer_id, sale_date, subtotal, discount,
          total_amount, total_cartons, transport_name, bilty_number, booking_destination,
          previous_balance, paid_amount, remaining_balance,
          payment_method, cash_received, change_given,
          created_by, is_min_price_overridden, overridden_by, notes, transaction_id, client_tx_id
        ) VALUES ($1,$2,$3,$4,$22,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$23,$24)
        RETURNING id`,
        insertParams
      );
    },
    (err: any) => err?.code === '23505'
  );
});

test('notifyPosAction delivers strictly once per logical event even under concurrent retries while preserving distinct events', async () => {
  resetServerNotificationDedupeCache();
  const sseWrites: string[] = [];
  const unregister = registerSseClient(88, 5, 'ADMIN', {
    write: (chunk: string) => {
      sseWrites.push(chunk);
      return true;
    },
  } as any);

  try {
    const baseSalePayload = {
      type: 'SALE' as const,
      title: 'Sale #INV-8801',
      message: 'Invoice INV-8801 completed',
      invoiceNumber: 'INV-8801',
      saleId: 8801,
      totalAmount: 4500,
      deepLinkUrl: '/?tab=reports&viewInvoice=INV-8801',
      timestamp: new Date().toISOString(),
    };

    // Concurrent + sequential duplicate calls for the same saleId must emit only 1 SSE event
    await Promise.all([
      notifyPosAction(88, baseSalePayload),
      notifyPosAction(88, baseSalePayload),
      notifyPosAction(88, baseSalePayload),
    ]);
    await notifyPosAction(88, baseSalePayload);

    assert.equal(sseWrites.length, 1);

    // Distinct legitimate events (saleId 8802 and two distinct returns RET-1 / RET-2 on same invoice) must all deliver
    await notifyPosAction(88, {
      ...baseSalePayload,
      title: 'Sale #INV-8802',
      invoiceNumber: 'INV-8802',
      saleId: 8802,
    });
    await notifyPosAction(88, {
      type: 'RETURN',
      title: 'Return #RET-1',
      message: 'First return',
      invoiceNumber: 'INV-8802',
      returnNumber: 'RET-1',
      returnId: 101,
      deepLinkUrl: '/?tab=returns',
      timestamp: new Date().toISOString(),
    });
    await notifyPosAction(88, {
      type: 'RETURN',
      title: 'Return #RET-2',
      message: 'Second return',
      invoiceNumber: 'INV-8802',
      returnNumber: 'RET-2',
      returnId: 102,
      deepLinkUrl: '/?tab=returns',
      timestamp: new Date().toISOString(),
    });

    assert.equal(sseWrites.length, 4);
  } finally {
    unregister();
    resetServerNotificationDedupeCache();
  }
});

test('notifyPlatformAnnouncement & testFcmPush coalesce concurrent/retried triggers sharing the same eventId', async () => {
  resetServerNotificationDedupeCache();
  const adminSse: string[] = [];
  const unregister = registerSseClient(15, 1, 'ADMIN', {
    write: (chunk: string) => {
      adminSse.push(chunk);
      return true;
    },
  } as any);

  let fcmDispatchCount = 0;

  try {
    // 1. Platform announcement with same id / eventId triggers once
    const allEnabledPrefs = {
      preset: 'all' as const,
      channels: { webPush: true, emailAlerts: true },
      events: {
        sale: true,
        return: true,
        exchange: true,
        low_stock: true,
        subscription: true,
        announcement: true,
      },
      custom: {
        channels: { webPush: true, emailAlerts: true },
        events: {
          sale: true,
          return: true,
          exchange: true,
          low_stock: true,
          subscription: true,
          announcement: true,
        },
      },
    };
    await Promise.all([
      notifyPlatformAnnouncement(
        {
          id: 501,
          eventId: 'announcement-501',
          tenantId: 15,
          targetRole: 'ADMIN',
          title: 'Store Notice',
          message: 'Maintenance window',
        },
        { getPreferencesFn: async () => allEnabledPrefs }
      ),
      notifyPlatformAnnouncement(
        {
          id: 501,
          eventId: 'announcement-501',
          tenantId: 15,
          targetRole: 'ADMIN',
          title: 'Store Notice',
          message: 'Maintenance window',
        },
        { getPreferencesFn: async () => allEnabledPrefs }
      ),
    ]);
    assert.equal(adminSse.length, 1);

    // Different announcement id must still deliver
    await notifyPlatformAnnouncement(
      {
        id: 502,
        eventId: 'announcement-502',
        tenantId: 15,
        targetRole: 'ADMIN',
        title: 'Second Notice',
        message: 'Feature update',
      },
      { getPreferencesFn: async () => allEnabledPrefs }
    );
    assert.equal(adminSse.length, 2);

    // 2. Concurrent & retried testFcmPush sharing the same eventId only dispatches once
    const [r1, r2, r3] = await Promise.all([
      testFcmPush(15, 'Test', 'Check single delivery', {
        eventId: 'idem-test-push-1',
        getFirebaseAdminFn: () => ({} as any),
        fetchTokensFn: async () => ['tok-1'],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmDispatchCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
      }),
      testFcmPush(15, 'Test', 'Check single delivery', {
        eventId: 'idem-test-push-1',
        getFirebaseAdminFn: () => ({} as any),
        fetchTokensFn: async () => ['tok-1'],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmDispatchCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
      }),
      testFcmPush(15, 'Test', 'Check single delivery', {
        eventId: 'idem-test-push-1',
        getFirebaseAdminFn: () => ({} as any),
        fetchTokensFn: async () => ['tok-1'],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmDispatchCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
      }),
    ]);

    assert.equal(r1.success, true);
    assert.equal(r2.eventId, 'idem-test-push-1');
    assert.equal(r3.eventId, 'idem-test-push-1');
    assert.equal(fcmDispatchCount, 1);
    assert.equal(adminSse.length, 3);

    // Distinct test-push eventId delivers normally
    await testFcmPush(15, 'Test 2', 'Second test', {
      eventId: 'idem-test-push-2',
      getFirebaseAdminFn: () => ({} as any),
      fetchTokensFn: async () => ['tok-1'],
      sendFcmPushToTokensFn: async (tokens) => {
        fcmDispatchCount++;
        return { success: true, sentCount: tokens.length, failureCount: 0 };
      },
    });
    assert.equal(fcmDispatchCount, 2);
    assert.equal(adminSse.length, 4);
  } finally {
    unregister();
    resetServerNotificationDedupeCache();
  }
});

test('notificationDedupe synchronizes claims via localStorage across tabs and respects distinct event_id payloads', () => {
  const origStorage = (globalThis as any).localStorage;
  const sharedStorage = createMemoryStorage();
  (globalThis as any).localStorage = sharedStorage;

  try {
    resetNotificationDedupeCache();

    const key1 = getNotificationDedupeKey({ event_id: 'evt-snake-101', title: 'Sale #1' });
    const key2 = getNotificationDedupeKey({ data: { event_id: 'evt-snake-101' }, title: 'Sale #1' });
    const distinctKey = getNotificationDedupeKey({ event_id: 'evt-snake-102', title: 'Sale #1' });

    assert.equal(key1, 'id:evt-snake-101');
    assert.equal(key1, key2);
    assert.notEqual(key1, distinctKey);

    assert.equal(claimNotificationChannel(key1, 'sse'), true);
    assert.equal(claimNotificationChannel(key1, 'toast'), true);

    // Simulate a second open browser tab with an empty in-memory Map reading shared localStorage
    const rawClaimsSnapshot = sharedStorage.getItem('pos_notif_channel_claims_v1');
    resetNotificationDedupeCache();
    if (rawClaimsSnapshot) {
      sharedStorage.setItem('pos_notif_channel_claims_v1', rawClaimsSnapshot);
    }

    assert.equal(isNotificationChannelClaimed(key2, 'sse'), true);
    assert.equal(claimNotificationChannel(key2, 'toast'), false, 'Second tab must not duplicate toast');
    assert.equal(claimNotificationChannel(distinctKey, 'toast'), true, 'Distinct event must never be suppressed');
  } finally {
    resetNotificationDedupeCache();
    (globalThis as any).localStorage = origStorage;
  }
});

test('public/sw.js assigns deterministic tags for untagged FCM background payloads', async () => {
  const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const shownNotifications: Array<{ title: string; options: any }> = [];
  const registeredBgHandlers: Array<(payload: any) => Promise<void>> = [];

  const sandbox: Record<string, any> = {
    URL,
    Promise,
    Response,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        apiKey: 'k',
        projectId: 'p',
        messagingSenderId: '1',
        appId: 'a',
      }),
    }),
    importScripts: () => {},
    firebase: {
      apps: [],
      initializeApp: () => {},
      messaging: () => ({
        onBackgroundMessage: (fn: (payload: any) => Promise<void>) => {
          registeredBgHandlers.push(fn);
        },
      }),
    },
    caches: {
      keys: async () => [],
      delete: async () => true,
    },
  };

  const activeByTag = new Map<string, any>();
  sandbox.self = {
    location: { origin: 'https://pos.example.com' },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => null },
    registration: {
      getNotifications: async () => Array.from(activeByTag.values()),
      showNotification: async (title: string, options: any) => {
        shownNotifications.push({ title, options });
        activeByTag.set(options.tag, { title, body: options.body, tag: options.tag, data: options.data });
      },
    },
    addEventListener: () => {},
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(registeredBgHandlers.length, 1, 'onBackgroundMessage handler must be registered');
  const bgHandler = registeredBgHandlers[0];

  await bgHandler({
    notification: { title: 'Untagged Notice', body: 'Same payload body' },
    data: { url: '/notifications' },
  });
  await bgHandler({
    notification: { title: 'Untagged Notice', body: 'Same payload body' },
    data: { url: '/notifications' },
  });

  assert.equal(shownNotifications.length, 1, 'Duplicate untagged background push must collapse to one card');

  await bgHandler({
    notification: { title: 'Untagged Notice 2', body: 'Different payload body' },
    data: { url: '/notifications' },
  });
  assert.equal(shownNotifications.length, 2, 'Distinct untagged payload must still display');
});

test('permission safeguards suppress iOS Safari tab prompts, honor dismissal snooze, and coalesce concurrent status checks', async () => {
  const origWindow = (globalThis as any).window;
  const origDocument = (globalThis as any).document;
  const origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origLocalStorage = (globalThis as any).localStorage;
  const origNotification = (globalThis as any).Notification;
  const origCustomEvent = (globalThis as any).CustomEvent;

  const storage = createMemoryStorage();
  let queryCalls = 0;
  let requestCalls = 0;
  let currentPermission: NotificationPermission = 'default';
  let userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  let standalone = false;

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
    get: () => currentPermission,
  });
  MockNotification.requestPermission = async () => {
    requestCalls++;
    currentPermission = 'granted';
    return 'granted';
  };

  const mockWin: any = {
    location: { pathname: '/pos', origin: 'https://pos.example.com', search: '' },
    navigator: {
      get userAgent() {
        return userAgent;
      },
      platform: 'iPhone',
      maxTouchPoints: 5,
      get standalone() {
        return standalone;
      },
      serviceWorker: {
        async getRegistration() {
          return {
            active: { state: 'activated' },
            pushManager: {
              async permissionState() {
                return 'prompt';
              },
              async getSubscription() {
                return null;
              },
            },
          };
        },
        async getRegistrations() {
          return [];
        },
        addEventListener() {},
      },
      permissions: {
        async query() {
          queryCalls++;
          await new Promise((r) => setTimeout(r, 15));
          return { state: 'prompt', onchange: null };
        },
      },
    },
    Notification: MockNotification,
    PushManager: function () {},
    matchMedia: () => ({ matches: standalone }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };

  (globalThis as any).window = mockWin;
  (globalThis as any).document = { referrer: '', visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockWin.navigator });
  (globalThis as any).localStorage = storage;
  (globalThis as any).Notification = MockNotification;
  (globalThis as any).CustomEvent = MockCustomEvent;

  try {
    // 1. iOS Safari non-standalone browser tab must never show soft prompt
    assert.equal(shouldShowSoftPushPrompt(), false);

    // 2. Desktop/Chrome default state shows soft prompt once, then hides after dismissal snooze
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36';
    mockWin.navigator.platform = 'Win32';
    mockWin.navigator.maxTouchPoints = 0;
    assert.equal(shouldShowSoftPushPrompt(), true);

    dismissSoftPushPrompt();
    assert.equal(shouldShowSoftPushPrompt(), false);
    resetSoftPushPromptDismissal();
    assert.equal(shouldShowSoftPushPrompt(), true);

    // 3. Concurrent getDetailedPushPermissionStatus calls coalesce into a single permissions.query
    const beforeQueries = queryCalls;
    await Promise.all([
      getDetailedPushPermissionStatus(),
      getDetailedPushPermissionStatus(),
      getDetailedPushPermissionStatus(),
    ]);
    assert.equal(queryCalls - beforeQueries, 1);

    // 4. Granted or denied state must never call Notification.requestPermission()
    currentPermission = 'granted';
    assert.equal(shouldShowSoftPushPrompt(), false);
    await requestFcmPermissionAndToken('ADMIN');
    assert.equal(requestCalls, 0);

    storage.removeItem(PUSH_PERMISSION_PROMPTED_KEY);
    storage.removeItem(PUSH_PERMISSION_DENIED_KEY);
    currentPermission = 'denied';
    assert.equal(shouldShowSoftPushPrompt(), false);
    await requestFcmPermissionAndToken('ADMIN');
    assert.equal(requestCalls, 0);
  } finally {
    (globalThis as any).window = origWindow;
    (globalThis as any).document = origDocument;
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    } else {
      delete (globalThis as any).navigator;
    }
    (globalThis as any).localStorage = origLocalStorage;
    (globalThis as any).Notification = origNotification;
    (globalThis as any).CustomEvent = origCustomEvent;
  }
});
