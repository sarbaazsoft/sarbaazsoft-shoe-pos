import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  isBinaryInstallerAsset,
  isContentHashedAsset,
  isServiceWorkerScript,
  resolveApiCacheHeaders,
  resolveServiceWorkerFilePath,
  resolveStaticCacheHeaders,
} from '../src/server/utils/staticCacheHeaders.ts';

test('staticCacheHeaders assigns proper Cache-Control policies per asset class', () => {
  // 1. Service Workers must never be HTTP-cached
  for (const swPath of ['/sw.js', '/firebase-messaging-sw.js', '/sw-background-sync.js']) {
    assert.equal(isServiceWorkerScript(swPath), true);
    assert.equal(isContentHashedAsset(swPath), false);
    const headers = resolveStaticCacheHeaders(swPath);
    assert.equal(headers['Cache-Control'], 'no-cache, no-store, must-revalidate');
    assert.equal(headers['Service-Worker-Allowed'], '/');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  }

  // 2. HTML entry points must always revalidate
  const htmlHeaders = resolveStaticCacheHeaders('/dist/index.html');
  assert.equal(htmlHeaders['Cache-Control'], 'no-cache, no-store, must-revalidate');
  assert.equal(htmlHeaders['Pragma'], 'no-cache');

  // 3. Manifests must revalidate
  const manifestHeaders = resolveStaticCacheHeaders('/manifest.webmanifest');
  assert.equal(manifestHeaders['Content-Type'], 'application/manifest+json; charset=utf-8');
  assert.equal(manifestHeaders['Cache-Control'], 'no-cache, must-revalidate');

  // 4. Content-hashed JS, CSS, fonts, and media are immutable for 1 year
  const hashedPaths = [
    '/assets/js/index-Ab12Cd34.js',
    '/assets/js/vendor-react-XyZ98765.js',
    '/assets/css/index-Ef56Gh78.css',
    '/assets/fonts/inter-latin-QwErTy12.woff2',
    '/assets/media/shoe_store_blurred_bg-MnOpQr34.jpg',
    '/assets/custom-chunk-1234abcd.mjs',
  ];
  for (const p of hashedPaths) {
    assert.equal(isContentHashedAsset(p), true, `Expected content-hashed: ${p}`);
    const headers = resolveStaticCacheHeaders(p);
    assert.equal(headers['Cache-Control'], 'public, max-age=31536000, immutable');
  }

  // 5. Unhashed mutable public static assets get bounded SWR caching
  for (const mutable of ['/pwa-192x192.png', '/favicon.ico', '/icons/badge-favicon.png', '/admin/pwa-512x512.png']) {
    assert.equal(isContentHashedAsset(mutable), false, `Did not expect content-hashed: ${mutable}`);
    const headers = resolveStaticCacheHeaders(mutable);
    assert.equal(headers['Cache-Control'], 'public, max-age=3600, stale-while-revalidate=86400');
  }

  // 6. Binary installers are never immutable
  for (const bin of ['/assets/SarbaazSoft-POS.apk', '/assets/SarbaazSoft-POS-Desktop-Setup.exe']) {
    assert.equal(isBinaryInstallerAsset(bin), true);
    assert.equal(isContentHashedAsset(bin), false);
    const headers = resolveStaticCacheHeaders(bin);
    assert.equal(headers['Cache-Control'], 'no-cache, must-revalidate');
  }
  // 7. Development static headers never HTTP-cache assets; API headers switch cleanly by env
  const devStatic = resolveStaticCacheHeaders('/src/App.tsx', false);
  assert.equal(devStatic['Cache-Control'], 'no-cache, no-store, must-revalidate');
  const devIcon = resolveStaticCacheHeaders('/pwa-192x192.png', false);
  assert.equal(devIcon['Cache-Control'], 'no-cache, no-store, must-revalidate');

  const devApi = resolveApiCacheHeaders('/products', false);
  assert.equal(devApi['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(devApi['Pragma'], 'no-cache');

  const prodApi = resolveApiCacheHeaders('/products', true);
  assert.equal(prodApi['Cache-Control'], 'private, no-cache, must-revalidate');
  assert.equal(prodApi['Vary'], 'X-Tenant-Id, X-Auth-Token, Authorization');

  const sseHeaders = resolveApiCacheHeaders('/notifications/stream', true);
  assert.equal(sseHeaders['Cache-Control'], 'no-cache, no-transform');
});

test('resolveServiceWorkerFilePath prefers dist/ in production and public/ in development', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sw-path-'));
  try {
    const distDir = path.join(tmpRoot, 'dist');
    const pubDir = path.join(tmpRoot, 'public');
    fs.mkdirSync(distDir, { recursive: true });
    fs.mkdirSync(pubDir, { recursive: true });

    const distSw = path.join(distDir, 'sw.js');
    const pubSw = path.join(pubDir, 'sw.js');
    fs.writeFileSync(distSw, '// dist build');
    fs.writeFileSync(pubSw, '// public dev');

    assert.equal(resolveServiceWorkerFilePath(tmpRoot, 'sw.js', true), distSw);
    assert.equal(resolveServiceWorkerFilePath(tmpRoot, 'sw.js', false), pubSw);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

function createMockSwHarness(options?: {
  mode?: 'development' | 'production';
  hasActiveRegistration?: boolean;
  initialCaches?: Record<string, Record<string, { status: number; body: string; contentType: string }>>;
  fetchImpl?: (input: any, init?: any) => Promise<any>;
}) {
  let swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  if ((options?.mode || 'production') === 'production') {
    swCode = swCode.replace(/const SW_ENV = ['"][^'"]*['"];/, "const SW_ENV = 'production';");
  }
  const listeners = new Map<string, (event: any) => void>();
  let skipWaitingCalls = 0;
  let clientsClaimCalls = 0;

  const store = new Map<string, Map<string, any>>();
  if (options?.initialCaches) {
    for (const [cacheName, entries] of Object.entries(options.initialCaches)) {
      const m = new Map<string, any>();
      for (const [url, spec] of Object.entries(entries)) {
        m.set(url, {
          ok: spec.status >= 200 && spec.status < 300,
          status: spec.status,
          type: 'basic',
          headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? spec.contentType : null) },
          body: spec.body,
          clone() {
            return this;
          },
        });
      }
      store.set(cacheName, m);
    }
  }

  const normalizeKey = (reqOrUrl: any) => {
    const raw = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
    return new URL(raw, 'https://pos.example.com').href;
  };

  const makeCacheWrapper = (cacheName: string) => {
    if (!store.has(cacheName)) store.set(cacheName, new Map());
    const map = store.get(cacheName)!;
    return {
      match: async (reqOrUrl: any) => map.get(normalizeKey(reqOrUrl)) || undefined,
      put: async (reqOrUrl: any, res: any) => {
        map.set(normalizeKey(reqOrUrl), res);
      },
      add: async (url: string) => {
        const res = await sandbox.fetch(url);
        if (res && res.ok) map.set(normalizeKey(url), res);
      },
      keys: async () => Array.from(map.keys()).map((url) => ({ url })),
      delete: async (reqOrUrl: any) => map.delete(normalizeKey(reqOrUrl)),
    };
  };

  const cachesMock = {
    open: async (name: string) => makeCacheWrapper(name),
    keys: async () => Array.from(store.keys()),
    delete: async (name: string) => store.delete(name),
    match: async (reqOrUrl: any) => {
      const key = normalizeKey(reqOrUrl);
      for (const map of store.values()) {
        if (map.has(key)) return map.get(key);
      }
      return undefined;
    },
  };

  const fetchedUrls: string[] = [];
  const defaultFetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    fetchedUrls.push(url);
    return {
      ok: true,
      status: 200,
      type: 'basic',
      headers: { get: () => 'application/octet-stream' },
      clone() {
        return this;
      },
    };
  };

  const sandbox: Record<string, any> = {
    URL,
    Promise,
    Response: Object.assign(
      function MockResponse(body: any, init: any) {
        return {
          ok: true,
          status: 200,
          type: 'basic',
          body,
          headers: { get: (k: string) => init?.headers?.[k] || null },
          clone() {
            return this;
          },
        };
      },
      {
        error: () => ({ ok: false, status: 0, type: 'error' }),
      }
    ),
    fetch: async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      fetchedUrls.push(url);
      if (options?.fetchImpl) return options.fetchImpl(input, init);
      return defaultFetch(input);
    },
    importScripts: () => {},
    caches: cachesMock,
  };

  sandbox.self = {
    location: { origin: 'https://pos.example.com' },
    skipWaiting: () => {
      skipWaitingCalls++;
    },
    clients: {
      claim: async () => {
        clientsClaimCalls++;
      },
      matchAll: async () => [],
    },
    registration: {
      active: options?.hasActiveRegistration ? {} : null,
      showNotification: async () => {},
    },
    addEventListener: (name: string, fn: (event: any) => void) => {
      listeners.set(name, fn);
    },
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });

  return {
    listeners,
    store,
    fetchedUrls,
    getSkipWaitingCalls: () => skipWaitingCalls,
    getClientsClaimCalls: () => clientsClaimCalls,
  };
}

