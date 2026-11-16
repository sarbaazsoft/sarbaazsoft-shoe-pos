import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  IS_HTTP_CACHING_PAUSED,
  isBinaryInstallerAsset,
  isContentHashedAsset,
  isServiceWorkerScript,
  resolveApiCacheHeaders,
  resolveServiceWorkerFilePath,
  resolveStaticCacheHeaders,
} from '../src/server/utils/staticCacheHeaders.ts';

test('staticCacheHeaders pauses HTTP caching for APIs and static assets while preserving content headers', () => {
  assert.equal(IS_HTTP_CACHING_PAUSED, true);

  // 1. Service Workers must never be HTTP-cached
  for (const swPath of ['/sw.js', '/firebase-messaging-sw.js', '/sw-background-sync.js']) {
    assert.equal(isServiceWorkerScript(swPath), true);
    assert.equal(isContentHashedAsset(swPath), false);
    const headers = resolveStaticCacheHeaders(swPath);
    assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
    assert.equal(headers['Surrogate-Control'], 'no-store');
    assert.equal(headers['Service-Worker-Allowed'], '/');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  }

  // 2. HTML entry points, manifests, hashed assets, mutable assets, and installers all enforce no-store when paused
  const htmlHeaders = resolveStaticCacheHeaders('/dist/index.html');
  assert.equal(htmlHeaders['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(htmlHeaders['Pragma'], 'no-cache');

  const manifestHeaders = resolveStaticCacheHeaders('/manifest.webmanifest');
  assert.equal(manifestHeaders['Content-Type'], 'application/manifest+json; charset=utf-8');
  assert.equal(manifestHeaders['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');

  const hashedPaths = [
    '/assets/js/index-Ab12Cd34.js',
    '/assets/js/vendor-react-XyZ98765.js',
    '/assets/css/index-Ef56Gh78.css',
    '/assets/fonts/inter-latin-QwErTy12.woff2',
    '/assets/media/shoe_store_blurred_bg-MnOpQr34.jpg',
    '/assets/custom-chunk-1234abcd.mjs',
  ];
  for (const p of hashedPaths) {
    assert.equal(isContentHashedAsset(p), true, `Expected content-hashed classifier: ${p}`);
    const headers = resolveStaticCacheHeaders(p, true);
    assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  for (const mutable of ['/pwa-192x192.png', '/favicon.ico', '/icons/badge-favicon.png', '/admin/pwa-512x512.png']) {
    assert.equal(isContentHashedAsset(mutable), false, `Did not expect content-hashed: ${mutable}`);
    const headers = resolveStaticCacheHeaders(mutable, true);
    assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  for (const bin of ['/assets/SarbaazSoft-POS.apk', '/assets/SarbaazSoft-POS-Desktop-Setup.exe']) {
    assert.equal(isBinaryInstallerAsset(bin), true);
    assert.equal(isContentHashedAsset(bin), false);
    const headers = resolveStaticCacheHeaders(bin, true);
    assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  // 3. API headers disable HTTP/proxy caching across both dev and prod while preserving SSE framing
  for (const isProd of [false, true]) {
    const apiHeaders = resolveApiCacheHeaders('/products', isProd);
    assert.equal(apiHeaders['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
    assert.equal(apiHeaders['Pragma'], 'no-cache');
    assert.equal(apiHeaders['Expires'], '0');
    assert.equal(apiHeaders['Surrogate-Control'], 'no-store');
  }

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
  respectPausedFlag?: boolean;
  hasActiveRegistration?: boolean;
  initialCaches?: Record<string, Record<string, { status: number; body: string; contentType: string }>>;
  fetchImpl?: (input: any, init?: any) => Promise<any>;
}) {
  let swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  if ((options?.mode || 'production') === 'production') {
    swCode = swCode.replace(/const SW_ENV = ['"][^'"]*['"];/, "const SW_ENV = 'production';");
    if (options?.respectPausedFlag === false) {
      swCode = swCode.replace(/const SW_CACHING_PAUSED = true;/, 'const SW_CACHING_PAUSED = false;');
    }
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

test('public/sw.js pauses all Cache Storage usage by default and purges leftover caches on install & activate', async () => {
  const seenFetchInits: Array<{ url: string; cache?: string }> = [];
  // Even if SW_ENV is toggled to production, SW_CACHING_PAUSED = true keeps all caching disabled
  const pausedHarness = createMockSwHarness({
    mode: 'production',
    respectPausedFlag: true,
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
      'legacy-external-cache': {
        'https://pos.example.com/pwa-192x192.png': {
          status: 200,
          body: 'old-png',
          contentType: 'image/png',
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
        body: 'fresh-network-asset',
        clone() {
          return this;
        },
      };
    },
  });

  // 1. Install immediately calls skipWaiting and purges old Cache Storage
  let installWait = Promise.resolve();
  pausedHarness.listeners.get('install')!({ waitUntil: (p: Promise<any>) => (installWait = p) });
  await installWait;
  assert.equal(pausedHarness.getSkipWaitingCalls(), 1);
  assert.equal(pausedHarness.store.size, 0, 'Install must purge all caches while caching is paused');

  // 2. Activate purges all caches & claims clients
  let actWait = Promise.resolve();
  pausedHarness.listeners.get('activate')!({ waitUntil: (p: Promise<any>) => (actWait = p) });
  await actWait;
  assert.equal(pausedHarness.getClientsClaimCalls(), 1);
  assert.equal(pausedHarness.store.size, 0);

  // 3. Asset fetch bypasses Cache Storage and fetches directly with cache: no-store
  let responded: Promise<any> | null = null;
  pausedHarness.listeners.get('fetch')!({
    request: { method: 'GET', url: 'https://pos.example.com/assets/js/index-12345678.js', destination: 'script' },
    respondWith: (p: Promise<any>) => (responded = p),
  });
  const res = await responded!;
  assert.equal(res.body, 'fresh-network-asset');
  assert.equal(seenFetchInits[0]?.cache, 'no-store');
  assert.equal(pausedHarness.store.size, 0, 'Must never write assets to Cache Storage while paused');

  // 4. API requests pass straight through untouched (respondWith not called)
  let apiIntercepted = false;
  pausedHarness.listeners.get('fetch')!({
    request: { method: 'GET', url: 'https://pos.example.com/api/products' },
    respondWith: () => {
      apiIntercepted = true;
    },
  });
  assert.equal(apiIntercepted, false);
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
  let instWait = Promise.resolve();
  devHarness.listeners.get('install')!({ waitUntil: (p: Promise<any>) => (instWait = p) });
  await instWait;
  assert.equal(devHarness.getSkipWaitingCalls(), 1);

  // 2. Development activate purges ALL caches so prod artifacts never linger in dev
  let actWait = Promise.resolve();
  devHarness.listeners.get('activate')!({ waitUntil: (p: Promise<any>) => (actWait = p) });
  await actWait;
  assert.equal(devHarness.store.size, 0, 'Dev SW activate must purge all caches');

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
