import { initializeApp, cert, getApps, deleteApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Response } from 'express';
import { pgClient } from '../db/index.ts';
import {
  ensureFcmTokensSchema,
  ensurePlatformNotificationsSchema,
  ensureSaasControlPlane,
  normalizeSubscriptionPlan,
} from '../db/schemaInit.ts';
import { getAppSetting, registerSettingsUpdateListener } from './services/appSettingsService.ts';
import {
  dispatchPosEmailAlert,
  dispatchStoreNoticeEmailAlert,
  dispatchSuperAdminEmailAlert,
} from './services/emailAlertService.ts';
import { getApplicationBaseUrl } from './services/welcomeService.ts';
import { getTenantNotificationPreferences } from './services/notificationPreferencesService.ts';
import {
  mapPlatformAnnouncementToEventKey,
  mapPosActionTypeToEventKey,
  resolveStoreChannelDelivery,
  type StoreNotificationPreferences,
} from '../utils/notificationPreferences.ts';
import { normalizeVapidPublicKey } from '../utils/vapid.ts';
import {
  isOwnerRole,
  hasFreshOwnerHeartbeat,
  isSuperAdminRole,
  hasFreshSuperAdminHeartbeat,
  registerSuperAdminSseChecker,
} from './services/ownerPresenceService.ts';

export { normalizeVapidPublicKey };

// ============================================================================
// FIREBASE ADMIN SDK SINGLETON & DYNAMIC INITIALIZATION
// ============================================================================

let firebaseApp: App | null = null;
let lastCredentialSignature = '';

/**
 * Initializes or retrieves the Firebase Admin App instance.
 * Reads FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY exclusively from app_settings.
 */
