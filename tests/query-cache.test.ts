import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apiFetch,
  clearAllSessionState,
  isAbortError,
  setActiveTenantId,
  setAuthSession,
} from '../src/services/api.ts';
import {
  queryClient,
  queryKeys,
  registerQueryCacheLifecycle,
  resolveInvalidationKeysForTopics,
} from '../src/services/queryClient.ts';
import { clearDataSyncListeners, emitDataSync } from '../src/utils/dataSyncBus.ts';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
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

function withMockBrowserEnv(fn: () => Promise<void> | void): Promise<void> {
  const prevLocal = (globalThis as any).localStorage;
  const prevSession = (globalThis as any).sessionStorage;
  const prevFetch = globalThis.fetch;

  (globalThis as any).localStorage = createMockStorage();
  (globalThis as any).sessionStorage = createMockStorage();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      (globalThis as any).localStorage = prevLocal;
      (globalThis as any).sessionStorage = prevSession;
      globalThis.fetch = prevFetch;
    });
}

test('queryKeys: enforces strict tenant scoping and deterministic param normalization', () => {
  const k1 = queryKeys.products.list({ search: 'nike', category: 'Sneakers', brand: undefined }, 101);
  const k2 = queryKeys.products.list({ category: 'Sneakers', search: 'nike', brand: '' }, 101);
  const kOtherTenant = queryKeys.products.list({ search: 'nike', category: 'Sneakers' }, 202);
  const kPublic = queryKeys.products.list({ search: 'nike' }, null);

  assert.deepEqual(k1, k2);
  assert.equal(k1[1], '101');
  assert.equal(kOtherTenant[1], '202');
  assert.equal(kPublic[1], 'public');
  assert.notDeepEqual(k1, kOtherTenant);
});

test('resolveInvalidationKeysForTopics: deduplicates and maps sync topics to tenant prefixes', () => {
  const keys = resolveInvalidationKeysForTopics(['sales', 'inventory', 'sales'], 7);
  const serialized = keys.map((k) => JSON.stringify(k));

  // Should contain no duplicates
  assert.equal(new Set(serialized).size, serialized.length);

  // Should include tenant-scoped sales, reports, customers, inventory, products, notifications
  assert.ok(serialized.includes(JSON.stringify(['tenant', '7', 'sales'])));
  assert.ok(serialized.includes(JSON.stringify(['tenant', '7', 'reports'])));
  assert.ok(serialized.includes(JSON.stringify(['tenant', '7', 'customers'])));
  assert.ok(serialized.includes(JSON.stringify(['tenant', '7', 'inventory'])));
  assert.ok(serialized.includes(JSON.stringify(['tenant', '7', 'products'])));
  assert.ok(serialized.includes(JSON.stringify(['tenant', '7', 'notifications'])));
});

test('registerQueryCacheLifecycle: evicts tenant queries on tenant switch, resets all on session clear, and invalidates on dataSyncBus', async () => {
  await withMockBrowserEnv(async () => {
    clearDataSyncListeners();
    queryClient.clear();
    const unregister = registerQueryCacheLifecycle();

    try {
      const superAdminToken = makeFakeJwt({
        id: 1,
        role: 'SUPERADMIN',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      setAuthSession(superAdminToken, { id: 1, role: 'SUPERADMIN' });
      setActiveTenantId(11);

      // Seed tenant-scoped queries and a global saas directory query
      queryClient.setQueryData(queryKeys.products.list(undefined, 11), { products: [{ id: 1 }] });
      queryClient.setQueryData(queryKeys.customers.list(undefined, 11), { customers: [{ id: 2 }] });
      queryClient.setQueryData(queryKeys.saas.resolve(''), { tenants: [{ id: 11 }] });

      // Emit dataSyncBus event for sales -> should invalidate tenant 11 sales/products/customers caches
      emitDataSync(['sales'], { source: 'test' });
      await Promise.resolve();
      const prodState = queryClient.getQueryState(queryKeys.products.list(undefined, 11));
      assert.equal(prodState?.isInvalidated, true);

      // Switching active tenant to 22 must evict tenant caches while preserving saas directory cache
      setActiveTenantId(22);
      assert.equal(queryClient.getQueryData(queryKeys.products.list(undefined, 11)), undefined);
      assert.equal(queryClient.getQueryData(queryKeys.customers.list(undefined, 11)), undefined);
      assert.deepEqual(queryClient.getQueryData(queryKeys.saas.resolve('')), { tenants: [{ id: 11 }] });

      // Repopulate tenant 22 data, then clearAllSessionState -> resets entire query cache
      queryClient.setQueryData(queryKeys.products.list(undefined, 22), { products: [{ id: 9 }] });
      clearAllSessionState();
      assert.equal(queryClient.getQueryData(queryKeys.products.list(undefined, 22)), undefined);
      assert.equal(queryClient.getQueryData(queryKeys.saas.resolve('')), undefined);
    } finally {
      unregister();
      queryClient.clear();
      clearDataSyncListeners();
    }
  });
});

test('apiFetch: aborts immediately on pre-aborted AbortSignal without invoking fetch', async () => {
  await withMockBrowserEnv(async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => apiFetch('/products', { signal: controller.signal }),
      (err: unknown) => isAbortError(err)
    );
    assert.equal(calls, 0);
  });
});

test('apiFetch: retries idempotent GET on 502 but makes only 1 attempt for non-idempotent POST on 502', async () => {
  await withMockBrowserEnv(async () => {
    let getCalls = 0;
    let postCalls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        getCalls += 1;
        if (getCalls === 1) {
          return new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } });
        }
        return new Response(JSON.stringify({ items: [1, 2] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      postCalls += 1;
      return new Response(JSON.stringify({ error: 'Upstream timeout' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    // Idempotent GET retries after 502 and succeeds on attempt 2
    const getResult = await apiFetch<{ items: number[] }>('/products');
    assert.deepEqual(getResult.items, [1, 2]);
    assert.equal(getCalls, 2);

    // Non-idempotent POST must NOT retry on 502 (prevents duplicate sales/ledger writes)
    await assert.rejects(() => apiFetch('/pos/checkout', { method: 'POST', body: { total: 500 } }));
    assert.equal(postCalls, 1);
  });
});

test('apiFetch: triggers single GET RPC bridge fallback for mutations only on non-JSON 403/405 proxy block', async () => {
  await withMockBrowserEnv(async () => {
    const requestedUrls: string[] = [];
    const requestedMethods: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();
      requestedUrls.push(url);
      requestedMethods.push(method);

      if (method === 'POST') {
        return new Response('<html>405 Not Allowed</html>', {
          status: 405,
          headers: { 'content-type': 'text/html' },
        });
      }

      return new Response(JSON.stringify({ success: true, id: 77 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const res = await apiFetch('/customers', { method: 'POST', body: { name: 'Walk-in' } });
    assert.equal(res.success, true);
    assert.equal(res.id, 77);
    assert.deepEqual(requestedMethods, ['POST', 'GET']);
    assert.ok(requestedUrls[1].includes('__method=POST'));
  });
});
