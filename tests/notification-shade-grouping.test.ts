import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  ADMIN_SUMMARY_TAG,
  MAX_ACTIVE_SHADE_NOTIFICATIONS,
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

test('public/sw.js keeps each alert as an individual expandable card for Android native grouping with per-message headers and footers', async () => {
  const harness = createSwShadeHarness();
  const baseTs = 1760000000000;

  // 1st notification keeps its own unique tag, title, body, timestamp, and actions
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-101',
    body: 'Invoice #INV-101 for Rs. 1000 completed.',
    timestamp: baseTs + 1000,
    data: {
      tag: 'pos-sale-INV-101',
      url: '/?tab=reports&invoice=INV-101',
    },
  });

  // 2nd notification stays an independent child notification (never merged into a bullet-text blob)
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice #INV-102 for Rs. 2000 completed.',
    timestamp: baseTs + 2000,
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  // 3rd notification adds a 3rd individual expandable child card
  await harness.dispatchPush({
    title: 'Customer Return #RET-201',
    body: 'Refund #RET-201 processed for Rs. 500.',
    timestamp: baseTs + 3000,
    data: {
      tag: 'pos-return-RET-201',
      url: '/?tab=returns&return=RET-201',
    },
  });

  assert.equal(harness.activeNotifications.size, 3);
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);

  const first = harness.activeNotifications.get('pos-sale-INV-101');
  const second = harness.activeNotifications.get('pos-sale-INV-102');
  const third = harness.activeNotifications.get('pos-return-RET-201');
  assert.equal(first.title, 'Sale Confirmed #INV-101');
  assert.equal(second.title, 'Sale Confirmed #INV-102');
  assert.equal(third.title, 'Customer Return #RET-201');
  assert.equal(first.data.isGroupSummary, false);
  assert.equal(second.data.isGroupSummary, false);
  assert.equal(third.data.isGroupSummary, false);
  assert.deepEqual(
    Array.from(first.actions, (a: any) => a.action),
    ['open_receipt', 'dismiss']
  );

  // Re-delivering matching tag updates that notification in place without duplicating cards
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice #INV-102 updated total Rs. 2100.',
    timestamp: baseTs + 3500,
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  assert.equal(harness.activeNotifications.size, 3);
  const updatedSecond = harness.activeNotifications.get('pos-sale-INV-102');
  assert.ok(updatedSecond.body.includes('Rs. 2100'));

  // Clicking an individual child card opens its specific deep link and closes only that card
  await harness.dispatchClick(updatedSecond, '');
  assert.equal(harness.openWindows[0], '/?tab=reports&invoice=INV-102');
  assert.equal(harness.activeNotifications.size, 2);
});

test('public/sw.js cleans legacy merged summary cards, enforces per-group cap cleanly, and isolates Admin vs POS alerts', async () => {
  const harness = createSwShadeHarness();
  const baseTs = 1760000000000;

  // Seed a legacy synthetic merged summary notification in the shade
  harness.activeNotifications.set(POS_SUMMARY_TAG, {
    title: '2 POS Notifications',
    tag: POS_SUMMARY_TAG,
    timestamp: baseTs,
    data: { isGroupSummary: true, isAdmin: 'false' },
    close: () => {
      harness.activeNotifications.delete(POS_SUMMARY_TAG);
    },
  });

  // New POS notification removes the stale merged summary and keeps its clean individual card
  await harness.dispatchPush({
    title: 'POS Sale #1',
    body: 'Completed',
    timestamp: baseTs + 100,
    data: { tag: 'pos-1', url: '/?tab=reports' },
  });
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);
  assert.equal(harness.activeNotifications.has('pos-1'), true);

  // Admin alerts remain isolated with admin icon & actions
  await harness.dispatchPush({
    title: 'New Free Trial #1',
    body: 'Store 1 registered',
    timestamp: baseTs + 200,
    data: { tag: 'admin-1', url: '/admin', isAdmin: 'true' },
  });
  assert.equal(harness.activeNotifications.size, 2);
  const adminCard = harness.activeNotifications.get('admin-1');
  assert.equal(adminCard.icon, '/admin/pwa-192x192.png');
  assert.deepEqual(
    Array.from(adminCard.actions, (a: any) => a.action),
    ['open_pos', 'dismiss']
  );

  // Posting more than MAX_ACTIVE_SHADE_NOTIFICATIONS POS alerts bounds oldest alerts without merging text
  for (let i = 2; i <= MAX_ACTIVE_SHADE_NOTIFICATIONS + 2; i++) {
    await harness.dispatchPush({
      title: `POS Sale #${i}`,
      body: `Invoice #${i} completed`,
      timestamp: baseTs + i * 1000,
      data: { tag: `pos-${i}`, url: `/?tab=reports&invoice=${i}` },
    });
  }

  const activePosCount = Array.from(harness.activeNotifications.values()).filter(
    (n) => n.data?.isAdmin !== 'true'
  ).length;
  assert.equal(activePosCount, MAX_ACTIVE_SHADE_NOTIFICATIONS);
  assert.equal(harness.activeNotifications.has('pos-1'), false);
  assert.equal(harness.activeNotifications.has(`pos-${MAX_ACTIVE_SHADE_NOTIFICATIONS + 2}`), true);
  assert.equal(harness.activeNotifications.has(ADMIN_SUMMARY_TAG), false);
  assert.equal(harness.activeNotifications.has('admin-1'), true);
});

test('showGroupedWithRegistration keeps individual foreground child cards and skips duplicate active tags', async () => {
  const active = new Map<string, any>();
  let showCalls = 0;
  const mockRegistration = {
    getNotifications: async () => Array.from(active.values()),
    showNotification: async (title: string, options: any = {}) => {
      showCalls++;
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
    data: { url: '/?tab=reports&invoice=INV-2', isAdmin: 'false' },
  });

  assert.equal(active.size, 2);
  assert.equal(active.has('fg-pos-1'), true);
  assert.equal(active.has('fg-pos-2'), true);
  assert.equal(active.has(POS_SUMMARY_TAG), false);
  assert.deepEqual(
    Array.from(active.get('fg-pos-2').actions, (a: any) => a.action),
    ['open_receipt', 'dismiss']
  );

  // Re-dispatching an active tag with renotify=false must skip duplicate showNotification call
  const callsBeforeDup = showCalls;
  await showGroupedWithRegistration(mockRegistration, 'POS Alert #1', {
    body: 'First alert body',
    tag: 'fg-pos-1',
    timestamp: 1760000001000,
    data: { url: '/pos', isAdmin: 'false' },
  });
  assert.equal(showCalls, callsBeforeDup);
});
