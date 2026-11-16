const DEFAULT_TTL_MS = 120_000;
export const PUSH_DEDUPE_CHANNEL_NAME = 'pos_push_dedupe_channel';
const STORAGE_CHANNEL_CLAIMS_KEY = 'pos_notif_channel_claims_v1';
const MAX_STORED_CLAIMS = 150;

const recentChannelClaims = new Map<string, number>();
let sharedDedupeBroadcastChannel: BroadcastChannel | null = null;
let listenersInitialized = false;

function pruneExpiredClaims(now: number) {
  if (recentChannelClaims.size < 100) return;
  for (const [entryKey, expiresAt] of recentChannelClaims.entries()) {
    if (expiresAt <= now) {
      recentChannelClaims.delete(entryKey);
    }
  }
}

function readStoredClaims(now: number): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_CHANNEL_CLAIMS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const active: Record<string, number> = {};
    for (const [key, exp] of Object.entries(parsed)) {
      if (typeof exp === 'number' && exp > now) {
        active[key] = exp;
      }
    }
    return active;
  } catch {
    return {};
  }
}

function writeStoredClaims(claims: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const entries = Object.entries(claims)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_STORED_CLAIMS);
    localStorage.setItem(STORAGE_CHANNEL_CLAIMS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

export type NotificationDeliveryChannel =
  | 'sse'
  | 'audio'
  | 'os_notification'
  | 'toast';

/**
 * Derives a stable deduplication key for an incoming notification payload across
 * SSE (`pos_action` / `platform_announcement`), FCM foreground (`onMessage`),
 * Service Worker push, and local fallback notifications.
 */
export function getNotificationDedupeKey(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return `anon:${String(payload ?? '')}`;
  }

  const explicitId =
    payload.eventId ||
    payload.event_id ||
    payload.tag ||
    payload.data?.eventId ||
    payload.data?.event_id ||
    payload.data?.tag ||
    payload.notification?.tag ||
    payload.messageId;
  if (explicitId) {
    return `id:${String(explicitId)}`;
  }

  const type = String(payload.type || payload.data?.type || 'INFO').toUpperCase();
  const invoice = payload.invoiceNumber || payload.data?.invoiceNumber || '';
  const returnNum = payload.returnNumber || payload.data?.returnNumber || '';
  if (invoice || returnNum) {
    return `tx:${type}:${invoice}:${returnNum}`;
  }

  const title = String(payload.title || payload.notification?.title || payload.data?.title || '').trim();
  const body = String(
    payload.message || payload.body || payload.notification?.body || payload.data?.body || ''
  ).trim();
  return `msg:${type}:${title}:${body}`;
}

export function isNotificationChannelClaimed(
  dedupeKey: string,
  channel: NotificationDeliveryChannel
): boolean {
  const now = Date.now();
  pruneExpiredClaims(now);
  const compositeKey = `${channel}:${dedupeKey}`;
  const existingExpiry = recentChannelClaims.get(compositeKey);
  if (existingExpiry && existingExpiry > now) {
    return true;
  }
  const stored = readStoredClaims(now);
  const storedExpiry = stored[compositeKey];
  if (storedExpiry && storedExpiry > now) {
    recentChannelClaims.set(compositeKey, storedExpiry);
    return true;
  }
  return false;
}

export function markNotificationChannelClaimed(
  dedupeKey: string,
  channel: NotificationDeliveryChannel,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  const now = Date.now();
  pruneExpiredClaims(now);
  const compositeKey = `${channel}:${dedupeKey}`;
  const expiresAt = Math.max(recentChannelClaims.get(compositeKey) || 0, now + ttlMs);
  recentChannelClaims.set(compositeKey, expiresAt);
  const stored = readStoredClaims(now);
  if (!stored[compositeKey] || expiresAt > stored[compositeKey]) {
    stored[compositeKey] = expiresAt;
    writeStoredClaims(stored);
  }
}

export function recordSwNotificationShown(msg: {
  dedupeKey?: string;
  eventId?: string;
  tag?: string;
  ttlMs?: number;
}): void {
  if (!msg || typeof msg !== 'object') return;
  const ttl = typeof msg.ttlMs === 'number' && msg.ttlMs > 0 ? msg.ttlMs : DEFAULT_TTL_MS;
  const keys = new Set<string>();
  if (msg.dedupeKey) keys.add(String(msg.dedupeKey));
  if (msg.eventId) keys.add(`id:${String(msg.eventId)}`);
  if (msg.tag) keys.add(`id:${String(msg.tag)}`);

  for (const key of keys) {
    markNotificationChannelClaimed(key, 'os_notification', ttl);
    markNotificationChannelClaimed(key, 'audio', ttl);
  }
}

function broadcastChannelClaim(compositeKey: string, expiresAt: number): void {
  const message = {
    type: 'CLAIM_CHANNEL',
    compositeKey,
    expiresAt,
  };
  try {
    if (sharedDedupeBroadcastChannel) {
      sharedDedupeBroadcastChannel.postMessage(message);
    }
  } catch {}
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(message);
    }
  } catch {}
}

function handleCrossContextDedupeMessage(data: any): void {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SW_NOTIFICATION_SHOWN') {
    recordSwNotificationShown(data);
    return;
  }

  if (data.type === 'CLAIM_CHANNEL' && typeof data.compositeKey === 'string' && typeof data.expiresAt === 'number') {
    if (data.expiresAt > Date.now()) {
      const existing = recentChannelClaims.get(data.compositeKey) || 0;
      if (data.expiresAt > existing) {
        recentChannelClaims.set(data.compositeKey, data.expiresAt);
      }
    }
  }
}

export function initNotificationDedupeSync(): void {
  if (typeof window === 'undefined' || listenersInitialized) return;
  listenersInitialized = true;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      sharedDedupeBroadcastChannel = new BroadcastChannel(PUSH_DEDUPE_CHANNEL_NAME);
      sharedDedupeBroadcastChannel.addEventListener('message', (event: MessageEvent) => {
        handleCrossContextDedupeMessage(event.data);
      });
    } catch {
      sharedDedupeBroadcastChannel = null;
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        handleCrossContextDedupeMessage(event.data);
      });
    } catch {}
  }
}

initNotificationDedupeSync();

/**
 * Attempts to claim a delivery channel for a given notification key within `ttlMs`.
 * Returns `true` only the first time `(dedupeKey, channel)` is claimed so duplicate
 * listeners or cross-channel deliveries (SSE + FCM + SW) do not fire twice.
 */
export function claimNotificationChannel(
  dedupeKey: string,
  channel: NotificationDeliveryChannel,
  ttlMs: number = DEFAULT_TTL_MS
): boolean {
  const now = Date.now();
  pruneExpiredClaims(now);

  const compositeKey = `${channel}:${dedupeKey}`;
  const existingExpiry = recentChannelClaims.get(compositeKey);
  if (existingExpiry && existingExpiry > now) {
    return false;
  }

  const stored = readStoredClaims(now);
  const storedExpiry = stored[compositeKey];
  if (storedExpiry && storedExpiry > now) {
    recentChannelClaims.set(compositeKey, storedExpiry);
    return false;
  }

  const expiresAt = now + ttlMs;
  recentChannelClaims.set(compositeKey, expiresAt);
  stored[compositeKey] = expiresAt;
  writeStoredClaims(stored);

  if (channel === 'os_notification' || channel === 'audio') {
    broadcastChannelClaim(compositeKey, expiresAt);
  }

  return true;
}

export function resetNotificationDedupeCache(): void {
  recentChannelClaims.clear();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_CHANNEL_CLAIMS_KEY);
    } catch {}
  }
}
