import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import {
  buildFcmNotificationConfig,
  DEFAULT_NOTIFICATION_ICON,
  NOTIFICATION_BADGE_ICON,
} from '../src/server/pushNotificationService.ts';
import { recordApplicationBaseUrl } from '../src/server/services/welcomeService.ts';
import {
  claimNotificationChannel,
  isNotificationChannelClaimed,
  recordSwNotificationShown,
  resetNotificationDedupeCache,
} from '../src/utils/notificationDedupe.ts';
import { showSingleNotificationWithRegistration } from '../src/utils/notificationShade.ts';
import {
  decodeBase64UrlToBytes,
  doVapidKeysMatch,
  normalizeVapidPublicKey,
} from '../src/utils/vapid.ts';

function generateTestVapidKeyPairBase64Url(seedByte = 0x11): string {
  const bytes = new Uint8Array(65);
  bytes[0] = 0x04;
  for (let i = 1; i < 65; i++) {
    bytes[i] = (seedByte + i) & 0xff;
  }
  return Buffer.from(bytes).toString('base64url');
}

test('VAPID normalizer accepts base64/base64url/padded P-256 keys and rejects invalid values', () => {
  const validBase64Url = generateTestVapidKeyPairBase64Url(0x2a);
  const stdBase64WithPaddingAndQuotes = `"  ${validBase64Url.replace(/-/g, '+').replace(/_/g, '/')}==  "`;

  assert.equal(normalizeVapidPublicKey(validBase64Url), validBase64Url);
  assert.equal(normalizeVapidPublicKey(stdBase64WithPaddingAndQuotes), validBase64Url);

  assert.equal(normalizeVapidPublicKey('admin@example.com'), '');
  assert.equal(normalizeVapidPublicKey('too-short'), '');

  // Wrong prefix byte (0x02 compressed key instead of 0x04 uncompressed)
  const badPrefix = new Uint8Array(65);
  badPrefix[0] = 0x02;
  assert.equal(normalizeVapidPublicKey(Buffer.from(badPrefix).toString('base64url')), '');

  const decoded = decodeBase64UrlToBytes(validBase64Url)!;
  assert.equal(decoded.length, 65);
  assert.equal(doVapidKeysMatch(decoded.buffer, validBase64Url), true);

  const differentKey = generateTestVapidKeyPairBase64Url(0x7f);
  assert.equal(doVapidKeysMatch(decoded.buffer, differentKey), false);
});

