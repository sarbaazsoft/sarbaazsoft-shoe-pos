import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  apiFetch,
  clearAllSessionState,
  isAbortError,
  setActiveTenantId,
  setAuthSession,
  subscribeApiMutation,
} from '../src/services/api.ts';
import { resolveMutationSyncPlan } from '../src/hooks/useLiveData.ts';
import { clearDataSyncListeners } from '../src/utils/dataSyncBus.ts';

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

test('zero TanStack Query or API/app caching systems remain in codebase', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['@tanstack/react-query'], undefined);
  assert.equal(pkg.devDependencies?.['@tanstack/react-query'], undefined);

  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/services/queryClient.ts')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/utils/cachePolicy.ts')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/hooks/useAppQueries.ts')), false);

  const appSettingsSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/server/services/appSettingsService.ts'),
    'utf8'
  );
  assert.equal(/\bsettingsCache\b/.test(appSettingsSrc), false);
  assert.equal(/\bloadAppSettingsCache\b/.test(appSettingsSrc), false);
  assert.equal(/\bgetCachedAppSetting\b/.test(appSettingsSrc), false);
});

test('resolveMutationSyncPlan maps endpoints to live-refresh topics accurately', () => {
  const customerPlan = resolveMutationSyncPlan('/customers');
  assert.ok(customerPlan.topics.includes('customers'));
  assert.equal(customerPlan.refreshSuperAdmin, false);

  const superPlan = resolveMutationSyncPlan('/superadmin/tenants/9/status');
  assert.equal(superPlan.refreshSuperAdmin, true);
  assert.equal(superPlan.refreshSaas, true);
  assert.deepEqual(superPlan.topics, []);

  const settingsPlan = resolveMutationSyncPlan('/settings');
  assert.ok(settingsPlan.topics.includes('settings'));
  assert.equal(settingsPlan.refreshSaas, true);

  const salePlan = resolveMutationSyncPlan('/pos/checkout');
  assert.ok(salePlan.topics.includes('sales'));
  assert.ok(salePlan.topics.includes('inventory'));
  assert.ok(salePlan.topics.includes('notifications'));
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

test('apiFetch: enforces cache no-store on requests and retries only idempotent GET on 502', async () => {
  await withMockBrowserEnv(async () => {
    let getCalls = 0;
    let postCalls = 0;
    const seenCacheModes: Array<RequestCache | undefined> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenCacheModes.push(init?.cache);
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
    assert.ok(seenCacheModes.every((m) => m === 'no-store'));

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

test('apiFetch: notifies mutation listeners on mutating endpoints and skips /chat', async () => {
  await withMockBrowserEnv(async () => {
    clearDataSyncListeners();
    const mutations: Array<{ endpoint: string; method: string }> = [];
    const unsubscribe = subscribeApiMutation((endpoint, method) => {
      mutations.push({ endpoint, method });
    });

    try {
      const adminToken = makeFakeJwt({
        id: 5,
        tenantId: 9,
        role: 'ADMIN',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      setAuthSession(adminToken, { id: 5, tenantId: 9, role: 'ADMIN' });
      setActiveTenantId(9);

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ success: true, customer: { id: 2, name: 'Ali' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch;

      await apiFetch('/customers', { method: 'POST', body: { name: 'Ali' } });
      await apiFetch('/chat', { method: 'POST', body: { message: 'hello' } });

      assert.equal(mutations.length, 1);
      assert.equal(mutations[0].endpoint, '/customers');
      assert.equal(mutations[0].method, 'POST');

      clearAllSessionState();
    } finally {
      unsubscribe();
      clearDataSyncListeners();
    }
  });
});
