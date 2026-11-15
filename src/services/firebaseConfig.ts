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
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
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

export const ANDROID_SYSTEM_DISABLED_KEY = 'pos_android_system_notifications_disabled';
export const ANDROID_SYSTEM_DISABLED_REASON_KEY = 'pos_android_system_notifications_disabled_reason';
export const PUSH_PERMISSION_DENIED_KEY = 'pos_push_permission_denied';
export const PUSH_ENABLED_KEY = 'pos_push_notifications_enabled';
export const FCM_TOKEN_KEY = 'pos_fcm_token';

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
export async function acquireAndSyncFcmToken(overrideRole?: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  androidSystemDisabled?: boolean;
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
      // 1. Check Permissions API & active SW PushManager permission state before assuming OS permission is active
      const permissionsApiState = await queryBrowserPermissionsState();
      const activeSwReg = await resolveActivePushServiceWorker();
      const pushManagerState = await queryPushManagerPermissionState(activeSwReg);

      const discrepancyBlocked =
        permissionsApiState === 'denied' ||
        permissionsApiState === 'prompt' ||
        pushManagerState === 'denied' ||
        pushManagerState === 'prompt';

      if (discrepancyBlocked) {
        const androidBlocked = isAndroidDevice();
        if (androidBlocked) {
          localStorage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
          localStorage.setItem(
            ANDROID_SYSTEM_DISABLED_REASON_KEY,
            permissionsApiState && permissionsApiState !== 'granted' ? 'permission-api' : 'push-manager'
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

      // If permissions API / PushManager both confirm 'granted', clear prior permission-api / push-manager block markers
      const priorReason = localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
      if (priorReason === 'permission-api' || priorReason === 'push-manager') {
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

      // 3. Validate VAPID key and preserve existing valid PushManager subscription + token wherever possible
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

      const storedToken = localStorage.getItem(FCM_TOKEN_KEY) || undefined;

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
            } catch (retryErr) {
              console.warn(
                '[firebaseConfig] Background push token retry failed:',
                retryErr
              );
            }
          } else if (storedToken && existingSub && existingSubMatchesVapid) {
            // Transient network/AbortError while existing PushSubscription and FCM token are valid: reuse stored token
            token = storedToken;
          } else {
            console.warn(
              '[firebaseConfig] Background push token notice (activating real-time alert stream fallback):',
              fcmErr
            );
          }
        }
      } else if (!activeSwReg?.active) {
        if (storedToken) {
          token = storedToken;
        } else {
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

        const syncSignature = `${tenantId}:${userId}:${userRole}:${token}`;
        const previousToken = localStorage.getItem(FCM_TOKEN_KEY) || undefined;

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

          localStorage.setItem(FCM_TOKEN_KEY, token);
          lastSyncedSignature = syncSignature;
        }
      }

      const stillDeliveryBlocked =
        localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true' &&
        localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY) === 'delivery-rejected';

      // Mark notifications as enabled in localStorage and clear denial flag
      localStorage.setItem(PUSH_ENABLED_KEY, 'true');
      localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);

      // Notify other components that notification state updated
      window.dispatchEvent(
        new CustomEvent('pos:push-status-changed', {
          detail: {
            token,
            permission: 'granted',
            isSubscribed: !stillDeliveryBlocked,
            androidSystemDisabled: stillDeliveryBlocked,
            mode: token ? 'fcm' : 'realtime',
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
        mode: token ? 'fcm' : 'realtime',
        warning: !token
          ? vapidWarning ||
            'Real-time desktop alerts are active! (Live counter & sales alerts will pop up while POS is open).'
          : undefined,
      };
    } catch (err: any) {
      console.error('[firebaseConfig] Exception in acquireAndSyncFcmToken:', err);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const stillBlocked = localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true';
        if (stillBlocked) {
          return {
            success: false,
            androidSystemDisabled: true,
            error:
              'Browser permission is granted, but Android system notifications appear disabled in device settings.',
          };
        }
        localStorage.setItem(PUSH_ENABLED_KEY, 'true');
        localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
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
  if (localStorage.getItem(PUSH_ENABLED_KEY) === 'false') return false;

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
}> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Notifications are only available in a browser environment.' };
  }

  if (!('Notification' in window)) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  try {
    let permission = Notification.permission;
    const permissionsApiState = await queryBrowserPermissionsState();

    // Never call requestPermission() if browser or Permissions API already says denied
    if (permission === 'denied' || (permission === 'default' && permissionsApiState === 'denied')) {
      localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
      localStorage.setItem(PUSH_ENABLED_KEY, 'false');
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

    // Only prompt when permission is genuinely 'default' (never when 'granted' or 'denied')
    if (permission === 'default') {
      permission = await Notification.requestPermission();

      // If user explicitly dismissed or OS suppressed POST_NOTIFICATIONS on Android 13+, prevent loop re-prompting
      if (permission === 'default') {
        const postPromptApiState = await queryBrowserPermissionsState();
        const androidTwa = isAndroidTwaEnvironment();
        if (postPromptApiState === 'denied' || androidTwa) {
          localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
          if (androidTwa) {
            localStorage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
            localStorage.setItem(ANDROID_SYSTEM_DISABLED_REASON_KEY, 'post-notifications');
          }
        }
      }
    }

    if (permission !== 'granted') {
      if (permission === 'denied') {
        localStorage.setItem(PUSH_PERMISSION_DENIED_KEY, 'true');
        localStorage.setItem(PUSH_ENABLED_KEY, 'false');
      }
      const androidBlocked = isAndroidTwaEnvironment() && (permission === 'denied' || localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true');
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
            : 'Notification permission request was dismissed.',
      };
    }

    // Permission is 'granted' — clear explicit prior delivery-rejection flag only if user clicked to re-verify,
    // then run token reuse/sync (which still re-validates Permissions API & PushManager state)
    if (localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY) === 'post-notifications') {
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
  androidSystemDisabled?: boolean;
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
