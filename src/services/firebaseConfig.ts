import { initializeApp, getApps, getApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, deleteToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { api, getActiveTenantId } from './api.ts';
import { playAudioFeedback } from '../utils/audio.ts';
import {
  PUSH_DEDUPE_CHANNEL_NAME,
  claimNotificationChannel,
  getNotificationDedupeKey,
  isNotificationChannelClaimed,
} from '../utils/notificationDedupe.ts';
import { showSingleShadeNotification } from '../utils/notificationShade.ts';
import { buildPushNotificationActions, navigateToNotificationUrl } from '../utils/notificationActions.ts';
import { doVapidKeysMatch, normalizeVapidPublicKey } from '../utils/vapid.ts';

let cachedFirebaseApp: FirebaseApp | null = null;
let cachedMessaging: Messaging | null = null;
let cachedFirebaseConfigSig = '';
let inFlightConfigPromise: Promise<any> | null = null;
let onMessageUnsubscribe: (() => void) | null = null;
let inFlightPermissionRequest: Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  permission?: NotificationPermission;
  androidSystemDisabled?: boolean;
  alreadyPrompted?: boolean;
}> | null = null;
let inFlightTokenSync: Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
}> | null = null;
let lastSyncedSignature = '';
const FCM_LAST_SYNC_SIG_KEY = 'pos_fcm_last_sync_sig';
const FCM_LAST_SYNC_AT_KEY = 'pos_fcm_last_sync_at';
const FCM_SYNC_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let swSubscriptionListenerAttached = false;

function hasFreshFcmSyncSignature(signature: string): boolean {
  if (lastSyncedSignature === signature) return true;
  if (typeof localStorage === 'undefined') return false;
  try {
    const storedSig = localStorage.getItem(FCM_LAST_SYNC_SIG_KEY);
    const storedAt = Number(localStorage.getItem(FCM_LAST_SYNC_AT_KEY) || 0);
    if (storedSig === signature && storedAt > 0 && Date.now() - storedAt < FCM_SYNC_CACHE_TTL_MS) {
      lastSyncedSignature = signature;
      return true;
    }
  } catch {}
  return false;
}

function persistFcmSyncSignature(signature: string): void {
  lastSyncedSignature = signature;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FCM_LAST_SYNC_SIG_KEY, signature);
    localStorage.setItem(FCM_LAST_SYNC_AT_KEY, String(Date.now()));
  } catch {}
}

function clearPersistedFcmSyncSignature(): void {
  lastSyncedSignature = '';
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(FCM_LAST_SYNC_SIG_KEY);
    localStorage.removeItem(FCM_LAST_SYNC_AT_KEY);
  } catch {}
}

export async function fetchFcmConfig() {
  if (inFlightConfigPromise) {
    return inFlightConfigPromise;
  }

  inFlightConfigPromise = (async () => {
    try {
      const config = await api.notifications.getFcmConfig();
      if (config && config.projectId && config.apiKey) {
        return config;
      }
    } catch (err) {
      console.warn('[firebaseConfig] Could not fetch FCM config from server:', err);
    }
    return null;
  })().finally(() => {
    inFlightConfigPromise = null;
  });

  return inFlightConfigPromise;
}

function attachPushSubscriptionChangeListener(): void {
  if (typeof window === 'undefined' || swSubscriptionListenerAttached) return;
  swSubscriptionListenerAttached = true;

  const handleMessage = (data: any) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'SW_PUSH_RECEIVED' && data.payload) {
      handleForegroundFcmPayload(data.payload, { skipOsNotification: true });
      return;
    }
    if (data.type === 'SW_PUSH_SUBSCRIPTION_CHANGED') {
      clearPersistedFcmSyncSignature();
      void syncFcmTokenSilently();
      return;
    }
    if (data.type === 'SW_NOTIFICATION_DELIVERY_BLOCKED') {
      window.dispatchEvent(
        new CustomEvent('pos:notification-delivery-blocked', {
          detail: { reason: data.reason || 'delivery-rejected' },
        })
      );
      return;
    }
    if (data.type === 'SW_NOTIFICATION_DELIVERY_RESTORED') {
      window.dispatchEvent(new CustomEvent('pos:notification-delivery-restored'));
    }
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(PUSH_DEDUPE_CHANNEL_NAME);
      if (typeof (channel as any).unref === 'function') {
        (channel as any).unref();
      }
      channel.addEventListener('message', (event: MessageEvent) => handleMessage(event.data));
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => handleMessage(event.data));
    } catch {}
  }
}

/**
 * Resolves and activates the single root Service Worker (/sw.js at scope '/').
 * Removes any competing legacy '/firebase-cloud-messaging-push-scope' worker so
 * Chrome/Edge/Firefox never split PushManager subscriptions across two scopes.
 */
