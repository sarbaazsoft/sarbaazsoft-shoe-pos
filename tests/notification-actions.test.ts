import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  resolveNotificationActions,
  buildPushNotificationActions,
  navigateToNotificationUrl,
} from '../src/utils/notificationActions.ts';
import { showSingleNotificationWithRegistration } from '../src/utils/notificationShade.ts';

function createSwActionHarness() {
  const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const listeners = new Map<string, (event: any) => void>();
  const activeNotifications = new Map<string, any>();
  const openWindows: string[] = [];
  const postedMessages: any[] = [];
  let backgroundHandler: ((payload: any) => Promise<any>) | null = null;

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
        onBackgroundMessage: (fn: (payload: any) => Promise<any>) => {
          backgroundHandler = fn;
        },
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

  const syncUserRole = (role: string) => {
    const msgListener = listeners.get('message');
    assert.ok(msgListener, 'message listener must exist');
    msgListener({
      data: {
        type: 'SYNC_AUTH_CONTEXT',
        tenantId: 1,
        userRole: role,
      },
      waitUntil: () => {},
    });
  };

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

  const setOpenWindowClient = () => {
    const clientUrl = 'https://sarbaazsoft.cloud.run/pos';
    sandbox.self.clients.matchAll = async () => [
      {
        url: clientUrl,
        focus: async () => {},
        navigate: async (url: string) => {
          openWindows.push(`nav:${url}`);
        },
        postMessage: (msg: any) => {
          postedMessages.push(msg);
        },
      },
    ];
  };

  return {
    activeNotifications,
    openWindows,
    postedMessages,
    syncUserRole,
    dispatchPush,
    dispatchClick,
    setOpenWindowClient,
    triggerBackgroundFcm: async (payload: any) => {
      await Promise.resolve();
      if (backgroundHandler) {
        await backgroundHandler(payload);
      }
    },
  };
}

