import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  ADMIN_SUMMARY_TAG,
  MAX_UNGROUPED_SHADE_NOTIFICATIONS,
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
          data: options.data || {},
          actions: options.actions || [],
          timestamp: Date.now(),
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

test('public/sw.js keeps 1 POS notification individual and collapses into a grouped summary at 2 or more', async () => {
  const harness = createSwShadeHarness();

  // 1st notification stays ungrouped
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-101',
    body: 'Invoice for Rs. 1000 completed.',
    data: {
      tag: 'pos-sale-INV-101',
      url: '/?tab=reports',
    },
  });

  assert.equal(MAX_UNGROUPED_SHADE_NOTIFICATIONS, 1);
  assert.equal(harness.activeNotifications.size, 1);
  assert.equal(harness.activeNotifications.has(POS_SUMMARY_TAG), false);

  // 2nd notification triggers grouping (>= 2 items)
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-102',
    body: 'Invoice for Rs. 2000 completed.',
    data: {
      tag: 'pos-sale-INV-102',
      url: '/?tab=reports',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  const summary2 = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.ok(summary2, '2nd notification must produce pos-grouped-summary');
  assert.equal(summary2.title, '2 POS Notifications');
  assert.equal(summary2.icon, '/pwa-192x192.png');
  assert.equal(summary2.badge, '/icons/badge-favicon.png');
  assert.equal(summary2.data.isGroupSummary, true);
  assert.equal(summary2.data.groupedCount, 2);

  // 3rd through 5th notifications keep updating the grouped summary
  for (let i = 3; i <= 5; i++) {
    await harness.dispatchPush({
      title: `Sale Confirmed #INV-${100 + i}`,
      body: `Invoice for Rs. ${1000 * i} completed.`,
      data: {
        tag: `pos-sale-INV-${100 + i}`,
        url: '/?tab=reports',
      },
    });
  }

  assert.equal(harness.activeNotifications.size, 1);
  const summary5 = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(summary5.title, '5 POS Notifications');
  assert.equal(summary5.data.groupedCount, 5);
  assert.match(summary5.body, /\+1 more alerts/);

  // Duplicate tag re-delivery must NOT inflate groupedCount
  await harness.dispatchPush({
    title: 'Sale Confirmed #INV-105',
    body: 'Invoice for Rs. 5000 completed.',
    data: {
      tag: 'pos-sale-INV-105',
      url: '/?tab=reports',
    },
  });

  const summaryStill5 = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(summaryStill5.title, '5 POS Notifications');
  assert.equal(summaryStill5.data.groupedCount, 5);

  // 6th distinct notification updates existing summary cleanly
  await harness.dispatchPush({
    title: 'Customer Return #RET-201',
    body: 'Refund processed.',
    data: {
      tag: 'pos-return-RET-201',
      url: '/?tab=returns',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  const summary6 = harness.activeNotifications.get(POS_SUMMARY_TAG);
  assert.equal(summary6.title, '6 POS Notifications');
  assert.equal(summary6.data.groupedCount, 6);
  assert.match(summary6.body, /\+2 more alerts/);

  // Tapping grouped summary opens /notifications
  await harness.dispatchClick(summary6, '');
  assert.equal(harness.openWindows[0], '/notifications');
  assert.equal(harness.activeNotifications.size, 0);
});

test('public/sw.js separates Admin and POS notification shade groups at 2+ notifications', async () => {
  const harness = createSwShadeHarness();

  // 1 POS notification (stays individual) + 2 Admin notifications (grouped)
  await harness.dispatchPush({
    title: 'POS Sale #1',
    body: 'Completed',
    data: { tag: 'pos-1', url: '/?tab=reports' },
  });

  for (let i = 1; i <= 2; i++) {
    await harness.dispatchPush({
      title: `New Free Trial #${i}`,
      body: `Store ${i} registered`,
      data: { tag: `admin-${i}`, url: '/admin', isAdmin: 'true' },
    });
  }

  // 1 POS individual + 1 Admin grouped summary
  assert.equal(harness.activeNotifications.size, 2);
  const adminSummary = harness.activeNotifications.get(ADMIN_SUMMARY_TAG);
  assert.ok(adminSummary);
  assert.equal(adminSummary.title, '2 Admin Notifications');
  assert.equal(adminSummary.icon, '/admin/pwa-192x192.png');

  await harness.dispatchClick(adminSummary, 'open_notifications');
  assert.equal(harness.openWindows[0], '/admin');
});

test('showGroupedWithRegistration bundles 2 or more foreground notifications identically', async () => {
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
        data: options.data || {},
        timestamp: Date.now(),
        close: () => active.delete(tag),
      });
    },
  };

  for (let i = 1; i <= 2; i++) {
    await showGroupedWithRegistration(mockRegistration, `POS Alert #${i}`, {
      body: `Item ${i}`,
      icon: '/pwa-192x192.png',
      badge: '/icons/badge-favicon.png',
      tag: `fg-pos-${i}`,
      data: { url: '/pos', isAdmin: 'false' },
    });
  }

  assert.equal(active.size, 1);
  const summary = active.get(POS_SUMMARY_TAG);
  assert.ok(summary);
  assert.equal(summary.title, '2 POS Notifications');
  assert.equal(summary.data.groupedCount, 2);
});