test('public/sw.js defers skipWaiting when an active worker exists and cleans outdated caches on activate', async () => {
  // 1. Clean first-time install -> auto skipWaiting
  const firstInstall = createMockSwHarness({ hasActiveRegistration: false });
  let waitP = Promise.resolve();
  firstInstall.listeners.get('install')!({ waitUntil: (p: Promise<any>) => (waitP = p) });
  await waitP;
  assert.equal(firstInstall.getSkipWaitingCalls(), 1);

  // 2. Upgrade while active worker exists -> wait for explicit SKIP_WAITING message
  const upgrade = createMockSwHarness({
    hasActiveRegistration: true,
    initialCaches: {
      'sarbaazsoft-pos-cache-v10': {
        'https://pos.example.com/old.js': { status: 200, body: 'old', contentType: 'application/javascript' },
      },
      'sarbaazsoft-pos-precache-1.0.0-old': {
        'https://pos.example.com/': { status: 200, body: 'html', contentType: 'text/html' },
      },
      'sarbaazsoft-pos-immutable-v1': {
        'https://pos.example.com/assets/js/vendor-react-12345678.js': {
          status: 200,
          body: 'react',
          contentType: 'application/javascript',
        },
      },
    },
  });

  upgrade.listeners.get('install')!({ waitUntil: (p: Promise<any>) => (waitP = p) });
  await waitP;
  assert.equal(upgrade.getSkipWaitingCalls(), 0, 'Must not auto-skipWaiting when active worker serves session');

  upgrade.listeners.get('message')!({ data: { type: 'SKIP_WAITING' } });
  assert.equal(upgrade.getSkipWaitingCalls(), 1, 'SKIP_WAITING message must trigger skipWaiting');

  upgrade.listeners.get('activate')!({ waitUntil: (p: Promise<any>) => (waitP = p) });
  await waitP;
  assert.equal(upgrade.getClientsClaimCalls(), 1);
  assert.equal(upgrade.store.has('sarbaazsoft-pos-cache-v10'), false, 'Legacy cache-v10 must be deleted');
  assert.equal(upgrade.store.has('sarbaazsoft-pos-precache-1.0.0-old'), false, 'Old precache must be deleted');
  assert.equal(upgrade.store.has('sarbaazsoft-pos-immutable-v1'), true, 'Immutable asset cache must survive activate');
});