export async function getFirebaseAdmin(): Promise<App | null> {
  const [rawProjectId, rawClientEmail, rawPrivateKey] = await Promise.all([
    getAppSetting('FCM_PROJECT_ID', ''),
    getAppSetting('FCM_CLIENT_EMAIL', ''),
    getAppSetting('FCM_PRIVATE_KEY', ''),
  ]);
  const projectId = (rawProjectId || '').trim();
  const clientEmail = (rawClientEmail || '').trim();
  let privateKey = (rawPrivateKey || '').trim();

  if (privateKey) {
    // Format PEM newlines properly whether stored as literal \n or escaped \\n
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  const sig = `${projectId}:${clientEmail}:${privateKey.slice(0, 32)}`;
  if (firebaseApp && lastCredentialSignature === sig) {
    return firebaseApp;
  }

  try {
    const existingApps = getApps();
    if (existingApps.length > 0) {
      for (const app of existingApps) {
        if (app) {
          await deleteApp(app).catch(() => {});
        }
      }
    }

    firebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
    lastCredentialSignature = sig;
    console.log(`🔥 [FCM] Firebase Admin SDK initialized successfully for project: ${projectId}`);
    return firebaseApp;
  } catch (err: any) {
    console.warn('⚠️ [FCM] Could not initialize Firebase Admin SDK:', err?.message || err);
    return null;
  }
}

// Re-configure whenever FCM credentials are saved dynamically via the settings API
registerSettingsUpdateListener((key) => {
  if (['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'].includes(key)) {
    void getFirebaseAdmin().catch(() => {});
  }
});

// Asynchronously hydrate once PostgreSQL app_settings table is reachable
void getFirebaseAdmin().catch(() => {});

// ============================================================================
// ACTIVE SSE BROWSER CLIENTS (REAL-TIME DASHBOARD SYNC)
// ============================================================================

export interface SseClientRecord {
  res: Response;
  tenantId: number;
  userId: number;
  role: string; // 'SUPERADMIN' | 'ADMIN' | 'OWNER' | 'CASHIER'
  sessionId: string;
  authenticated: boolean;
}

const sseClients = new Set<SseClientRecord>();

function sanitizeSseSessionId(sessionId?: string | null): string {
  const clean = String(sessionId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '');
  return clean ? clean.slice(0, 64) : 'default';
}

export function registerSseClient(
  tenantId: number,
  userId: number,
  role: string,
  res: Response,
  options?: { sessionId?: string; authenticated?: boolean }
): () => void {
  const cleanTenantId = Number(tenantId) || 0;
  const cleanUserId = Number(userId) || 0;
  const cleanRole = String(role || (cleanTenantId === 0 ? 'SUPERADMIN' : 'CASHIER')).trim().toUpperCase();
  const cleanSessionId = sanitizeSseSessionId(options?.sessionId);
  const authenticated = options?.authenticated !== false;

  const client: SseClientRecord = {
    res,
    tenantId: cleanTenantId,
    userId: cleanUserId,
    role: cleanRole,
    sessionId: cleanSessionId,
    authenticated,
  };
  sseClients.add(client);

  return () => {
    sseClients.delete(client);
  };
}

export function hasActiveAuthenticatedOwnerSse(tenantId: number): boolean {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return false;

  for (const client of sseClients) {
    if (
      client.tenantId === cleanTenantId &&
      client.authenticated !== false &&
      isOwnerRole(client.role) &&
      client.userId > 0 &&
      !client.res?.writableEnded &&
      !client.res?.destroyed
    ) {
      return true;
    }
  }
  return false;
}

export function disconnectOwnerSseClients(
  tenantId: number,
  userId?: number,
  sessionId?: string
): number {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return 0;

  const cleanUserId = Number(userId);
  const hasUserFilter = Number.isInteger(cleanUserId) && cleanUserId > 0;
  const hasSessionFilter = Boolean(sessionId && String(sessionId).trim());
  const cleanSessionId = hasSessionFilter ? sanitizeSseSessionId(sessionId) : '';

  let closed = 0;
  for (const client of Array.from(sseClients)) {
    if (client.tenantId !== cleanTenantId || !isOwnerRole(client.role)) {
      continue;
    }
    if (hasUserFilter && client.userId !== cleanUserId) {
      continue;
    }
    if (hasSessionFilter && client.sessionId !== cleanSessionId) {
      continue;
    }
    sseClients.delete(client);
    try {
      client.res?.end?.();
    } catch {}
    closed++;
  }
  return closed;
}

export function isStoreOwnerOnline(tenantId: number, now?: number): boolean {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return false;
  return hasActiveAuthenticatedOwnerSse(cleanTenantId) || hasFreshOwnerHeartbeat(cleanTenantId, now);
}

export function hasActiveAuthenticatedSuperAdminSse(): boolean {
  for (const client of sseClients) {
    if (
      client.authenticated !== false &&
      isSuperAdminRole(client.role) &&
      client.userId > 0 &&
      !client.res?.writableEnded &&
      !client.res?.destroyed
    ) {
      return true;
    }
  }
  return false;
}

export function disconnectSuperAdminSseClients(userId?: number, sessionId?: string): number {
  const cleanUserId = Number(userId);
  const hasUserFilter = Number.isInteger(cleanUserId) && cleanUserId > 0;
  const hasSessionFilter = Boolean(sessionId && String(sessionId).trim());
  const cleanSessionId = hasSessionFilter ? sanitizeSseSessionId(sessionId) : '';

  let closed = 0;
  for (const client of Array.from(sseClients)) {
    if (!isSuperAdminRole(client.role)) {
      continue;
    }
    if (hasUserFilter && client.userId !== cleanUserId) {
      continue;
    }
    if (hasSessionFilter && client.sessionId !== cleanSessionId) {
      continue;
    }
    sseClients.delete(client);
    try {
      client.res?.end?.();
    } catch {}
    closed++;
  }
  return closed;
}

export function isSuperAdminOnline(now?: number): boolean {
  return hasActiveAuthenticatedSuperAdminSse() || hasFreshSuperAdminHeartbeat(now);
}

registerSuperAdminSseChecker(() => hasActiveAuthenticatedSuperAdminSse());

// ============================================================================
// FCM DEVICE TOKEN PERSISTENCE
// ============================================================================

export async function saveFcmToken(
  tenantId: number,
  userId: number,
  userRole: string,
  token: string,
  userAgent: string = '',
  deviceName: string = '',
  previousToken: string = ''
): Promise<boolean> {
  try {
    await ensureFcmTokensSchema();
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return false;

    const cleanRole = String(userRole || (tenantId === 0 ? 'SUPERADMIN' : 'ADMIN')).trim().toUpperCase();
    const cleanTenantId = Number(tenantId) || 1;
    const cleanUserId = Number(userId) || 0;
    const cleanPreviousToken = String(previousToken || '').trim();

    if (cleanPreviousToken && cleanPreviousToken !== cleanToken) {
      await pgClient
        .query('DELETE FROM public.fcm_tokens WHERE token = $1', [cleanPreviousToken])
        .catch(() => {});
    }

    const deviceIdMatch = String(deviceName || '').match(/\[id:([a-zA-Z0-9_-]{8,40})\]/);
    if (deviceIdMatch) {
      await pgClient
        .query(
          `DELETE FROM public.fcm_tokens
           WHERE tenant_id = $1
             AND user_id = $2
             AND UPPER(user_role) = $3
             AND device_name LIKE $4
             AND token != $5`,
          [cleanTenantId, cleanUserId, cleanRole, `%[id:${deviceIdMatch[1]}]%`, cleanToken]
        )
        .catch(() => {});
    }

    await pgClient.query(
      `INSERT INTO public.fcm_tokens (
        token, tenant_id, user_id, user_role, user_agent, device_name, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (token) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        user_id = EXCLUDED.user_id,
        user_role = EXCLUDED.user_role,
        user_agent = EXCLUDED.user_agent,
        device_name = EXCLUDED.device_name,
        updated_at = NOW()`,
      [cleanToken, cleanTenantId, cleanUserId, cleanRole, userAgent, deviceName]
    );

    return true;
  } catch (err) {
    console.error('Failed to save FCM token:', err);
    return false;
  }
}

export async function removeFcmToken(token: string): Promise<boolean> {
  try {
    await ensureFcmTokensSchema();
    await pgClient.query('DELETE FROM public.fcm_tokens WHERE token = $1', [String(token).trim()]);
    return true;
  } catch (err) {
    console.error('Failed to remove FCM token:', err);
    return false;
  }
}

export async function getFcmStats(): Promise<{
  configured: boolean;
  projectId: string;
  totalTokens: number;
  tokensByRole: Record<string, number>;
}> {
  try {
    await ensureFcmTokensSchema();
    const app = await getFirebaseAdmin();
    const projectId = (await getAppSetting('FCM_PROJECT_ID', '')).trim();

    const countRes = await pgClient.query<{ count: string; user_role: string }>(`
      SELECT user_role, COUNT(*) as count 
      FROM public.fcm_tokens 
      GROUP BY user_role
    `);

    const tokensByRole: Record<string, number> = {};
    let totalTokens = 0;
    for (const row of countRes.rows) {
      const c = parseInt(row.count, 10) || 0;
      tokensByRole[row.user_role] = c;
      totalTokens += c;
    }

    return {
      configured: Boolean(app),
      projectId,
      totalTokens,
      tokensByRole,
    };
  } catch {
    return {
      configured: false,
      projectId: '',
      totalTokens: 0,
      tokensByRole: {},
    };
  }
}


// ============================================================================
// FCM MULTICAST DISPATCH ENGINE
// ============================================================================

export const DEFAULT_NOTIFICATION_ICON = '/pwa-192x192.png';
export const ADMIN_NOTIFICATION_ICON = '/admin/pwa-192x192.png';
export const NOTIFICATION_BADGE_ICON = '/icons/badge-favicon.png';

export interface FcmDispatchResult {
  success: boolean;
  sentCount: number;
  failureCount: number;
  error?: string;
}

export interface FcmPushPayload {
  title: string;
  body: string;
  deepLinkUrl?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, string>;
}

const FCM_MULTICAST_BATCH_SIZE = 500;
const RECENT_FCM_DISPATCH_TTL_MS = 120000;
const SERVER_EVENT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const recentFcmTokenTagDispatches = new Map<string, number>();
const claimedServerNotificationEvents = new Map<string, number>();
const inFlightTestPushByEventId = new Map<string, Promise<TestFcmPushResult>>();
const completedTestPushByEventId = new Map<string, { result: TestFcmPushResult; expiresAt: number }>();

export function resetServerNotificationDedupeCache(): void {
  recentFcmTokenTagDispatches.clear();
  claimedServerNotificationEvents.clear();
  inFlightTestPushByEventId.clear();
  completedTestPushByEventId.clear();
}

export function claimServerNotificationEvent(eventId: string): boolean {
  const cleanId = String(eventId || '').trim();
  if (!cleanId) return true;
  const now = Date.now();
  if (claimedServerNotificationEvents.size > 1000) {
    for (const [k, exp] of claimedServerNotificationEvents.entries()) {
      if (exp <= now) claimedServerNotificationEvents.delete(k);
    }
  }
  const existingExp = claimedServerNotificationEvents.get(cleanId);
  if (existingExp && existingExp > now) {
    return false;
  }
  claimedServerNotificationEvents.set(cleanId, now + SERVER_EVENT_DEDUPE_TTL_MS);
  return true;
}

function claimServerTokenTagDispatch(token: string, tag: string): boolean {
  if (!tag) return true;
  const now = Date.now();
  if (recentFcmTokenTagDispatches.size > 500) {
    for (const [k, exp] of recentFcmTokenTagDispatches.entries()) {
      if (exp <= now) recentFcmTokenTagDispatches.delete(k);
    }
  }
  const key = `${tag}::${token}`;
  const existingExp = recentFcmTokenTagDispatches.get(key);
  if (existingExp && existingExp > now) {
    return false;
  }
  recentFcmTokenTagDispatches.set(key, now + RECENT_FCM_DISPATCH_TTL_MS);
  return true;
}

function resolveHttpsWebpushLink(linkUrl: string): string | undefined {
  const baseUrl = getApplicationBaseUrl();
  if (!baseUrl || !baseUrl.startsWith('https://')) {
    return undefined;
  }
  try {
    const resolved = new URL(linkUrl || '/', baseUrl);
    return resolved.protocol === 'https:' ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Truncates text cleanly by Unicode code points (never splitting UTF-16 surrogate pairs
 * such as multi-byte emojis like 🔔, ⏳, ✅, ⚠️, ❌).
 */
export function truncateUtf8Safe(value: string | undefined | null, maxCodePoints: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || maxCodePoints <= 0) return '';
  const codePoints = Array.from(normalized);
  return codePoints.length > maxCodePoints ? codePoints.slice(0, maxCodePoints).join('') : normalized;
}

export function buildFcmNotificationConfig(payload: FcmPushPayload) {
  const linkUrl = payload.deepLinkUrl || '/';
  const isAdminTarget = linkUrl.startsWith('/admin') || payload.data?.isAdmin === 'true';
  const icon = payload.icon || (isAdminTarget ? ADMIN_NOTIFICATION_ICON : DEFAULT_NOTIFICATION_ICON);
  const badge = payload.badge || NOTIFICATION_BADGE_ICON;
  const tag = payload.tag || `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cleanWebTitle = truncateUtf8Safe(payload.title || 'SarbaazSoft Shoe POS Alert', 120);
  const cleanWebBody = truncateUtf8Safe(payload.body || 'New store notification received.', 320);

  const rawTimestamp = payload.data?.timestamp;
  const numericTimestamp = rawTimestamp ? Number(rawTimestamp) || Date.parse(rawTimestamp) || Date.now() : Date.now();
  const httpsLinkUrl = resolveHttpsWebpushLink(linkUrl);

  const stringData: Record<string, string> = {
    url: linkUrl,
    title: payload.title,
    body: payload.body,
    icon,
    badge,
    tag,
    isAdmin: isAdminTarget ? 'true' : 'false',
    timestamp: String(numericTimestamp),
  };
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      stringData[k] = String(v ?? '');
    }
  }

  return {
    linkUrl,
    httpsLinkUrl,
    icon,
    badge,
    tag,
    stringData,
    androidNotification: {
      title: payload.title,
      body: payload.body,
      channelId: 'pos_alerts',
      color: '#9333EA',
      priority: 'max' as const,
      defaultSound: true,
      defaultVibrateTimings: true,
      visibility: 'public' as const,
    },
    webpushHeaders: {
      TTL: '86400',
      Urgency: 'normal',
    },
    webpushNotification: {
      title: cleanWebTitle,
      body: cleanWebBody,
      icon,
      badge,
      tag,
      timestamp: numericTimestamp,
      renotify: false,
      requireInteraction: false,
      vibrate: [200, 100, 200],
    },
  };
}

export async function sendFcmPushToTokens(
  tokens: string[],
  payload: FcmPushPayload
): Promise<FcmDispatchResult> {
  const app = await getFirebaseAdmin();
  if (!app) {
    return {
      success: false,
      sentCount: 0,
      failureCount: tokens.length,
      error: 'Firebase Admin SDK credentials (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY) are not configured in SuperAdmin settings.',
    };
  }

  const config = buildFcmNotificationConfig(payload);
  const dedupedTokens = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
  const uniqueTokens = payload.tag
    ? dedupedTokens.filter((t) => claimServerTokenTagDispatch(t, payload.tag!))
    : dedupedTokens;

  if (uniqueTokens.length === 0) {
    return {
      success: true,
      sentCount: 0,
      failureCount: 0,
    };
  }

  try {
    const messaging = getMessaging(app);
    let totalSent = 0;
    let totalFailure = 0;
    const tokensToRemove: string[] = [];

    for (let offset = 0; offset < uniqueTokens.length; offset += FCM_MULTICAST_BATCH_SIZE) {
      const batchTokens = uniqueTokens.slice(offset, offset + FCM_MULTICAST_BATCH_SIZE);
      const response = await messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: config.stringData,
        android: {
          priority: 'high',
          notification: config.androidNotification,
        },
        webpush: {
          headers: config.webpushHeaders,
          notification: config.webpushNotification,
          ...(config.httpsLinkUrl
            ? {
                fcmOptions: {
                  link: config.httpsLinkUrl,
                },
              }
            : {}),
        },
      });

      totalSent += response.successCount;
      totalFailure += response.failureCount;

      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success && resp.error) {
          const errCode = resp.error.code;
          if (
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/registration-token-not-registered'
          ) {
            tokensToRemove.push(batchTokens[idx]);
          }
        }
      });
    }

    if (tokensToRemove.length > 0) {
      await pgClient
        .query('DELETE FROM public.fcm_tokens WHERE token = ANY($1::text[])', [tokensToRemove])
        .catch(() => {});
    }

    return {
      success: totalSent > 0 || totalFailure === 0,
      sentCount: totalSent,
      failureCount: totalFailure,
    };
  } catch (err: any) {
    console.error('[FCM] Error dispatching push notification:', err);
    return {
      success: false,
      sentCount: 0,
      failureCount: uniqueTokens.length,
      error: err?.message || 'Failed to dispatch FCM push notification',
    };
  }
}

// ============================================================================
// POS ACTION NOTIFICATION (SALES, RETURNS, EXCHANGES, LOW STOCK)
// ============================================================================

export interface PosActionNotification {
  eventId?: string;
  type: 'SALE' | 'RETURN' | 'EXCHANGE' | 'SALE_RETURN' | 'SALE_EXCHANGE' | 'STOCK' | 'PURCHASE';
  title: string;
  message: string;
  invoiceNumber: string;
  orderId?: number;
  saleId?: number;
  returnNumber?: string;
  returnId?: number;
  purchaseNumber?: string;
  purchaseId?: number;
  exchangeNumber?: string;
  totalAmount?: number;
  refundAmount?: number;
  netDifference?: number;
  totalPairs?: number;
  returnedPairs?: number;
  paymentMethod?: string;
  customerName?: string;
  supplierName?: string;
  cashierName?: string;
  cashierId?: number;
  itemsSummary?: string;
  exchangeDetails?: {
    oldItems: string;
    newItems: string;
    netDifference: number;
  };
  deepLinkUrl: string;
  actionTab?: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp: string;
  triggeredBy?: string;
  targetRole?: 'ALL' | 'ADMIN' | 'CASHIER';
  targetRoles?: ('ADMIN' | 'CASHIER')[];
}

function cleanPushText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'n/a') return null;
  return trimmed;
}

function parsePairsFromText(text?: string | null): number | null {
  if (!text) return null;
  const str = String(text);
  const netMatch = str.match(/Net Sold:\s*(\d+(?:\.\d+)?)\s*pairs?/i);
  if (netMatch) return Number(netMatch[1]);
  const totalSoldMatch = str.match(/Total Sold:\s*(\d+(?:\.\d+)?)\s*pairs?/i);
  if (totalSoldMatch) return Number(totalSoldMatch[1]);
  const pairsMatch = str.match(/\b(\d+(?:\.\d+)?)\s*pairs?\b/i);
  if (pairsMatch) return Number(pairsMatch[1]);
  const itemMatches = Array.from(str.matchAll(/(\d+(?:\.\d+)?)\s*x\s+/gi));
  if (itemMatches.length > 0) {
    return itemMatches.reduce((acc, m) => acc + (Number(m[1]) || 0), 0);
  }
  return null;
}

export function enrichPosPushNotificationPayload(payload: PosActionNotification): PosActionNotification & {
  resolvedCustomerName: string;
  resolvedCashierName: string;
  resolvedTotalPairs: number | undefined;
  resolvedReturnedPairs: number | undefined;
} {
  const actionType = String(payload.type || '').toUpperCase();
  const isTransactionAlert = actionType !== 'STOCK';
  const resolvedCustomerName =
    cleanPushText(payload.customerName) ||
    cleanPushText(payload.supplierName) ||
    'Walk-in Customer';
  const resolvedCashierName =
    cleanPushText(payload.cashierName) ||
    cleanPushText(payload.triggeredBy) ||
    'Counter Staff';

  let resolvedTotalPairs: number | undefined =
    typeof payload.totalPairs === 'number' && Number.isFinite(payload.totalPairs) && payload.totalPairs >= 0
      ? payload.totalPairs
      : undefined;

  if (resolvedTotalPairs === undefined) {
    const parsedFromMessage = parsePairsFromText(payload.message);
    const parsedFromSummary = parsePairsFromText(payload.itemsSummary);
    const parsedFromNew = parsePairsFromText(payload.exchangeDetails?.newItems);
    const parsedFromOld = parsePairsFromText(payload.exchangeDetails?.oldItems);
    const candidate = parsedFromMessage ?? parsedFromSummary ?? parsedFromNew ?? parsedFromOld;
    if (candidate !== null && Number.isFinite(candidate) && candidate >= 0) {
      resolvedTotalPairs = candidate;
    }
  }

  let resolvedReturnedPairs: number | undefined =
    typeof payload.returnedPairs === 'number' && Number.isFinite(payload.returnedPairs) && payload.returnedPairs >= 0
      ? payload.returnedPairs
      : undefined;

  if (resolvedReturnedPairs === undefined && payload.message) {
    const retMatch = String(payload.message).match(/Returned:\s*(\d+(?:\.\d+)?)\s*pairs?/i);
    if (retMatch) {
      resolvedReturnedPairs = Number(retMatch[1]);
    }
  }

  let message = String(payload.message || '').trim();
  if (isTransactionAlert) {
    const hasPairsInMessage = /\b\d+(?:\.\d+)?\s*(?:pairs?|cartons?|boxes?|dozens?)\b/i.test(message);
    const hasCustomerInMessage =
      message.toLowerCase().includes(resolvedCustomerName.toLowerCase()) ||
      /\b(?:sold to|customer|returned by|exchanged by|purchased from)\s*:?\s*\S+/i.test(message);
    const hasCashierInMessage =
      message.toLowerCase().includes(resolvedCashierName.toLowerCase()) ||
      /\b(?:processed by|cashier)\s*:/i.test(message);

    const missingLines: string[] = [];
    if (!hasPairsInMessage) {
      const displayPairs = resolvedTotalPairs ?? 0;
      missingLines.push(`Total Pairs: ${displayPairs} ${displayPairs === 1 ? 'pair' : 'pairs'}`);
    }
    if (!hasCustomerInMessage) {
      missingLines.push(`Customer: ${resolvedCustomerName}`);
    }
    if (!hasCashierInMessage) {
      missingLines.push(`Processed by: ${resolvedCashierName}`);
    }
    if (missingLines.length > 0) {
      message = message ? `${message}\n${missingLines.join('\n')}` : missingLines.join('\n');
    }
  }

  return {
    ...payload,
    message,
    customerName: resolvedCustomerName,
    cashierName: resolvedCashierName,
    totalPairs: resolvedTotalPairs,
    returnedPairs: resolvedReturnedPairs,
    resolvedCustomerName,
    resolvedCashierName,
    resolvedTotalPairs,
    resolvedReturnedPairs,
  };
}

export interface BroadcastSseOptions {
  skipOwnerClients?: boolean;
}

export function broadcastSsePosAction(
  tenantId: number,
  payload: PosActionNotification & { tag?: string },
  options?: BroadcastSseOptions
): number {
  const actionType = String(payload.type || '').toUpperCase();
  if (!['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE', 'STOCK'].includes(actionType)) {
    return 0;
  }
  const cleanTenantId = Number(tenantId) || 1;
  const allowedRoles = payload.targetRoles || ['ADMIN', 'CASHIER'];
  const sseMessage = `event: pos_action\ndata: ${JSON.stringify(payload)}\n\n`;
  let delivered = 0;

  for (const client of sseClients) {
    if (
      client.tenantId === cleanTenantId &&
      client.role !== 'SUPERADMIN' &&
      (allowedRoles.includes(client.role as any) ||
        (isOwnerRole(client.role) && allowedRoles.includes('ADMIN')))
    ) {
      if (isOwnerRole(client.role) && client.authenticated === false) {
        continue;
      }
      if (options?.skipOwnerClients && isOwnerRole(client.role)) {
        continue;
      }
      if (client.role === 'CASHIER' && payload.cashierId && client.userId !== payload.cashierId) {
        continue;
      }
      try {
        client.res.write(sseMessage);
        delivered++;
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return delivered;
}

export interface NotifyPosActionDeps {
  isOwnerOnlineFn?: (tenantId: number) => boolean;
  dispatchPosEmailAlertFn?: typeof dispatchPosEmailAlert;
  sendFcmPushToTokensFn?: typeof sendFcmPushToTokens;
  fetchFcmTokensFn?: (
    tenantId: number,
    allowedRoles: string[]
  ) => Promise<Array<{ token: string; user_role: string; user_id: number }>>;
  getPreferencesFn?: (tenantId: number) => Promise<StoreNotificationPreferences>;
  isFirebaseReadyFn?: () => Promise<boolean>;
}

/**
 * Broadcasts real-time POS transactional alerts with Store Notification Preferences & Email Fallback:
 * - Disabled event types are suppressed completely across all channels.
 * - Owner Online with Web Push active, Firebase available, & active subscription: SSE + FCM push (no duplicate email).
 * - Owner Offline OR Web Push inactive/unavailable/unsubscribed/failed (with Email Alerts enabled): Email Fallback triggers reliably.
 * - Cashiers continue receiving counter alerts for their own transactions when Web Push is enabled.
 */
export async function notifyPosAction(
  tenantId: number,
  payload: PosActionNotification,
  deps?: NotifyPosActionDeps
): Promise<void> {
  const actionType = String(payload.type || '').toUpperCase();
  if (!['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE', 'STOCK'].includes(actionType)) {
    return;
  }
  const cleanTenantId = Number(tenantId) || 1;
  const eventKey = mapPosActionTypeToEventKey(actionType);
  const prefs = deps?.getPreferencesFn
    ? await deps.getPreferencesFn(cleanTenantId)
    : await getTenantNotificationPreferences(cleanTenantId);

  if (eventKey && !prefs.events[eventKey]) {
    return;
  }

  const allowedRoles = payload.targetRoles || ['ADMIN', 'CASHIER'];
  const typeLower = payload.type.toLowerCase();
  const explicitEventId = typeof payload.eventId === 'string' ? payload.eventId.trim() : '';
  const eventTag =
    explicitEventId ||
    (payload.purchaseId
      ? `pos-${typeLower}-${cleanTenantId}-pur-${payload.purchaseId}`
      : payload.purchaseNumber
      ? `pos-${typeLower}-${cleanTenantId}-purno-${payload.purchaseNumber}`
      : payload.returnId
      ? `pos-${typeLower}-${cleanTenantId}-ret-${payload.returnId}`
      : payload.returnNumber
      ? `pos-${typeLower}-${cleanTenantId}-retno-${payload.returnNumber}`
      : payload.saleId
      ? `pos-${typeLower}-${cleanTenantId}-sale-${payload.saleId}`
      : payload.orderId
      ? `pos-${typeLower}-${cleanTenantId}-ord-${payload.orderId}`
      : payload.invoiceNumber
      ? `pos-${typeLower}-${cleanTenantId}-inv-${payload.invoiceNumber}`
      : `pos-${typeLower}-${cleanTenantId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);

  if (!claimServerNotificationEvent(eventTag)) {
    return;
  }

  const normalizedPushPayload = enrichPosPushNotificationPayload(payload);
  const {
    resolvedCustomerName,
    resolvedCashierName,
    resolvedTotalPairs,
    resolvedReturnedPairs,
    ...cleanPayload
  } = normalizedPushPayload;

  const enrichedPayload: PosActionNotification & { eventId: string; tag: string } = {
    ...cleanPayload,
    eventId: eventTag,
    tag: eventTag,
    targetRole: payload.targetRole || 'ALL',
    targetRoles: allowedRoles,
  };

  const isTransactionAlert = actionType !== 'STOCK';
  const ownerAllowed = allowedRoles.some((r) => isOwnerRole(r));
  const ownerOnline = deps?.isOwnerOnlineFn
    ? deps.isOwnerOnlineFn(cleanTenantId)
    : isStoreOwnerOnline(cleanTenantId);

  let tokenRows: Array<{ token: string; user_role: string; user_id: number }> = [];
  try {
    if (deps?.fetchFcmTokensFn) {
      tokenRows = await deps.fetchFcmTokensFn(cleanTenantId, allowedRoles);
    } else {
      await ensureFcmTokensSchema();
      const tokensRes = await pgClient.query<{
        token: string;
        user_role: string;
        user_id: number;
      }>(
        `SELECT token, user_role, user_id
         FROM public.fcm_tokens
         WHERE tenant_id = $1
           AND (UPPER(user_role) IN ('ADMIN', 'OWNER') OR UPPER(user_role) = ANY($2::text[]))
           AND tenant_id != 0`,
        [cleanTenantId, allowedRoles]
      );
      tokenRows = tokensRes.rows;
    }
  } catch (err) {
    console.error('Error loading FCM tokens for POS dispatch:', err);
  }

  const hasActiveOwnerPushSubscription = tokenRows.some(
    (row) => row.token && isOwnerRole(row.user_role)
  );
  const fcmConfigured = deps?.isFirebaseReadyFn
    ? await deps.isFirebaseReadyFn()
    : Boolean(deps?.sendFcmPushToTokensFn || (await getFirebaseAdmin()));

  const deliveryPlan = resolveStoreChannelDelivery({
    preferences: prefs,
    eventKey: eventKey || 'sale',
    ownerOnline,
    fcmConfigured,
    hasActiveOwnerPushSubscription,
    ownerTargeted: ownerAllowed,
  });

  const deliverOwnerInApp = !isTransactionAlert || !ownerAllowed || ownerOnline;

  // 1. Deliver to active browser dashboard sessions via Server-Sent Events (SSE)
  broadcastSsePosAction(cleanTenantId, enrichedPayload, {
    skipOwnerClients: !deliverOwnerInApp,
  });

  // 2. Deliver via Firebase Cloud Messaging (FCM) to registered devices when Web Push is enabled
  let ownerPushTargeted = false;
  let ownerPushSucceeded = false;

  try {
    const targetTokens: string[] = [];
    for (const row of tokenRows) {
      const uRole = String(row.user_role || '').toUpperCase();
      if (isOwnerRole(uRole)) {
        if (!deliveryPlan.sendOwnerWebPush) {
          continue;
        }
        if (row.token) {
          ownerPushTargeted = true;
          targetTokens.push(row.token);
        }
        continue;
      }
      if (!deliveryPlan.sendCashierWebPush) {
        continue;
      }
      // Cashiers only receive their own counter alerts
      if (uRole === 'CASHIER' && enrichedPayload.cashierId && Number(row.user_id) !== Number(enrichedPayload.cashierId)) {
        continue;
      }
      if (row.token) {
        targetTokens.push(row.token);
      }
    }

    if (targetTokens.length > 0 && prefs.channels.webPush && fcmConfigured) {
      const sendFcmImpl = deps?.sendFcmPushToTokensFn || sendFcmPushToTokens;
      const pushRes = await sendFcmImpl(targetTokens, {
        title: enrichedPayload.title,
        body: enrichedPayload.message,
        deepLinkUrl: enrichedPayload.deepLinkUrl || '/pos',
        icon: DEFAULT_NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE_ICON,
        tag: eventTag,
        data: {
          type: enrichedPayload.type,
          eventId: eventTag,
          tag: eventTag,
          invoiceId: String(enrichedPayload.invoiceNumber || enrichedPayload.saleId || enrichedPayload.orderId || ''),
          invoiceNumber: enrichedPayload.invoiceNumber || '',
          returnNumber: enrichedPayload.returnNumber || '',
          exchangeNumber: enrichedPayload.exchangeNumber || '',
          saleId: String(enrichedPayload.saleId || enrichedPayload.orderId || ''),
          orderId: String(enrichedPayload.orderId || ''),
          totalAmount: String(enrichedPayload.totalAmount || ''),
          totalPairs: resolvedTotalPairs !== undefined ? String(resolvedTotalPairs) : '',
          returnedPairs: resolvedReturnedPairs !== undefined ? String(resolvedReturnedPairs) : '',
          customerName: resolvedCustomerName,
          cashierName: resolvedCashierName,
          itemsSummary: enrichedPayload.itemsSummary || '',
          targetRole: String(enrichedPayload.targetRole || 'ALL'),
          timestamp: enrichedPayload.timestamp,
        },
      });
      if (ownerPushTargeted && (pushRes?.sentCount || 0) > 0) {
        ownerPushSucceeded = true;
      }
    }
  } catch (err) {
    console.error('Error during FCM POS push dispatch:', err);
  }

  // 3. Store owner transactional email alert / Email Fallback
  //    Sent if Owner is offline (when Email Alerts enabled), OR if Web Push is inactive/unavailable/unsubscribed/failed (Email Fallback)
  const runtimePushFailed = ownerPushTargeted && !ownerPushSucceeded;
  const shouldSendOwnerEmail = isTransactionAlert
    ? deliveryPlan.sendOwnerEmail || (ownerAllowed && prefs.channels.emailAlerts && runtimePushFailed)
    : prefs.channels.emailAlerts && ownerAllowed;

  if (shouldSendOwnerEmail) {
    const dispatchEmailImpl = deps?.dispatchPosEmailAlertFn || dispatchPosEmailAlert;
    try {
      await dispatchEmailImpl(cleanTenantId, enrichedPayload);
    } catch (err: any) {
      console.warn('[pushNotificationService] Error in dispatchPosEmailAlert:', err?.message || err);
    }
  }
}

// ============================================================================
// PLATFORM ANNOUNCEMENTS (SUPERADMIN TO STORES)
// ============================================================================

export interface PlatformAnnouncementNotification {
  id?: number;
  eventId?: string;
  tenantId?: number | null;
  targetRole?: 'ALL' | 'ADMIN' | 'CASHIER' | 'SUPERADMIN';
  title: string;
  message: string;
  type?: 'INFO' | 'WARNING' | 'SUCCESS' | 'URGENT' | string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp?: string;
}

function broadcastSsePlatformAnnouncement(
  eventPayload: Record<string, any>,
  options: { isGlobal: boolean; cleanTenantId: number | null; targetRole: string }
): number {
  const { isGlobal, cleanTenantId, targetRole } = options;
  const sseMessage = `event: platform_announcement\ndata: ${JSON.stringify(eventPayload)}\n\n`;
  let deliveredCount = 0;

  for (const client of sseClients) {
    const isTenantMatch = isGlobal ? true : client.tenantId === cleanTenantId;
    if (!isTenantMatch) continue;

    if (targetRole === 'SUPERADMIN' && (client.role !== 'SUPERADMIN' || client.authenticated === false)) continue;
    if (targetRole === 'ADMIN' && client.role !== 'ADMIN') continue;
    if (targetRole === 'CASHIER' && client.role !== 'CASHIER') continue;
    if (targetRole === 'ALL' && cleanTenantId !== null && client.role === 'SUPERADMIN') continue;

    try {
      client.res.write(sseMessage);
      deliveredCount++;
    } catch {
      sseClients.delete(client);
    }
  }

  return deliveredCount;
}

export interface NotifyPlatformAnnouncementDeps {
  isSuperAdminOnlineFn?: () => boolean;
  dispatchSuperAdminEmailAlertFn?: typeof dispatchSuperAdminEmailAlert;
  dispatchStoreNoticeEmailFn?: typeof dispatchStoreNoticeEmailAlert;
  sendFcmPushToTokensFn?: typeof sendFcmPushToTokens;
  fetchFcmTokensFn?: (targetRole: string, cleanTenantId: number | null) => Promise<string[]>;
  getPreferencesFn?: (tenantId: number) => Promise<StoreNotificationPreferences>;
  isFirebaseReadyFn?: () => Promise<boolean>;
  isOwnerOnlineFn?: (tenantId: number) => boolean;
}

export async function notifyPlatformAnnouncement(
  payload: PlatformAnnouncementNotification,
  deps?: NotifyPlatformAnnouncementDeps
): Promise<void> {
  const isGlobal = payload.tenantId === null || payload.tenantId === undefined || Number(payload.tenantId) === 0;
  const cleanTenantId = isGlobal ? null : (Number(payload.tenantId) || null);
  const targetRole = String(payload.targetRole || 'ALL').toUpperCase();

  // 0. If target is SUPERADMIN, enforce granular event trigger toggles
  if (targetRole === 'SUPERADMIN') {
    const titleLower = (payload.title || '').toLowerCase();
    const typeUpper = (payload.type || '').toUpperCase();

    const isNewTrial = titleLower.includes('new free trial') || titleLower.includes('free tier store registered') || titleLower.includes('trial activation');
    const isRenewal = titleLower.includes('renewal request') || titleLower.includes('subscription renewal') || titleLower.includes('upgrade request') || titleLower.includes('upgrade');
    const isExpired = titleLower.includes('expired') || typeUpper === 'EXPIRED';
    const isSale = typeUpper === 'SALE' || titleLower.includes('sale') || titleLower.includes('invoice');
    const isSecurity = typeUpper === 'SECURITY' || typeUpper === 'SYSTEM' || titleLower.includes('security') || titleLower.includes('backup') || titleLower.includes('critical');

    if (isNewTrial && (await getAppSetting('SUPERADMIN_PUSH_ON_NEW_TRIAL', 'true')).toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin alert settings
    }
    if (isRenewal && (await getAppSetting('SUPERADMIN_PUSH_ON_RENEWAL', 'true')).toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin alert settings
    }
    if (isExpired && (await getAppSetting('SUPERADMIN_PUSH_ON_EXPIRED_STORE', 'true')).toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin alert settings
    }
    if (isSale && (await getAppSetting('SUPERADMIN_PUSH_ON_SALES', 'false')).toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin alert settings
    }
    if (isSecurity && !isRenewal && !isNewTrial && (await getAppSetting('SUPERADMIN_PUSH_ON_SECURITY_ALERT', 'true')).toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin alert settings
    }
  }

  // Enforce per-store Notification Preferences for tenant-targeted store alerts
  let storePrefs: StoreNotificationPreferences | null = null;
  const storeEventKey = mapPlatformAnnouncementToEventKey(payload);
  if (targetRole !== 'SUPERADMIN' && cleanTenantId !== null) {
    storePrefs = deps?.getPreferencesFn
      ? await deps.getPreferencesFn(cleanTenantId)
      : await getTenantNotificationPreferences(cleanTenantId);

    if (!storePrefs.events[storeEventKey]) {
      return;
    }
  }

  const explicitEventId = typeof payload.eventId === 'string' ? payload.eventId.trim() : '';
  const eventTag =
    explicitEventId ||
    (payload.id
      ? `platform-${payload.id}`
      : `platform-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  if (!claimServerNotificationEvent(eventTag)) {
    return;
  }

  const eventPayload = {
    id: payload.id,
    announcementId: payload.id ? String(payload.id) : '',
    itemType: 'ANNOUNCEMENT',
    eventId: eventTag,
    tag: eventTag,
    type: payload.type || 'INFO',
    title: payload.title,
    message: payload.message,
    actionUrl: payload.actionUrl || '',
    actionLabel: payload.actionLabel || '',
    tenantId: cleanTenantId,
    targetRole,
    timestamp: payload.timestamp || new Date().toISOString(),
  };

  // 1. Deliver to any legacy/test active browser sessions via SSE
  broadcastSsePlatformAnnouncement(eventPayload, { isGlobal, cleanTenantId, targetRole });

  // 2. Deliver via Firebase Cloud Messaging (FCM) as primary transport
  const allowWebPush = storePrefs ? Boolean(storePrefs.channels.webPush) : true;
  const ownerTargeted = targetRole === 'ADMIN' || targetRole === 'ALL';
  let hasOwnerToken = false;
  let ownerPushSentCount = 0;
  let superAdminTokensCount = 0;
  let superAdminPushSentCount = 0;

  const fcmConfigured = deps?.isFirebaseReadyFn
    ? await deps.isFirebaseReadyFn()
    : Boolean(deps?.sendFcmPushToTokensFn || (await getFirebaseAdmin()));

  try {
    let tokens: string[] = [];
    if (deps?.fetchFcmTokensFn) {
      tokens = await deps.fetchFcmTokensFn(targetRole, cleanTenantId);
      hasOwnerToken = ownerTargeted && tokens.length > 0;
      if (targetRole === 'SUPERADMIN') {
        superAdminTokensCount = tokens.length;
      }
    } else {
      await ensureFcmTokensSchema();
      let query = '';
      let params: any[] = [];

      if (targetRole === 'SUPERADMIN') {
        query = `SELECT token, user_role FROM public.fcm_tokens WHERE UPPER(user_role) = 'SUPERADMIN'`;
        params = [];
      } else if (targetRole === 'ADMIN') {
        query = isGlobal
          ? `SELECT token, user_role FROM public.fcm_tokens WHERE UPPER(user_role) IN ('ADMIN', 'OWNER') AND tenant_id != 0`
          : `SELECT token, user_role FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) IN ('ADMIN', 'OWNER')`;
        params = isGlobal ? [] : [cleanTenantId];
      } else if (targetRole === 'CASHIER') {
        query = isGlobal
          ? `SELECT token, user_role FROM public.fcm_tokens WHERE UPPER(user_role) = 'CASHIER' AND tenant_id != 0`
          : `SELECT token, user_role FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) = 'CASHIER'`;
        params = isGlobal ? [] : [cleanTenantId];
      } else {
        query = isGlobal
          ? `SELECT token, user_role FROM public.fcm_tokens`
          : `SELECT token, user_role FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) IN ('ADMIN', 'OWNER', 'CASHIER')`;
        params = isGlobal ? [] : [cleanTenantId];
      }

      const tokensRes = await pgClient.query<{ token: string; user_role: string }>(query, params);
      tokens = tokensRes.rows.map((r) => r.token).filter(Boolean);
      hasOwnerToken = ownerTargeted && tokensRes.rows.some((r) => Boolean(r.token) && isOwnerRole(r.user_role));
      if (targetRole === 'SUPERADMIN') {
        superAdminTokensCount = tokens.length;
      }
    }

    if (tokens.length > 0 && allowWebPush && fcmConfigured) {
      const isAdminAnnouncement = targetRole === 'SUPERADMIN';
      const sendFcmImpl = deps?.sendFcmPushToTokensFn || sendFcmPushToTokens;
      const pushRes = await sendFcmImpl(tokens, {
        title: payload.title,
        body: payload.message,
        deepLinkUrl: payload.actionUrl || (isAdminAnnouncement ? '/admin' : '/'),
        icon: isAdminAnnouncement ? ADMIN_NOTIFICATION_ICON : DEFAULT_NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE_ICON,
        tag: eventTag,
        data: {
          type: payload.type || 'INFO',
          itemType: 'ANNOUNCEMENT',
          eventId: eventTag,
          tag: eventTag,
          announcementId: String(payload.id || ''),
          notificationId: String(payload.id || ''),
          targetRole: String(targetRole || 'ALL'),
          actionLabel: String(payload.actionLabel || ''),
          isAdmin: isAdminAnnouncement ? 'true' : 'false',
          timestamp: eventPayload.timestamp,
        },
      });
      if (hasOwnerToken) {
        ownerPushSentCount = pushRes?.sentCount || 0;
      }
      if (targetRole === 'SUPERADMIN') {
        superAdminPushSentCount = pushRes?.sentCount || 0;
      }
    }
  } catch (err) {
    console.error('Error during FCM announcement push dispatch:', err);
  }

  // 3a. SuperAdmin Email Fallback when FCM is unavailable, unsubscribed, or fails delivery
  if (targetRole === 'SUPERADMIN') {
    const needsSuperAdminFallback =
      !fcmConfigured || superAdminTokensCount === 0 || superAdminPushSentCount === 0;
    if (needsSuperAdminFallback) {
      const dispatchEmailImpl = deps?.dispatchSuperAdminEmailAlertFn || dispatchSuperAdminEmailAlert;
      try {
        await dispatchEmailImpl(eventPayload);
      } catch (err: any) {
        console.warn('[pushNotificationService] Error in dispatchSuperAdminEmailAlert:', err?.message || err);
      }
    }
    return;
  }

  // 3b. Store Owner Email Fallback for tenant-targeted announcements & subscription alerts
  if (cleanTenantId !== null && ownerTargeted && storePrefs?.channels.emailAlerts) {
    const ownerOnline = deps?.isOwnerOnlineFn
      ? deps.isOwnerOnlineFn(cleanTenantId)
      : isStoreOwnerOnline(cleanTenantId);
    const plan = resolveStoreChannelDelivery({
      preferences: storePrefs,
      eventKey: storeEventKey,
      ownerOnline,
      fcmConfigured,
      hasActiveOwnerPushSubscription: hasOwnerToken,
      ownerTargeted: true,
    });
    const runtimePushFailed = plan.sendOwnerWebPush && hasOwnerToken && ownerPushSentCount === 0;
    if (plan.sendOwnerEmail || runtimePushFailed) {
      const dispatchNoticeEmailImpl = deps?.dispatchStoreNoticeEmailFn || dispatchStoreNoticeEmailAlert;
      try {
        await dispatchNoticeEmailImpl(cleanTenantId, {
          ...eventPayload,
          fallbackReason: runtimePushFailed ? 'push_delivery_failed' : plan.emailFallbackReason,
        });
      } catch (err: any) {
        console.warn('[pushNotificationService] Error in dispatchStoreNoticeEmailAlert:', err?.message || err);
      }
    }
  }
}

// ============================================================================
// TEST FCM ALERT DISPATCH
// ============================================================================

export interface TestFcmPushResult {
  success: boolean;
  message: string;
  sentCount: number;
  fcmSentCount: number;
  failureCount: number;
  channel: 'fcm' | 'sse';
  eventId: string;
  error?: string;
}

export interface TestFcmPushDeps {
  eventId?: string;
  getFirebaseAdminFn?: () => App | null | Promise<App | null>;
  sendFcmPushToTokensFn?: typeof sendFcmPushToTokens;
  fetchTokensFn?: (tenantId: number, isSuperAdminTest: boolean) => Promise<string[]>;
}

export async function testFcmPush(
  tenantId: number,
  customTitle?: string,
  customMessage?: string,
  deps?: TestFcmPushDeps
): Promise<TestFcmPushResult> {
  const isSuperAdminTest = tenantId === 0;
  const alertTitle = customTitle || (isSuperAdminTest ? 'SuperAdmin Test Alert' : 'POS Test Alert');
  const alertBody = customMessage || (isSuperAdminTest
    ? 'SuperAdmin push alert delivered successfully. Device notifications are operational.'
    : 'POS push alert delivered successfully. Device notifications are operational.');

  const rawEventId = typeof deps?.eventId === 'string' ? deps.eventId.trim() : '';
  const eventId = rawEventId || `test-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (rawEventId) {
    const now = Date.now();
    if (completedTestPushByEventId.size > 200) {
      for (const [k, entry] of completedTestPushByEventId.entries()) {
        if (entry.expiresAt <= now) completedTestPushByEventId.delete(k);
      }
    }
    const cached = completedTestPushByEventId.get(rawEventId);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }
    const inFlight = inFlightTestPushByEventId.get(rawEventId);
    if (inFlight) {
      return inFlight;
    }
  }

  const executeTestPush = async (): Promise<TestFcmPushResult> => {
    const targetRole = isSuperAdminTest ? 'SUPERADMIN' : 'ALL';
    const cleanTenantId = isSuperAdminTest ? null : (Number(tenantId) || 1);

    // 1. Deliver real-time alert to active browser sessions via SSE stream ONLY (no duplicate FCM send)
    broadcastSsePlatformAnnouncement(
      {
        eventId,
        tag: eventId,
        type: 'TEST_PUSH',
        title: alertTitle,
        message: alertBody,
        actionUrl: '',
        actionLabel: '',
        tenantId: cleanTenantId,
        targetRole,
        timestamp: new Date().toISOString(),
      },
      {
        isGlobal: isSuperAdminTest,
        cleanTenantId,
        targetRole,
      }
    );

    const app = deps?.getFirebaseAdminFn ? await deps.getFirebaseAdminFn() : await getFirebaseAdmin();
    if (!app) {
      return {
        success: true,
        message: '✓ Test alert dispatched to your open browser session(s)! (Configure Firebase Admin SDK in Settings to enable background push while the app is closed.)',
        sentCount: 1,
        fcmSentCount: 0,
        failureCount: 0,
        channel: 'sse',
        eventId,
      };
    }

    let tokens: string[] = [];
    if (deps?.fetchTokensFn) {
      tokens = await deps.fetchTokensFn(tenantId, isSuperAdminTest);
    } else {
      await ensureFcmTokensSchema();
      // Scope FCM tokens strictly: SuperAdmin test targets SUPERADMIN tokens; Store test targets that tenant's store tokens
      const query = isSuperAdminTest
        ? `SELECT token FROM public.fcm_tokens WHERE UPPER(user_role) = 'SUPERADMIN'`
        : `SELECT token FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) != 'SUPERADMIN'`;
      const params = isSuperAdminTest ? [] : [cleanTenantId];
      const tokensRes = await pgClient.query<{ token: string }>(query, params);
      tokens = tokensRes.rows.map((r) => r.token);
    }

    const uniqueTokens = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
    if (uniqueTokens.length === 0) {
      return {
        success: true,
        message: '✓ Test alert delivered to your open session! Tap "Enable Push" to register this device for background alerts when the app is closed.',
        sentCount: 0,
        fcmSentCount: 0,
        failureCount: 0,
        channel: 'sse',
        eventId,
      };
    }

    // 2. Dispatch FCM push notification ONCE with matching eventId/tag for cross-channel deduplication
    const sender = deps?.sendFcmPushToTokensFn || sendFcmPushToTokens;
    const result = await sender(uniqueTokens, {
      title: alertTitle,
      body: alertBody,
      deepLinkUrl: isSuperAdminTest ? '/admin' : '/pos',
      icon: isSuperAdminTest ? ADMIN_NOTIFICATION_ICON : DEFAULT_NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE_ICON,
      tag: eventId,
      data: {
        type: 'TEST_PUSH',
        eventId,
        tag: eventId,
        userRole: isSuperAdminTest ? 'SUPERADMIN' : 'ADMIN',
        isAdmin: isSuperAdminTest ? 'true' : 'false',
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: result.success,
      message: result.success
        ? `✓ Test notification successfully dispatched to ${result.sentCount} device(s)!`
        : `Test alert sent to active session, but FCM delivery reported: ${result.error || 'Unknown error'}`,
      sentCount: result.sentCount,
      fcmSentCount: result.sentCount,
      failureCount: result.failureCount,
      channel: result.sentCount > 0 ? 'fcm' : 'sse',
      eventId,
      error: result.error,
    };
  };

  if (!rawEventId) {
    return executeTestPush();
  }

  const runPromise = executeTestPush().then((res) => {
    completedTestPushByEventId.set(rawEventId, {
      result: res,
      expiresAt: Date.now() + 120_000,
    });
    return res;
  }).finally(() => {
    inFlightTestPushByEventId.delete(rawEventId);
  });

  inFlightTestPushByEventId.set(rawEventId, runPromise);
  return runPromise;
}

// ============================================================================
// SUBSCRIPTION & TRIAL LIFECYCLE NOTIFICATIONS
// ============================================================================

export const SUBSCRIPTION_NOTIFICATION_TITLES = {
  FREE_TRIAL_EXPIRING_SOON: 'Free Trial Expiring Soon ⏳',
  SUBSCRIPTION_EXPIRING_SOON: 'Subscription Expiring Soon ⚠️',
  SUBSCRIPTION_EXPIRED: 'Subscription Expired ❌',
  SUBSCRIPTION_RENEWED: 'Subscription Renewed ✅',
  NEW_RENEWAL_REQUEST: 'New Renewal Request 🔔',
  RENEWAL_REQUEST_APPROVED: 'Renewal Request Approved ✅',
} as const;

export interface StoreSubscriptionNotificationInput {
  tenantId: number | null;
  targetRole: 'ADMIN' | 'SUPERADMIN' | 'ALL';
  title: string;
  message: string;
  type?: 'INFO' | 'WARNING' | 'SUCCESS' | 'URGENT' | 'SYSTEM';
  actionUrl?: string;
  actionLabel?: string;
  eventId: string;
}

/**
 * Persists a UTF-8 platform notification idempotently using event_id and dispatches
 * SSE + FCM Web Push (+ offline email if applicable) exactly once per eventId.
 */
export async function emitPlatformNotificationOnce(
  input: StoreSubscriptionNotificationInput
): Promise<boolean> {
  await ensurePlatformNotificationsSchema();
  const cleanTenantId =
    input.tenantId === null || input.tenantId === undefined || Number(input.tenantId) <= 0
      ? null
      : Number(input.tenantId);

  const insertRes = await pgClient.query<{ id: number; created_at: string }>(
    `INSERT INTO platform_notifications (
      tenant_id, target_role, title, message, type, action_url, action_label, event_id, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id, created_at`,
    [
      cleanTenantId,
      input.targetRole,
      input.title,
      input.message,
      input.type || 'INFO',
      input.actionUrl || (input.targetRole === 'SUPERADMIN' ? '/superadmin' : '/?tab=settings&section=subscription'),
      input.actionLabel || (input.targetRole === 'SUPERADMIN' ? 'Review Store' : 'View Subscription'),
      input.eventId,
    ]
  );

  const row = insertRes.rows[0];
  if (!row?.id) {
    return false;
  }

  await notifyPlatformAnnouncement({
    id: row.id,
    eventId: input.eventId,
    tenantId: cleanTenantId,
    targetRole: input.targetRole,
    title: input.title,
    message: input.message,
    type: input.type || 'INFO',
    actionUrl: input.actionUrl || (input.targetRole === 'SUPERADMIN' ? '/superadmin' : '/?tab=settings&section=subscription'),
    actionLabel: input.actionLabel || (input.targetRole === 'SUPERADMIN' ? 'Review Store' : 'View Subscription'),
    timestamp: row.created_at || new Date().toISOString(),
  }).catch(() => {});

  return true;
}

export async function emitStoreSubscriptionNotification(params: {
  tenantId: number;
  storeName: string;
  kind: 'RENEWED' | 'RENEWAL_APPROVED' | 'EXPIRED';
  planLabel?: string;
  endDate?: Date | string | null;
}): Promise<boolean> {
  const cleanId = Number(params.tenantId);
  if (!Number.isSafeInteger(cleanId) || cleanId <= 0) return false;
  const storeName = String(params.storeName || 'Retail Store').trim();
  const endDateObj = params.endDate ? new Date(params.endDate) : new Date();
  const endKey = Number.isNaN(endDateObj.getTime())
    ? new Date().toISOString().slice(0, 10)
    : endDateObj.toISOString().slice(0, 13);
  const formattedEnd = Number.isNaN(endDateObj.getTime()) ? '' : endDateObj.toLocaleDateString();
  const planText = params.planLabel || 'Subscription';

  if (params.kind === 'EXPIRED') {
    const storeEmitted = await emitPlatformNotificationOnce({
      tenantId: cleanId,
      targetRole: 'ADMIN',
      title: SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_EXPIRED,
      message: `Subscription for '${storeName}' (${planText}) has expired. Please renew your plan to continue uninterrupted POS access.`,
      type: 'WARNING',
      actionUrl: '/?tab=settings&section=subscription',
      actionLabel: 'Renew Subscription',
      eventId: `sub-expired-${cleanId}-${endKey}`,
    });

    await emitPlatformNotificationOnce({
      tenantId: null,
      targetRole: 'SUPERADMIN',
      title: SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_EXPIRED,
      message: `Store '${storeName}' (${planText}) subscription expired.`,
      type: 'WARNING',
      actionUrl: '/superadmin',
      actionLabel: 'Review Store',
      eventId: `sa-sub-expired-${cleanId}-${endKey}`,
    }).catch(() => false);

    return storeEmitted;
  }

  if (params.kind === 'RENEWAL_APPROVED') {
    return emitPlatformNotificationOnce({
      tenantId: cleanId,
      targetRole: 'ADMIN',
      title: SUBSCRIPTION_NOTIFICATION_TITLES.RENEWAL_REQUEST_APPROVED,
      message: `Your subscription renewal request (${planText}) for '${storeName}' has been approved${formattedEnd ? ` and is valid until ${formattedEnd}` : ''}.`,
      type: 'SUCCESS',
      actionUrl: '/?tab=settings&section=subscription',
      actionLabel: 'View Plan',
      eventId: `renewal-approved-${cleanId}-${endKey}`,
    });
  }

  return emitPlatformNotificationOnce({
    tenantId: cleanId,
    targetRole: 'ADMIN',
    title: SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_RENEWED,
    message: `Subscription (${planText}) for '${storeName}' has been renewed${formattedEnd ? ` until ${formattedEnd}` : ''}.`,
    type: 'SUCCESS',
    actionUrl: '/?tab=settings&section=subscription',
    actionLabel: 'View Plan',
    eventId: `sub-renewed-${cleanId}-${endKey}`,
  });
}

let lastLifecycleSyncMs = 0;
let lifecycleSyncPromise: Promise<void> | null = null;

/**
 * Synchronizes expired subscriptions and dispatches idempotent alerts for:
 * - "Subscription Expired ❌"
 * - "Free Trial Expiring Soon ⏳" (free_tier <= 7 days remaining)
 * - "Subscription Expiring Soon ⚠️" (paid plans <= 7 days remaining)
 */
export async function syncAndNotifyTenantSubscriptionLifecycle(options?: { force?: boolean }): Promise<void> {
  const nowMs = Date.now();
  if (!options?.force && lifecycleSyncPromise) {
    return lifecycleSyncPromise;
  }
  if (!options?.force && nowMs - lastLifecycleSyncMs < 30_000) {
    return;
  }

  const run = (async () => {
    try {
      await ensureSaasControlPlane();
      await ensurePlatformNotificationsSchema();

      // 1. Mark newly expired tenants (and linked active free trials + tracking history)
      await syncExpiredTenantSubscriptions();

      // 2. Notify stores whose subscription is EXPIRED (idempotent per tenant + end_date)
      const expiredRes = await pgClient.query<{
        id: number;
        name: string;
        subscription_plan: string;
        subscription_end_date: string;
      }>(
        `SELECT id, name, subscription_plan::text AS subscription_plan, subscription_end_date
         FROM tenants
         WHERE id > 0
           AND COALESCE(status::text, 'ACTIVE') != 'SUSPENDED'
           AND subscription_status::text = 'EXPIRED'
           AND subscription_end_date IS NOT NULL`
      );

      for (const t of expiredRes.rows) {
        const plan = normalizeSubscriptionPlan(t.subscription_plan);
        const planLabel = plan === 'free_tier' ? 'Free Trial' : plan === '6_MONTHS' ? '6 Months' : 'Yearly';
        await emitStoreSubscriptionNotification({
          tenantId: t.id,
          storeName: t.name,
          kind: 'EXPIRED',
          planLabel,
          endDate: t.subscription_end_date,
        }).catch(() => {});
      }

      // 3. Notify active stores expiring within 7 days
      const expiringRes = await pgClient.query<{
        id: number;
        name: string;
        subscription_plan: string;
        subscription_end_date: string;
      }>(
        `SELECT id, name, subscription_plan::text AS subscription_plan, subscription_end_date
         FROM tenants
         WHERE id > 0
           AND COALESCE(status::text, 'ACTIVE') = 'ACTIVE'
           AND COALESCE(subscription_status::text, 'ACTIVE') = 'ACTIVE'
           AND subscription_end_date IS NOT NULL
           AND subscription_end_date > NOW()
           AND subscription_end_date <= NOW() + INTERVAL '7 days'`
      );

      for (const t of expiringRes.rows) {
        const endDate = new Date(t.subscription_end_date);
        if (Number.isNaN(endDate.getTime())) continue;
        const daysLeft = Math.max(1, Math.ceil((endDate.getTime() - Date.now()) / 86_400_000));
        const daysLabel = daysLeft === 1 ? '1 day' : `${daysLeft} days`;
        const endKey = endDate.toISOString().slice(0, 10);
        const isFreeTrial = normalizeSubscriptionPlan(t.subscription_plan) === 'free_tier';

        if (isFreeTrial) {
          await emitPlatformNotificationOnce({
            tenantId: t.id,
            targetRole: 'ADMIN',
            title: SUBSCRIPTION_NOTIFICATION_TITLES.FREE_TRIAL_EXPIRING_SOON,
            message: `Your free trial for '${t.name}' expires in ${daysLabel}. Upgrade your subscription to continue uninterrupted POS access.`,
            type: 'WARNING',
            actionUrl: '/?tab=settings&section=subscription',
            actionLabel: 'Upgrade Plan',
            eventId: `trial-expiring-${t.id}-${endKey}`,
          }).catch(() => {});
        } else {
          await emitPlatformNotificationOnce({
            tenantId: t.id,
            targetRole: 'ADMIN',
            title: SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_EXPIRING_SOON,
            message: `Your subscription for '${t.name}' expires in ${daysLabel}. Renew now to avoid service interruption.`,
            type: 'WARNING',
            actionUrl: '/?tab=settings&section=subscription',
            actionLabel: 'Renew Subscription',
            eventId: `sub-expiring-${t.id}-${endKey}`,
          }).catch(() => {});
        }
      }

      lastLifecycleSyncMs = Date.now();
    } catch (err: any) {
      console.warn('[SubscriptionLifecycle] Notification sync warning:', err?.message || err);
    } finally {
      lifecycleSyncPromise = null;
    }
  })();

  lifecycleSyncPromise = run;
  return run;
}


