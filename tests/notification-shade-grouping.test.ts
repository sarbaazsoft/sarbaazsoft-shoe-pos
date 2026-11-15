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

test('public/sw.js keeps a single alert ungrouped and groups 2+ alerts into one aligned shade card', async () => {
  const harness = createSwShadeHarness();
  const baseTs = 1760000000000;

  // 1st notification stays ungrouped with its individual tag and actions
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-101',
    body: 'Invoice #INV-101 for Rs. 1000 completed.',
    timestamp: baseTs + 1000,
    data: {
      tag: 'pos-sale-INV-101',
      url: '/?tab=reports&invoice=INV-101',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);
  const single = harness.activeNotifications.get('pos-sale-INV-101');
  assert.equal(single.title, 'Sale Confirmed #INV-101');
  assert.equal(single.body, 'Invoice #INV-101 for Rs. 1000 completed.');
  assert.equal(single.data.groupKey, 'pos_alerts');
  assert.equal(single.data.isGroupSummary, false);

  // 2nd notification merges with the 1st into one grouped shade card
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice #INV-102 for Rs. 2000 completed.',
    timestamp: baseTs + 2000,
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), true);
  assert.equal(harness.activeNotifications.has('pos-sale-INV-101'), false);

  const groupedTwo = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(groupedTwo.title, '2 POS Notifications');
  assert.equal(groupedTwo.timestamp, baseTs + 2000);
  assert.equal(groupedTwo.data.isGroupSummary, true);
  assert.equal(groupedTwo.data.groupKey, 'pos_alerts');
  assert.equal(groupedTwo.data.count, 2);
  assert.equal(groupedTwo.data.items.length, 2);
  const twoLines = groupedTwo.body.split('\n');
  assert.equal(twoLines.length, 2);
  assert.ok(twoLines[0].includes('Sale Confirmed #INV-102'));
  assert.ok(twoLines[1].includes('Sale Confirmed #INV-101'));

  // 3rd notification appends to the same grouped card cleanly
  await harness.dispatchPush({
    title: 'Customer Return #RET-201',
    body: 'Refund #RET-201 processed for Rs. 500.',
    timestamp: baseTs + 3000,
    data: {
      tag: 'pos-return-RET-201',
      url: '/?tab=returns&return=RET-201',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  const groupedThree = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(groupedThree.title, '3 POS Notifications');
  assert.equal(groupedThree.timestamp, baseTs + 3000);
  assert.equal(groupedThree.data.count, 3);
  assert.deepEqual(
    Array.from(groupedThree.actions, (a: any) => a.action),
    ['open_notifications', 'open_pos', 'dismiss']
  );

  // Re-delivering matching tag updates that item in place without inflating count
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice #INV-102 updated total Rs. 2100.',
    timestamp: baseTs + 3500,
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  const updatedGroup = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(updatedGroup.title, '3 POS Notifications');
  assert.equal(updatedGroup.data.count, 3);
  assert.ok(updatedGroup.body.includes('Rs. 2100'));

  // Clicking the grouped summary navigates to /notifications and closes the card
  await harness.dispatchClick(updatedGroup, '');
  assert.equal(harness.openWindows[0], '/notifications');
  assert.equal(harness.activeNotifications.size, 0);
});

test('public/sw.js keeps Admin and POS groups isolated and summarizes overflow > 6 cleanly', async () => {
  const harness = createSwShadeHarness();
  const baseTs = 1760000000000;

  // 1 POS notification + 2 Admin notifications -> 1 ungrouped POS card + 1 grouped Admin card
  await harness.dispatchPush({
    title: 'POS Sale #1',
    body: 'Completed',
    timestamp: baseTs + 100,
    data: { tag: 'pos-1', url: '/?tab=reports' },
  });
  await harness.dispatchPush({
    title: 'New Free Trial #1',
    body: 'Store 1 registered',
    timestamp: baseTs + 200,
    data: { tag: 'admin-1', url: '/admin', isAdmin: 'true' },
  });
  await harness.dispatchPush({
    title: 'Renewal Request #2',
    body: 'Store 2 requested upgrade',
    timestamp: baseTs + 300,
    data: { tag: 'admin-2', url: '/admin?tab=renewals', isAdmin: 'true' },
  });

  assert.equal(harness.activeNotifications.size, 2);
  assert.equal(harness.activeNotifications.has('pos-1'), true);
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);
  assert.equal(harness.activeNotifications.has(ADMIN_SUMMARY_TAG), true);

  const adminGroup = harness.activeNotifications.get(ADMIN_SUMMARY_TAG);
  assert.equal(adminGroup.title, '2 Admin Notifications');
  assert.equal(adminGroup.icon, '/admin/pwa-192x192.png');
  assert.equal(adminGroup.data.groupKey, 'admin_alerts');
  assert.ok(adminGroup.body.includes('Renewal Request #2'));
  assert.ok(adminGroup.body.includes('New Free Trial #1'));

  await harness.dispatchClick(adminGroup, '');
  assert.equal(harness.openWindows[0], '/admin');
  assert.equal(harness.activeNotifications.size, 1);

  // Add 6 more POS alerts (total 7 POS alerts) and verify clean +2 overflow line
  for (let i = 2; i <= 7; i++) {
    await harness.dispatchPush({
      title: `POS Sale #${i}`,
      body: `Invoice #${i} completed`,
      timestamp: baseTs + i * 1000,
      data: { tag: `pos-${i}`, url: `/?tab=reports&invoice=${i}` },
    });
  }

  assert.equal(harness.activeNotifications.size, 1);
  const sevenGroup = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(sevenGroup.title, '7 POS Notifications');
  const lines = sevenGroup.body.split('\n');
  assert.equal(lines.length, 6);
  assert.ok(lines[0].includes('POS Sale #7'));
  assert.ok(lines[5].includes('+2 more alerts'));
});

test('showGroupedWithRegistration groups 2+ foreground alerts and skips duplicate tags already inside group summary', async () => {
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

  assert.equal(active.size, 1);
  assert.equal(active.has('fg-pos-1'), true);

  await showGroupedWithRegistration(mockRegistration, 'POS Alert #2', {
    body: 'Second alert body',
    icon: '/pwa-192x192.png',
    badge: '/icons/badge-favicon.png',
    tag: 'fg-pos-2',
    timestamp: 1760000002000,
    data: { url: '/?tab=reports', isAdmin: 'false' },
  });

  assert.equal(active.size, 1);
  assert.equal(active.has(POS_SUMMARY_TAG), true);
  assert.equal(active.has('fg-pos-1'), false);

  const summary = active.get(POS_SUMMARY_TAG);
  assert.equal(summary.title, '2 POS Notifications');
  assert.equal(summary.timestamp, 1760000002000);
  assert.equal(summary.data.groupKey, 'pos_alerts');
  assert.equal(summary.data.isGroupSummary, true);
  assert.equal(summary.data.count, 2);
  assert.ok(summary.body.includes('POS Alert #2'));
  assert.ok(summary.body.includes('POS Alert #1'));

  // Re-dispatching a tag already included inside the grouped summary must be skipped without duplicating
  const callsBeforeDup = showCalls;
  await showGroupedWithRegistration(mockRegistration, 'POS Alert #1', {
    body: 'First alert body',
    tag: 'fg-pos-1',
    timestamp: 1760000001000,
    data: { url: '/pos', isAdmin: 'false' },
  });
  assert.equal(showCalls, callsBeforeDup);
});