test('public/sw.js enforces Cache-First for hashed assets, SWR for icons, and blocks HTML MIME-poisoning', async () => {
  const harness = createMockSwHarness({
    initialCaches: {
      'sarbaazsoft-pos-immutable-v1': {
        'https://pos.example.com/assets/js/vendor-react-Ab12Cd34.js': {
          status: 200,
          body: 'cached-react',
          contentType: 'application/javascript',
        },
      },
      'sarbaazsoft-pos-runtime-dev': {
        'https://pos.example.com/pwa-192x192.png': {
          status: 200,
          body: 'old-png',
          contentType: 'image/png',
        },
      },
    },
    fetchImpl: async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/assets/js/missing-12345678.js')) {
        // Simulate broken proxy returning 200 text/html SPA fallback
        return {
          ok: true,
          status: 200,
          type: 'basic',
          headers: { get: () => 'text/html; charset=utf-8' },
          body: '<html>fallback</html>',
          clone() {
            return this;
          },
        };
      }
      if (url.endsWith('/pwa-192x192.png')) {
        return {
          ok: true,
          status: 200,
          type: 'basic',
          headers: { get: () => 'image/png' },
          body: 'fresh-png',
          clone() {
            return this;
          },
        };
      }
      return {
        ok: true,
        status: 200,
        type: 'basic',
        headers: { get: () => 'application/javascript' },
        body: 'network-js',
        clone() {
          return this;
        },
      };
    },
  });

  const fetchHandler = harness.listeners.get('fetch')!;

  // 1. Hashed JS cache hit: must serve from cache without hitting network
  let responded: Promise<any> | null = null;
  fetchHandler({
    request: { method: 'GET', url: 'https://pos.example.com/assets/js/vendor-react-Ab12Cd34.js', destination: 'script' },
    respondWith: (p: Promise<any>) => (responded = p),
  });
  const cachedRes = await responded!;
  assert.equal(cachedRes.body, 'cached-react');
  assert.equal(
    harness.fetchedUrls.some((u) => u.includes('vendor-react-Ab12Cd34.js')),
    false,
    'Immutable cache hit should not trigger network request'
  );

  // 2. HTML fallback returned for .js must NOT be cached into immutable store
  responded = null;
  fetchHandler({
    request: { method: 'GET', url: 'https://pos.example.com/assets/js/missing-12345678.js', destination: 'script' },
    respondWith: (p: Promise<any>) => (responded = p),
  });
  await responded!;
  assert.equal(
    harness.store.get('sarbaazsoft-pos-immutable-v1')?.has('https://pos.example.com/assets/js/missing-12345678.js'),
    false,
    'HTML MIME-poisoned response must not be stored in immutable cache'
  );

  // 3. Mutable public icon returns stale cache immediately while revalidating
  responded = null;
  fetchHandler({
    request: { method: 'GET', url: 'https://pos.example.com/pwa-192x192.png', destination: 'image' },
    respondWith: (p: Promise<any>) => (responded = p),
  });
  const iconRes = await responded!;
  assert.equal(iconRes.body, 'old-png');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    harness.store.get('sarbaazsoft-pos-runtime-dev')?.get('https://pos.example.com/pwa-192x192.png')?.body,
    'fresh-png',
    'SWR background fetch must refresh runtime cache'
  );

  // 4. API and binary installer requests are bypassed cleanly (respondWith not called)
  let apiIntercepted = false;
  fetchHandler({
    request: { method: 'GET', url: 'https://pos.example.com/api/products' },
    respondWith: () => {
      apiIntercepted = true;
    },
  });
  assert.equal(apiIntercepted, false);

  let apkIntercepted = false;
  fetchHandler({
    request: { method: 'GET', url: 'https://pos.example.com/assets/SarbaazSoft-POS.apk' },
    respondWith: () => {
      apkIntercepted = true;
    },
  });
  assert.equal(apkIntercepted, false);
});