test('resolveNotificationActions produces dynamic primary + persistent Open POS with max 2 buttons and zero Dismiss/Unsubscribe', () => {
  // 1. Invoice / Sale
  const invoiceBtns = resolveNotificationActions(
    { type: 'INVOICE', invoiceId: 'INV-4201' },
    'CASHIER'
  );
  assert.deepEqual(invoiceBtns, [
    { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-4201' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 2. Announcement / Platform Notice
  const announcementBtns = resolveNotificationActions(
    { type: 'ANNOUNCEMENT', announcementId: 88 },
    'ADMIN'
  );
  assert.deepEqual(announcementBtns, [
    { action: 'read_more', label: 'Read More', url: '/announcements/88' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 3. Low Stock (without invoiceId, including batched alert carrying saleId/invoiceNumber)
  const lowStockBtns = resolveNotificationActions(
    { type: 'LOW_STOCK', itemType: 'LOW_STOCK' },
    'ADMIN'
  );
  assert.deepEqual(lowStockBtns, [
    { action: 'view_stock', label: 'View Stock', url: '/inventory?filter=low-stock' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  const batchedLowStockBtns = resolveNotificationActions(
    { type: 'STOCK', itemType: 'LOW_STOCK', saleId: '42', invoiceNumber: 'INV-100' },
    'OWNER'
  );
  assert.deepEqual(batchedLowStockBtns, [
    { action: 'view_stock', label: 'View Stock', url: '/inventory?filter=low-stock' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 3b. Explicit invoiceId on non-INVOICE or LOW_STOCK notification resolves View Invoice
  const explicitInvoiceOnSystem = resolveNotificationActions(
    { type: 'SYSTEM', invoiceId: 'INV-888' },
    'CASHIER'
  );
  assert.deepEqual(explicitInvoiceOnSystem, [
    { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-888' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  const explicitInvoiceOnLowStock = resolveNotificationActions(
    { type: 'LOW_STOCK', invoiceId: 'INV-99' },
    'ADMIN'
  );
  assert.deepEqual(explicitInvoiceOnLowStock, [
    { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-99' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 1b. Return with invoiceNumber resolves View Invoice + Open POS
  const returnBtns = resolveNotificationActions(
    { type: 'RETURN', invoiceNumber: 'INV-4201', returnNumber: 'RET-10' },
    'CASHIER'
  );
  assert.deepEqual(returnBtns, [
    { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-4201' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 1c. Independent Return (no invoiceNumber) routes View Invoice fallback to /returns + Open POS
  const indepReturnBtns = resolveNotificationActions(
    { type: 'RETURN', returnNumber: 'RET-000012' },
    'ADMIN'
  );
  assert.deepEqual(indepReturnBtns, [
    { action: 'view_invoice', label: 'View Invoice', url: '/returns' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 1d. Purchase resolves View Purchase + Open POS
  const purchaseBtns = resolveNotificationActions(
    { type: 'PURCHASE', purchaseNumber: 'PUR-000025' },
    'ADMIN'
  );
  assert.deepEqual(purchaseBtns, [
    { action: 'view_purchase', label: 'View Purchase', url: '/?tab=purchases' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 4a. Fallback for OWNER / ADMIN -> Dashboard + Open POS
  const adminFallback = resolveNotificationActions({ type: 'TEST_PUSH' }, 'ADMIN');
  assert.deepEqual(adminFallback, [
    { action: 'open_dashboard', label: 'Dashboard', url: '/dashboard' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  const ownerFallback = resolveNotificationActions({ type: 'SYSTEM' }, 'OWNER');
  assert.deepEqual(ownerFallback, [
    { action: 'open_dashboard', label: 'Dashboard', url: '/dashboard' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // 4b. Fallback for CASHIER -> Omit Button 1, render only Open POS
  const cashierFallback = resolveNotificationActions({ type: 'TEST_PUSH' }, 'CASHIER');
  assert.deepEqual(cashierFallback, [
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);

  // Push action formatter never exceeds 2 and strips dismiss/unsubscribe
  const pushBtns = buildPushNotificationActions({ type: 'SALE', invoiceNumber: 'INV-9' }, 'CASHIER');
  assert.equal(pushBtns.length, 2);
  assert.ok(!pushBtns.some((b) => /dismiss|unsubscribe/i.test(b.action) || /dismiss|unsubscribe/i.test(b.title)));
});

test('showSingleNotificationWithRegistration strips dismiss/unsubscribe actions and enforces max 2 actions', async () => {
  const shown: any[] = [];
  const mockReg = {
    getNotifications: async () => [],
    showNotification: async (title: string, options: any) => {
      shown.push({ title, options });
    },
  };

  await showSingleNotificationWithRegistration(mockReg, 'Low Stock Warning', {
    body: '3 items need restocking',
    tag: 'low-stock-1',
    actions: [
      { action: 'dismiss', title: 'Dismiss' },
      { action: 'unsubscribe', title: 'Unsubscribe' },
    ],
    data: {
      type: 'LOW_STOCK',
      itemType: 'LOW_STOCK',
      url: '/?tab=inventory&lowStockOnly=true',
    },
  });

  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].options.actions, [
    { action: 'view_stock', title: 'View Stock' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
});

test('public/sw.js renders dynamic actions (<= 2) across push events and routes notificationclick accurately', async () => {
  const harness = createSwActionHarness();

  const toPlain = <T>(val: T): T => JSON.parse(JSON.stringify(val));

  // Invoice push
  await harness.dispatchPush({
    title: 'Sale #INV-555',
    body: 'Completed Rs. 2500',
    data: { type: 'SALE', invoiceId: 'INV-555', tag: 'notif-inv-555' },
  });
  const invNotif = harness.activeNotifications.get('notif-inv-555');
  assert.deepEqual(toPlain(invNotif.actions), [
    { action: 'view_invoice', title: 'View Invoice' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(invNotif, 'view_invoice');
  assert.equal(harness.openWindows.pop(), '/invoices/INV-555');

  // Announcement push
  await harness.dispatchPush({
    title: 'System Update',
    body: 'New reporting charts live.',
    data: { type: 'ANNOUNCEMENT', announcementId: '77', tag: 'notif-ann-77' },
  });
  const annNotif = harness.activeNotifications.get('notif-ann-77');
  assert.deepEqual(toPlain(annNotif.actions), [
    { action: 'read_more', title: 'Read More' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(annNotif, 'read_more');
  assert.equal(harness.openWindows.pop(), '/announcements/77');

  // Low stock push (without invoiceId)
  await harness.dispatchPush({
    title: 'Low Stock Alert',
    body: 'Nike Air is below threshold.',
    data: { type: 'LOW_STOCK', itemType: 'LOW_STOCK', tag: 'notif-stock-1' },
  });
  const stockNotif = harness.activeNotifications.get('notif-stock-1');
  assert.deepEqual(toPlain(stockNotif.actions), [
    { action: 'view_stock', title: 'View Stock' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(stockNotif, 'view_stock');
  assert.equal(harness.openWindows.pop(), '/inventory?filter=low-stock');

  // Explicit invoiceId push on arbitrary type routes to View Invoice
  await harness.dispatchPush({
    title: 'Invoice Adjustment',
    body: 'Invoice updated.',
    data: { type: 'SYSTEM', invoiceId: 'INV-888', tag: 'notif-sys-inv' },
  });
  const sysInvNotif = harness.activeNotifications.get('notif-sys-inv');
  assert.deepEqual(toPlain(sysInvNotif.actions), [
    { action: 'view_invoice', title: 'View Invoice' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(sysInvNotif, 'view_invoice');
  assert.equal(harness.openWindows.pop(), '/invoices/INV-888');

  // Return push resolves View Invoice + Open POS
  await harness.dispatchPush({
    title: 'Return Completed',
    body: 'Return #: #RET-10\n1 pair returned by Walk-in Customer.\nRefund: Rs. 1,200 (Cash)\nProcessed by: Ali',
    data: { type: 'RETURN', invoiceNumber: 'INV-555', returnNumber: 'RET-10', tag: 'notif-ret-inv' },
  });
  const retInvNotif = harness.activeNotifications.get('notif-ret-inv');
  assert.deepEqual(toPlain(retInvNotif.actions), [
    { action: 'view_invoice', title: 'View Invoice' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(retInvNotif, 'view_invoice');
  assert.equal(harness.openWindows.pop(), '/invoices/INV-555');

  // Purchase push resolves View Purchase + Open POS
  await harness.dispatchPush({
    title: 'Purchase Completed',
    body: 'Purchase #: #PUR-000025\n25 cartons purchased from Metro Supplier.\nPayment: Cash\nProcessed by: Ali',
    data: { type: 'PURCHASE', purchaseNumber: 'PUR-000025', tag: 'notif-pur-25' },
  });
  const purNotif = harness.activeNotifications.get('notif-pur-25');
  assert.deepEqual(toPlain(purNotif.actions), [
    { action: 'view_purchase', title: 'View Purchase' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(purNotif, 'view_purchase');
  assert.equal(harness.openWindows.pop(), '/?tab=purchases');

  // Fallback for OWNER/ADMIN
  harness.syncUserRole('ADMIN');
  await harness.dispatchPush({
    title: 'POS Test Alert',
    body: 'Diagnostics OK.',
    data: { type: 'TEST_PUSH', tag: 'notif-test-admin' },
  });
  const adminFallback = harness.activeNotifications.get('notif-test-admin');
  assert.deepEqual(toPlain(adminFallback.actions), [
    { action: 'open_dashboard', title: 'Dashboard' },
    { action: 'open_pos', title: 'Open POS' },
  ]);
  await harness.dispatchClick(adminFallback, 'open_dashboard');
  assert.equal(harness.openWindows.pop(), '/dashboard');

  // Fallback for CASHIER omits Dashboard button
  harness.syncUserRole('CASHIER');
  await harness.dispatchPush({
    title: 'POS Test Alert',
    body: 'Diagnostics OK.',
    data: { type: 'TEST_PUSH', tag: 'notif-test-cashier' },
  });
  const cashierFallback = harness.activeNotifications.get('notif-test-cashier');
  assert.deepEqual(toPlain(cashierFallback.actions), [
    { action: 'open_pos', title: 'Open POS' },
  ]);

  // Open POS action focuses open window and sends POS_DEEP_LINK_NOTIFICATION WITHOUT reloading via targetClient.navigate
  harness.setOpenWindowClient();
  const prevOpenCount = harness.openWindows.length;
  await harness.dispatchClick(cashierFallback, 'open_pos');
  assert.equal(harness.postedMessages[0].type, 'POS_DEEP_LINK_NOTIFICATION');
  assert.equal(harness.postedMessages[0].action, 'open_pos');
  assert.equal(harness.postedMessages[0].targetUrl, '/pos');
  assert.equal(harness.openWindows.length, prevOpenCount, 'Must NOT call targetClient.navigate or openWindow when app is already open');

  // View Invoice action on open window also posts deep-link without calling targetClient.navigate
  await harness.dispatchClick(invNotif, 'view_invoice');
  assert.equal(harness.postedMessages[1].type, 'POS_DEEP_LINK_NOTIFICATION');
  assert.equal(harness.postedMessages[1].action, 'view_invoice');
  assert.equal(harness.postedMessages[1].targetUrl, '/invoices/INV-555');
  assert.equal(harness.openWindows.length, prevOpenCount, 'Must NOT reload existing client window on View Invoice click');
});

test('UI notification footers have removed custom Dismiss and Unsubscribe buttons', () => {
  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const notificationsViewSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'notifications', 'NotificationsView.tsx'),
    'utf8'
  );
  const headerSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'common', 'Header.tsx'),
    'utf8'
  );

  // SW must never emit dismiss or unsubscribe actions
  assert.equal(/action:\s*['"](?:dismiss|unsubscribe)['"]/.test(swSrc), false);

  // NotificationsView card footer uses dynamic action resolver without Dismiss button
  assert.equal(notificationsViewSrc.includes('resolveNotificationActions'), true);
  assert.equal(notificationsViewSrc.includes("<span>{isDismissing ? 'Saving...' : 'Dismiss'}</span>"), false);

  // Header dropdown cards and floating push toast use dynamic action resolver without Dismiss buttons
  assert.equal(headerSrc.includes('resolveNotificationActions'), true);
  assert.equal(headerSrc.includes('<span>Dismiss</span>'), false);
  assert.equal(headerSrc.includes('>Dismiss<'), false);
});

test('navigateToNotificationUrl routes client-side when authenticated and falls back to full navigation when unauthenticated or external', () => {
  const prevWindow = (globalThis as any).window;
  const prevLocalStorage = (globalThis as any).localStorage;
  const prevCustomEvent = (globalThis as any).CustomEvent;

  const dispatched: any[] = [];
  const assigned: string[] = [];
  const storageMap = new Map<string, string>();

  (globalThis as any).CustomEvent = class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  (globalThis as any).localStorage = {
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => storageMap.set(k, v),
    removeItem: (k: string) => storageMap.delete(k),
  };
  (globalThis as any).window = {
    location: {
      origin: 'https://sarbaazsoft.cloud.run',
      assign: (url: string) => {
        assigned.push(url);
      },
    },
    dispatchEvent: (ev: any) => {
      dispatched.push(ev);
      return true;
    },
  };

  try {
    // 1. Unauthenticated -> preserves standard document navigation
    navigateToNotificationUrl('/invoices/INV-100');
    assert.deepEqual(assigned, ['/invoices/INV-100']);
    assert.equal(dispatched.length, 0);

    // Build valid unexpired JWT token
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payloadB64 = Buffer.from(JSON.stringify({ sub: 1, exp: futureExp })).toString('base64url');
    storageMap.set('pos_auth_token', `header.${payloadB64}.sig`);

    // 2. Authenticated relative path -> client-side event, zero location.assign
    navigateToNotificationUrl('/invoices/INV-101', { invoiceId: 'INV-101' });
    navigateToNotificationUrl('https://sarbaazsoft.cloud.run/inventory?filter=low-stock');
    navigateToNotificationUrl('/dashboard');
    navigateToNotificationUrl('/pos');
    assert.equal(assigned.length, 1);
    assert.deepEqual(
      dispatched.map((e) => e.detail.url),
      ['/invoices/INV-101', '/inventory?filter=low-stock', '/dashboard', '/pos']
    );

    // 3. External URL -> location.assign even when authenticated
    navigateToNotificationUrl('https://example.com/release-notes');
    assert.deepEqual(assigned, ['/invoices/INV-100', 'https://example.com/release-notes']);
  } finally {
    (globalThis as any).window = prevWindow;
    (globalThis as any).localStorage = prevLocalStorage;
    (globalThis as any).CustomEvent = prevCustomEvent;
  }
});

test('Notification footer links, push clients, and destination views enforce no-reload SPA routing with skeletons', () => {
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const headerSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'common', 'Header.tsx'), 'utf8');
  const bannerSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'pos', 'PosNotificationBanner.tsx'), 'utf8');
  const firebaseSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'firebaseConfig.ts'), 'utf8');
  const pushClientSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'pushNotificationClient.ts'), 'utf8');
  const reportsSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'reports', 'ReportsDashboard.tsx'), 'utf8');
  const notificationsViewSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'notifications', 'NotificationsView.tsx'), 'utf8');

  // App.tsx listens for Service Worker messages on navigator.serviceWorker as well as window
  assert.equal(appSrc.includes('navigator.serviceWorker'), true);
  assert.equal(appSrc.includes("swContainer?.addEventListener('message'"), true);

  // Notification handlers avoid window.location.href / window.open reloads
  assert.equal(headerSrc.includes('window.location.href'), false);
  assert.equal(headerSrc.includes("window.open(actionUrl"), false);
  assert.equal(bannerSrc.includes('window.location.href'), false);
  assert.equal(firebaseSrc.includes('window.location.href'), false);
  assert.equal(pushClientSrc.includes('window.location.href'), false);

  // Destination receipt and announcement modals include skeleton loading states
  assert.equal(reportsSrc.includes('isLoadingReceiptModal'), true);
  assert.equal(reportsSrc.includes('aria-label="Loading invoice receipt"'), true);
  assert.equal(notificationsViewSrc.includes('aria-label="Loading announcement"'), true);
});
