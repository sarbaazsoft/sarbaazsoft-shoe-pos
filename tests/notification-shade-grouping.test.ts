import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  ADMIN_SUMMARY_TAG,
  POS_SUMMARY_TAG,
  showGroupedWithRegistration,
} from '../src/utils/notificationShade.ts';

function createSwShadeHarness() {
  const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const activeNotifications = new Map<string, any>();
  const openWindows: string[] = [];

  const sandbox: Record<string, any> = {
    URL,
    Promise,
    Response,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        apiKey: 'test-key',
        projectId: 'test-proj',
        messagingSenderId: '123',
        appId: '1:123:web:abc',
      }),
    }),
    importScripts: () => {},
    firebase: {
      apps: [],
      initializeApp: () => {},
      messaging: () => ({
        onBackgroundMessage: () => {},
      }),
    },
    caches: {
      open: async () => ({ add: async () => {}, put: async () => {} }),
      keys: async () => [],
      match: async () => null,
      delete: async () => true,
    },
  };

  sandbox.self = {
    location: { origin: 'https://sarbaazsoft.cloud.run' },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url: string) => {
        openWindows.push(url);
        return null;
      },
    },
    registration: {
      getNotifications: async () => Array.from(activeNotifications.values()),
      showNotification: async (title: string, options: any = {}) => {
        const tag = options.tag || `auto-${activeNotifications.size + 1}`;
        const record = {
          title,
          body: options.body || '',
          icon: options.icon || '',
          badge: options.badge || '',
          tag,
          timestamp: options.timestamp || Date.now(),
          data: options.data || {},
          actions: options.actions || [],
          close: () => {
            activeNotifications.delete(tag);
          },
        };
        activeNotifications.set(tag, record);
      },
    },
    addEventListener: (name: string, fn: (event: any) => void) => {
      listeners.set(name, fn);
    },
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });

  const dispatchPush = async (payload: Record<string, any>) => {
    const pushListener = listeners.get('push');
    assert.ok(pushListener, 'push listener must exist');
    let waitPromise: Promise<any> = Promise.resolve();
    pushListener({
      data: {
        json: () => payload,
      },
      waitUntil: (p: Promise<any>) => {
        waitPromise = p;
      },
    });
    await waitPromise;
  };

  const dispatchClick = async (notification: any, action: string = '') => {
    const clickListener = listeners.get('notificationclick');
    assert.ok(clickListener, 'notificationclick listener must exist');
    let waitPromise: Promise<any> = Promise.resolve();
    clickListener({
      notification,
      action,
      waitUntil: (p: Promise<any>) => {
        waitPromise = p;
      },
    });
    await waitPromise;
  };

  return {
    activeNotifications,
    openWindows,
    dispatchPush,
    dispatchClick,
  };
}

test('public/sw.js keeps every notification distinct with isolated body, timestamp, actions, and groupKey', async () => {
  const harness = createSwShadeHarness();
  const baseTs = 1760000000000;

  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-101',
    body: 'Invoice #INV-101 for Rs. 1000 completed.',
    timestamp: baseTs + 1000,
    data: {
      tag: 'pos-sale-INV-101',
      url: '/?tab=reports&invoice=INV-101',
    },
  });

  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice #INV-102 for Rs. 2000 completed.',
    timestamp: baseTs + 2000,
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  await harness.dispatchPush({
    title: 'Customer Return #RET-201',
    body: 'Refund #RET-201 processed for Rs. 500.',
    timestamp: baseTs + 3000,
    data: {
      tag: 'pos-return-RET-201',
      url: '/?tab=returns&return=RET-201',
    },
  });

  // All 3 remain distinct (never collapsed into a merged summary blob)
  assert.equal(harness.activeNotifications.size, 3);
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);

  const n1 = harness.activeNotifications.get('pos-sale-INV-101');
  const n2 = harness.activeNotifications.get('pos-sale-INV-102');
  const n3 = harness.activeNotifications.get('pos-return-RET-201');

  assert.equal(n1.title, 'Sale Confirmed #INV-101');
  assert.equal(n1.body, 'Invoice #INV-101 for Rs. 1000 completed.');
  assert.equal(n1.timestamp, baseTs + 1000);
  assert.equal(n1.data.groupKey, 'pos_alerts');
  assert.equal(n1.data.isGroupSummary, false);
  assert.equal(n1.body.includes('INV-102'), false);
  assert.equal(n1.body.includes('RET-201'), false);

  assert.equal(n2.title, 'Sale Confirmed #INV-102');
  assert.equal(n2.body, 'Invoice #INV-102 for Rs. 2000 completed.');
  assert.equal(n2.timestamp, baseTs + 2000);
  assert.equal(n2.body.includes('INV-101'), false);

  assert.equal(n3.title, 'Customer Return #RET-201');
  assert.equal(n3.body, 'Refund #RET-201 processed for Rs. 500.');
  assert.equal(n3.timestamp, baseTs + 3000);
  assert.deepEqual(
    Array.from(n3.actions, (a: any) => a.action),
    ['open_pos', 'open_receipt', 'dismiss']
  );

  // Re-delivering matching tag updates only that notification without altering others
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice #INV-102 updated total Rs. 2100.',
    timestamp: baseTs + 2500,
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  assert.equal(harness.activeNotifications.size, 3);
  assert.equal(
    harness.activeNotifications.get('pos-sale-INV-102').body,
    'Invoice #INV-102 updated total Rs. 2100.'
  );
  assert.equal(
    harness.activeNotifications.get('pos-sale-INV-101').body,
    'Invoice #INV-101 for Rs. 1000 completed.'
  );

  // Clicking a specific notification navigates to that specific notification's URL
  await harness.dispatchClick(n3, '');
  assert.equal(harness.openWindows[0], '/?tab=returns&return=RET-201');
  assert.equal(harness.activeNotifications.size, 2);
});