test('public/sw.js registers push/notificationclick before Firebase compat and stops propagation to prevent double notifications', async () => {
  const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');

  const orderedListeners: Record<string, Array<(event: any) => void>> = {};
  const shownNotifications: Array<{ title: string; options: any }> = [];
  const broadcastMessages: any[] = [];
  let firebaseInternalPushCalled = false;
  let firebaseInternalClickCalled = false;

  class MockBroadcastChannel {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    postMessage(msg: any) {
      broadcastMessages.push(msg);
    }
    close() {}
  }

  const sandbox: Record<string, any> = {
    URL,
    Promise,
    Response,
    BroadcastChannel: MockBroadcastChannel,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        apiKey: 'test-key',
        projectId: 'test-proj',
        messagingSenderId: '123',
        appId: '1:123:web:abc',
      }),
    }),
    importScripts: (...scripts: string[]) => {
      // Simulate firebase-messaging-compat registering its own internal listeners during importScripts
      if (scripts.some((s) => s.includes('firebase-messaging-compat'))) {
        orderedListeners.push = orderedListeners.push || [];
        orderedListeners.push.push(() => {
          firebaseInternalPushCalled = true;
        });
        orderedListeners.notificationclick = orderedListeners.notificationclick || [];
        orderedListeners.notificationclick.push(() => {
          firebaseInternalClickCalled = true;
        });
      }
    },
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
    location: { origin: 'https://pos.example.com' },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async () => null,
    },
    registration: {
      getNotifications: async () => [],
      showNotification: async (title: string, options: any) => {
        shownNotifications.push({ title, options });
      },
    },
    addEventListener: (name: string, fn: (event: any) => void) => {
      orderedListeners[name] = orderedListeners[name] || [];
      orderedListeners[name].push(fn);
    },
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });
  await new Promise((r) => setTimeout(r, 20));

  const pushChain = orderedListeners.push || [];
  assert.ok(pushChain.length >= 2, 'Both sw.js and simulated firebase-messaging-compat push listeners exist');

  // Dispatch push event mimicking browser ServiceWorkerGlobalScope listener dispatch
  let stopped = false;
  let waitPromise: Promise<any> = Promise.resolve();
  for (const fn of pushChain) {
    if (stopped) break;
    fn({
      data: {
        json: () => ({
          notification: { title: 'Sale #INV-99', body: 'Rs. 4500 received' },
          data: { tag: 'pos-sale-INV-99', eventId: 'pos-sale-INV-99', url: '/?tab=reports' },
        }),
      },
      stopImmediatePropagation: () => {
        stopped = true;
      },
      waitUntil: (p: Promise<any>) => {
        waitPromise = p;
      },
    });
  }
  await waitPromise;

  assert.equal(stopped, true, 'sw.js push handler must call stopImmediatePropagation()');
  assert.equal(firebaseInternalPushCalled, false, 'Firebase compat push listener must not double-fire');
  assert.equal(shownNotifications.length, 1);
  assert.equal(shownNotifications[0].options.requireInteraction, false);
  assert.equal(shownNotifications[0].options.renotify, false);
  assert.equal(shownNotifications[0].options.silent, false);

  // Check BroadcastChannel foreground relay + OS dedupe events emitted by SW
  const shownMsgs = broadcastMessages.filter((m) => m?.type === 'SW_NOTIFICATION_SHOWN');
  const relayMsgs = broadcastMessages.filter((m) => m?.type === 'SW_PUSH_RECEIVED');
  assert.equal(relayMsgs.length, 1);
  assert.equal(shownMsgs.length, 1);
  assert.equal(shownMsgs[0].tag, 'pos-sale-INV-99');

  // Duplicate push within 15s suppresses sound/vibration via silent: true and never enables renotify
  stopped = false;
  for (const fn of pushChain) {
    if (stopped) break;
    fn({
      data: {
        json: () => ({
          notification: { title: 'Sale #INV-99', body: 'Rs. 4500 received' },
          data: { tag: 'pos-sale-INV-99', eventId: 'pos-sale-INV-99', url: '/?tab=reports' },
        }),
      },
      stopImmediatePropagation: () => {
        stopped = true;
      },
      waitUntil: (p: Promise<any>) => {
        waitPromise = p;
      },
    });
  }
  await waitPromise;

  assert.equal(shownNotifications.length, 2);
  assert.equal(shownNotifications[1].options.silent, true);
  assert.equal(shownNotifications[1].options.renotify, false);

  // Empty/malformed push payload must still resolve cleanly with showNotification
  stopped = false;
  for (const fn of pushChain) {
    if (stopped) break;
    fn({
      data: null,
      stopImmediatePropagation: () => {
        stopped = true;
      },
      waitUntil: (p: Promise<any>) => {
        waitPromise = p;
      },
    });
  }
  await waitPromise;
  assert.equal(shownNotifications.length, 3);

  // Dispatch notificationclick and verify firebase compat click handler doesn't hijack it
  let clickStopped = false;
  let clickWait: Promise<any> = Promise.resolve();
  for (const fn of orderedListeners.notificationclick || []) {
    if (clickStopped) break;
    fn({
      notification: {
        data: { url: '/?tab=reports' },
        close: () => {},
      },
      action: '',
      stopImmediatePropagation: () => {
        clickStopped = true;
      },
      waitUntil: (p: Promise<any>) => {
        clickWait = p;
      },
    });
  }
  await clickWait;
  assert.equal(clickStopped, true);
  assert.equal(firebaseInternalClickCalled, false);
});

test('SW_NOTIFICATION_SHOWN + showSingleNotificationWithRegistration prevent SSE/foreground duplicate notifications', async () => {
  resetNotificationDedupeCache();

  recordSwNotificationShown({
    type: 'SW_NOTIFICATION_SHOWN',
    tag: 'pos-sale-555',
    eventId: 'pos-sale-555',
    dedupeKey: 'id:pos-sale-555',
  } as any);

  assert.equal(isNotificationChannelClaimed('id:pos-sale-555', 'os_notification'), true);
  assert.equal(isNotificationChannelClaimed('id:pos-sale-555', 'audio'), false);
  assert.equal(claimNotificationChannel('id:pos-sale-555', 'os_notification'), false);

  // Also test registration-level active tag dedupe
  let showCount = 0;
  const mockReg = {
    getNotifications: async () => [{ tag: 'pos-sale-555', data: {} } as any],
    showNotification: async () => {
      showCount++;
    },
  };

  await showSingleNotificationWithRegistration(mockReg, 'Sale #555', {
    body: 'Completed',
    tag: 'pos-sale-555',
  });
  assert.equal(showCount, 0, 'Duplicate window-side notification for existing active tag should be skipped');
});