export async function resolveActivePushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    if (typeof navigator.serviceWorker.getRegistrations === 'function') {
      const allRegs = await navigator.serviceWorker.getRegistrations().catch(() => [] as ServiceWorkerRegistration[]);
      for (const reg of allRegs) {
        if (reg.scope && reg.scope.includes('firebase-cloud-messaging-push-scope')) {
          await reg.unregister().catch(() => {});
        }
      }
    }

    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg && typeof navigator.serviceWorker.register === 'function') {
      reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    } else if (reg && typeof reg.update === 'function') {
      void reg.update().catch(() => {});
    }

    if (reg?.waiting) {
      try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch {}
    }

    let readyTimeout: ReturnType<typeof setTimeout> | null = null;
    const readyReg = await Promise.race([
      navigator.serviceWorker.ready.finally(() => {
        if (readyTimeout) clearTimeout(readyTimeout);
      }),
      new Promise<ServiceWorkerRegistration | null>((resolve) => {
        readyTimeout = setTimeout(() => resolve(null), 5000);
      }),
    ]);
    if (readyReg?.active && readyReg.scope === reg?.scope) {
      reg = readyReg;
    }

    if (reg && (!reg.active || reg.active.state !== 'activated')) {
      await new Promise<void>((resolve) => {
        if (reg?.active && reg.active.state === 'activated') return resolve();
        const timer = setTimeout(resolve, 3500);
        const worker = reg?.installing || reg?.waiting || reg?.active;
        if (worker) {
          worker.addEventListener('statechange', (e: any) => {
            if (e.target?.state === 'activated' || reg?.active?.state === 'activated') {
              clearTimeout(timer);
              resolve();
            }
          });
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
    }

    if (reg?.active) {
      return reg;
    }

    const freshReg = await navigator.serviceWorker.getRegistration('/');
    return freshReg?.active ? freshReg : null;
  } catch (err) {
    console.warn('[firebaseConfig] Service worker readiness notice:', err);
    return null;
  }
}

async function ensureCleanPushSubscriptionForVapid(
  reg: ServiceWorkerRegistration,
  vapidKey?: string
): Promise<void> {
  if (!reg?.pushManager || typeof reg.pushManager.getSubscription !== 'function') return;
  try {
    const existingSub = await reg.pushManager.getSubscription();
    if (!existingSub) return;

    if (vapidKey && existingSub.options?.applicationServerKey) {
      if (!doVapidKeysMatch(existingSub.options.applicationServerKey, vapidKey)) {
        await existingSub.unsubscribe().catch(() => {});
      }
    }
  } catch {}
}

async function clearFirebaseMessagingIndexedDbCache(appId?: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(finish, 400);
    try {
      const req = indexedDB.open('firebase-messaging-database');
      req.onerror = () => {
        clearTimeout(timer);
        finish();
      };
      req.onupgradeneeded = () => {
        // Database did not exist yet; abort creation so Firebase initializes schema cleanly
        try {
          req.transaction?.abort();
        } catch {}
        clearTimeout(timer);
        finish();
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const storeNames = ['firebase-messaging-store', 'firebase-messaging-fid-registration-store'].filter((name) =>
            db.objectStoreNames.contains(name)
          );
          if (storeNames.length === 0) {
            db.close();
            clearTimeout(timer);
            finish();
            return;
          }
          const tx = db.transaction(storeNames, 'readwrite');
          for (const storeName of storeNames) {
            const store = tx.objectStore(storeName);
            // Always clear all cached appId/FID entries so switching Firebase Web Apps never leaves stale registrations behind
            store.clear();
          }
          tx.oncomplete = () => {
            try {
              db.close();
            } catch {}
            clearTimeout(timer);
            finish();
          };
          tx.onerror = () => {
            try {
              db.close();
            } catch {}
            clearTimeout(timer);
            finish();
          };
        } catch {
          try {
            db.close();
          } catch {}
          clearTimeout(timer);
          finish();
        }
      };
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

export async function resetFirebaseClientCache(clearLocalToken = false): Promise<void> {
  cachedFirebaseConfigSig = '';
  cachedMessaging = null;
  if (onMessageUnsubscribe) {
    try {
      onMessageUnsubscribe();
    } catch {}
    onMessageUnsubscribe = null;
  }
  if (cachedFirebaseApp) {
    try {
      await deleteApp(cachedFirebaseApp);
    } catch {}
    cachedFirebaseApp = null;
  }
  if (clearLocalToken && typeof localStorage !== 'undefined') {
    clearPersistedFcmSyncSignature();
  }
}

function handleForegroundFcmPayload(
  payload: any,
  options?: { skipOsNotification?: boolean }
): void {
  if (!payload || typeof payload !== 'object') return;

  const dedupeKey = getNotificationDedupeKey(payload);
  // Ensure each eventId/tag triggers foreground UI dispatch at most once across onMessage & SW_PUSH_RECEIVED
  if (!claimNotificationChannel(dedupeKey, 'toast')) {
    return;
  }

  const title = payload.notification?.title || payload.data?.title || 'POS Notification';
  const rawBody = payload.notification?.body || payload.data?.body || 'New operational activity';
  const actionType = String(payload.data?.type || '').toUpperCase();
  const isPosTx = ['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE'].includes(actionType);
  const dataCustomer = String(payload.data?.customerName || '').trim() || 'Walk-in Customer';
  const dataCashier = String(payload.data?.cashierName || '').trim() || 'Counter Staff';
  const dataPairs = Number(payload.data?.totalPairs);
  let body = rawBody;
  if (isPosTx) {
    const extraLines: string[] = [];
    const hasPairs = /\b\d+(?:\.\d+)?\s*(?:pairs?|cartons?|boxes?|dozens?)\b/i.test(rawBody);
    const hasCustomer =
      rawBody.toLowerCase().includes(dataCustomer.toLowerCase()) ||
      /\b(?:sold to|customer|returned by|exchanged by)\s*:?\s*\S+/i.test(rawBody);
    const hasCashier =
      rawBody.toLowerCase().includes(dataCashier.toLowerCase()) ||
      /\b(?:processed by|cashier)\s*:/i.test(rawBody);
    if (!hasPairs && payload.data?.totalPairs !== undefined && payload.data?.totalPairs !== '' && Number.isFinite(dataPairs)) {
      extraLines.push(`Total Pairs: ${dataPairs} ${dataPairs === 1 ? 'pair' : 'pairs'}`);
    }
    if (!hasCustomer) {
      extraLines.push(`Customer: ${dataCustomer}`);
    }
    if (!hasCashier) {
      extraLines.push(`Processed by: ${dataCashier}`);
    }
    if (extraLines.length > 0) {
      body = rawBody ? `${rawBody}\n${extraLines.join('\n')}` : extraLines.join('\n');
    }
  }
  const deepLinkUrl = payload.data?.url || '/pos';
  const isAdminTarget = String(deepLinkUrl).startsWith('/admin') || payload.data?.isAdmin === 'true';
  const icon = payload.notification?.icon || payload.data?.icon || (isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png');
  const rawBadge = payload.data?.badge || (payload.notification as Record<string, any> | undefined)?.badge;
  const badge = rawBadge && !String(rawBadge).includes('pwa-192x192') ? rawBadge : '/icons/badge-favicon.png';
  const tag =
    payload.data?.tag ||
    payload.data?.eventId ||
    payload.data?.event_id ||
    (payload.notification as Record<string, any> | undefined)?.tag ||
    payload.messageId ||
    dedupeKey;

  const parsedTimestamp = Number(payload.data?.timestamp) || Date.now();
  let activeUserRole = '';
  try {
    const rawUser = localStorage.getItem('pos_current_user');
    if (rawUser) {
      activeUserRole = String(JSON.parse(rawUser)?.role || '').toUpperCase();
    }
  } catch {}

  const mergedFcmData = {
    ...(payload.data || {}),
    url: deepLinkUrl,
    isAdmin: isAdminTarget ? 'true' : 'false',
    eventId: payload.data?.eventId || tag,
    tag,
    timestamp: parsedTimestamp,
    userRole: payload.data?.userRole || activeUserRole,
  };

  // Emit shared foreground FCM event so Header bell, toast, PosNotificationBanner, and SuperAdmin update without polling
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pos:fcm-notification', {
        detail: {
          id: payload.data?.announcementId || payload.data?.notificationId || tag,
          eventId: mergedFcmData.eventId,
          tag,
          type: payload.data?.type || 'INFO',
          itemType: payload.data?.itemType || '',
          title,
          message: body,
          invoiceNumber: payload.data?.invoiceNumber || undefined,
          purchaseNumber: payload.data?.purchaseNumber || undefined,
          returnNumber: payload.data?.returnNumber || undefined,
          saleId: payload.data?.saleId || undefined,
          announcementId: payload.data?.announcementId || undefined,
          totalAmount: payload.data?.totalAmount ? Number(payload.data.totalAmount) : undefined,
          totalPairs: Number.isFinite(dataPairs) && payload.data?.totalPairs !== '' ? dataPairs : undefined,
          customerName: payload.data?.customerName || undefined,
          cashierName: payload.data?.cashierName || undefined,
          targetRole: payload.data?.targetRole || undefined,
          deepLinkUrl,
          actionUrl: deepLinkUrl,
          actionLabel: payload.data?.actionLabel || undefined,
          timestamp: new Date(parsedTimestamp).toISOString(),
          isAdmin: isAdminTarget,
        },
      })
    );
  }

  // Play alert audio chime once per foreground FCM event (when target role matches active user)
  const payloadTargetRole = payload.data?.targetRole ? String(payload.data.targetRole).toUpperCase() : '';
  const payloadTypeUpper = String(payload.data?.type || 'INFO').toUpperCase();
  const isRoleEligibleForAudio =
    !activeUserRole ||
    ((activeUserRole !== 'SUPERADMIN' || !['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE', 'PURCHASE', 'STOCK'].includes(payloadTypeUpper)) &&
      (!payloadTargetRole || payloadTargetRole === 'ALL' || payloadTargetRole === activeUserRole || (activeUserRole === 'OWNER' && payloadTargetRole === 'ADMIN')));

  if (isRoleEligibleForAudio && claimNotificationChannel(dedupeKey, 'audio')) {
    playAudioFeedback.success();
  }

  if (options?.skipOsNotification) {
    return;
  }

  // Show browser/Android shade notification once per eventId/tag if permitted and not already shown by SW
  let androidDeliveryBlocked = false;
  try {
    androidDeliveryBlocked =
      localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true' &&
      localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY) === 'delivery-rejected';
  } catch {}

  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    !androidDeliveryBlocked &&
    !isNotificationChannelClaimed(dedupeKey, 'os_notification') &&
    claimNotificationChannel(dedupeKey, 'os_notification')
  ) {
    void showSingleShadeNotification(
      title,
      {
        body,
        icon,
        badge,
        tag,
        timestamp: parsedTimestamp,
        requireInteraction: false,
        renotify: false,
        actions: buildPushNotificationActions(
          { ...mergedFcmData, title, message: body },
          activeUserRole
        ),
        data: mergedFcmData,
      },
      () => {
        window.focus();
        navigateToNotificationUrl(deepLinkUrl, mergedFcmData);
      }
    );
  }
}

