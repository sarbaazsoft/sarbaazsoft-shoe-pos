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

test('staticCacheHeaders unconditionally enforces no-store across APIs and static assets while preserving content headers', () => {
  // 1. Service Workers must never be HTTP-cached
  for (const swPath of ['/sw.js', '/firebase-messaging-sw.js', '/sw-background-sync.js']) {
    assert.equal(isServiceWorkerScript(swPath), true);
    assert.equal(isContentHashedAsset(swPath), false);
    for (const isProd of [false, true]) {
      const headers = resolveStaticCacheHeaders(swPath, isProd);
      assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
      assert.equal(headers['Surrogate-Control'], 'no-store');
      assert.equal(headers['Service-Worker-Allowed'], '/');
      assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    }
  }

  // 2. HTML entry points, manifests, hashed assets, mutable assets, and installers all enforce no-store
  const htmlHeaders = resolveStaticCacheHeaders('/dist/index.html', true);
  assert.equal(htmlHeaders['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
  assert.equal(htmlHeaders['Pragma'], 'no-cache');

  const manifestHeaders = resolveStaticCacheHeaders('/manifest.webmanifest', true);
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

  const cachesMock = {
    open: async () => {
      throw new Error('caches.open should never be called when SW caching is removed');
    },
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
      active: {},
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

test('public/sw.js contains zero Cache Storage caching, purges any leftover caches, and fetches no-store', async () => {
  const swSource = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  assert.equal(/caches\.open\s*\(/.test(swSource), false);
  assert.equal(/caches\.put\s*\(/.test(swSource), false);
  assert.equal(/caches\.match\s*\(/.test(swSource), false);
  assert.equal(/\bSW_CACHING_PAUSED\b/.test(swSource), false);

  for (const mode of ['production', 'development'] as const) {
    const seenFetchInits: Array<{ url: string; cache?: string }> = [];
    const harness = createMockSwHarness({
      mode,
      initialCaches: {
        'legacy-precache': {
          'https://pos.example.com/': { status: 200, body: 'old-html', contentType: 'text/html' },
        },
        'legacy-immutable': {
          'https://pos.example.com/assets/js/index-12345678.js': {
            status: 200,
            body: 'old-js',
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
          body: 'fresh-network-asset',
          clone() {
            return this;
          },
        };
      },
    });

    let installWait = Promise.resolve();
    harness.listeners.get('install')!({ waitUntil: (p: Promise<any>) => (installWait = p) });
    await installWait;
    assert.equal(harness.getSkipWaitingCalls(), 1);
    assert.equal(harness.store.size, 0);

    let actWait = Promise.resolve();
    harness.listeners.get('activate')!({ waitUntil: (p: Promise<any>) => (actWait = p) });
    await actWait;
    assert.equal(harness.getClientsClaimCalls(), 1);
    assert.equal(harness.store.size, 0);

    let responded: Promise<any> | null = null;
    harness.listeners.get('fetch')!({
      request: { method: 'GET', url: 'https://pos.example.com/assets/js/index-12345678.js', destination: 'script' },
      respondWith: (p: Promise<any>) => (responded = p),
    });
    const res = await responded!;
    assert.equal(res.body, 'fresh-network-asset');
    assert.equal(seenFetchInits[0]?.cache, 'no-store');
    assert.equal(harness.store.size, 0);

    let apiIntercepted = false;
    harness.listeners.get('fetch')!({
      request: { method: 'GET', url: 'https://pos.example.com/api/products' },
      respondWith: () => {
        apiIntercepted = true;
      },
    });
    assert.equal(apiIntercepted, false);
  }
});