test('buildFcmNotificationConfig hardens webpush anti-spam defaults & HTTPS link while preserving Android APK config', () => {
  // Without HTTPS origin recorded (e.g., http://localhost:3000), relative link must omit fcmOptions.link
  recordApplicationBaseUrl('http://localhost:3000');
  const localCfg = buildFcmNotificationConfig({
    title: 'Sale Confirmed #INV-1',
    body: 'Completed at counter 1',
    deepLinkUrl: '/?tab=reports',
    tag: 'pos-sale-INV-1',
  });
  assert.equal(localCfg.httpsLinkUrl, undefined);
  assert.equal(localCfg.webpushHeaders.TTL, '86400');
  assert.equal(localCfg.webpushHeaders.Urgency, 'normal');
  assert.equal(localCfg.webpushNotification.renotify, false);
  assert.equal(localCfg.webpushNotification.requireInteraction, false);
  assert.equal(localCfg.webpushNotification.icon, DEFAULT_NOTIFICATION_ICON);
  assert.equal(localCfg.webpushNotification.badge, NOTIFICATION_BADGE_ICON);

  // Android APK notification properties must remain completely intact
  assert.deepEqual(localCfg.androidNotification, {
    title: 'Sale Confirmed #INV-1',
    body: 'Completed at counter 1',
    channelId: 'pos_alerts',
    color: '#9333EA',
    priority: 'max',
    defaultSound: true,
    defaultVibrateTimings: true,
    visibility: 'public',
  });

  // With HTTPS origin recorded, httpsLinkUrl resolves cleanly to HTTPS
  recordApplicationBaseUrl('https://pos.sarbaazsoft.com');
  const prodCfg = buildFcmNotificationConfig({
    title: 'Sale Confirmed #INV-2',
    body: 'Completed at counter 1',
    deepLinkUrl: '/?tab=reports',
    tag: 'pos-sale-INV-2',
  });
  assert.equal(prodCfg.httpsLinkUrl, 'https://pos.sarbaazsoft.com/?tab=reports');
});

test('public/sw.js does not emit SW_NOTIFICATION_SHOWN when showNotification rejects with NotAllowedError', async () => {
  const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');

  const orderedListeners: Record<string, Array<(event: any) => void>> = {};
  const broadcastMessages: any[] = [];
  let showCalls = 0;

  class MockBroadcastChannel {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    postMessage(msg: any) {
      broadcastMessages.push(msg);
    }
    close() {}
  }

  const sandbox: Record<string, any> = {
    URL,
    Promise,
    Response,
    BroadcastChannel: MockBroadcastChannel,
    fetch: async () => ({ ok: false }),
    importScripts: () => {},
    caches: {
      open: async () => ({ add: async () => {}, put: async () => {} }),
      keys: async () => [],
      match: async () => null,
      delete: async () => true,
    },
  };

  sandbox.self = {
    location: { origin: 'https://pos.example.com' },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async () => null,
    },
    registration: {
      getNotifications: async () => [],
      showNotification: async () => {
        showCalls++;
        const err = new Error('Notifications disabled by OS');
        err.name = 'NotAllowedError';
        throw err;
      },
    },
    addEventListener: (name: string, fn: (event: any) => void) => {
      orderedListeners[name] = orderedListeners[name] || [];
      orderedListeners[name].push(fn);
    },
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });
  await new Promise((r) => setTimeout(r, 20));

  let waitPromise: Promise<any> = Promise.resolve();
  for (const fn of orderedListeners.push || []) {
    fn({
      data: {
        json: () => ({
          notification: { title: 'Sale #INV-88', body: 'Rs. 1200' },
          data: { tag: 'pos-sale-INV-88', eventId: 'pos-sale-INV-88' },
        }),
      },
      stopImmediatePropagation: () => {},
      waitUntil: (p: Promise<any>) => {
        waitPromise = p;
      },
    });
  }
  await waitPromise;

  assert.equal(showCalls, 1, 'Should not retry showNotification after NotAllowedError');
  assert.equal(
    broadcastMessages.some((m) => m.type === 'SW_NOTIFICATION_SHOWN'),
    false,
    'Must never emit SW_NOTIFICATION_SHOWN when showNotification fails'
  );
  assert.equal(
    broadcastMessages.some((m) => m.type === 'SW_NOTIFICATION_DELIVERY_BLOCKED'),
    true,
    'Should emit SW_NOTIFICATION_DELIVERY_BLOCKED on NotAllowedError'
  );
});
