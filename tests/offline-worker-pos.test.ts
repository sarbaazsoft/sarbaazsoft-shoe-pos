import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isTransientNetworkError,
  processOfflineSalesQueue,
} from '../src/services/offline/syncEngine.ts';
import type { OfflineSyncStorageAdapter, QueuedSale } from '../src/services/offline/offlineTypes.ts';
import {
  cacheCustomersOffline,
  getCachedCustomersOffline,
  getOfflineSales,
  queueOfflineSale,
  updateOfflineSaleStatus,
} from '../src/utils/offlineDb.ts';

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

test('isTransientNetworkError classifies all offline/proxy/Safari connection failures without misclassifying business errors', () => {
  assert.equal(isTransientNetworkError(new Error('Failed to fetch')), true);
  assert.equal(isTransientNetworkError(new Error('Load failed')), true);
  assert.equal(isTransientNetworkError(new Error('Server is temporarily reconnecting. Please try again in a moment.')), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error('Gateway error'), { status: 503 })), true);
  assert.equal(isTransientNetworkError(new Error('Insufficient stock for article A-101')), false);
  assert.equal(isTransientNetworkError(new Error('Minimum Price Violation')), false);
});

test('processOfflineSalesQueue keeps queued sales PENDING on reconnecting/Safari errors', async () => {
  const queue: QueuedSale[] = [
    {
      clientTxId: 'OFFLINE-T1-1',
      createdAt: '2026-11-18T10:00:00.000Z',
      items: [{ productId: 10, article: 'SH-10', name: 'Runner', quantity: 1, unitPrice: 3500, discount: 0 }],
      customerId: null,
      paymentMethod: 'CASH',
      cashReceived: 3500,
      changeGiven: 0,
      totalAmount: 3500,
      subtotal: 3500,
      totalDiscount: 0,
      notes: '',
      status: 'PENDING',
    },
  ];

  const storage: OfflineSyncStorageAdapter = {
    async getSales() {
      return queue;
    },
    async updateSaleStatus(clientTxId, status, extra) {
      const item = queue.find((s) => s.clientTxId === clientTxId);
      if (item) {
        item.status = status;
        if (extra) Object.assign(item, extra);
      }
    },
  };

  for (const msg of [
    'Server is temporarily reconnecting. Please try again in a moment.',
    'Load failed',
  ]) {
    queue[0].status = 'PENDING';
    const res = await processOfflineSalesQueue(storage, {
      async submitCheckout() {
        throw new Error(msg);
      },
    });
    assert.equal(res.abortedByNetwork, true);
    assert.equal(queue[0].status, 'PENDING');
  }
});

test('offlineDb aligns DB_VERSION=4 with public/sw.js and falls back to localStorage queue & customers when IndexedDB is unavailable', async () => {
  const offlineDbSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/offlineDb.ts'), 'utf8');
  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  assert.ok(offlineDbSrc.includes('const DB_VERSION = 4;'));
  assert.ok(swSrc.includes('const DB_VERSION = 4;'));

  const prevLocal = (globalThis as any).localStorage;
  const mockStorage = createMockStorage();
  const token = makeFakeJwt({ id: 1, tenantId: 7, role: 'CASHIER', exp: Math.floor(Date.now() / 1000) + 3600 });
  mockStorage.setItem('pos_auth_token', token);
  mockStorage.setItem('pos_current_user', JSON.stringify({ id: 1, tenantId: 7, role: 'CASHIER' }));
  (globalThis as any).localStorage = mockStorage;

  try {
    cacheCustomersOffline([{ id: 12, name: 'Walk-In VIP', phone: '03001234567' }], 7);
    const customers = getCachedCustomersOffline(7);
    assert.equal(customers.length, 1);
    assert.equal(customers[0].name, 'Walk-In VIP');

    await queueOfflineSale(
      {
        clientTxId: 'OFFLINE-T7-99',
        tenantId: 7,
        createdAt: new Date().toISOString(),
        items: [{ productId: 5, article: 'A-5', name: 'Loafer', quantity: 1, unitPrice: 2400, discount: 0 }],
        customerId: 12,
        paymentMethod: 'CASH',
        cashReceived: 2400,
        changeGiven: 0,
        totalAmount: 2400,
        subtotal: 2400,
        totalDiscount: 0,
        notes: 'Offline fallback test',
        status: 'PENDING',
      },
      7
    );

    const sales = await getOfflineSales(7);
    assert.equal(sales.length, 1);
    assert.equal(sales[0].clientTxId, 'OFFLINE-T7-99');

    await updateOfflineSaleStatus('OFFLINE-T7-99', 'SYNCED', { syncedInvoiceNumber: 'INV-701' });
    const updatedSales = await getOfflineSales(7);
    assert.equal(updatedSales[0].status, 'SYNCED');
    assert.equal(updatedSales[0].syncedInvoiceNumber, 'INV-701');
  } finally {
    (globalThis as any).localStorage = prevLocal;
  }
});

test('offline worker integration wires SW registration, SW_TRIGGER_OFFLINE_SYNC, offline preload guard, and zero asset caching', () => {
  const mainSrc = fs.readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8');
  assert.ok(mainSrc.includes("navigator.serviceWorker.register('/sw.js'"));

  const swUpdateSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/swUpdate.ts'), 'utf8');
  assert.ok(swUpdateSrc.includes('navigator.onLine === false'));

  const queueSvcSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/offlineQueueService.ts'), 'utf8');
  assert.ok(queueSvcSrc.includes("data.type === 'SW_TRIGGER_OFFLINE_SYNC'"));
  assert.ok(queueSvcSrc.includes("BroadcastChannel('pos_background_sync_channel')"));

  const keepAliveSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/KeepAliveRouteHost.tsx'), 'utf8');
  assert.ok(keepAliveSrc.includes('TabErrorBoundary'));

  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  assert.equal(/caches\.open\s*\(/.test(swSrc), false);
  assert.equal(/caches\.put\s*\(/.test(swSrc), false);
  assert.ok(swSrc.includes('OFFLINE WORKER READY'));
});
