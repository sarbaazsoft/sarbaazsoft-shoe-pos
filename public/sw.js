/* eslint-disable no-undef */
// =========================================================================
// SarbaazSoft Shoe POS - Consolidated Root Service Worker
// Combines:
// 1. PWA Shell Offline Caching & Fetch Handling (PWABuilder / WebAPK Compliant)
// 2. Firebase Cloud Messaging (FCM) Background Push Notifications
// 3. Web Push API & Notification Interaction / Deep-Linking
// 4. Background Sync & Periodic Sync for Offline POS Transactions (IndexedDB)
// =========================================================================

const SW_ENV = 'development';
const SW_CACHING_PAUSED = true;
const SW_BUILD_VERSION = 'dev';
const IS_PRODUCTION_SW = !SW_CACHING_PAUSED && SW_ENV === 'production';
const CACHE_PREFIX = 'sarbaazsoft-pos';
const PRECACHE_CACHE_NAME = `${CACHE_PREFIX}-precache-${SW_BUILD_VERSION}`;
const RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-runtime-${SW_BUILD_VERSION}`;
const IMMUTABLE_CACHE_NAME = `${CACHE_PREFIX}-immutable-v1`;
const CACHE_NAME = PRECACHE_CACHE_NAME;
const MAX_IMMUTABLE_RUNTIME_ENTRIES = 160;
const NOTIFICATION_BADGE_ICON = '/icons/badge-favicon.png';
const MAX_ACTIVE_SHADE_NOTIFICATIONS = 8;
const POS_SUMMARY_TAG = 'pos-grouped-summary';
const ADMIN_SUMMARY_TAG = 'admin-grouped-summary';
const SW_SYNC_TAG = 'pos-offline-transactions-sync';
const SW_PERIODIC_SYNC_TAG = 'pos-offline-periodic-sync';
const DB_NAME = 'ShoePosOfflineDB';
const DB_VERSION = 4;
const STORE_SALES = 'offline_sales_queue';
const BROADCAST_CHANNEL_NAME = 'pos_background_sync_channel';

// Core assets to pre-cache on install for instant offline availability
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest.json',
  '/.well-known/assetlinks.json',
  '/favicon.ico',
  '/favicon.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/icons/badge-favicon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-192x192.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/admin/manifest.webmanifest',
  '/admin/manifest.json',
  '/admin/favicon.ico',
  '/admin/favicon.png',
  '/admin/favicon-16x16.png',
  '/admin/favicon-32x32.png',
  '/admin/pwa-192x192.png',
  '/admin/pwa-512x512.png',
  '/admin/pwa-maskable-192x192.png',
  '/admin/pwa-maskable-512x512.png',
  '/admin/apple-touch-icon.png',
];

// Populated automatically by Vite writeBundle plugin during production build
const PRECACHE_BUILD_ASSETS = [];

const BINARY_INSTALLER_EXT_RE = /\.(?:apk|aab|exe|msix|msixbundle|appx|appxbundle|cer)$/i;
const HASHED_ASSET_PATH_RE = /^\/assets\/(?:js|css|fonts|media)\//i;
const HASHED_FILENAME_RE =
  /[-_.][a-zA-Z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i;
const STATIC_ASSET_EXT_RE =
  /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i;

function isCacheableStaticOrigin(url) {
  if (url.origin === self.location.origin) return true;
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

function isContentHashedAssetUrl(url) {
  if (url.origin === self.location.origin) {
    if (BINARY_INSTALLER_EXT_RE.test(url.pathname)) return false;
    return HASHED_ASSET_PATH_RE.test(url.pathname) || HASHED_FILENAME_RE.test(url.pathname);
  }
  // Google Fonts font binary files on fonts.gstatic.com are content-addressed & immutable
  return url.hostname === 'fonts.gstatic.com';
}

function isValidAssetResponse(request, response, url) {
  if (!response) return false;
  if (response.type === 'opaque') {
    // Allow opaque responses only for external font CDNs when CORS headers are absent
    return url.origin !== self.location.origin && isCacheableStaticOrigin(url);
  }
  if (!response.ok || response.status !== 200) return false;

  const contentType =
    response.headers && typeof response.headers.get === 'function'
      ? (response.headers.get('content-type') || '').toLowerCase()
      : '';

  if (url.origin === self.location.origin && STATIC_ASSET_EXT_RE.test(url.pathname)) {
    // Prevent SPA fallback HTML responses from poisoning JS/CSS/image/font caches
    if (contentType.includes('text/html')) {
      return false;
    }
    const lowerPath = url.pathname.toLowerCase();
    if ((lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs')) && contentType.includes('text/css')) {
      return false;
    }
    if (lowerPath.endsWith('.css') && contentType.includes('javascript')) {
      return false;
    }
  }

  const dest = request && request.destination ? request.destination : '';
  if ((dest === 'script' || dest === 'style' || dest === 'font' || dest === 'image') && contentType.includes('text/html')) {
    return false;
  }

  return true;
}

async function trimImmutableCache() {
  try {
    const cache = await caches.open(IMMUTABLE_CACHE_NAME);
    if (typeof cache.keys !== 'function' || typeof cache.delete !== 'function') return;
    const keys = await cache.keys();
    if (keys.length <= MAX_IMMUTABLE_RUNTIME_ENTRIES) return;

    const currentBuildSet = new Set(
      (Array.isArray(PRECACHE_BUILD_ASSETS) ? PRECACHE_BUILD_ASSETS : []).map((p) => {
        try {
          return new URL(p, self.location.origin).href;
        } catch {
          return p;
        }
      })
    );

    let excess = keys.length - MAX_IMMUTABLE_RUNTIME_ENTRIES;
    for (const req of keys) {
      if (excess <= 0) break;
      if (!currentBuildSet.has(req.url)) {
        await cache.delete(req);
        excess--;
      }
    }
  } catch {
    // Non-fatal cache pruning failure
  }
}

async function precacheAppShell() {
  const precache = await caches.open(PRECACHE_CACHE_NAME);
  await Promise.allSettled(
    PRECACHE_ASSETS.map(async (assetUrl) => {
      try {
        const res = await fetch(assetUrl, { cache: 'reload' });
        if (res && res.status === 200) {
          await precache.put(assetUrl, res);
          return;
        }
      } catch {
        // Fallback to standard cache.add if available
      }
      if (typeof precache.add === 'function') {
        await precache.add(assetUrl).catch(() => null);
      }
    })
  );

  if (Array.isArray(PRECACHE_BUILD_ASSETS) && PRECACHE_BUILD_ASSETS.length > 0) {
    const immutableCache = await caches.open(IMMUTABLE_CACHE_NAME);
    await Promise.allSettled(
      PRECACHE_BUILD_ASSETS.map(async (assetUrl) => {
        try {
          const existing =
            typeof immutableCache.match === 'function'
              ? await immutableCache.match(assetUrl)
              : null;
          if (existing) return;
          const res = await fetch(assetUrl);
          if (res && res.status === 200) {
            await immutableCache.put(assetUrl, res);
          }
        } catch {
          // Non-fatal build asset precache miss
        }
      })
    );
  }
}

// -------------------------------------------------------------------------
// 1. Service Worker Lifecycle (Install & Activate)
// -------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  // When caching is paused or in development, activate immediately and clear any old caches.
  if (SW_CACHING_PAUSED || !IS_PRODUCTION_SW || !(self.registration && self.registration.active)) {
    self.skipWaiting();
  }
  if (SW_CACHING_PAUSED || !IS_PRODUCTION_SW) {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {})
    );
    return;
  }
  event.waitUntil(precacheAppShell().catch(() => {}));
});

async function cleanupLegacySummaryShadeNotifications() {
  try {
    if (!self.registration || typeof self.registration.getNotifications !== 'function') return;
    const all = await self.registration.getNotifications().catch(() => []);
    for (const n of all) {
      if (!n) continue;
      const d = n.data || {};
      if (
        n.tag === POS_SUMMARY_TAG ||
        n.tag === ADMIN_SUMMARY_TAG ||
        d.isGroupSummary === true
      ) {
        try {
          n.close();
        } catch {}
      }
    }
  } catch {}
}

self.addEventListener('activate', (event) => {
  if (SW_CACHING_PAUSED || !IS_PRODUCTION_SW) {
    // Caching paused / development: purge all Cache Storage buckets immediately and take control
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => cleanupLegacySummaryShadeNotifications())
        .then(() => self.clients.claim())
        .catch(() => self.clients.claim())
    );
    return;
  }

  const activeCacheNames = new Set([
    PRECACHE_CACHE_NAME,
    RUNTIME_CACHE_NAME,
    IMMUTABLE_CACHE_NAME,
  ]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !activeCacheNames.has(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => trimImmutableCache())
      .then(() => cleanupLegacySummaryShadeNotifications())
      .then(() => self.clients.claim())
  );
});

// -------------------------------------------------------------------------
// 2. PWA Fetch Handler (Offline Support & Caching Strategy)
// Satisfies PWABuilder, Lighthouse, and Chromium WebAPK offline requirements
// -------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Pass-through API calls, version probe, service worker scripts, binary installers (.apk/.aab/.exe/.msix*), and Vite dev internals directly to network
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/version.json' ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules') ||
    url.pathname.includes('hot-update') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/firebase-messaging-sw.js' ||
    url.pathname === '/sw-background-sync.js' ||
    url.pathname.startsWith('/assets/windows/') ||
    url.pathname.startsWith('/assets/android/') ||
    BINARY_INSTALLER_EXT_RE.test(url.pathname)
  ) {
    return;
  }

  // When caching is paused or in development, always fetch fresh from network with no-store
  if (SW_CACHING_PAUSED || !IS_PRODUCTION_SW) {
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return;
    }
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request, { cache: 'no-store' }).catch(
          () =>
            new Response(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dev Server Offline - SarbaazSoft Shoe POS</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FFFFFF;color:#0F172A;text-align:center;padding:20px;}</style></head><body><div><h2>SarbaazSoft Shoe POS (Development)</h2><p>Unable to reach the development server.</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
        )
      );
      return;
    }
    if (url.origin === self.location.origin) {
      event.respondWith(
        fetch(request, { cache: 'no-store' }).catch(() => Response.error())
      );
    }
    return;
  }

  // 1. Navigation requests (HTML pages): Network-first with no-cache validation & offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(async (response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(PRECACHE_CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
            return response;
          }
          const cached =
            (await caches.match(request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/'));
          return cached || response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const indexFallback = (await caches.match('/index.html')) || (await caches.match('/'));
          if (indexFallback) return indexFallback;
          return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline - SarbaazSoft Shoe POS</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FFFFFF;color:#0F172A;text-align:center;padding:20px;}</style></head><body><div><h2>SarbaazSoft Shoe POS</h2><p>You are currently offline. Please reconnect to the internet or launch the installed app to use cached POS functions.</p></div></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // 2. Digital Asset Links & Web App Manifests: Network-First (always fresh for TWA/PWA verification, with offline fallback)
  if (
    url.pathname.startsWith('/.well-known/') ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('/manifest.json')
  ) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(PRECACHE_CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || Response.error();
        })
    );
    return;
  }

  // Skip runtime caching for unrelated third-party origins
  if (!isCacheableStaticOrigin(url)) {
    return;
  }

  // 3A. Content-Hashed Immutable Assets & Google Font binaries: Cache-First
  if (isContentHashedAssetUrl(url)) {
    event.respondWith(
      caches.open(IMMUTABLE_CACHE_NAME).then(async (cache) => {
        const cachedResponse =
          (typeof cache.match === 'function' ? await cache.match(request) : null) ||
          (await caches.match(request));
        if (cachedResponse) {
          return cachedResponse;
        }
        try {
          const networkResponse = await fetch(request);
          if (isValidAssetResponse(request, networkResponse, url)) {
            const clone = networkResponse.clone();
            cache.put(request, clone).catch(() => {});
          }
          return networkResponse;
        } catch {
          return Response.error();
        }
      })
    );
    return;
  }

  // 3B. Mutable Static Assets (unhashed icons, SVGs, public images, Google Font CSS): Stale-While-Revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE_NAME).then(async (cache) => {
      const cachedResponse =
        (typeof cache.match === 'function' ? await cache.match(request) : null) ||
        (await caches.match(request));
      const fetchInit = url.origin === self.location.origin ? { cache: 'no-cache' } : undefined;
      const fetchPromise = fetch(request, fetchInit)
        .then((networkResponse) => {
          if (isValidAssetResponse(request, networkResponse, url)) {
            const clone = networkResponse.clone();
            cache.put(request, clone).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || Response.error());

      return cachedResponse || fetchPromise;
    })
  );
});

// -------------------------------------------------------------------------
// 3. Notification Helpers & Anti-Spam Deduplication
// -------------------------------------------------------------------------
const PUSH_DEDUPE_CHANNEL_NAME = 'pos_push_dedupe_channel';
const SW_PUSH_DEDUPE_TTL_MS = 15000;
const swRecentPushTags = new Map();
const swWindowClaimedKeys = new Map();

function recordSwWindowClaim(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'CLAIM_CHANNEL' && typeof data.compositeKey === 'string') {
    const exp = typeof data.expiresAt === 'number' && data.expiresAt > Date.now()
      ? data.expiresAt
      : Date.now() + SW_PUSH_DEDUPE_TTL_MS;
    swWindowClaimedKeys.set(data.compositeKey, exp);
  }
}

function isWindowClaimedInSw(tag, eventId) {
  const now = Date.now();
  if (swWindowClaimedKeys.size > 100) {
    for (const [k, exp] of swWindowClaimedKeys.entries()) {
      if (exp <= now) swWindowClaimedKeys.delete(k);
    }
  }
  const tagKey = tag ? `os_notification:id:${tag}` : '';
  const eventKey = eventId ? `os_notification:id:${eventId}` : '';
  const tagExp = tagKey ? swWindowClaimedKeys.get(tagKey) : 0;
  const eventExp = eventKey ? swWindowClaimedKeys.get(eventKey) : 0;
  return Boolean((tagExp && tagExp > now) || (eventExp && eventExp > now));
}

try {
  if (typeof BroadcastChannel !== 'undefined') {
    const swDedupeListenerChannel = new BroadcastChannel(PUSH_DEDUPE_CHANNEL_NAME);
    if (typeof swDedupeListenerChannel.addEventListener === 'function') {
      swDedupeListenerChannel.addEventListener('message', (evt) => recordSwWindowClaim(evt && evt.data));
    }
  }
} catch {}

function isAdminShadeTarget(options) {
  const data = (options && options.data) || {};
  const url = String(data.url || data.deepLinkUrl || '');
  return (
    data.isAdmin === true ||
    data.isAdmin === 'true' ||
    url.startsWith('/admin') ||
    String((options && options.icon) || '').includes('/admin/')
  );
}

function resolveShadeTimestamp(rawTimestamp) {
  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp) && rawTimestamp > 0) {
    return rawTimestamp;
  }
  if (typeof rawTimestamp === 'string' && rawTimestamp.trim()) {
    const asNum = Number(rawTimestamp);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
    const parsed = Date.parse(rawTimestamp);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

function sanitizePushTargetUrl(rawUrl, isAdminTarget) {
  const fallback = isAdminTarget ? '/admin' : '/?tab=reports';
  if (!rawUrl || typeof rawUrl !== 'string') return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? fallback : trimmed;
  }
  try {
    const parsed = new URL(trimmed, self.location && self.location.origin ? self.location.origin : 'https://localhost');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin === (self.location && self.location.origin)
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.href;
    }
  } catch {}
  return fallback;
}

function claimSwPushTag(tag) {
  const now = Date.now();
  if (swRecentPushTags.size > 100) {
    for (const [k, exp] of swRecentPushTags.entries()) {
      if (exp <= now) swRecentPushTags.delete(k);
    }
  }
  const existing = swRecentPushTags.get(tag);
  if (existing && existing > now) {
    return false;
  }
  swRecentPushTags.set(tag, now + SW_PUSH_DEDUPE_TTL_MS);
  return true;
}

function broadcastPushDedupeEvent(payload) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(PUSH_DEDUPE_CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {}

  if (self.clients && typeof self.clients.matchAll === 'function') {
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          try {
            client.postMessage(payload);
          } catch {}
        }
      })
      .catch(() => {});
  }
}

function formatShadeItemTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function normalizeInlineShadeText(value, maxLen) {
  const clean = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function stripLeadingTitleFromShadeBody(title, body) {
  const cleanTitle = normalizeInlineShadeText(title, 120);
  const cleanBody = String(body == null ? '' : body).replace(/\s+/g, ' ').trim();
  if (!cleanBody) return '';
  if (cleanTitle && cleanBody.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
    return cleanBody.slice(cleanTitle.length).replace(/^[\s:•\-—]+/, '').trim();
  }
  return cleanBody;
}

function formatShadeGroupSummaryBody(items) {
  const MAX_VISIBLE_LINES = 6;
  const sorted = items.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const hasOverflow = sorted.length > MAX_VISIBLE_LINES;
  const visible = hasOverflow ? sorted.slice(0, MAX_VISIBLE_LINES - 1) : sorted;

  const lines = visible.map((item) => {
    const itemTitle = normalizeInlineShadeText(item.title || 'POS Notification', 48);
    const timeStr = formatShadeItemTime(item.timestamp || Date.now());
    const strippedBody = stripLeadingTitleFromShadeBody(item.title, item.body);
    const shortDetail = normalizeInlineShadeText(strippedBody, 76);
    const headerPart = timeStr ? `• ${itemTitle} • ${timeStr}` : `• ${itemTitle}`;
    return shortDetail ? `${headerPart} — ${shortDetail}` : headerPart;
  });

  if (hasOverflow) {
    const remaining = sorted.length - visible.length;
    lines.push(`• +${remaining} more ${remaining === 1 ? 'alert' : 'alerts'} — Tap to view all`);
  }

  return lines.join('\n');
}

function extractItemsFromExistingSwNotification(existing, defaultUrl) {
  const existingData = (existing && existing.data) || {};
  if (Array.isArray(existingData.items) && existingData.items.length > 0) {
    return existingData.items
      .filter((it) => it && (it.title || it.body))
      .map((it, idx) => ({
        title: String(it.title || 'POS Notification'),
        body: String(it.body || ''),
        url: String(it.url || defaultUrl),
        tag: String(it.tag || `${existing.tag || 'item'}-${idx}`),
        timestamp: resolveShadeTimestamp(it.timestamp),
      }));
  }

  const tag = String((existing && existing.tag) || '').trim();
  if (!tag || tag === POS_SUMMARY_TAG || tag === ADMIN_SUMMARY_TAG || existingData.isGroupSummary === true) {
    return [];
  }

  return [
    {
      title: String(existingData.notificationTitle || (existing && existing.title) || 'POS Notification'),
      body: String(existingData.notificationBody || (existing && existing.body) || ''),
      url: String(existingData.url || defaultUrl),
      tag,
      timestamp: resolveShadeTimestamp((existing && existing.timestamp) || existingData.timestamp),
    },
  ];
}

let swShadeNotificationQueue = Promise.resolve();

async function showGroupedShadeNotification(title, options = {}) {
  const run = async () => {
    if (!self.registration || typeof self.registration.showNotification !== 'function') {
      return;
    }

    const isAdminTarget = isAdminShadeTarget(options);
    const groupKey = isAdminTarget ? 'admin_alerts' : 'pos_alerts';
    const summaryTag = isAdminTarget ? ADMIN_SUMMARY_TAG : POS_SUMMARY_TAG;
    const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
    const incomingTag =
      String(options.tag || (options.data && (options.data.tag || options.data.eventId)) || '').trim() ||
      `${isAdminTarget ? 'admin' : 'pos'}-${Date.now()}`;
    const incomingEventId = String((options.data && options.data.eventId) || incomingTag);
    const cleanTitle = String(title || 'SarbaazSoft POS Alert').slice(0, 120);
    const cleanBody = String(options.body || 'New store notification.').slice(0, 320);
    const timestamp = resolveShadeTimestamp(options.timestamp || (options.data && options.data.timestamp));
    const targetUrl = sanitizePushTargetUrl(
      (options.data && (options.data.url || options.data.deepLinkUrl)) || '',
      isAdminTarget
    );

    const claimedFirstTime = claimSwPushTag(incomingTag);
    const claimedByWindow = isWindowClaimedInSw(incomingTag, incomingEventId);
    const isFirstSwDeliveryForTag = claimedFirstTime && !claimedByWindow;

    const dedupeBroadcastPayload = {
      type: 'SW_NOTIFICATION_SHOWN',
      tag: incomingTag,
      eventId: incomingEventId,
      dedupeKey: `id:${incomingEventId}`,
      title: cleanTitle,
      body: cleanBody,
      timestamp,
    };

    let alreadyHadTagInShade = false;
    let existingMatchingCard = null;
    const existingGroupNotifications = [];

    if (typeof self.registration.getNotifications === 'function') {
      const existingAll = await self.registration.getNotifications().catch(() => []);
      for (const existing of existingAll) {
        if (!existing) continue;
        const existingData = existing.data || {};
        const existingIsAdmin =
          existingData.isAdmin === true ||
          existingData.isAdmin === 'true' ||
          String(existingData.url || '').startsWith('/admin') ||
          String(existing.icon || '').includes('/admin/') ||
          existing.tag === ADMIN_SUMMARY_TAG;

        if (existingIsAdmin !== isAdminTarget) {
          continue;
        }

        // Close any legacy synthetic merged summary notification so Android's native
        // expandable notification group renders individual child cards cleanly
        if (
          existing.tag === summaryTag ||
          existing.tag === POS_SUMMARY_TAG ||
          existing.tag === ADMIN_SUMMARY_TAG ||
          existingData.isGroupSummary === true
        ) {
          try {
            existing.close();
          } catch {}
          continue;
        }

        if (existing.tag === incomingTag) {
          alreadyHadTagInShade = true;
          existingMatchingCard = existing;
        } else {
          existingGroupNotifications.push(existing);
        }
      }

      // If this exact alert is already visible in the shade with unchanged text (e.g. shown via Window or duplicate token),
      // avoid re-calling showNotification() so Android never flickers or flags spam.
      if (alreadyHadTagInShade && options.renotify !== true && existingMatchingCard) {
        const prevTitle = String(
          existingMatchingCard.title || (existingMatchingCard.data && existingMatchingCard.data.notificationTitle) || ''
        );
        const prevBody = String(
          existingMatchingCard.body || (existingMatchingCard.data && existingMatchingCard.data.notificationBody) || ''
        );
        if ((prevTitle === cleanTitle && prevBody === cleanBody) || claimedByWindow) {
          broadcastPushDedupeEvent(dedupeBroadcastPayload);
          return;
        }
      }

      // Keep shade bounded to the newest MAX_ACTIVE_SHADE_NOTIFICATIONS per group
      if (existingGroupNotifications.length >= MAX_ACTIVE_SHADE_NOTIFICATIONS) {
        const sortedOldestFirst = existingGroupNotifications.slice().sort(
          (a, b) =>
            resolveShadeTimestamp((a && a.timestamp) || (a && a.data && a.data.timestamp)) -
            resolveShadeTimestamp((b && b.timestamp) || (b && b.data && b.data.timestamp))
        );
        const excessCount = existingGroupNotifications.length - (MAX_ACTIVE_SHADE_NOTIFICATIONS - 1);
        for (let i = 0; i < excessCount; i++) {
          try {
            sortedOldestFirst[i].close();
          } catch {}
        }
      }
    }

    const icon = options.icon || defaultIcon;
    const badge =
      options.badge && !String(options.badge).includes('pwa-192x192')
        ? options.badge
        : NOTIFICATION_BADGE_ICON;
    const shouldBeSilent = !isFirstSwDeliveryForTag || alreadyHadTagInShade || Boolean(options.silent === true);
    const allowRequireInteraction = Boolean(options.requireInteraction === true);
    const hasReceiptLink = targetUrl.includes('invoice') || targetUrl.includes('return');

    const defaultActions = isAdminTarget
      ? [
          { action: 'open_pos', title: 'Open Admin' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : hasReceiptLink
      ? [
          { action: 'open_receipt', title: 'Open Receipt' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : [
          { action: 'open_pos', title: 'Open POS' },
          { action: 'dismiss', title: 'Dismiss' },
        ];

    const allowRenotify = isFirstSwDeliveryForTag && !alreadyHadTagInShade
      ? Boolean(options.renotify === true)
      : false;

    const notificationOptions = Object.assign({}, options, {
      body: cleanBody,
      icon,
      badge,
      tag: incomingTag,
      timestamp,
      renotify: allowRenotify,
      requireInteraction: allowRequireInteraction,
      silent: shouldBeSilent,
      actions: Array.isArray(options.actions) && options.actions.length > 0 ? options.actions : defaultActions,
      data: Object.assign({}, options.data || {}, {
        url: targetUrl,
        isAdmin: isAdminTarget ? 'true' : 'false',
        groupKey,
        isGroupSummary: false,
        notificationTitle: cleanTitle,
        notificationBody: cleanBody,
        timestamp,
        eventId: incomingEventId,
        tag: incomingTag,
      }),
    });
    if (shouldBeSilent) {
      delete notificationOptions.vibrate;
    } else {
      notificationOptions.vibrate = options.vibrate || [200, 100, 200];
    }

    try {
      await self.registration.showNotification(cleanTitle, notificationOptions);
      broadcastPushDedupeEvent(dedupeBroadcastPayload);
    } catch (showErr) {
      const errName = String((showErr && showErr.name) || '').toLowerCase();
      if (errName === 'notallowederror' || errName === 'securityerror') {
        broadcastPushDedupeEvent({
          type: 'SW_NOTIFICATION_DELIVERY_BLOCKED',
          reason: 'delivery-rejected',
          timestamp: Date.now(),
        });
      }
      throw showErr;
    }
  };

  const nextTask = swShadeNotificationQueue.then(run, run);
  swShadeNotificationQueue = nextTask.catch(() => {});
  return nextTask;
}

// -------------------------------------------------------------------------
// 4. Authoritative Web Push & Notification Interaction Listeners
// Registered BEFORE firebase-messaging-compat importScripts so Firebase's
// internal compat listeners cannot auto-display duplicate notifications or
// hijack notification clicks in desktop/mobile browsers.
// -------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  let data = {};
  if (event && event.data) {
    try {
      data = event.data.json() || {};
    } catch {
      try {
        const textBody = event.data.text();
        data = { title: 'SarbaazSoft POS Alert', body: textBody };
      } catch {
        data = {};
      }
    }
  }

  const notification = (data && data.notification) || data || {};
  const payloadData = (data && data.data) || {};
  const title = notification.title || payloadData.title || data.title || 'SarbaazSoft Shoe POS Alert';
  const tag =
    payloadData.tag ||
    payloadData.eventId ||
    notification.tag ||
    data.tag ||
    data.eventId ||
    `pos-alert-${Date.now()}`;
  const rawTargetUrl = payloadData.url || payloadData.deepLinkUrl || data.url || '/?tab=reports';
  const isAdminTarget =
    String(rawTargetUrl).startsWith('/admin') ||
    payloadData.isAdmin === true ||
    payloadData.isAdmin === 'true' ||
    String(notification.icon || data.icon || payloadData.icon || '').includes('/admin/');
  const targetUrl = sanitizePushTargetUrl(rawTargetUrl, isAdminTarget);
  const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
  const rawBadge = notification.badge || data.badge || payloadData.badge;
  const badge =
    rawBadge && !String(rawBadge).includes('pwa-192x192')
      ? rawBadge
      : NOTIFICATION_BADGE_ICON;
  const timestamp = resolveShadeTimestamp(
    notification.timestamp || data.timestamp || payloadData.timestamp
  );

  const options = {
    body:
      notification.body ||
      payloadData.body ||
      data.body ||
      data.message ||
      'New Point of Sale notification received.',
    icon: notification.icon || data.icon || payloadData.icon || defaultIcon,
    badge,
    tag,
    timestamp,
    data: Object.assign({}, payloadData, { url: targetUrl, isAdmin: isAdminTarget ? 'true' : 'false' }),
    vibrate: [200, 100, 200],
    requireInteraction: Boolean(
      notification.requireInteraction === true ||
        data.requireInteraction === true ||
        payloadData.requireInteraction === 'true'
    ),
    renotify: Boolean(
      notification.renotify === true ||
        data.renotify === true ||
        payloadData.renotify === 'true'
    ),
    actions: Array.isArray(notification.actions) && notification.actions.length > 0
      ? notification.actions
      : isAdminTarget
      ? [
          { action: 'open_pos', title: 'Open Admin' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : targetUrl.includes('invoice') || targetUrl.includes('return')
      ? [
          { action: 'open_receipt', title: 'Open Receipt' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : [
          { action: 'open_pos', title: 'Open POS' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
  };

  event.waitUntil(
    showGroupedShadeNotification(title, options).catch((err) => {
      const errName = String((err && err.name) || '').toLowerCase();
      if (errName === 'notallowederror' || errName === 'securityerror') {
        return;
      }
      return self.registration
        .showNotification(title || 'SarbaazSoft Shoe POS Alert', {
          body: (options && options.body) || 'New store activity received.',
          icon: defaultIcon,
          badge: NOTIFICATION_BADGE_ICON,
          tag: tag || `pos-fallback-${Date.now()}`,
        })
        .then(() => {
          broadcastPushDedupeEvent({
            type: 'SW_NOTIFICATION_SHOWN',
            tag,
            eventId: (options.data && options.data.eventId) || tag,
            dedupeKey: `id:${(options.data && options.data.eventId) || tag}`,
            title,
            body: (options && options.body) || '',
            timestamp,
          });
        })
        .catch(() => {});
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  if (event.notification && typeof event.notification.close === 'function') {
    event.notification.close();
  }

  if (event.action === 'dismiss') {
    return;
  }

  const notifData = (event.notification && event.notification.data) || {};
  const isAdminTarget =
    notifData.isAdmin === true ||
    notifData.isAdmin === 'true' ||
    String(notifData.url || '').startsWith('/admin');
  let targetUrl = sanitizePushTargetUrl(notifData.url || '/?tab=reports', isAdminTarget);
  if (event.action === 'open_notifications') {
    targetUrl = isAdminTarget ? '/admin' : '/notifications';
  } else if (event.action === 'open_pos') {
    targetUrl = isAdminTarget ? '/admin' : '/?tab=pos';
  } else if (event.action === 'open_receipt') {
    targetUrl = sanitizePushTargetUrl(notifData.url || '/?tab=reports', isAdminTarget);
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If an active window is already open, notify it and bring to focus
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            client.postMessage({
              type: 'POS_DEEP_LINK_NOTIFICATION',
              payload: notifData,
              targetUrl,
            });
            if (client.url && client.navigate) {
              Promise.resolve(client.navigate(targetUrl)).catch(() => {});
            }
          } catch {}
          return client.focus();
        }
      }

      // 2. If no window is open, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  broadcastPushDedupeEvent({
    type: 'SW_PUSH_SUBSCRIPTION_CHANGED',
    timestamp: Date.now(),
  });
  if (
    event &&
    typeof event.waitUntil === 'function' &&
    event.oldSubscription &&
    event.oldSubscription.options &&
    self.registration &&
    self.registration.pushManager
  ) {
    event.waitUntil(
      self.registration.pushManager
        .subscribe(event.oldSubscription.options)
        .then(() => {
          broadcastPushDedupeEvent({
            type: 'SW_PUSH_SUBSCRIPTION_CHANGED',
            resubscribed: true,
            timestamp: Date.now(),
          });
        })
        .catch(() => {})
    );
  }
});

// -------------------------------------------------------------------------
// 4B. Firebase Cloud Messaging (FCM) Compat Initialization
// -------------------------------------------------------------------------
let messagingInitialized = false;

try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');
} catch (err) {
  // Graceful fallback if running offline or in network-isolated environments
}

async function initFirebaseInWorker() {
  if (messagingInitialized || typeof firebase === 'undefined') return;
  try {
    const res = await fetch('/api/notifications/fcm-config', { cache: 'no-store' });
    if (!res.ok) return;
    const config = await res.json();
    if (config && config.apiKey && config.projectId) {
      if (!firebase.apps.length) {
        firebase.initializeApp({
          apiKey: config.apiKey,
          projectId: config.projectId,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId,
          measurementId: config.measurementId,
        });
      }
      const messaging = firebase.messaging();
      messaging.onBackgroundMessage((payload) => {
        const title = payload.notification?.title || payload.data?.title || 'SarbaazSoft Shoe POS Alert';
        const body = payload.notification?.body || payload.data?.body || 'New store transaction activity received.';
        const url = payload.data?.url || '/?tab=reports';
        const isAdminTarget = String(url).startsWith('/admin') || payload.data?.isAdmin === 'true';
        const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
        const icon = payload.notification?.icon || payload.data?.icon || defaultIcon;
        const rawBadge = payload.data?.badge || payload.notification?.badge;
        const badge =
          rawBadge && !String(rawBadge).includes('pwa-192x192')
            ? rawBadge
            : NOTIFICATION_BADGE_ICON;
        const tag = payload.data?.tag || payload.data?.eventId || `pos-${Date.now()}`;
        const timestamp = resolveShadeTimestamp(payload.data?.timestamp);

        const notificationOptions = {
          body,
          icon,
          badge,
          tag,
          timestamp,
          vibrate: [200, 100, 200],
          data: {
            url,
            isAdmin: isAdminTarget ? 'true' : 'false',
            ...payload.data,
          },
          actions: [
            { action: 'open_pos', title: isAdminTarget ? 'Open Admin' : 'Open POS' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        };

        return showGroupedShadeNotification(title, notificationOptions);
      });
      messagingInitialized = true;
    }
  } catch {
    // Non-fatal if config not yet saved or offline
  }
}

initFirebaseInWorker().catch(() => {});

// -------------------------------------------------------------------------
// 5. Offline Background Sync for Offline Sales Transactions (IndexedDB)
// -------------------------------------------------------------------------
let cachedAuthContext = {
  token: null,
  tenantId: null,
};

let isSwSyncing = false;

function broadcastSyncEvent(payload) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {}

  self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        try {
          client.postMessage(payload);
        } catch {}
      }
    })
    .catch(() => {});
}

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in Service Worker'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_SALES)) {
        const salesStore = db.createObjectStore(STORE_SALES, { keyPath: 'clientTxId' });
        salesStore.createIndex('status', 'status', { unique: false });
        salesStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllQueuedSalesFromIDB(db) {
  return new Promise((resolve, reject) => {
    try {
      if (!db.objectStoreNames.contains(STORE_SALES)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(STORE_SALES, 'readonly');
      const store = tx.objectStore(STORE_SALES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function updateQueuedSaleInIDB(db, clientTxId, updates) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SALES, 'readwrite');
      const store = tx.objectStore(STORE_SALES);
      const getReq = store.get(clientTxId);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          resolve(null);
          return;
        }
        const updated = Object.assign({}, existing, updates);
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function isServerHealthy() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const res = await fetch('/api/health', {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

async function processOfflineQueueFromSW(triggerSource) {
  if (isSwSyncing) return;

  const windowClients = await self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .catch(() => []);

  if (windowClients && windowClients.length > 0) {
    broadcastSyncEvent({
      type: 'SW_TRIGGER_OFFLINE_SYNC',
      source: triggerSource || 'sw-sync',
      timestamp: Date.now(),
    });
    return;
  }

  if (!cachedAuthContext.token) {
    return;
  }

  const healthy = await isServerHealthy();
  if (!healthy) {
    throw new Error('Server unreachable during Service Worker background sync');
  }

  isSwSyncing = true;
  let db = null;
  let synced = 0;
  let failed = 0;

  try {
    db = await openOfflineDB();
    const allSales = await getAllQueuedSalesFromIDB(db);
    const pendingSales = allSales
      .filter((s) => s && (s.status === 'PENDING' || s.status === 'FAILED'))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (pendingSales.length === 0) {
      return;
    }

    for (const sale of pendingSales) {
      const authToken = sale.authToken || cachedAuthContext.token;
      if (!authToken) continue;

      try {
        await updateQueuedSaleInIDB(db, sale.clientTxId, { status: 'SYNCING' });

        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        };
        const targetTenantId = sale.tenantId || cachedAuthContext.tenantId;
        if (targetTenantId) {
          headers['X-Tenant-Id'] = String(targetTenantId);
        }

        const payload = {
          clientTxId: sale.clientTxId,
          saleDate: sale.createdAt,
          items: (sale.items || []).map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
          })),
          customerId: sale.customerId,
          paymentMethod: sale.paymentMethod,
          cashReceived: sale.cashReceived,
          changeGiven: sale.changeGiven,
          notes: sale.notes,
          isMinPriceOverridden: Boolean(sale.isMinPriceOverridden),
          adminOverrideEmail: sale.adminOverrideEmail || null,
          adminOverridePassword: sale.adminOverridePassword || null,
          exchange: sale.exchange || null,
        };

        const res = await fetch('/api/pos/checkout', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        await updateQueuedSaleInIDB(db, sale.clientTxId, {
          status: 'SYNCED',
          syncedInvoiceNumber: (data && data.sale && data.sale.invoiceNumber) || data.invoiceNumber,
          syncedAt: new Date().toISOString(),
          errorMessage: undefined,
        });
        synced++;
      } catch (err) {
        const msg = String((err && err.message) || err || 'Background sync error');
        const isNetErr =
          msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('abort');
        await updateQueuedSaleInIDB(db, sale.clientTxId, {
          status: isNetErr ? 'PENDING' : 'FAILED',
          errorMessage: isNetErr ? 'Server offline (will auto-retry on reconnect)' : msg,
        });
        failed++;
        if (isNetErr) {
          throw err;
        }
      }
    }

    if (synced > 0 || failed > 0) {
      broadcastSyncEvent({
        type: 'SW_BACKGROUND_SYNC_COMPLETED',
        synced,
        failed,
        timestamp: Date.now(),
      });
      broadcastSyncEvent({
        type: 'SW_OFFLINE_SYNC_COMPLETE',
        synced,
        failed,
        timestamp: Date.now(),
      });
    }
  } finally {
    isSwSyncing = false;
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SW_SYNC_TAG) {
    event.waitUntil(processOfflineQueueFromSW('sync-event'));
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === SW_PERIODIC_SYNC_TAG || event.tag === SW_SYNC_TAG) {
    event.waitUntil(processOfflineQueueFromSW('periodicsync-event'));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'CLAIM_CHANNEL') {
    recordSwWindowClaim(data);
    return;
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'SYNC_AUTH_CONTEXT') {
    cachedAuthContext = {
      token: data.token || cachedAuthContext.token,
      tenantId: data.tenantId !== undefined ? data.tenantId : cachedAuthContext.tenantId,
    };
    return;
  }

  if (data.type === 'CLEAR_AUTH_CONTEXT') {
    cachedAuthContext = {
      token: null,
      tenantId: null,
    };
    return;
  }

  if (data.type === 'TRIGGER_BACKGROUND_SYNC') {
    if (data.authToken) {
      cachedAuthContext.token = data.authToken;
    }
    event.waitUntil(processOfflineQueueFromSW('manual-trigger').catch(() => {}));
    return;
  }

  if (data.type === 'REGISTER_BACKGROUND_SYNC') {
    if (self.registration && 'sync' in self.registration) {
      self.registration.sync.register(SW_SYNC_TAG).catch(() => {});
    }
    event.waitUntil(processOfflineQueueFromSW('message-trigger').catch(() => {}));
    return;
  }

  if (data.type === 'SHOW_SHADE_NOTIFICATION' && data.title) {
    event.waitUntil(showGroupedShadeNotification(data.title, data.options || {}).catch(() => {}));
  }
});
