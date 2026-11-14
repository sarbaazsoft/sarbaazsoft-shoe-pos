const DEFAULT_TTL_MS = 10_000;
const recentChannelClaims = new Map<string, number>();

function pruneExpiredClaims(now: number) {
  if (recentChannelClaims.size < 100) return;
  for (const [entryKey, expiresAt] of recentChannelClaims.entries()) {
    if (expiresAt <= now) {
      recentChannelClaims.delete(entryKey);
    }
  }
}

export type NotificationDeliveryChannel =
  | 'sse'
  | 'audio'
  | 'os_notification'
  | 'toast';

/**
 * Derives a stable deduplication key for an incoming notification payload across
 * SSE (`pos_action` / `platform_announcement`), FCM foreground (`onMessage`),
 * and local fallback notifications.
 */
export function getNotificationDedupeKey(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return `anon:${String(payload ?? '')}`;
  }

  const explicitId =
    payload.eventId ||
    payload.tag ||
    payload.data?.eventId ||
    payload.data?.tag ||
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

/**
 * Attempts to claim a delivery channel for a given notification key within `ttlMs`.
 * Returns `true` only the first time `(dedupeKey, channel)` is claimed so duplicate
 * listeners or cross-channel deliveries (SSE + FCM) do not fire twice.
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

  recentChannelClaims.set(compositeKey, now + ttlMs);
  return true;
}

export function resetNotificationDedupeCache(): void {
  recentChannelClaims.clear();
}
