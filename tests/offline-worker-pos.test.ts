import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCheckoutRequestPayload,
  isTransientNetworkError,
  processOfflineSalesQueue,
} from '../src/services/offline/syncEngine.ts';
import type {
  OfflineSyncStorageAdapter,
  QueuedReturn,
  QueuedSale,
} from '../src/services/offline/offlineTypes.ts';
import {
  cacheCustomersOffline,
  cacheSalesHistoryOffline,
  getCachedCustomersOffline,
  getOfflineSales,
  queueOfflineReturn,
  queueOfflineSale,
  updateOfflineSaleStatus,
  verifyInvoiceOffline,
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

test('offlineDb aligns DB_VERSION=5 with public/sw.js and falls back to localStorage queue & customers when IndexedDB is unavailable', async () => {
  const offlineDbSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/offlineDb.ts'), 'utf8');
  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  assert.ok(offlineDbSrc.includes('const DB_VERSION = 5;'));
  assert.ok(swSrc.includes('const DB_VERSION = 5;'));

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

test('offline worker integration wires SW registration, SW_TRIGGER_OFFLINE_SYNC, offline shell caching, and offline stores', () => {
  const mainSrc = fs.readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8');
  assert.ok(mainSrc.includes("navigator.serviceWorker.register('/sw.js'"));
  assert.equal(mainSrc.includes('caches.delete'), false);

  const swUpdateSrc = fs.readFileSync(path.join(process.cwd(), 'src/utils/swUpdate.ts'), 'utf8');
  assert.ok(swUpdateSrc.includes('navigator.onLine === false'));

  const queueSvcSrc = fs.readFileSync(path.join(process.cwd(), 'src/services/offlineQueueService.ts'), 'utf8');
  assert.ok(queueSvcSrc.includes("data.type === 'SW_TRIGGER_OFFLINE_SYNC'"));
  assert.ok(queueSvcSrc.includes("BroadcastChannel('pos_background_sync_channel')"));

  const keepAliveSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/common/KeepAliveRouteHost.tsx'), 'utf8');
  assert.ok(keepAliveSrc.includes('TabErrorBoundary'));

  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  assert.ok(swSrc.includes('SHELL_CACHE'));
  assert.ok(swSrc.includes('RUNTIME_CACHE'));
  assert.ok(swSrc.includes('APP_SHELL_KEY'));
  assert.ok(swSrc.includes('offline_returns_queue'));
  assert.ok(swSrc.includes('cached_sales_by_store'));
  assert.ok(swSrc.includes('OFFLINE WORKER READY'));
  assert.ok(swSrc.includes('VersionError'));
});

test('offlineDb recovers from IndexedDB VersionError by falling back to existing database version without rejecting', async () => {
  const prevIndexedDB = (globalThis as any).indexedDB;
  const prevLocal = (globalThis as any).localStorage;

  const mockStorage = createMockStorage();
  const token = makeFakeJwt({ id: 1, tenantId: 9, role: 'CASHIER', exp: Math.floor(Date.now() / 1000) + 3600 });
  mockStorage.setItem('pos_auth_token', token);
  mockStorage.setItem('pos_current_user', JSON.stringify({ id: 1, tenantId: 9, role: 'CASHIER' }));
  (globalThis as any).localStorage = mockStorage;

  const openCalls: Array<number | undefined> = [];
  const fakeSales = [
    {
      clientTxId: 'OFFLINE-T9-1',
      tenantId: 9,
      createdAt: '2026-11-18T12:00:00.000Z',
      items: [],
      status: 'PENDING',
    },
  ];

  (globalThis as any).indexedDB = {
    open(_name: string, version?: number) {
      openCalls.push(version);
      const req: any = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (version !== undefined) {
          req.error = Object.assign(new Error('The requested version (5) is less than the existing version (6).'), {
            name: 'VersionError',
          });
          req.onerror?.({ target: req });
          return;
        }
        req.result = {
          version: 6,
          onversionchange: null,
          close() {},
          objectStoreNames: {
            contains: (storeName: string) =>
              storeName === 'offline_sales_queue' ||
              storeName === 'cached_products_by_store' ||
              storeName === 'offline_returns_queue' ||
              storeName === 'cached_sales_by_store',
          },
          transaction() {
            return {
              objectStore() {
                return {
                  getAll() {
                    const getReq: any = { result: fakeSales, onsuccess: null, onerror: null };
                    queueMicrotask(() => getReq.onsuccess?.());
                    return getReq;
                  },
                };
              },
            };
          },
        };
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };

  try {
    const sales = await getOfflineSales(9);
    assert.deepEqual(openCalls, [5, undefined]);
    assert.equal(sales.length, 1);
    assert.equal(sales[0].clientTxId, 'OFFLINE-T9-1');
  } finally {
    if (prevIndexedDB === undefined) {
      delete (globalThis as any).indexedDB;
    } else {
      (globalThis as any).indexedDB = prevIndexedDB;
    }
    if (prevLocal === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = prevLocal;
    }
  }
});

test('buildCheckoutRequestPayload preserves wholesale, split payment, customer balance, and exchange fields', () => {
  const sale: QueuedSale = {
    clientTxId: 'OFFLINE-WH-1',
    createdAt: '2026-11-25T08:00:00.000Z',
    saleType: 'WHOLESALE',
    totalCartons: 2,
    items: [
      {
        productId: 42,
        article: 'WS-42',
        name: 'Leather Boot',
        quantity: 24,
        unitPrice: 1200,
        discount: 200,
        packingType: 'CARTON',
        cartonQuantity: 2,
        pairsPerCarton: 12,
      },
    ],
    customerId: 77,
    paymentMethod: 'SPLIT',
    splitCashAmount: 15000,
    splitOnlineAmount: 10000,
    splitDigitalType: 'JAZZCASH',
    transactionId: 'JC-9911',
    previousBalance: 5000,
    paidAmount: 25000,
    amountReceived: 25000,
    remainingBalance: 8600,
    cashReceived: 15000,
    changeGiven: 0,
    totalAmount: 28600,
    notes: 'Wholesale dispatch',
    status: 'PENDING',
    exchange: {
      originalSaleId: 501,
      originalInvoiceNumber: 'INV-501',
      originalSaleDate: '2026-11-20',
      customerId: 77,
      mode: 'EXCHANGE_EXACT',
      reason: 'Size swap',
      isExchange: true,
      items: [
        {
          saleItemId: 9001,
          productId: 11,
          productName: 'Canvas Low',
          quantity: 1,
          unitRefundPrice: 1800,
        },
      ],
    },
  };

  const payload = buildCheckoutRequestPayload(sale);
  assert.equal(payload.saleType, 'WHOLESALE');
  assert.equal(payload.totalCartons, 2);
  assert.equal(payload.items[0].packingType, 'CARTON');
  assert.equal(payload.items[0].cartonQuantity, 2);
  assert.equal(payload.items[0].pairsPerCarton, 12);
  assert.equal(payload.paymentMethod, 'SPLIT');
  assert.equal(payload.splitCashAmount, 15000);
  assert.equal(payload.splitOnlineAmount, 10000);
  assert.equal(payload.splitDigitalType, 'JAZZCASH');
  assert.equal(payload.previousBalance, 5000);
  assert.equal(payload.paidAmount, 25000);
  assert.equal(payload.amountReceived, 25000);
  assert.equal(payload.remainingBalance, 8600);
  assert.equal(payload.exchange.originalSaleId, 501);
  assert.equal(payload.exchange.items[0].saleItemId, 9001);
});

test('processOfflineSalesQueue interleaves sales and returns chronologically and resolves originalClientTxId dependencies', async () => {
  const salesQueue: QueuedSale[] = [
    {
      clientTxId: 'OFFLINE-SALE-1',
      createdAt: '2026-11-25T09:00:00.000Z',
      items: [{ productId: 101, article: 'SH-101', name: 'Sneaker', quantity: 2, unitPrice: 3000, discount: 0 }],
      customerId: 5,
      paymentMethod: 'CASH',
      cashReceived: 6000,
      changeGiven: 0,
      totalAmount: 6000,
      notes: '',
      status: 'PENDING',
    },
    {
      clientTxId: 'OFFLINE-EXCH-3',
      createdAt: '2026-11-25T09:10:00.000Z',
      items: [{ productId: 202, article: 'SH-202', name: 'Oxford', quantity: 1, unitPrice: 4000, discount: 0 }],
      customerId: 5,
      paymentMethod: 'CASH',
      cashReceived: 1000,
      changeGiven: 0,
      totalAmount: 1000,
      notes: 'Exchange',
      status: 'PENDING',
      exchange: {
        originalClientTxId: 'OFFLINE-SALE-1',
        originalInvoiceNumber: 'OFFLINE-SALE-1',
        mode: 'EXCHANGE_EXACT',
        reason: 'Color change',
        isExchange: true,
        items: [
          {
            saleItemId: -999,
            productId: 101,
            productName: 'Sneaker',
            quantity: 1,
            unitRefundPrice: 3000,
          },
        ],
      },
    },
  ];

  const returnsQueue: QueuedReturn[] = [
    {
      clientReturnId: 'OFFLINE-RET-2',
      createdAt: '2026-11-25T09:05:00.000Z',
      originalClientTxId: 'OFFLINE-SALE-1',
      originalInvoiceNumber: 'OFFLINE-SALE-1',
      customerId: 5,
      paymentMethod: 'CASH',
      reason: 'Wrong size',
      totalRefundAmount: 3000,
      status: 'PENDING',
      items: [
        {
          saleItemId: -999,
          productId: 101,
          quantity: 1,
          unitRefundPrice: 3000,
        },
      ],
    },
  ];

  const executionOrder: Array<{ kind: string; payload: any }> = [];

  const storage: OfflineSyncStorageAdapter = {
    async getSales() {
      return salesQueue;
    },
    async updateSaleStatus(clientTxId, status, extra) {
      const s = salesQueue.find((x) => x.clientTxId === clientTxId);
      if (s) {
        s.status = status;
        if (extra) Object.assign(s, extra);
      }
    },
    async getReturns() {
      return returnsQueue;
    },
    async updateReturnStatus(clientReturnId, status, extra) {
      const r = returnsQueue.find((x) => x.clientReturnId === clientReturnId);
      if (r) {
        r.status = status;
        if (extra) Object.assign(r, extra);
      }
    },
  };

  const result = await processOfflineSalesQueue(storage, {
    async submitCheckout(payload) {
      executionOrder.push({ kind: 'SALE', payload });
      if (payload.clientTxId === 'OFFLINE-SALE-1') {
        return {
          sale: {
            id: 8801,
            invoiceNumber: 'INV-8801',
            items: [{ id: 55001, productId: 101, quantity: 2 }],
          },
        };
      }
      return {
        sale: {
          id: 8803,
          invoiceNumber: 'INV-8803',
          items: [{ id: 55003, productId: 202, quantity: 1 }],
        },
      };
    },
    async submitReturn(payload) {
      executionOrder.push({ kind: 'RETURN', payload });
      return { returnNumber: 'RET-401', returnId: 401, totalRefundAmount: 3000 };
    },
  });

  assert.equal(result.synced, 3);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    executionOrder.map((e) => e.kind),
    ['SALE', 'RETURN', 'SALE']
  );

  // Return queued offline against OFFLINE-SALE-1 received real server IDs
  assert.equal(executionOrder[1].payload.originalSaleId, 8801);
  assert.equal(executionOrder[1].payload.items[0].saleItemId, 55001);

  // Downstream exchange queued offline against OFFLINE-SALE-1 also received real server IDs
  assert.equal(executionOrder[2].payload.exchange.originalSaleId, 8801);
  assert.equal(executionOrder[2].payload.exchange.originalInvoiceNumber, 'INV-8801');
  assert.equal(executionOrder[2].payload.exchange.items[0].saleItemId, 55001);
});

test('verifyInvoiceOffline resolves cached server sales minus pending offline returns and resolves OFFLINE-* invoices', async () => {
  const prevLocal = (globalThis as any).localStorage;
  const mockStorage = createMockStorage();
  const token = makeFakeJwt({ id: 1, tenantId: 12, role: 'CASHIER', exp: Math.floor(Date.now() / 1000) + 3600 });
  mockStorage.setItem('pos_auth_token', token);
  mockStorage.setItem('pos_current_user', JSON.stringify({ id: 1, tenantId: 12, role: 'CASHIER' }));
  (globalThis as any).localStorage = mockStorage;

  try {
    await cacheSalesHistoryOffline(
      [
        {
          id: 700,
          invoiceNumber: 'INV-700',
          saleDate: '2026-11-24',
          totalAmount: 9000,
          customerName: 'Ali',
          cachedAt: '2026-11-25T07:00:00.000Z',
          items: [
            {
              id: 7001,
              productId: 50,
              article: 'SN-50',
              productName: 'Classic Runner',
              quantity: 3,
              alreadyReturnedQuantity: 0,
              unitPrice: 3000,
              discount: 0,
              subtotal: 9000,
            },
          ],
        },
      ],
      12
    );

    await queueOfflineReturn(
      {
        clientReturnId: 'RET-OFF-1',
        tenantId: 12,
        createdAt: '2026-11-25T08:00:00.000Z',
        originalSaleId: 700,
        originalInvoiceNumber: 'INV-700',
        customerId: null,
        paymentMethod: 'CASH',
        reason: 'Size mismatch',
        totalRefundAmount: 3000,
        status: 'PENDING',
        items: [{ saleItemId: 7001, productId: 50, quantity: 1, unitRefundPrice: 3000 }],
      },
      12
    );

    const verifiedCached = await verifyInvoiceOffline('INV-700', 12);
    assert.ok(verifiedCached);
    assert.equal(verifiedCached.offline, true);
    assert.equal(verifiedCached.items[0].returnableQuantity, 2);

    await queueOfflineSale(
      {
        clientTxId: 'OFFLINE-T12-555',
        tenantId: 12,
        createdAt: '2026-11-25T08:30:00.000Z',
        items: [{ productId: 51, article: 'BT-51', name: 'Boot', quantity: 2, unitPrice: 4500, discount: 0 }],
        customerId: null,
        customerName: 'Bilal',
        paymentMethod: 'CASH',
        cashReceived: 9000,
        changeGiven: 0,
        totalAmount: 9000,
        notes: '',
        status: 'PENDING',
      },
      12
    );

    const verifiedOffline = await verifyInvoiceOffline('OFFLINE-T12-555', 12);
    assert.ok(verifiedOffline);
    assert.equal(verifiedOffline.sale.originalClientTxId, 'OFFLINE-T12-555');
    assert.equal(verifiedOffline.sale.isOfflineSale, true);
    assert.equal(verifiedOffline.items[0].returnableQuantity, 2);
  } finally {
    if (prevLocal === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = prevLocal;
    }
  }
});