test('public/sw.js clears stale legacy summary notifications and isolates Admin vs POS groups', async () => {
  const harness = createSwShadeHarness();

  // Seed stale legacy summary notifications from older SW versions
  harness.activeNotifications.set(POS_SUMMARY_TAG, {
    tag: POS_SUMMARY_TAG,
    title: '2 POS Notifications',
    data: { isGroupSummary: true, isAdmin: 'false' },
    close: () => harness.activeNotifications.delete(POS_SUMMARY_TAG),
  });
  harness.activeNotifications.set(ADMIN_SUMMARY_TAG, {
    tag: ADMIN_SUMMARY_TAG,
    title: '2 Admin Notifications',
    data: { isGroupSummary: true, isAdmin: 'true' },
    close: () => harness.activeNotifications.delete(ADMIN_SUMMARY_TAG),
  });

  await harness.dispatchPush({
    title: 'POS Sale #1',
    body: 'Completed',
    data: { tag: 'pos-1', url: '/?tab=reports' },
  });
  await harness.dispatchPush({
    title: 'New Free Trial #1',
    body: 'Store 1 registered',
    data: { tag: 'admin-1', url: '/admin', isAdmin: 'true' },
  });
  await harness.dispatchPush({
    title: 'Renewal Request #2',
    body: 'Store 2 requested upgrade',
    data: { tag: 'admin-2', url: '/admin?tab=renewals', isAdmin: 'true' },
  });

  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);
  assert.equal(harness.activeNotifications.has(ADMIN_SUMMARY_TAG), false);
  assert.equal(harness.activeNotifications.size, 3);

  const pos1 = harness.activeNotifications.get('pos-1');
  const admin1 = harness.activeNotifications.get('admin-1');
  const admin2 = harness.activeNotifications.get('admin-2');

  assert.equal(pos1.data.groupKey, 'pos_alerts');
  assert.equal(pos1.icon, '/pwa-192x192.png');

  assert.equal(admin1.data.groupKey, 'admin_alerts');
  assert.equal(admin1.icon, '/admin/pwa-192x192.png');

  assert.equal(admin2.data.groupKey, 'admin_alerts');
  assert.equal(admin2.body, 'Store 2 requested upgrade');

  await harness.dispatchClick(admin2, '');
  assert.equal(harness.openWindows[0], '/admin?tab=renewals');
});

test('showGroupedWithRegistration preserves isolated bodies, timestamps, and group metadata in foreground alerts', async () => {
  const active = new Map<string, any>();
  const mockRegistration = {
    getNotifications: async () => Array.from(active.values()),
    showNotification: async (title: string, options: any = {}) => {
      const tag = options.tag || `fg-${active.size + 1}`;
      active.set(tag, {
        title,
        body: options.body || '',
        icon: options.icon || '',
        badge: options.badge || '',
        tag,
        timestamp: options.timestamp,
        actions: options.actions || [],
        data: options.data || {},
        close: () => active.delete(tag),
      });
    },
  };

  await showGroupedWithRegistration(mockRegistration, 'POS Alert #1', {
    body: 'First alert body',
    icon: '/pwa-192x192.png',
    badge: '/icons/badge-favicon.png',
    tag: 'fg-pos-1',
    timestamp: 1760000001000,
    data: { url: '/pos', isAdmin: 'false' },
  });

  await showGroupedWithRegistration(mockRegistration, 'POS Alert #2', {
    body: 'Second alert body',
    icon: '/pwa-192x192.png',
    badge: '/icons/badge-favicon.png',
    tag: 'fg-pos-2',
    timestamp: 1760000002000,
    data: { url: '/?tab=reports', isAdmin: 'false' },
  });

  assert.equal(active.size, 2);
  assert.equal(active.has(POS_SUMMARY_TAG), false);

  const first = active.get('fg-pos-1');
  const second = active.get('fg-pos-2');
  assert.equal(first.title, 'POS Alert #1');
  assert.equal(first.body, 'First alert body');
  assert.equal(first.timestamp, 1760000001000);
  assert.equal(first.data.groupKey, 'pos_alerts');

  assert.equal(second.title, 'POS Alert #2');
  assert.equal(second.body, 'Second alert body');
  assert.equal(second.timestamp, 1760000002000);
  assert.equal(second.data.groupKey, 'pos_alerts');
});