test('public/sw.js defaults to development mode: purges caches and uses no-store network-only fetch', async () => {
  const seenFetchInits: Array<{ url: string; cache?: string }> = [];
  const devHarness = createMockSwHarness({
    mode: 'development',
    hasActiveRegistration: true,
    initialCaches: {
      'sarbaazsoft-pos-precache-1.2.4-abc': {
        'https://pos.example.com/': { status: 200, body: 'old-prod', contentType: 'text/html' },
      },
      'sarbaazsoft-pos-immutable-v1': {
        'https://pos.example.com/assets/js/index-12345678.js': {
          status: 200,
          body: 'old-prod-js',
          contentType: 'application/javascript',
        },
      },
    },
    fetchImpl: async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      seenFetchInits.push({ url, cache: init?.cache });
      return {
        ok: true,
        status: 200,
        type: 'basic',
        headers: { get: () => 'application/javascript' },
        body: 'fresh-dev-module',
        clone() {
          return this;
        },
      };
    },
  });

  // 1. Development install immediately calls skipWaiting even if active worker exists
  devHarness.listeners.get('install')!({ waitUntil: () => {} });
  assert.equal(devHarness.getSkipWaitingCalls(), 1);

  // 2. Development activate purges ALL sarbaazsoft-pos-* caches so prod artifacts never linger in dev
  let actWait = Promise.resolve();
  devHarness.listeners.get('activate')!({ waitUntil: (p: Promise<any>) => (actWait = p) });
  await actWait;
  assert.equal(devHarness.store.size, 0, 'Dev SW activate must purge all sarbaazsoft-pos caches');

  // 3. Development fetch always goes straight to network with cache: no-store and writes nothing to Cache Storage
  let responded: Promise<any> | null = null;
  devHarness.listeners.get('fetch')!({
    request: { method: 'GET', url: 'https://pos.example.com/src/App.tsx', destination: 'script' },
    respondWith: (p: Promise<any>) => (responded = p),
  });
  const devRes = await responded!;
  assert.equal(devRes.body, 'fresh-dev-module');
  assert.equal(seenFetchInits[0]?.cache, 'no-store');
  assert.equal(devHarness.store.size, 0, 'Dev SW must never write dev modules to Cache Storage');
});