export async function initFirebaseClient(): Promise<{ app: FirebaseApp | null; messaging: Messaging | null }> {
  if (typeof window === 'undefined') {
    return { app: null, messaging: null };
  }

  attachPushSubscriptionChangeListener();

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return { app: null, messaging: null };
  }

  const config = await fetchFcmConfig();
  if (!config || !config.apiKey || !config.projectId) {
    return { app: null, messaging: null };
  }

  const nextConfigSig = `${config.projectId}:${config.apiKey}:${config.messagingSenderId || ''}:${config.appId || ''}`;
  if (cachedFirebaseApp && cachedMessaging && cachedFirebaseConfigSig === nextConfigSig) {
    return { app: cachedFirebaseApp, messaging: cachedMessaging };
  }

  try {
    let app: FirebaseApp;
    if (getApps().length > 0) {
      const existing = getApp();
      const opts = existing.options || {};
      const sameOptions =
        opts.projectId === config.projectId &&
        opts.apiKey === config.apiKey &&
        (opts.messagingSenderId || '') === (config.messagingSenderId || '') &&
        (opts.appId || '') === (config.appId || '');
      if (sameOptions) {
        app = existing;
      } else {
        if (onMessageUnsubscribe) {
          try {
            onMessageUnsubscribe();
          } catch {}
          onMessageUnsubscribe = null;
        }
        await deleteApp(existing).catch(() => {});
        app = initializeApp({
          apiKey: config.apiKey,
          projectId: config.projectId,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId,
          measurementId: config.measurementId,
        });
      }
    } else {
      app = initializeApp({
        apiKey: config.apiKey,
        projectId: config.projectId,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        measurementId: config.measurementId,
      });
    }

    const messaging = getMessaging(app);
    cachedFirebaseApp = app;
    cachedMessaging = messaging;
    cachedFirebaseConfigSig = nextConfigSig;

    // Attach foreground message listener once
    if (!onMessageUnsubscribe) {
      onMessageUnsubscribe = onMessage(messaging, (payload) => {
        handleForegroundFcmPayload(payload);
      });
    }

    return { app, messaging };
  } catch (err) {
    console.warn('[firebaseConfig] Error initializing Firebase client:', err);
    return { app: null, messaging: null };
  }
}

