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
const SW_BUILD_VERSION = 'dev';
const NOTIFICATION_BADGE_ICON = '/icons/badge-favicon.png';
const SW_SYNC_TAG = 'pos-offline-transactions-sync';
const SW_PERIODIC_SYNC_TAG = 'pos-offline-periodic-sync';
const DB_NAME = 'ShoePosOfflineDB';
const DB_VERSION = 4;
const STORE_SALES = 'offline_sales_queue';
const BROADCAST_CHANNEL_NAME = 'pos_background_sync_channel';

const BINARY_INSTALLER_EXT_RE = /\.(?:apk|aab|exe|msix|msixbundle|appx|appxbundle|cer)$/i;

function purgeAllSwCaches() {
  if (typeof caches === 'undefined') return Promise.resolve();
  return caches
    .keys()
    .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .catch(() => {});
}

// -------------------------------------------------------------------------
// 1. Service Worker Lifecycle (Install & Activate)
// -------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(purgeAllSwCaches());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    purgeAllSwCaches()
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

// -------------------------------------------------------------------------
// 2. Network-Only Fetch Handler (No App or Asset Caching)
// -------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Pass-through API calls, version probe, service worker scripts, binary installers, and Vite dev internals directly to network
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

  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(
        () =>
          new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline - SarbaazSoft Shoe POS</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FFFFFF;color:#0F172A;text-align:center;padding:20px;}</style></head><body><div><h2>SarbaazSoft Shoe POS</h2><p>Unable to reach the server. Please check your connection and try again.</p></div></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
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
});

// -------------------------------------------------------------------------
// 3. Notification Helpers & Anti-Spam Deduplication
// -------------------------------------------------------------------------
const PUSH_DEDUPE_CHANNEL_NAME = 'pos_push_dedupe_channel';
const SW_PUSH_DEDUPE_TTL_MS = 120000;
const swRecentPushTags = new Map();
const swWindowClaimedKeys = new Map();

