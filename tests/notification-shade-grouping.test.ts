import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as notificationShade from '../src/utils/notificationShade.ts';
import {
  buildFcmNotificationConfig,
  notifyPosAction,
  registerSseClient,
} from '../src/server/pushNotificationService.ts';

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

test('Notification grouping has been completely removed from shade utilities, service worker, and FCM payloads', () => {
  const shadeSource = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'notificationShade.ts'), 'utf8');
  const swSource = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const fcmSource = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'pushNotificationService.ts'), 'utf8');

  assert.equal('POS_SUMMARY_TAG' in notificationShade, false);
  assert.equal('ADMIN_SUMMARY_TAG' in notificationShade, false);
  assert.equal('formatShadeGroupSummaryBody' in notificationShade, false);
  assert.equal('showGroupedWithRegistration' in notificationShade, false);
  assert.equal('showGroupedShadeNotification' in notificationShade, false);

  for (const src of [shadeSource, swSource, fcmSource]) {
    assert.equal(src.includes('POS_SUMMARY_TAG'), false);
    assert.equal(src.includes('ADMIN_SUMMARY_TAG'), false);
    assert.equal(src.includes('isGroupSummary'), false);
    assert.equal(src.includes('groupKey'), false);
    assert.equal(src.includes('formatShadeGroupSummaryBody'), false);
    assert.equal(src.includes('showGroupedShadeNotification'), false);
  }

  const fcmCfg = buildFcmNotificationConfig({
    title: 'New Sale #INV-10',
    body: 'Sale recorded',
    deepLinkUrl: '/?tab=reports',
  });
  assert.equal('groupKey' in fcmCfg.stringData, false);
});

test('public/sw.js treats Sale, Return, Exchange, and System Announcement as independent single notifications with no grouping', async () => {
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
    title: 'Customer Return #RET-201',
    body: 'Refund #RET-201 processed for Rs. 500.',
    timestamp: baseTs + 2000,
    data: {
      tag: 'pos-return-RET-201',
      url: '/?tab=returns&return=RET-201',
    },
  });

  await harness.dispatchPush({
    title: 'Shoe Exchange #INV-102',
    body: 'Exchange #INV-102 net difference Rs. 300.',
    timestamp: baseTs + 3000,
    data: {
      tag: 'pos-exchange-INV-102',
      url: '/?tab=reports&invoice=INV-102',
    },
  });

  await harness.dispatchPush({
    title: 'System Announcement',
    body: 'Scheduled maintenance tonight at 11 PM.',
    timestamp: baseTs + 4000,
    data: {
      tag: 'platform-notice-99',
      url: '/notifications',
    },
  });

  // Dispatch 10+ total notifications without closing or merging older ones
  for (let i = 1; i <= 8; i++) {
    await harness.dispatchPush({
      title: `POS Sale #INV-${200 + i}`,
      body: `Invoice #INV-${200 + i} completed.`,
      timestamp: baseTs + 4000 + i * 1000,
      data: {
        tag: `pos-sale-INV-${200 + i}`,
        url: `/?tab=reports&invoice=INV-${200 + i}`,
      },
    });
  }

  assert.equal(harness.activeNotifications.size, 12);

  const sale = harness.activeNotifications.get('pos-sale-INV-101');
  const ret = harness.activeNotifications.get('pos-return-RET-201');
  const exch = harness.activeNotifications.get('pos-exchange-INV-102');
  const notice = harness.activeNotifications.get('platform-notice-99');

  assert.equal(sale.title, 'Sale Confirmed #INV-101');
  assert.equal(ret.title, 'Customer Return #RET-201');
  assert.equal(exch.title, 'Shoe Exchange #INV-102');
  assert.equal(notice.title, 'System Announcement');
  assert.equal('groupKey' in sale.data, false);
  assert.equal('isGroupSummary' in sale.data, false);
  assert.deepEqual(
    Array.from(sale.actions, (a: any) => a.action),
    ['view_invoice', 'open_pos']
  );

  // Clicking one individual notification opens its own deep link and closes only itself
  await harness.dispatchClick(exch, '');
  assert.equal(harness.openWindows[0], '/?tab=reports&invoice=INV-102');
  assert.equal(harness.activeNotifications.size, 11);
});