export const ANDROID_SYSTEM_DISABLED_KEY = 'pos_android_system_notifications_disabled';
export const ANDROID_SYSTEM_DISABLED_REASON_KEY = 'pos_android_system_notifications_disabled_reason';
export const PUSH_PERMISSION_DENIED_KEY = 'pos_push_permission_denied';
export const PUSH_PERMISSION_PROMPTED_KEY = 'pos_push_permission_prompted';
export const PUSH_ENABLED_KEY = 'pos_push_notifications_enabled';
export const PUSH_USER_OPTED_OUT_KEY = 'pos_push_user_opted_out';
export const PUSH_DEVICE_ID_KEY = 'pos_push_device_id';
export const FCM_TOKEN_KEY = 'pos_fcm_token';
export const FCM_CLIENT_CONFIG_SIG_KEY = 'pos_fcm_client_config_sig';

export function getOrCreatePushDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = localStorage.getItem(PUSH_DEVICE_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,40}$/.test(existing)) {
      return existing;
    }
    const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PUSH_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return '';
  }
}

export function isExplicitUserPushOptOut(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(PUSH_USER_OPTED_OUT_KEY) === 'true') {
      return true;
    }
    const enabledVal = localStorage.getItem(PUSH_ENABLED_KEY);
    const denialVal = localStorage.getItem(PUSH_PERMISSION_DENIED_KEY);
    // Legacy builds set PUSH_ENABLED_KEY='false' alongside PUSH_PERMISSION_DENIED_KEY='true' on OS/browser denial.
    // Once Notification.permission is 'granted', treat denial-induced 'false' as healed rather than user opt-out.
    if (enabledVal === 'false') {
      if (denialVal === 'true' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        localStorage.removeItem(PUSH_ENABLED_KEY);
        localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
        return false;
      }
      return denialVal !== 'true';
    }
  } catch {}
  return false;
}

function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent || '');
}

function isAndroidTwaEnvironment(): boolean {
  if (typeof window === 'undefined' || !isAndroidDevice()) return false;
  const ref = typeof document !== 'undefined' ? document.referrer || '' : '';
  const isStandalone =
    (window.navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.matchMedia?.('(display-mode: fullscreen)')?.matches;
  return ref.startsWith('android-app://') || Boolean(isStandalone);
}

async function queryBrowserPermissionsState(): Promise<PermissionState | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return null;
  }
  try {
    const status = await navigator.permissions.query({ name: 'notifications' as PermissionName });
    return status?.state || null;
  } catch {
    return null;
  }
}

async function queryPushManagerPermissionState(
  reg: ServiceWorkerRegistration | null
): Promise<PermissionState | null> {
  if (!reg?.pushManager || typeof reg.pushManager.permissionState !== 'function') {
    return null;
  }
  try {
    return await reg.pushManager.permissionState({ userVisibleOnly: true });
  } catch {
    return null;
  }
}

function isPermissionBlockedError(err: any): boolean {
  const code = String(err?.code || '').toLowerCase();
  const name = String(err?.name || '').toLowerCase();
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    code.includes('permission-blocked') ||
    code.includes('permission-default') ||
    name === 'notallowederror' ||
    msg.includes('permission-blocked') ||
    msg.includes('notification permission') ||
    msg.includes('permission denied') ||
    msg.includes('notifications are disabled')
  );
}

/**
 * Core background token acquisition and database sync.
 * Assumes Notification.permission is 'granted' or already established.
 * Reuses any existing valid PushManager subscription and FCM token without requesting UI permission.
 */