function hashPushKey(input) {
  const str = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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

function cleanSwIdValue(val) {
  if (val === undefined || val === null) return '';
  const str = String(val).trim();
  if (!str || str === 'undefined' || str === 'null') return '';
  return str;
}

function extractSwInvoiceId(data, candidateUrls) {
  const direct = cleanSwIdValue(data.invoiceId) || cleanSwIdValue(data.invoiceNumber);
  if (direct) return direct;

  for (const rawUrl of candidateUrls) {
    if (!rawUrl) continue;
    const pathMatch = rawUrl.match(/\/invoices\/([^/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch {
        return pathMatch[1];
      }
    }
    try {
      const parsed = new URL(rawUrl, 'https://localhost');
      const qp = parsed.searchParams.get('viewInvoice') || parsed.searchParams.get('invoice');
      if (qp && qp.trim()) return qp.trim();
    } catch {}
  }

  const fallbackId =
    cleanSwIdValue(data.saleId) ||
    cleanSwIdValue(data.orderId) ||
    (String(data.itemType || '').toUpperCase() === 'SALE' ? cleanSwIdValue(data.rawId) : '');
  if (fallbackId) return fallbackId;

  const titleOrMsg = `${data.notificationTitle || data.title || ''} ${data.notificationBody || data.body || data.message || ''}`;
  const hashMatch = titleOrMsg.match(/#([A-Z0-9][A-Z0-9-]*)/i);
  if (hashMatch && hashMatch[1] && !/^(?:RET|EXC|PUR)-/i.test(hashMatch[1])) {
    return hashMatch[1];
  }
  return '';
}

function extractSwAnnouncementId(data, candidateUrls) {
  const direct =
    cleanSwIdValue(data.announcementId) ||
    cleanSwIdValue(data.notificationId) ||
    (String(data.kind || '').toUpperCase() === 'NOTICE'
      ? cleanSwIdValue(data.rawId) || cleanSwIdValue(data.id).replace(/^notice-/i, '')
      : '');
  if (direct) return direct;

  for (const rawUrl of candidateUrls) {
    if (!rawUrl) continue;
    const pathMatch = rawUrl.match(/\/announcements\/([^/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch {
        return pathMatch[1];
      }
    }
  }

  const idStr = cleanSwIdValue(data.id);
  if (/^(?:notice|platform)-(\d+)$/i.test(idStr)) {
    return idStr.replace(/^(?:notice|platform)-/i, '');
  }
  const tagStr = cleanSwIdValue(data.tag);
  if (/^platform-(?:notice-)?(\d+)$/i.test(tagStr)) {
    return tagStr.replace(/^platform-(?:notice-)?/i, '');
  }
  return '';
}

function resolveSwNotificationActions(data = {}, fallbackUserRole = '') {
  const type = String(data.type || '').trim().toUpperCase();
  const itemType = String(data.itemType || '').trim().toUpperCase();
  const kind = String(data.kind || '').trim().toUpperCase();
  const tag = String(data.tag || '').trim().toLowerCase();
  const candidateUrls = [data.actionUrl, data.deepLinkUrl, data.url]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean);
  const combinedUrl = candidateUrls.join(' ').toLowerCase();

  const isLowStock =
    type === 'LOW_STOCK' ||
    type === 'STOCK' ||
    itemType === 'LOW_STOCK' ||
    data.lowStockOnly === 'true' ||
    data.lowStockOnly === true ||
    combinedUrl.includes('filter=low-stock') ||
    combinedUrl.includes('lowstockonly=true');

  const isReturn = type === 'RETURN' || itemType === 'RETURN';
  const isPurchase = type === 'PURCHASE' || itemType === 'PURCHASE';

  const hasAnnouncementHint =
    type === 'ANNOUNCEMENT' ||
    itemType === 'ANNOUNCEMENT' ||
    itemType === 'NOTICE' ||
    kind === 'NOTICE' ||
    combinedUrl.includes('/announcements/') ||
    tag.startsWith('platform-') ||
    (['INFO', 'WARNING', 'URGENT', 'SUCCESS'].includes(type) && !isLowStock && !isReturn && !isPurchase);

  const isInvoice =
    !isLowStock &&
    !isPurchase &&
    (type === 'INVOICE' ||
      type === 'SALE' ||
      type === 'RETURN' ||
      type === 'EXCHANGE' ||
      type === 'SALE_RETURN' ||
      type === 'SALE_EXCHANGE' ||
      itemType === 'INVOICE' ||
      itemType === 'SALE' ||
      itemType === 'RETURN' ||
      itemType === 'EXCHANGE' ||
      itemType === 'SALE_RETURN' ||
      itemType === 'SALE_EXCHANGE' ||
      combinedUrl.includes('/invoices/') ||
      combinedUrl.includes('viewinvoice=') ||
      combinedUrl.includes('invoice='));

  let primaryAction = null;

  if (isLowStock) {
    primaryAction = { action: 'view_stock', title: 'View Stock' };
  } else if (isPurchase) {
    primaryAction = { action: 'view_purchase', title: 'View Purchase' };
  } else if (isInvoice) {
    primaryAction = { action: 'view_invoice', title: 'View Invoice' };
  } else if (hasAnnouncementHint) {
    primaryAction = { action: 'read_more', title: 'Read More' };
  } else {
    const resolvedRole = String(data.userRole || data.role || fallbackUserRole || '')
      .trim()
      .toUpperCase();
    if (resolvedRole === 'OWNER' || resolvedRole === 'ADMIN') {
      primaryAction = { action: 'open_dashboard', title: 'Dashboard' };
    }
  }

  const openPosAction = { action: 'open_pos', title: 'Open POS' };
  return primaryAction ? [primaryAction, openPosAction] : [openPosAction];
}

function sanitizeSwActions(rawActions, data = {}, fallbackUserRole = '') {
  if (Array.isArray(rawActions) && rawActions.length > 0) {
    const filtered = rawActions
      .filter((a) => {
        const key = String((a && a.action) || '').trim().toLowerCase();
        return Boolean(key) && key !== 'dismiss' && key !== 'unsubscribe';
      })
      .slice(0, 2);
    if (filtered.length > 0) {
      return filtered;
    }
  }
  return resolveSwNotificationActions(data, fallbackUserRole);
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

let swShadeNotificationQueue = Promise.resolve();

async function showSingleShadeNotification(title, options = {}) {
  const run = async () => {
    if (!self.registration || typeof self.registration.showNotification !== 'function') {
      return;
    }

    const isAdminTarget = isAdminShadeTarget(options);
    const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
    const explicitTag = String(
      options.tag || (options.data && (options.data.tag || options.data.eventId || options.data.event_id)) || ''
    ).trim();
    const cleanTitle = String(title || 'SarbaazSoft POS Alert').slice(0, 120);
    const cleanBody = String(options.body || 'New store notification.').slice(0, 320);
    const deterministicFallbackTag = `${isAdminTarget ? 'admin' : 'pos'}-${hashPushKey(
      `${cleanTitle}|${cleanBody}|${(options.data && (options.data.url || options.data.deepLinkUrl)) || ''}`
    )}`;
    const incomingTag = explicitTag || deterministicFallbackTag;
    const incomingEventId = String((options.data && (options.data.eventId || options.data.event_id)) || incomingTag);
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

    if (typeof self.registration.getNotifications === 'function') {
      const existingAll = await self.registration.getNotifications().catch(() => []);
      for (const existing of existingAll) {
        if (!existing) continue;
        if (existing.tag === incomingTag) {
          alreadyHadTagInShade = true;
          existingMatchingCard = existing;
          break;
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
    }

    const icon = options.icon || defaultIcon;
    const badge =
      options.badge && !String(options.badge).includes('pwa-192x192')
        ? options.badge
        : NOTIFICATION_BADGE_ICON;
    const shouldBeSilent = !isFirstSwDeliveryForTag || alreadyHadTagInShade || Boolean(options.silent === true);
    const allowRequireInteraction = Boolean(options.requireInteraction === true);
    const mergedData = Object.assign({}, options.data || {}, {
      url: targetUrl,
      isAdmin: isAdminTarget ? 'true' : 'false',
      notificationTitle: cleanTitle,
      notificationBody: cleanBody,
      timestamp,
      eventId: incomingEventId,
      tag: incomingTag,
    });
    const resolvedActions = sanitizeSwActions(
      options.actions,
      mergedData,
      cachedAuthContext && cachedAuthContext.userRole
    );

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
      actions: resolvedActions,
      data: mergedData,
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
        throw showErr;
      }

      // Safari / WebKit PWAs may reject non-standard fields like vibrate or actions;
      // retry once with minimal standards-compliant notification options before failing.
      try {
        await self.registration.showNotification(cleanTitle, {
          body: cleanBody,
          icon,
          badge,
          tag: incomingTag,
          data: notificationOptions.data,
        });
        broadcastPushDedupeEvent(dedupeBroadcastPayload);
      } catch {
        throw showErr;
      }
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
  const rawBody =
    notification.body ||
    payloadData.body ||
    data.body ||
    data.message ||
    'New Point of Sale notification received.';
  const rawTargetUrl = payloadData.url || payloadData.deepLinkUrl || data.url || '/?tab=reports';
  const tag =
    payloadData.tag ||
    payloadData.eventId ||
    payloadData.event_id ||
    notification.tag ||
    data.tag ||
    data.eventId ||
    data.event_id ||
    data.messageId ||
    `pos-alert-${hashPushKey(`${title}|${rawBody}|${rawTargetUrl}`)}`;
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

  const mergedPushData = Object.assign({}, payloadData, {
    url: targetUrl,
    isAdmin: isAdminTarget ? 'true' : 'false',
    tag,
    notificationTitle: title,
    notificationBody: rawBody,
  });

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
    data: mergedPushData,
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
    actions: sanitizeSwActions(
      notification.actions,
      mergedPushData,
      cachedAuthContext && cachedAuthContext.userRole
    ),
  };

  event.waitUntil(
    showSingleShadeNotification(title, options).catch(async (err) => {
      const errName = String((err && err.name) || '').toLowerCase();
      if (errName === 'notallowederror' || errName === 'securityerror') {
        return;
      }
      const fallbackTag =
        tag || `pos-fallback-${hashPushKey(`${title}|${(options && options.body) || ''}|${targetUrl}`)}`;
      const fallbackEventId =
        (options.data && (options.data.eventId || options.data.event_id)) || fallbackTag;
      if (isWindowClaimedInSw(fallbackTag, fallbackEventId)) {
        return;
      }
      if (self.registration && typeof self.registration.getNotifications === 'function') {
        const active = await self.registration.getNotifications().catch(() => []);
        if (active.some((n) => n && n.tag === fallbackTag)) {
          return;
        }
      }
      const isFirstFallback = claimSwPushTag(fallbackTag);
      return self.registration
        .showNotification(title || 'SarbaazSoft Shoe POS Alert', {
          body: (options && options.body) || 'New store activity received.',
          icon: defaultIcon,
          badge: NOTIFICATION_BADGE_ICON,
          tag: fallbackTag,
          renotify: false,
          silent: !isFirstFallback,
        })
        .then(() => {
          broadcastPushDedupeEvent({
            type: 'SW_NOTIFICATION_SHOWN',
            tag: fallbackTag,
            eventId: fallbackEventId,
            dedupeKey: `id:${fallbackEventId}`,
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

  if (event.action === 'dismiss' || event.action === 'unsubscribe') {
    return;
  }

  const notifData = (event.notification && event.notification.data) || {};
  const isAdminTarget =
    notifData.isAdmin === true ||
    notifData.isAdmin === 'true' ||
    String(notifData.url || '').startsWith('/admin');
  const candidateUrls = [notifData.actionUrl, notifData.deepLinkUrl, notifData.url]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean);

  let targetUrl = sanitizePushTargetUrl(notifData.url || '/?tab=reports', isAdminTarget);
  if (event.action === 'view_invoice') {
    const invoiceId = extractSwInvoiceId(notifData, candidateUrls);
    const isRet = String(notifData.type || notifData.itemType || '').toUpperCase() === 'RETURN';
    targetUrl = invoiceId ? `/invoices/${encodeURIComponent(invoiceId)}` : isRet ? '/returns' : '/reports';
  } else if (event.action === 'view_purchase') {
    targetUrl = '/?tab=purchases';
  } else if (event.action === 'read_more') {
    const announcementId = extractSwAnnouncementId(notifData, candidateUrls);
    targetUrl = announcementId ? `/announcements/${encodeURIComponent(announcementId)}` : '/notifications';
  } else if (event.action === 'view_stock') {
    targetUrl = '/inventory?filter=low-stock';
  } else if (event.action === 'open_dashboard') {
    targetUrl = '/dashboard';
  } else if (event.action === 'open_pos') {
    targetUrl = '/pos';
  } else if (event.action === 'open_notifications') {
    targetUrl = isAdminTarget ? '/admin' : '/notifications';
  } else if (event.action === 'open_receipt') {
    targetUrl = sanitizePushTargetUrl(notifData.url || '/?tab=reports', isAdminTarget);
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      const targetResolved = new URL(
        targetUrl,
        self.location && self.location.origin ? self.location.origin : 'https://localhost'
      );

      // Prefer an already-open client matching the target route, else any controllable same-origin window client
      const exactMatchClient = clientList.find((c) => {
        try {
          const parsed = new URL(c.url || '', targetResolved.origin);
          return (
            parsed.origin === targetResolved.origin &&
            `${parsed.pathname}${parsed.search}` === `${targetResolved.pathname}${targetResolved.search}`
          );
        } catch {
          return false;
        }
      });

      const targetClient =
        exactMatchClient ||
        clientList.find((c) => {
          if (!('focus' in c)) return false;
          try {
            return !c.url || new URL(c.url).origin === targetResolved.origin;
          } catch {
            return true;
          }
        }) ||
        clientList.find((c) => 'focus' in c);

      if (targetClient && 'focus' in targetClient) {
        try {
          targetClient.postMessage({
            type: 'POS_DEEP_LINK_NOTIFICATION',
            action: event.action || '',
            payload: Object.assign({}, notifData, { url: targetUrl, deepLinkUrl: targetUrl }),
            targetUrl,
          });
        } catch {}

        try {
          if (
            targetClient.url &&
            typeof targetClient.navigate === 'function' &&
            targetClient !== exactMatchClient
          ) {
            await Promise.resolve(targetClient.navigate(targetUrl)).catch(() => {});
          }
        } catch {}

        return targetClient.focus();
      }

      // If no window is open, open the target app URL in a new window
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
let initFirebasePromise = null;

try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');
} catch (err) {
  // Graceful fallback if running offline or in network-isolated environments
}

function initFirebaseInWorker() {
  if (messagingInitialized || typeof firebase === 'undefined') {
    return Promise.resolve();
  }
  if (initFirebasePromise) {
    return initFirebasePromise;
  }

  initFirebasePromise = (async () => {
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
          const body =
            payload.notification?.body ||
            payload.data?.body ||
            payload.data?.message ||
            'New store transaction activity received.';
          const url = payload.data?.url || payload.data?.deepLinkUrl || '/?tab=reports';
          const isAdminTarget = String(url).startsWith('/admin') || payload.data?.isAdmin === 'true';
          const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
          const icon = payload.notification?.icon || payload.data?.icon || defaultIcon;
          const rawBadge = payload.data?.badge || payload.notification?.badge;
          const badge =
            rawBadge && !String(rawBadge).includes('pwa-192x192')
              ? rawBadge
              : NOTIFICATION_BADGE_ICON;
          const tag =
            payload.data?.tag ||
            payload.data?.eventId ||
            payload.data?.event_id ||
            payload.notification?.tag ||
            payload.messageId ||
            `pos-fcm-${hashPushKey(`${title}|${body}|${url}`)}`;
          const timestamp = resolveShadeTimestamp(payload.data?.timestamp);

          const fcmMergedData = Object.assign(
            {
              url,
              isAdmin: isAdminTarget ? 'true' : 'false',
              tag,
              notificationTitle: title,
              notificationBody: body,
            },
            payload.data || {}
          );

          const notificationOptions = {
            body,
            icon,
            badge,
            tag,
            timestamp,
            renotify: false,
            requireInteraction: false,
            vibrate: [200, 100, 200],
            data: fcmMergedData,
            actions: resolveSwNotificationActions(
              fcmMergedData,
              cachedAuthContext && cachedAuthContext.userRole
            ),
          };

          return showSingleShadeNotification(title, notificationOptions);
        });
        messagingInitialized = true;
      }
    } catch {
      // Non-fatal if config not yet saved or offline
    } finally {
      initFirebasePromise = null;
    }
  })();

  return initFirebasePromise;
}

initFirebaseInWorker().catch(() => {});

// -------------------------------------------------------------------------
// 5. Offline Background Sync for Offline Sales Transactions (IndexedDB)
// -------------------------------------------------------------------------
let cachedAuthContext = {
  token: null,
  tenantId: null,
  userRole: null,
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
      userRole: data.userRole ? String(data.userRole).toUpperCase() : cachedAuthContext.userRole,
    };
    initFirebaseInWorker().catch(() => {});
    return;
  }

  if (data.type === 'INIT_FIREBASE_MESSAGING') {
    initFirebaseInWorker().catch(() => {});
    return;
  }

  if (data.type === 'CLEAR_AUTH_CONTEXT') {
    cachedAuthContext = {
      token: null,
      tenantId: null,
      userRole: null,
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
    event.waitUntil(showSingleShadeNotification(data.title, data.options || {}).catch(() => {}));
  }
});
