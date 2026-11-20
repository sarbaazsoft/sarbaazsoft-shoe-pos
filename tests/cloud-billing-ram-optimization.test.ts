import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { shouldPollBackendHealth } from '../src/services/offlineQueueService.ts';
import { DEFAULT_MAX_KEEP_ALIVE_TABS, CORE_PINNED_TABS } from '../src/context/RouteLifecycleContext.tsx';
import { cacheCatalogOffline, searchCachedProductsOffline } from '../src/utils/offlineDb.ts';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(k: string) {
      store.delete(k);
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
  };
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

test('shouldPollBackendHealth skips polling when online, healthy, and queue empty, but polls on recovery or pending sales', () => {
  // Online, connected, 0 pending -> ZERO background /api/health hits (allows scale-to-zero)
  assert.equal(
    shouldPollBackendHealth({
      isOnline: true,
      isBackendConnected: true,
      pendingCount: 0,
      hasAuthToken: true,
      isDocumentHidden: false,
    }),
    false
  );

  // Unauthenticated or hidden tab -> skip polling
  assert.equal(
    shouldPollBackendHealth({
      isOnline: true,
      isBackendConnected: false,
      pendingCount: 2,
      hasAuthToken: false,
      isDocumentHidden: false,
    }),
    false
  );
  assert.equal(
    shouldPollBackendHealth({
      isOnline: true,
      isBackendConnected: false,
      pendingCount: 2,
      hasAuthToken: true,
      isDocumentHidden: true,
    }),
    false
  );

  // Offline browser -> skip doomed network pings
  assert.equal(
    shouldPollBackendHealth({
      isOnline: false,
      isBackendConnected: false,
      pendingCount: 3,
      hasAuthToken: true,
      isDocumentHidden: false,
    }),
    false
  );

  // Disconnected backend while browser reports online -> poll for recovery
  assert.equal(
    shouldPollBackendHealth({
      isOnline: true,
      isBackendConnected: false,
      pendingCount: 0,
      hasAuthToken: true,
      isDocumentHidden: false,
    }),
    true
  );

  // Online with queued offline sales -> poll/flush pending queue
  assert.equal(
    shouldPollBackendHealth({
      isOnline: true,
      isBackendConnected: true,
      pendingCount: 1,
      hasAuthToken: true,
      isDocumentHidden: false,
    }),
    true
  );
});

test('KeepAliveRouteHost expands mounted tabs to 8 while keeping pos and dashboard pinned, with zero 30s polling', () => {
  assert.equal(DEFAULT_MAX_KEEP_ALIVE_TABS, 8);
  assert.equal(CORE_PINNED_TABS.has('pos'), true);
  assert.equal(CORE_PINNED_TABS.has('dashboard'), true);

  const headerSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/Header.tsx'), 'utf8');
  const posBannerSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/pos/PosNotificationBanner.tsx'), 'utf8');
  const landingSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/saas/SaasLandingPage.tsx'), 'utf8');
  const notifCtxSrc = fs.readFileSync(path.join(process.cwd(), 'src/context/NotificationContext.tsx'), 'utf8');

  assert.equal(headerSrc.includes('30_000'), false);
  assert.equal(posBannerSrc.includes('30_000'), false);
  assert.equal(landingSrc.includes('30_000'), false);
  assert.ok(notifCtxSrc.includes('noticesOnly: true'));
  assert.ok(notifCtxSrc.includes('loadHistoryOnDemand'));
});

test('offlineDb strips heavy base64 data URLs from localStorage catalog mirror while preserving barcodes and pricing', async () => {
  const prevLocal = (globalThis as any).localStorage;
  const mockStorage = createMockStorage();
  const token = makeFakeJwt({ id: 2, tenantId: 14, role: 'CASHIER', exp: Math.floor(Date.now() / 1000) + 3600 });
  mockStorage.setItem('pos_auth_token', token);
  mockStorage.setItem('pos_current_user', JSON.stringify({ id: 2, tenantId: 14, role: 'CASHIER' }));
  (globalThis as any).localStorage = mockStorage;

  try {
    await cacheCatalogOffline(
      [
        {
          id: 101,
          tenantId: 14,
          article: 'RUN-101',
          name: 'Pro Runner',
          barcode: 'SN-101',
          sellingPrice: 4500,
          totalStock: 12,
          primaryImageUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
          brandLogo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
        },
      ],
      14
    );

    const rawMirror = mockStorage.getItem('pos_offline_catalog_tenant:14') || '[]';
    const parsedMirror = JSON.parse(rawMirror);
    assert.equal(parsedMirror.length, 1);
    assert.equal(parsedMirror[0].primaryImageUrl, '');
    assert.equal(parsedMirror[0].brandLogo, '');

    const matches = await searchCachedProductsOffline('SN-101', 14);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sellingPrice, 4500);
    assert.equal(matches[0].totalStock, 12);
  } finally {
    (globalThis as any).localStorage = prevLocal;
  }
});

test('SettingsView webcam cleanup, debounced POS/Exchange searches, and lazy modal splits remain intact', () => {
  const settingsSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/settings/SettingsView.tsx'), 'utf8');
  assert.ok(settingsSrc.includes('useRouteActivity'));
  assert.ok(settingsSrc.includes('cameraStreamRef'));
  assert.ok(settingsSrc.includes("!isRouteActive || activeTab !== 'store'"));

  const posSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/pos/PosTerminal.tsx'), 'utf8');
  assert.ok(posSrc.includes('manualSearchTimerRef'));
  assert.ok(posSrc.includes('manualSearchAbortRef'));

  const exchangeSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/pos/ShoeExchangeModal.tsx'), 'utf8');
  assert.ok(exchangeSrc.includes('productSearchTimerRef'));
  assert.ok(exchangeSrc.includes('productSearchAbortRef'));

  const offlineToastSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/OfflineToastNotification.tsx'), 'utf8');
  assert.ok(offlineToastSrc.includes('lazy(() =>'));
  assert.ok(offlineToastSrc.includes('{isModalOpen && ('));

  const sidebarSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/Sidebar.tsx'), 'utf8');
  assert.ok(sidebarSrc.includes('lazy(() =>'));
  assert.ok(sidebarSrc.includes('{isInstallModalOpen && ('));
});
