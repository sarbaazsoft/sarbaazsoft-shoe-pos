import { initializeApp, cert, getApps, deleteApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Response } from 'express';
import { pgClient } from '../db/index.ts';
import { ensureFcmTokensSchema } from '../db/schemaInit.ts';
import { getCachedAppSetting, getAppSetting, loadAppSettingsCache, registerSettingsUpdateListener } from './services/appSettingsService.ts';
import { dispatchPosEmailAlert } from './services/emailAlertService.ts';

// ============================================================================
// FIREBASE ADMIN SDK SINGLETON & DYNAMIC INITIALIZATION
// ============================================================================

let firebaseApp: App | null = null;
let lastCredentialSignature = '';

/**
 * Initializes or retrieves the Firebase Admin App instance.
 * Reads FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY from app_settings or process.env.
 */
export function getFirebaseAdmin(): App | null {
  const projectId = (getCachedAppSetting('FCM_PROJECT_ID', '') || process.env.FCM_PROJECT_ID || '').trim();
  const clientEmail = (getCachedAppSetting('FCM_CLIENT_EMAIL', '') || process.env.FCM_CLIENT_EMAIL || '').trim();
  let privateKey = (getCachedAppSetting('FCM_PRIVATE_KEY', '') || process.env.FCM_PRIVATE_KEY || '').trim();

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
          deleteApp(app).catch(() => {});
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

// Initial configuration attempt
getFirebaseAdmin();

// Re-configure whenever FCM credentials are saved dynamically via the settings API
registerSettingsUpdateListener((key) => {
  if (['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'].includes(key)) {
    getFirebaseAdmin();
  }
});

// Asynchronously hydrate once PostgreSQL app_settings cache is loaded
getAppSetting('FCM_PROJECT_ID').then(() => {
  getFirebaseAdmin();
}).catch(() => {});

// ============================================================================
// ACTIVE SSE BROWSER CLIENTS (REAL-TIME DASHBOARD SYNC)
// ============================================================================

export interface SseClientRecord {
  res: Response;
  tenantId: number;
  userId: number;
  role: string; // 'SUPERADMIN' | 'ADMIN' | 'CASHIER'
}

const sseClients = new Set<SseClientRecord>();

export function registerSseClient(
  tenantId: number,
  userId: number,
  role: string,
  res: Response
): () => void {
  const cleanTenantId = Number(tenantId) || 0;
  const cleanUserId = Number(userId) || 0;
  const cleanRole = String(role || (cleanTenantId === 0 ? 'SUPERADMIN' : 'CASHIER')).trim().toUpperCase();

  const client: SseClientRecord = {
    res,
    tenantId: cleanTenantId,
    userId: cleanUserId,
    role: cleanRole,
  };
  sseClients.add(client);

  return () => {
    sseClients.delete(client);
  };
}

// ============================================================================
// FCM DEVICE TOKEN PERSISTENCE
// ============================================================================

export async function saveFcmToken(
  tenantId: number,
  userId: number,
  userRole: string,
  token: string,
  userAgent: string = '',
  deviceName: string = ''
): Promise<boolean> {
  try {
    await ensureFcmTokensSchema();
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return false;

    const cleanRole = String(userRole || (tenantId === 0 ? 'SUPERADMIN' : 'ADMIN')).trim().toUpperCase();
    const cleanTenantId = Number(tenantId) || 1;
    const cleanUserId = Number(userId) || 0;

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
    await loadAppSettingsCache();
    const app = getFirebaseAdmin();
    const projectId = (await getAppSetting('FCM_PROJECT_ID', '')) || process.env.FCM_PROJECT_ID || '';

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

export function buildFcmNotificationConfig(payload: FcmPushPayload) {
  const linkUrl = payload.deepLinkUrl || '/';
  const isAdminTarget = linkUrl.startsWith('/admin') || payload.data?.isAdmin === 'true';
  const icon = payload.icon || (isAdminTarget ? ADMIN_NOTIFICATION_ICON : DEFAULT_NOTIFICATION_ICON);
  const badge = payload.badge || NOTIFICATION_BADGE_ICON;
  const tag = payload.tag || `pos-${Date.now()}`;

  const groupKey = isAdminTarget ? 'admin_alerts' : 'pos_alerts';
  const rawTimestamp = payload.data?.timestamp;
  const numericTimestamp = rawTimestamp ? Number(rawTimestamp) || Date.parse(rawTimestamp) || Date.now() : Date.now();

  const stringData: Record<string, string> = {
    url: linkUrl,
    title: payload.title,
    body: payload.body,
    icon,
    badge,
    tag,
    groupKey,
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
    webpushNotification: {
      title: payload.title,
      body: payload.body,
      icon,
      badge,
      tag,
      timestamp: numericTimestamp,
      vibrate: [200, 100, 200],
    },
  };
}

export async function sendFcmPushToTokens(
  tokens: string[],
  payload: FcmPushPayload
): Promise<FcmDispatchResult> {
  await loadAppSettingsCache();
  const app = getFirebaseAdmin();
  if (!app) {
    return {
      success: false,
      sentCount: 0,
      failureCount: tokens.length,
      error: 'Firebase Admin SDK credentials (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY) are not configured in SuperAdmin settings.',
    };
  }

  const uniqueTokens = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
  if (uniqueTokens.length === 0) {
    return {
      success: true,
      sentCount: 0,
      failureCount: 0,
    };
  }

  try {
    const messaging = getMessaging(app);
    const config = buildFcmNotificationConfig(payload);

    const response = await messaging.sendEachForMulticast({
      tokens: uniqueTokens,
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
        notification: config.webpushNotification,
        fcmOptions: {
          link: config.linkUrl,
        },
      },
    });

    // Cleanup expired or uninstalled tokens automatically
    const tokensToRemove: string[] = [];
    response.responses.forEach((resp: any, idx: number) => {
      if (!resp.success && resp.error) {
        const errCode = resp.error.code;
        if (
          errCode === 'messaging/invalid-registration-token' ||
          errCode === 'messaging/registration-token-not-registered'
        ) {
          tokensToRemove.push(uniqueTokens[idx]);
        }
      }
    });

    if (tokensToRemove.length > 0) {
      await pgClient.query('DELETE FROM public.fcm_tokens WHERE token = ANY($1::text[])', [tokensToRemove]).catch(() => {});
    }

    return {
      success: response.successCount > 0 || response.failureCount === 0,
      sentCount: response.successCount,
      failureCount: response.failureCount,
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
  type: 'SALE' | 'RETURN' | 'EXCHANGE' | 'STOCK' | 'PURCHASE';
  title: string;
  message: string;
  invoiceNumber: string;
  orderId?: number;
  saleId?: number;
  returnNumber?: string;
  returnId?: number;
  totalAmount?: number;
  refundAmount?: number;
  netDifference?: number;
  customerName?: string;
  cashierName?: string;
  cashierId?: number;
  itemsSummary?: string;
  exchangeDetails?: {
    oldItems: string;
    newItems: string;
    netDifference: number;
  };
  deepLinkUrl: string;
  timestamp: string;
  triggeredBy?: string;
  targetRole?: 'ALL' | 'ADMIN' | 'CASHIER';
  targetRoles?: ('ADMIN' | 'CASHIER')[];
}

/**
 * Broadcasts real-time POS transactional alerts:
 * 1. Active Web dashboard sessions via Server-Sent Events (SSE)
 * 2. Mobile and desktop devices via Firebase Cloud Messaging (FCM)
 *
 * Routing rules:
 * - Store Owners (ADMIN / OWNER) ALWAYS receive all transactional sales, returns, and low stock alerts.
 * - Cashiers only receive alerts for their own counter transactions.
 * - SuperAdmin does not receive individual store POS counter alerts.
 */
export async function notifyPosAction(
  tenantId: number,
  payload: PosActionNotification
): Promise<void> {
  const cleanTenantId = Number(tenantId) || 1;
  const allowedRoles = payload.targetRoles || ['ADMIN', 'CASHIER'];
  const eventTag = `pos-${payload.type.toLowerCase()}-${payload.invoiceNumber || Date.now()}`;
  const enrichedPayload: PosActionNotification & { eventId: string; tag: string } = {
    ...payload,
    eventId: eventTag,
    tag: eventTag,
    targetRole: payload.targetRole || 'ALL',
    targetRoles: allowedRoles,
  };

  // 1. Deliver to active browser dashboard sessions via Server-Sent Events (SSE)
  const sseMessage = `event: pos_action\ndata: ${JSON.stringify(enrichedPayload)}\n\n`;
  for (const client of sseClients) {
    if (
      client.tenantId === cleanTenantId &&
      client.role !== 'SUPERADMIN' &&
      allowedRoles.includes(client.role as any)
    ) {
      if (client.role === 'CASHIER' && enrichedPayload.cashierId && client.userId !== enrichedPayload.cashierId) {
        continue;
      }
      try {
        client.res.write(sseMessage);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // 2. Deliver via Firebase Cloud Messaging (FCM) to all registered mobile and desktop devices
  try {
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

    if (tokensRes.rows.length === 0) {
      return;
    }

    const targetTokens: string[] = [];
    for (const row of tokensRes.rows) {
      const uRole = String(row.user_role || '').toUpperCase();
      // Store Owners receive all transactional alerts; cashiers only receive their own
      if (uRole === 'CASHIER' && enrichedPayload.cashierId && Number(row.user_id) !== Number(enrichedPayload.cashierId)) {
        continue;
      }
      targetTokens.push(row.token);
    }

    if (targetTokens.length > 0) {
      await sendFcmPushToTokens(targetTokens, {
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
          invoiceNumber: enrichedPayload.invoiceNumber || '',
          orderId: String(enrichedPayload.orderId || ''),
          totalAmount: String(enrichedPayload.totalAmount || ''),
          timestamp: enrichedPayload.timestamp,
        },
      });
    }
  } catch (err) {
    console.error('Error during FCM POS push dispatch:', err);
  }

  // 3. Store owner transactional email alert
  dispatchPosEmailAlert(cleanTenantId, enrichedPayload).catch((err) => {
    console.warn('[pushNotificationService] Error in dispatchPosEmailAlert:', err?.message || err);
  });
}

// ============================================================================
// PLATFORM ANNOUNCEMENTS (SUPERADMIN TO STORES)
// ============================================================================

export interface PlatformAnnouncementNotification {
  id?: number;
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

    if (targetRole === 'SUPERADMIN' && client.role !== 'SUPERADMIN') continue;
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

export async function notifyPlatformAnnouncement(
  payload: PlatformAnnouncementNotification
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

    if (isNewTrial && getCachedAppSetting('SUPERADMIN_PUSH_ON_NEW_TRIAL', 'true').toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin push event settings
    }
    if (isRenewal && getCachedAppSetting('SUPERADMIN_PUSH_ON_RENEWAL', 'true').toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin push event settings
    }
    if (isExpired && getCachedAppSetting('SUPERADMIN_PUSH_ON_EXPIRED_STORE', 'true').toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin push event settings
    }
    if (isSale && getCachedAppSetting('SUPERADMIN_PUSH_ON_SALES', 'false').toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin push event settings
    }
    if (isSecurity && !isRenewal && !isNewTrial && getCachedAppSetting('SUPERADMIN_PUSH_ON_SECURITY_ALERT', 'true').toLowerCase() === 'false') {
      return; // Suppressed by SuperAdmin push event settings
    }
  }

  const eventTag = `platform-${payload.id || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const eventPayload = {
    id: payload.id,
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

  // 1. Deliver to active browser sessions via SSE
  broadcastSsePlatformAnnouncement(eventPayload, { isGlobal, cleanTenantId, targetRole });

  // 2. Deliver via Firebase Cloud Messaging (FCM)
  try {
    await ensureFcmTokensSchema();
    let query = '';
    let params: any[] = [];

    if (targetRole === 'SUPERADMIN') {
      query = `SELECT token FROM public.fcm_tokens WHERE UPPER(user_role) = 'SUPERADMIN'`;
      params = [];
    } else if (targetRole === 'ADMIN') {
      query = isGlobal
        ? `SELECT token FROM public.fcm_tokens WHERE UPPER(user_role) IN ('ADMIN', 'OWNER') AND tenant_id != 0`
        : `SELECT token FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) IN ('ADMIN', 'OWNER')`;
      params = isGlobal ? [] : [cleanTenantId];
    } else if (targetRole === 'CASHIER') {
      query = isGlobal
        ? `SELECT token FROM public.fcm_tokens WHERE UPPER(user_role) = 'CASHIER' AND tenant_id != 0`
        : `SELECT token FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) = 'CASHIER'`;
      params = isGlobal ? [] : [cleanTenantId];
    } else {
      query = isGlobal
        ? `SELECT token FROM public.fcm_tokens`
        : `SELECT token FROM public.fcm_tokens WHERE tenant_id = $1 AND UPPER(user_role) IN ('ADMIN', 'OWNER', 'CASHIER')`;
      params = isGlobal ? [] : [cleanTenantId];
    }

    const tokensRes = await pgClient.query<{ token: string }>(query, params);
    if (tokensRes.rows.length === 0) return;

    const tokens = tokensRes.rows.map((r) => r.token);
    const isAdminAnnouncement = targetRole === 'SUPERADMIN';
    await sendFcmPushToTokens(tokens, {
      title: payload.title,
      body: payload.message,
      deepLinkUrl: payload.actionUrl || (isAdminAnnouncement ? '/admin' : '/'),
      icon: isAdminAnnouncement ? ADMIN_NOTIFICATION_ICON : DEFAULT_NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE_ICON,
      tag: eventTag,
      data: {
        type: payload.type || 'INFO',
        eventId: eventTag,
        tag: eventTag,
        notificationId: String(payload.id || ''),
        isAdmin: isAdminAnnouncement ? 'true' : 'false',
      },
    });
  } catch (err) {
    console.error('Error during FCM announcement push dispatch:', err);
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
  getFirebaseAdminFn?: () => App | null;
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
  const alertTitle = customTitle || (isSuperAdminTest ? '🔔 SuperAdmin Test Push Alert' : '🔔 POS Test Push Alert');
  const alertBody = customMessage || (isSuperAdminTest
    ? `SuperAdmin Push Alert received successfully at ${new Date().toLocaleTimeString()}! Device notifications are fully operational.`
    : `Push Alert received successfully at ${new Date().toLocaleTimeString()}! Device notifications are fully operational.`);

  const rawEventId = typeof deps?.eventId === 'string' ? deps.eventId.trim() : '';
  const eventId = rawEventId || `test-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  await loadAppSettingsCache().catch(() => {});
  const app = deps?.getFirebaseAdminFn ? deps.getFirebaseAdminFn() : getFirebaseAdmin();
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
}