export async function acquireAndSyncFcmToken(
  overrideRole?: string,
  options?: { forceRefresh?: boolean }
): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  androidSystemDisabled?: boolean;
}> {
  const forceRefresh = Boolean(options?.forceRefresh);
  if (typeof window === 'undefined') {
    return { success: false, error: 'Notifications are only available in a browser environment.' };
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return { success: false, error: 'Notification permission is not granted on this device.' };
  }

  if (inFlightTokenSync && !forceRefresh) {
    return inFlightTokenSync;
  }

  inFlightTokenSync = (async () => {
    try {
      // 1. Check Permissions API & active SW PushManager permission state before assuming OS permission is active
      const permissionsApiState = await queryBrowserPermissionsState();
      const activeSwReg = await resolveActivePushServiceWorker();
      const pushManagerState = await queryPushManagerPermissionState(activeSwReg);

      // Note: On Chrome before a PushSubscription exists and in Android TWA (Notification Delegation),
      // Permissions API and/or pushManager.permissionState() legitimately return 'prompt' even when
      // Notification.permission is 'granted'. Only explicit 'denied' indicates OS/browser blockage here.
      const discrepancyBlocked =
        permissionsApiState === 'denied' ||
        pushManagerState === 'denied';

      if (discrepancyBlocked) {
        const androidBlocked = isAndroidDevice();
        if (androidBlocked) {
          localStorage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
          localStorage.setItem(
            ANDROID_SYSTEM_DISABLED_REASON_KEY,
            permissionsApiState === 'denied' ? 'permission-api' : 'push-manager'
          );
        }
        window.dispatchEvent(
          new CustomEvent('pos:push-status-changed', {
            detail: {
              permission: Notification.permission,
              isSubscribed: false,
              androidSystemDisabled: androidBlocked,
            },
          })
        );
        return {
          success: false,
          androidSystemDisabled: androidBlocked,
          error: androidBlocked
            ? 'Browser notification permission is granted, but Android system or app notifications appear disabled. Enable Notifications in Android Settings → Apps → Notifications.'
            : 'Notification permission is blocked or incomplete in your browser settings.',
        };
      }

      // If permissions API / PushManager are not 'denied', clear prior permission-api / push-manager / post-notifications block markers
      const priorReason = localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
      if (
        priorReason === 'permission-api' ||
        priorReason === 'push-manager' ||
        priorReason === 'post-notifications'
      ) {
        localStorage.removeItem(ANDROID_SYSTEM_DISABLED_KEY);
        localStorage.removeItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
      }

      // 2. Initialize Firebase client
      const { messaging } = await initFirebaseClient();
      if (!messaging) {
        return {
          success: false,
          error: 'Firebase Cloud Messaging is not yet configured in SuperAdmin settings. Please enter FCM credentials.',
        };
      }

      // 3. Validate VAPID key and rotate stale PushSubscription/token whenever Firebase config changes
      let token: string | undefined;
      let vapidWarning: string | undefined;
      let tokenErrorDetail: string | undefined;

      const config = await fetchFcmConfig();
      const rawVapid = typeof config?.vapidKey === 'string' ? config.vapidKey.trim() : '';
      const normalizedVapid = normalizeVapidPublicKey(rawVapid);
      const vapidKey = normalizedVapid || undefined;

      if (rawVapid && !normalizedVapid) {
        vapidWarning =
          'Configured Web Push VAPID key appears malformed. Re-save the Web Push Certificate key pair in Notification Settings.';
        console.warn('[firebaseConfig]', vapidWarning);
      }

      const activeClientConfigSig = `${config?.projectId || ''}:${config?.apiKey || ''}:${config?.messagingSenderId || ''}:${config?.appId || ''}:${vapidKey || ''}`;
      const previousClientConfigSig = localStorage.getItem(FCM_CLIENT_CONFIG_SIG_KEY) || '';
      const previousStoredToken = localStorage.getItem(FCM_TOKEN_KEY) || undefined;
      const hasConfigChanged = Boolean(
        (previousClientConfigSig && previousClientConfigSig !== activeClientConfigSig) ||
          (!previousClientConfigSig && previousStoredToken)
      );
      const shouldRotateToken = hasConfigChanged || forceRefresh;

      if (shouldRotateToken) {
        clearPersistedFcmSyncSignature();
        if (activeSwReg?.active) {
          try {
            activeSwReg.active.postMessage({ type: 'PREPARE_PUSH_SUBSCRIPTION_ROTATION' });
            if (typeof MessageChannel !== 'undefined') {
              await new Promise<void>((resolve) => {
                const mc = new MessageChannel();
                const timer = setTimeout(resolve, 600);
                mc.port1.onmessage = () => {
                  clearTimeout(timer);
                  resolve();
                };
                activeSwReg.active?.postMessage({ type: 'REINIT_FIREBASE_CONFIG' }, [mc.port2]);
              });
            } else {
              activeSwReg.active.postMessage({ type: 'REINIT_FIREBASE_CONFIG' });
            }
          } catch {}
        }
        // Bind the active root SW registration BEFORE deleteToken() so @firebase/messaging
        // never re-registers the competing /firebase-messaging-sw.js worker scope.
        if (activeSwReg) {
          try {
            (messaging as any).swRegistration = activeSwReg;
          } catch {}
        }
        if (typeof deleteToken === 'function' && activeSwReg) {
          await deleteToken(messaging).catch(() => false);
        }
        // Purge cached token details in IndexedDB even if cross-project DELETE /registrations failed
        await clearFirebaseMessagingIndexedDbCache();
        if (activeSwReg?.pushManager && typeof activeSwReg.pushManager.getSubscription === 'function') {
          const oldSub = await activeSwReg.pushManager.getSubscription().catch(() => null);
          if (oldSub) {
            await oldSub.unsubscribe().catch(() => {});
          }
        }
        try {
          localStorage.removeItem(FCM_TOKEN_KEY);
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }

      const storedToken = shouldRotateToken ? undefined : previousStoredToken;

      if (messaging && activeSwReg?.active) {
        await ensureCleanPushSubscriptionForVapid(activeSwReg, vapidKey);

        const existingSub = await activeSwReg.pushManager?.getSubscription?.().catch(() => null);
        const existingSubMatchesVapid = Boolean(
          existingSub &&
            (!vapidKey ||
              !existingSub.options?.applicationServerKey ||
              doVapidKeysMatch(existingSub.options.applicationServerKey, vapidKey))
        );

        try {
          token = await getToken(messaging, {
            serviceWorkerRegistration: activeSwReg,
            vapidKey,
          });
        } catch (fcmErr: any) {
          if (isPermissionBlockedError(fcmErr)) {
            const androidBlocked = isAndroidDevice();
            if (androidBlocked) {
              localStorage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
              localStorage.setItem(ANDROID_SYSTEM_DISABLED_REASON_KEY, 'push-manager');
            } else {
              localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
            }
            window.dispatchEvent(
              new CustomEvent('pos:push-status-changed', {
                detail: {
                  permission: Notification.permission,
                  isSubscribed: false,
                  androidSystemDisabled: androidBlocked,
                },
              })
            );
            return {
              success: false,
              androidSystemDisabled: androidBlocked,
              error: androidBlocked
                ? 'Android system notification permission (POST_NOTIFICATIONS) or app notifications appear disabled in Android Settings.'
                : 'Notifications are blocked by browser settings.',
            };
          }

          const msg = String(fcmErr?.message || fcmErr || '');
          tokenErrorDetail = msg || undefined;
          const isKeyMismatchOrCorruptSub =
            msg.includes('applicationServerKey') ||
            msg.includes('InvalidAccessError') ||
            (msg.includes('InvalidStateError') && !existingSubMatchesVapid);

          if (isKeyMismatchOrCorruptSub) {
            // Only unsubscribe & re-subscribe when the existing PushSubscription key actually mismatches or is corrupt
            try {
              const staleSub = await activeSwReg.pushManager.getSubscription();
              if (staleSub) {
                await staleSub.unsubscribe();
              }
              await new Promise((r) => setTimeout(r, 150));
              token = await getToken(messaging, {
                serviceWorkerRegistration: activeSwReg,
                vapidKey,
              });
              tokenErrorDetail = undefined;
            } catch (retryErr: any) {
              tokenErrorDetail = String(retryErr?.message || retryErr || msg) || undefined;
              console.warn(
                '[firebaseConfig] Background push token retry failed:',
                retryErr
              );
            }
          } else if (storedToken && existingSub && existingSubMatchesVapid && !hasConfigChanged) {
            // Transient network/AbortError while existing PushSubscription and FCM token are valid: reuse stored token
            token = storedToken;
            tokenErrorDetail = undefined;
          } else {
            console.warn(
              '[firebaseConfig] Background push token notice (activating real-time alert stream fallback):',
              fcmErr
            );
          }
        }
      } else if (!activeSwReg?.active) {
        if (storedToken && !hasConfigChanged) {
          token = storedToken;
        } else {
          tokenErrorDetail = 'Root Service Worker (/sw.js) is not active yet.';
          console.warn(
            '[firebaseConfig] Root Service Worker (/sw.js) did not reach active state; skipping competing SW registration.'
          );
        }
      }

      // 4. Send token to backend if obtained (coalescing unchanged session signatures & cleaning up rotated tokens)
      if (token) {
        let userRole = overrideRole || 'ADMIN';
        let tenantId = getActiveTenantId() || 1;
        let userId = 0;
        try {
          const stored = localStorage.getItem('pos_current_user');
          if (stored) {
            const u = JSON.parse(stored);
            if (u.role) userRole = String(u.role).toUpperCase();
            if (u.tenantId || u.tenant_id) tenantId = Number(u.tenantId || u.tenant_id);
            if (u.id) userId = Number(u.id);
          }
        } catch {}
        if (userRole === 'SUPERADMIN') {
          tenantId = 0;
        }

        const syncSignature = `${tenantId}:${userId}:${userRole}:${token}`;
        const previousToken = previousStoredToken || localStorage.getItem(FCM_TOKEN_KEY) || undefined;

        if (shouldRotateToken || !hasFreshFcmSyncSignature(syncSignature) || (previousToken && previousToken !== token)) {
          const deviceId = getOrCreatePushDeviceId();
          const baseDeviceName = `${navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop/Laptop'} (${navigator.platform || 'Web'})`;
          const deviceName = deviceId ? `${baseDeviceName} [id:${deviceId}]` : baseDeviceName;

          await api.notifications.registerFcmToken({
            token,
            previousToken: previousToken && previousToken !== token ? previousToken : undefined,
            tenantId,
            userId,
            userRole,
            userAgent: navigator.userAgent,
            deviceName,
          });

          localStorage.setItem(FCM_TOKEN_KEY, token);
          localStorage.setItem(FCM_CLIENT_CONFIG_SIG_KEY, activeClientConfigSig);
          persistFcmSyncSignature(syncSignature);
        } else if (activeClientConfigSig) {
          localStorage.setItem(FCM_CLIENT_CONFIG_SIG_KEY, activeClientConfigSig);
        }
      } else if (shouldRotateToken && previousStoredToken) {
        await api.notifications.removeFcmToken(previousStoredToken).catch(() => {});
      }

      const stillDeliveryBlocked =
        localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true' &&
        localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY) === 'delivery-rejected';

      if (!token) {
        localStorage.setItem(PUSH_ENABLED_KEY, 'false');
        window.dispatchEvent(
          new CustomEvent('pos:push-status-changed', {
            detail: {
              token: undefined,
              permission: 'granted',
              isSubscribed: false,
              androidSystemDisabled: stillDeliveryBlocked,
            },
          })
        );
        return {
          success: false,
          androidSystemDisabled: stillDeliveryBlocked,
          error:
            vapidWarning ||
            tokenErrorDetail ||
            'Could not register an FCM push token for this browser. Verify Web API Key, Sender ID, Web App ID, and VAPID key in Notification Settings.',
        };
      }

      // Mark notifications as enabled in localStorage and clear denial / prompt / explicit opt-out flags
      localStorage.setItem(PUSH_ENABLED_KEY, 'true');
      localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
      localStorage.removeItem(PUSH_PERMISSION_PROMPTED_KEY);
      localStorage.removeItem(PUSH_USER_OPTED_OUT_KEY);

      // Notify other components that notification state updated
      window.dispatchEvent(
        new CustomEvent('pos:push-status-changed', {
          detail: {
            token,
            permission: 'granted',
            isSubscribed: !stillDeliveryBlocked,
            androidSystemDisabled: stillDeliveryBlocked,
            mode: 'fcm',
          },
        })
      );

      if (stillDeliveryBlocked) {
        return {
          success: false,
          token,
          androidSystemDisabled: true,
          error:
            'Browser permission is granted, but Android system notifications for this app appear disabled. Enable Notifications in Android Settings and tap Check Status.',
        };
      }

      return {
        success: true,
        token,
        mode: 'fcm',
      };
    } catch (err: any) {
      console.error('[firebaseConfig] Exception in acquireAndSyncFcmToken:', err);
      const stillBlocked = localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true';
      window.dispatchEvent(
        new CustomEvent('pos:push-status-changed', {
          detail: {
            permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
            isSubscribed: false,
            androidSystemDisabled: stillBlocked,
          },
        })
      );
      return {
        success: false,
        androidSystemDisabled: stillBlocked,
        error: stillBlocked
          ? 'Browser permission is granted, but Android system notifications appear disabled in device settings.'
          : err?.message || 'Failed to complete notification registration.',
      };
    } finally {
      inFlightTokenSync = null;
    }
  })();

  return inFlightTokenSync;
}

