import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { api, getActiveTenantId } from './api.ts';
import { playAudioFeedback } from '../utils/audio.ts';
import {
  PUSH_DEDUPE_CHANNEL_NAME,
  claimNotificationChannel,
  getNotificationDedupeKey,
  isNotificationChannelClaimed,
} from '../utils/notificationDedupe.ts';
import { showGroupedShadeNotification } from '../utils/notificationShade.ts';
import { doVapidKeysMatch, normalizeVapidPublicKey } from '../utils/vapid.ts';

const CONFIG_CACHE_TTL_MS = 60_000;

let cachedFirebaseApp: FirebaseApp | null = null;
let cachedMessaging: Messaging | null = null;
let cachedConfig: any = null;
let cachedConfigFetchedAt = 0;
let inFlightConfigPromise: Promise<any> | null = null;
let onMessageUnsubscribe: (() => void) | null = null;
let inFlightTokenSync: Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
}> | null = null;
let lastSyncedSignature = '';
let swSubscriptionListenerAttached = false;

export function invalidateFcmConfigCache(): void {
  cachedConfig = null;
  cachedConfigFetchedAt = 0;
  inFlightConfigPromise = null;
  lastSyncedSignature = '';
}

export async function fetchFcmConfig(forceRefresh = false) {
  if (!forceRefresh && cachedConfig && Date.now() - cachedConfigFetchedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }
  if (!forceRefresh && inFlightConfigPromise) {
    return inFlightConfigPromise;
  }

  inFlightConfigPromise = (async () => {
    try {
      const config = await api.notifications.getFcmConfig();
      if (config && config.projectId && config.apiKey) {
        cachedConfig = config;
        cachedConfigFetchedAt = Date.now();
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
    if (data && data.type === 'SW_PUSH_SUBSCRIPTION_CHANGED') {
      lastSyncedSignature = '';
      void syncFcmTokenSilently();
    }
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(PUSH_DEDUPE_CHANNEL_NAME);
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
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }

    if (reg?.waiting) {
      try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch {}
    }

    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | null>((resolve) => setTimeout(() => resolve(null), 5000)),
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

export async function initFirebaseClient(): Promise<{ app: FirebaseApp | null; messaging: Messaging | null }> {
  if (typeof window === 'undefined') {
    return { app: null, messaging: null };
  }

  attachPushSubscriptionChangeListener();

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return { app: null, messaging: null };
  }

  if (cachedFirebaseApp && cachedMessaging) {
    return { app: cachedFirebaseApp, messaging: cachedMessaging };
  }

  const config = await fetchFcmConfig();
  if (!config || !config.apiKey || !config.projectId) {
    return { app: null, messaging: null };
  }

  try {
    let app: FirebaseApp;
    if (getApps().length > 0) {
      app = getApp();
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

    // Attach foreground message listener once
    if (!onMessageUnsubscribe) {
      onMessageUnsubscribe = onMessage(messaging, (payload) => {
        const title = payload.notification?.title || payload.data?.title || 'POS Notification';
        const body = payload.notification?.body || payload.data?.body || 'New operational activity';
        const deepLinkUrl = payload.data?.url || '/pos';
        const isAdminTarget = String(deepLinkUrl).startsWith('/admin') || payload.data?.isAdmin === 'true';
        const icon = payload.notification?.icon || payload.data?.icon || (isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png');
        const rawBadge = payload.data?.badge || (payload.notification as Record<string, any> | undefined)?.badge;
        const badge = rawBadge && !String(rawBadge).includes('pwa-192x192') ? rawBadge : '/icons/badge-favicon.png';
        const dedupeKey = getNotificationDedupeKey(payload);
        const tag = payload.data?.tag || payload.data?.eventId || `fcm-fg-${Date.now()}`;

        // Play alert audio chime only if SSE / SW did not already play it for this event
        if (claimNotificationChannel(dedupeKey, 'audio')) {
          playAudioFeedback.success();
        }

        // Show browser/Android shade notification once per eventId/tag if permitted and not already shown by SW
        if (
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          !isNotificationChannelClaimed(dedupeKey, 'os_notification') &&
          claimNotificationChannel(dedupeKey, 'os_notification')
        ) {
          const parsedTimestamp = Number(payload.data?.timestamp) || Date.now();
          void showGroupedShadeNotification(
            title,
            {
              body,
              icon,
              badge,
              tag,
              timestamp: parsedTimestamp,
              requireInteraction: false,
              renotify: false,
              actions: [
                { action: 'open_pos', title: isAdminTarget ? 'Open Admin' : 'Open POS' },
                { action: 'dismiss', title: 'Dismiss' },
              ],
              data: {
                url: deepLinkUrl,
                isAdmin: isAdminTarget ? 'true' : 'false',
                timestamp: parsedTimestamp,
              },
            },
            () => {
              window.focus();
              if (window.location.pathname !== deepLinkUrl) {
                window.location.href = deepLinkUrl;
              }
            }
          );
        }
      });
    }

    return { app, messaging };
  } catch (err) {
    console.warn('[firebaseConfig] Error initializing Firebase client:', err);
    return { app: null, messaging: null };
  }
}

/**
 * Core background token acquisition and database sync.
 * Assumes Notification.permission is 'granted' or already established.
 * Fetches the FCM device token and persists it to backend without requesting UI permission.
 */
export async function acquireAndSyncFcmToken(overrideRole?: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
}> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Notifications are only available in a browser environment.' };
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return { success: false, error: 'Notification permission is not granted on this device.' };
  }

  if (inFlightTokenSync) {
    return inFlightTokenSync;
  }

  inFlightTokenSync = (async () => {
    try {
      // 1. Initialize Firebase client
      const { messaging } = await initFirebaseClient();
      if (!messaging) {
        return {
          success: false,
          error: 'Firebase Cloud Messaging is not yet configured in SuperAdmin settings. Please enter FCM credentials.',
        };
      }

      // 2. Ensure the single root Service Worker (/sw.js) is active
      const activeSwReg = await resolveActivePushServiceWorker();

      // 3. Validate VAPID key and reconcile any stale PushManager subscription
      let token: string | undefined;
      let vapidWarning: string | undefined;

      const config = await fetchFcmConfig();
      const rawVapid = typeof config?.vapidKey === 'string' ? config.vapidKey.trim() : '';
      const normalizedVapid = normalizeVapidPublicKey(rawVapid);
      const vapidKey = normalizedVapid || undefined;

      if (rawVapid && !normalizedVapid) {
        vapidWarning =
          'Configured Web Push VAPID key appears malformed. Re-save the Web Push Certificate key pair in Notification Settings.';
        console.warn('[firebaseConfig]', vapidWarning);
      }

      if (messaging && activeSwReg?.active) {
        await ensureCleanPushSubscriptionForVapid(activeSwReg, vapidKey);

        try {
          token = await getToken(messaging, {
            serviceWorkerRegistration: activeSwReg,
            vapidKey,
          });
        } catch (fcmErr: any) {
          const msg = String(fcmErr?.message || fcmErr || '');
          // Recover cleanly from InvalidStateError / mismatched applicationServerKey / stale subscription
          if (
            msg.includes('applicationServerKey') ||
            msg.includes('InvalidStateError') ||
            msg.includes('subscription') ||
            msg.includes('AbortError')
          ) {
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
            } catch (retryErr) {
              console.warn(
                '[firebaseConfig] Background push token retry failed (activating real-time alert stream fallback):',
                retryErr
              );
            }
          } else {
            console.warn(
              '[firebaseConfig] Background push token notice (activating real-time alert stream fallback):',
              fcmErr
            );
          }
        }
      } else if (!activeSwReg?.active) {
        console.warn(
          '[firebaseConfig] Root Service Worker (/sw.js) did not reach active state; skipping competing SW registration.'
        );
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

        const syncSignature = `${tenantId}:${userId}:${userRole}:${token}`;
        const previousToken = localStorage.getItem('pos_fcm_token') || undefined;

        if (lastSyncedSignature !== syncSignature || (previousToken && previousToken !== token)) {
          const deviceName = `${navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop/Laptop'} (${navigator.platform || 'Web'})`;

          await api.notifications.registerFcmToken({
            token,
            previousToken: previousToken && previousToken !== token ? previousToken : undefined,
            tenantId,
            userId,
            userRole,
            userAgent: navigator.userAgent,
            deviceName,
          });

          localStorage.setItem('pos_fcm_token', token);
          lastSyncedSignature = syncSignature;
        }
      }

      // Mark notifications as enabled in localStorage and clear denial flag
      localStorage.setItem('pos_push_notifications_enabled', 'true');
      localStorage.removeItem('pos_push_permission_denied');

      // Notify other components that notification state updated
      window.dispatchEvent(
        new CustomEvent('pos:push-status-changed', {
          detail: { token, permission: 'granted', isSubscribed: true, mode: token ? 'fcm' : 'realtime' },
        })
      );

      return {
        success: true,
        token,
        mode: token ? 'fcm' : 'realtime',
        warning: !token
          ? vapidWarning ||
            'Real-time desktop alerts are active! (Live counter & sales alerts will pop up while POS is open).'
          : undefined,
      };
    } catch (err: any) {
      console.error('[firebaseConfig] Exception in acquireAndSyncFcmToken:', err);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        localStorage.setItem('pos_push_notifications_enabled', 'true');
        localStorage.removeItem('pos_push_permission_denied');
        window.dispatchEvent(
          new CustomEvent('pos:push-status-changed', {
            detail: { permission: 'granted', isSubscribed: true, mode: 'realtime' },
          })
        );
        return {
          success: true,
          mode: 'realtime',
          warning: 'Real-time notifications are enabled! You will receive live desktop and counter alerts while POS is open.',
        };
      }
      return {
        success: false,
        error: err?.message || 'Failed to complete notification registration.',
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
  if (localStorage.getItem('pos_push_notifications_enabled') === 'false') return false;

  try {
    const res = await acquireAndSyncFcmToken(overrideRole);
    return res.success;
  } catch {
    return false;
  }
}

/**
 * Two-step permission flow entrypoint:
 * Step 1: Explicitly requests browser/OS permission (triggered only by user intent).
 * Step 2: If granted, automatically calls acquireAndSyncFcmToken() to obtain and store the FCM token.
 * If denied: sets local denial flag and returns clean feedback for manual settings fallback.
 */
export async function requestFcmPermissionAndToken(overrideRole?: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  permission?: NotificationPermission;
}> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Notifications are only available in a browser environment.' };
  }

  if (!('Notification' in window)) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  try {
    // 1. Request browser/system notification permission
    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      if (permission === 'denied') {
        localStorage.setItem('pos_push_permission_denied', 'true');
        localStorage.setItem('pos_push_notifications_enabled', 'false');
      }
      window.dispatchEvent(
        new CustomEvent('pos:push-status-changed', {
          detail: { permission, isSubscribed: false },
        })
      );
      return {
        success: false,
        permission,
        error:
          permission === 'denied'
            ? 'Notifications are currently blocked by your browser settings. Please click the lock or site settings icon in your address bar to allow alerts.'
            : 'Notification permission request was dismissed.',
      };
    }

    // 2. Permission granted! Automatically acquire token and sync with backend
    const acquireRes = await acquireAndSyncFcmToken(overrideRole);
    return {
      success: acquireRes.success,
      token: acquireRes.token,
      permission: 'granted',
      mode: acquireRes.mode,
      warning: acquireRes.warning,
      error: acquireRes.error,
    };
  } catch (err: any) {
    console.error('[firebaseConfig] Exception in requestFcmPermissionAndToken:', err);
    return {
      success: false,
      error: err?.message || 'Failed to request notification permission.',
    };
  }
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
}> {
  return requestFcmPermissionAndToken(overrideRole);
}

/**
 * Unsubscribes and deletes the stored FCM token from the database.
 */
export async function unregisterFcmDeviceToken(): Promise<boolean> {
  lastSyncedSignature = '';
  const token = localStorage.getItem('pos_fcm_token');
  if (token) {
    try {
      await api.notifications.removeFcmToken(token);
    } catch {}
    localStorage.removeItem('pos_fcm_token');
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await sub.unsubscribe().catch(() => {});
      }
    } catch {}
  }
  localStorage.setItem('pos_push_notifications_enabled', 'false');
  window.dispatchEvent(
    new CustomEvent('pos:push-status-changed', {
      detail: { permission: typeof Notification !== 'undefined' ? Notification.permission : 'default', isSubscribed: false },
    })
  );
  return true;
}

export function getStoredFcmToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pos_fcm_token');
}