test('showSingleNotificationWithRegistration displays each notification individually and skips identical duplicate tag', async () => {
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

  await notificationShade.showSingleNotificationWithRegistration(mockRegistration, 'POS Alert #1', {
    body: 'First alert body',
    icon: '/pwa-192x192.png',
    badge: '/icons/badge-favicon.png',
    tag: 'fg-pos-1',
    timestamp: 1760000001000,
    data: { url: '/pos', isAdmin: 'false' },
  });

  await notificationShade.showSingleNotificationWithRegistration(mockRegistration, 'POS Alert #2', {
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
  assert.equal('groupKey' in active.get('fg-pos-1').data, false);
  assert.equal('isGroupSummary' in active.get('fg-pos-1').data, false);
  assert.deepEqual(
    Array.from(active.get('fg-pos-2').actions, (a: any) => a.action),
    ['view_invoice', 'open_pos']
  );

  // Re-dispatching an active tag with renotify=false skips duplicate showNotification call
  const callsBeforeDup = showCalls;
  await notificationShade.showSingleNotificationWithRegistration(mockRegistration, 'POS Alert #1', {
    body: 'First alert body',
    tag: 'fg-pos-1',
    timestamp: 1760000001000,
    data: { url: '/pos', isAdmin: 'false' },
  });
  assert.equal(showCalls, callsBeforeDup);
});

test('notifyPosAction assigns distinct unique eventTags even for multiple returns on the same invoice', async () => {
  const sseChunks: string[] = [];
  const unregister = registerSseClient(42, 7, 'ADMIN', {
    write: (chunk: string) => {
      sseChunks.push(chunk);
      return true;
    },
  } as any);

  try {
    await notifyPosAction(42, {
      type: 'RETURN',
      title: 'Return #RET-1',
      message: 'First return on INV-50',
      invoiceNumber: 'INV-50',
      returnNumber: 'RET-1',
      deepLinkUrl: '/?tab=returns',
      timestamp: new Date().toISOString(),
    });

    await notifyPosAction(42, {
      type: 'RETURN',
      title: 'Return #RET-2',
      message: 'Second return on INV-50',
      invoiceNumber: 'INV-50',
      returnNumber: 'RET-2',
      deepLinkUrl: '/?tab=returns',
      timestamp: new Date().toISOString(),
    });

    assert.equal(sseChunks.length, 2);
    const firstData = JSON.parse(sseChunks[0].replace(/^event: pos_action\ndata: /, '').trim());
    const secondData = JSON.parse(sseChunks[1].replace(/^event: pos_action\ndata: /, '').trim());
    assert.notEqual(firstData.tag, secondData.tag);
    assert.notEqual(firstData.eventId, secondData.eventId);
  } finally {
    unregister();
  }
});

test('public/sw.js skips duplicate unchanged already-shown alerts cleanly', async () => {
  const harness = createSwShadeHarness();
  const baseTs = 1760000000000;

  await harness.dispatchPush({
    title: 'POS Test Alert',
    body: 'Device notifications are operational.',
    timestamp: baseTs + 1000,
    data: {
      eventId: 'test-push-single-1',
      tag: 'test-push-single-1',
      url: '/pos',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  const firstCard = harness.activeNotifications.get('test-push-single-1');
  assert.ok(firstCard);

  await harness.dispatchPush({
    title: 'POS Test Alert',
    body: 'Device notifications are operational.',
    timestamp: baseTs + 2000,
    data: {
      eventId: 'test-push-single-1',
      tag: 'test-push-single-1',
      url: '/pos',
    },
  });

  assert.equal(harness.activeNotifications.size, 1);
  assert.equal(harness.activeNotifications.get('test-push-single-1'), firstCard);
});