/**
 * Silent background token sync for active sessions where permission was already granted.
 * Ensures the token remains valid and registered in the database without any UI disruption.
 */
export async function syncFcmTokenSilently(overrideRole?: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  if (isExplicitUserPushOptOut()) return false;

  try {
    const res = await acquireAndSyncFcmToken(overrideRole);
    return res.success;
  } catch {
    return false;
  }
}

/**
 * Two-step permission flow entrypoint:
 * Step 1: Checks existing Notification.permission + Permissions API before ever calling requestPermission().
 *   - If already 'granted', never re-prompts; reuses/syncs existing FCM registration cleanly.
 *   - If already 'denied', never re-prompts; returns guidance for browser / Android settings.
 *   - Only calls Notification.requestPermission() when state is genuinely 'default'.
 * Step 2: If granted, calls acquireAndSyncFcmToken() to obtain/reuse and store the FCM token.
 */
export async function requestFcmPermissionAndToken(overrideRole?: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  permission?: NotificationPermission;
  androidSystemDisabled?: boolean;
  alreadyPrompted?: boolean;
}> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Notifications are only available in a browser environment.' };
  }

  if (!('Notification' in window)) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  if (inFlightPermissionRequest) {
    return inFlightPermissionRequest;
  }

  inFlightPermissionRequest = (async () => {
    try {
      let permission = Notification.permission;
      const permissionsApiState = await queryBrowserPermissionsState();

      // Never call requestPermission() if browser or Permissions API already says denied
      if (permission === 'denied' || (permission === 'default' && permissionsApiState === 'denied')) {
        localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
        const androidTwa = isAndroidTwaEnvironment();
        window.dispatchEvent(
          new CustomEvent('pos:push-status-changed', {
            detail: { permission: 'denied', isSubscribed: false, androidSystemDisabled: androidTwa },
          })
        );
        return {
          success: false,
          permission: 'denied',
          androidSystemDisabled: androidTwa,
          error: androidTwa
            ? 'Notifications are blocked in Android or Chrome settings. Enable Notifications in Android Settings → Apps → Notifications and Chrome site settings.'
            : 'Notifications are currently blocked by your browser settings. Please click the lock or site settings icon in your address bar to allow alerts.',
        };
      }

      // Strictly enforce 1 permission prompt trigger: never call requestPermission() again after dismissal/denial
      if (permission === 'default') {
        let alreadyPromptedBefore = false;
        try {
          alreadyPromptedBefore =
            localStorage.getItem(PUSH_PERMISSION_PROMPTED_KEY) === 'true' ||
            localStorage.getItem(PUSH_PERMISSION_DENIED_KEY) === 'true';
        } catch {}

        if (alreadyPromptedBefore) {
          const androidTwa = isAndroidTwaEnvironment();
          const androidBlocked =
            androidTwa ||
            (() => {
              try {
                return localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true';
              } catch {
                return false;
              }
            })();
          return {
            success: false,
            permission: 'default',
            alreadyPrompted: true,
            androidSystemDisabled: androidBlocked,
            error: isAndroidDevice()
              ? 'Notification permission prompt was already shown once. To prevent Android spam warnings, please enable Notifications manually in Chrome Site Settings (🔒) or Android Settings → Apps → Notifications, then tap Check Status.'
              : 'Notification permission prompt was already shown. Please click the lock or site settings icon in your address bar to set Notifications to Allow, then tap Check Status.',
          };
        }

        // Mark prompted BEFORE calling Notification.requestPermission() so concurrent triggers or reloads cannot ask twice
        try {
          localStorage.setItem(PUSH_PERMISSION_PROMPTED_KEY, 'true');
        } catch {}

        permission = await Notification.requestPermission();

        // If user dismissed ('default') or denied, persist denial marker immediately so we never trigger repeat prompts
        if (permission !== 'granted') {
          const androidTwa = isAndroidTwaEnvironment();
          try {
            localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
            if (androidTwa && permission === 'default') {
              localStorage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
              localStorage.setItem(ANDROID_SYSTEM_DISABLED_REASON_KEY, 'post-notifications');
            }
          } catch {}
        }
      }

      if (permission !== 'granted') {
        if (permission === 'denied') {
          try {
            localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
          } catch {}
        }
        const androidBlocked =
          isAndroidTwaEnvironment() &&
          (permission === 'denied' || localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true');
        window.dispatchEvent(
          new CustomEvent('pos:push-status-changed', {
            detail: { permission, isSubscribed: false, androidSystemDisabled: androidBlocked },
          })
        );
        return {
          success: false,
          permission,
          androidSystemDisabled: androidBlocked,
          error:
            permission === 'denied' || androidBlocked
              ? isAndroidDevice()
                ? 'Notifications are blocked in Chrome or Android system settings. Allow notifications in Android Settings → Apps → Notifications, then tap Check Status.'
                : 'Notifications are currently blocked by your browser settings. Please click the lock or site settings icon in your address bar to allow alerts.'
              : isAndroidDevice()
              ? 'Notification prompt was dismissed. Enable Notifications in Chrome Site Settings (🔒) or Android Settings, then tap Check Status.'
              : 'Notification permission request was dismissed.',
        };
      }

      // Permission is 'granted' — clear explicit user opt-out and transient permission flags,
      // then run token reuse/sync (which still re-validates Permissions API & PushManager state)
      localStorage.removeItem(PUSH_USER_OPTED_OUT_KEY);
      localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
      localStorage.removeItem(PUSH_PERMISSION_PROMPTED_KEY);
      const disabledReason = localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
      if (
        disabledReason === 'post-notifications' ||
        disabledReason === 'permission-api' ||
        disabledReason === 'push-manager'
      ) {
        localStorage.removeItem(ANDROID_SYSTEM_DISABLED_KEY);
        localStorage.removeItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
      }

      const acquireRes = await acquireAndSyncFcmToken(overrideRole);
      return {
        success: acquireRes.success,
        token: acquireRes.token,
        permission: 'granted',
        mode: acquireRes.mode,
        warning: acquireRes.warning,
        error: acquireRes.error,
        androidSystemDisabled: acquireRes.androidSystemDisabled,
      };
    } catch (err: any) {
      console.error('[firebaseConfig] Exception in requestFcmPermissionAndToken:', err);
      return {
        success: false,
        error: err?.message || 'Failed to request notification permission.',
      };
    } finally {
      inFlightPermissionRequest = null;
    }
  })();

  return inFlightPermissionRequest;
}

/**
 * Alias for requestFcmPermissionAndToken for backwards compatibility with existing callers.
 */
export async function requestFcmDeviceToken(overrideRole?: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  permission?: NotificationPermission;
  androidSystemDisabled?: boolean;
  alreadyPrompted?: boolean;
}> {
  return requestFcmPermissionAndToken(overrideRole);
}

/**
 * Unsubscribes and deletes the FCM token via Firebase deleteToken(), removes it from
 * the backend database, and cleans up browser PushManager & localStorage flags.
 */
export async function unregisterFcmDeviceToken(): Promise<boolean> {
  clearPersistedFcmSyncSignature();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(FCM_TOKEN_KEY) : null;

  // 1. Gracefully delete the client FCM token with Firebase SDK
  try {
    let messagingInstance = cachedMessaging;
    if (!messagingInstance) {
      const initialized = await initFirebaseClient().catch(() => ({ app: null, messaging: null }));
      messagingInstance = initialized.messaging;
    }
    if (messagingInstance && typeof deleteToken === 'function') {
      await deleteToken(messagingInstance).catch(() => false);
    }
  } catch {}

  // 2. Remove the token from backend PostgreSQL storage
  if (token) {
    try {
      await api.notifications.removeFcmToken(token);
    } catch {}
    try {
      localStorage.removeItem(FCM_TOKEN_KEY);
    } catch {}
  }

  // 3. Unsubscribe active Web Push subscription on root SW scope
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await sub.unsubscribe().catch(() => {});
      }
    } catch {}
  }

  try {
    localStorage.setItem(PUSH_ENABLED_KEY, 'false');
    localStorage.setItem(PUSH_USER_OPTED_OUT_KEY, 'true');
    localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pos:push-status-changed', {
        detail: {
          permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
          isSubscribed: false,
        },
      })
    );
  }
  return true;
}
