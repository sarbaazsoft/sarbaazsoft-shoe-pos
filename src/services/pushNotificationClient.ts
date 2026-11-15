import { getAuthToken, getActiveTenantId } from './api.ts';
import { playAudioFeedback } from '../utils/audio.ts';
import {
  ANDROID_SYSTEM_DISABLED_KEY,
  ANDROID_SYSTEM_DISABLED_REASON_KEY,
  FCM_TOKEN_KEY,
  PUSH_ENABLED_KEY,
  PUSH_PERMISSION_DENIED_KEY,
  initFirebaseClient,
  requestFcmPermissionAndToken,
  syncFcmTokenSilently,
  unregisterFcmDeviceToken,
} from './firebaseConfig.ts';
import {
  claimNotificationChannel,
  getNotificationDedupeKey,
  isNotificationChannelClaimed,
} from '../utils/notificationDedupe.ts';
import { showGroupedShadeNotification } from '../utils/notificationShade.ts';

export function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type EffectiveNotificationStatus =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'browser-denied'
  | 'android-system-disabled'
  | 'disabled-by-user';

export interface PushPermissionSnapshot {
  browserPermission: NotificationPermission | 'unsupported';
  permissionsApiState?: PermissionState | 'unsupported';
  pushManagerState?: PermissionState | 'unsupported';
  isAndroid: boolean;
  isAndroidTwa: boolean;
  isWindowsPwa: boolean;
  isStandalone: boolean;
  userOptedOut: boolean;
  androidSystemDisabled: boolean;
  hasStoredToken: boolean;
  hasPushSubscription: boolean;
  effectiveStatus: EffectiveNotificationStatus;
  canReceiveSystemNotifications: boolean;
}

export interface ResolveSnapshotInput {
  supported: boolean;
  browserPermission: NotificationPermission | 'unsupported';
  permissionsApiState?: PermissionState | 'unsupported';
  pushManagerState?: PermissionState | 'unsupported';
  isAndroid: boolean;
  isAndroidTwa: boolean;
  isWindowsPwa: boolean;
  isStandalone: boolean;
  userOptedOut: boolean;
  storedDenialFlag: boolean;
  androidSystemBlockedFlag: boolean;
  androidSystemBlockedReason?: string | null;
  hasStoredToken: boolean;
  hasPushSubscription: boolean;
  userExplicitlyEnabledFlag: boolean;
}

export function resolveEffectivePermissionSnapshot(
  input: ResolveSnapshotInput
): PushPermissionSnapshot {
  const {
    supported,
    browserPermission,
    permissionsApiState = 'unsupported',
    pushManagerState = 'unsupported',
    isAndroid,
    isAndroidTwa,
    isWindowsPwa,
    isStandalone,
    userOptedOut,
    storedDenialFlag,
    androidSystemBlockedFlag,
    androidSystemBlockedReason,
    hasStoredToken,
    hasPushSubscription,
    userExplicitlyEnabledFlag,
  } = input;

  if (!supported || browserPermission === 'unsupported') {
    return {
      browserPermission: 'unsupported',
      permissionsApiState,
      pushManagerState,
      isAndroid,
      isAndroidTwa,
      isWindowsPwa,
      isStandalone,
      userOptedOut,
      androidSystemDisabled: false,
      hasStoredToken,
      hasPushSubscription,
      effectiveStatus: 'unsupported',
      canReceiveSystemNotifications: false,
    };
  }

  const permApiBlocked = permissionsApiState === 'denied' || permissionsApiState === 'prompt';
  const pushMgrBlocked = pushManagerState === 'denied' || pushManagerState === 'prompt';

  if (browserPermission === 'granted') {
    // Distinguish browser-origin 'granted' from Android OS / TWA delegation / system-level disablement
    const systemOrDelegationBlocked =
      permApiBlocked ||
      pushMgrBlocked ||
      (androidSystemBlockedFlag &&
        (isAndroid || androidSystemBlockedReason === 'delivery-rejected'));

    if (systemOrDelegationBlocked) {
      const effectiveStatus: EffectiveNotificationStatus =
        isAndroid || androidSystemBlockedFlag ? 'android-system-disabled' : 'browser-denied';
      return {
        browserPermission,
        permissionsApiState,
        pushManagerState,
        isAndroid,
        isAndroidTwa,
        isWindowsPwa,
        isStandalone,
        userOptedOut,
        androidSystemDisabled: isAndroid || effectiveStatus === 'android-system-disabled',
        hasStoredToken,
        hasPushSubscription,
        effectiveStatus,
        canReceiveSystemNotifications: false,
      };
    }

    if (userOptedOut) {
      return {
        browserPermission,
        permissionsApiState,
        pushManagerState,
        isAndroid,
        isAndroidTwa,
        isWindowsPwa,
        isStandalone,
        userOptedOut: true,
        androidSystemDisabled: false,
        hasStoredToken,
        hasPushSubscription,
        effectiveStatus: 'disabled-by-user',
        canReceiveSystemNotifications: false,
      };
    }

    const active = userExplicitlyEnabledFlag || hasStoredToken || hasPushSubscription;
    return {
      browserPermission,
      permissionsApiState,
      pushManagerState,
      isAndroid,
      isAndroidTwa,
      isWindowsPwa,
      isStandalone,
      userOptedOut: false,
      androidSystemDisabled: false,
      hasStoredToken,
      hasPushSubscription,
      effectiveStatus: 'granted',
      canReceiveSystemNotifications: active,
    };
  }

  if (browserPermission === 'denied') {
    const isAndroidBlocked = isAndroidTwa && (androidSystemBlockedFlag || permissionsApiState === 'denied');
    return {
      browserPermission,
      permissionsApiState,
      pushManagerState,
      isAndroid,
      isAndroidTwa,
      isWindowsPwa,
      isStandalone,
      userOptedOut,
      androidSystemDisabled: isAndroidBlocked,
      hasStoredToken,
      hasPushSubscription,
      effectiveStatus: isAndroidBlocked ? 'android-system-disabled' : 'browser-denied',
      canReceiveSystemNotifications: false,
    };
  }

  // browserPermission === 'default'
  if (
    permissionsApiState === 'denied' ||
    pushManagerState === 'denied' ||
    androidSystemBlockedFlag
  ) {
    return {
      browserPermission,
      permissionsApiState,
      pushManagerState,
      isAndroid,
      isAndroidTwa,
      isWindowsPwa,
      isStandalone,
      userOptedOut,
      androidSystemDisabled: isAndroid || androidSystemBlockedFlag,
      hasStoredToken,
      hasPushSubscription,
      effectiveStatus: isAndroid || androidSystemBlockedFlag ? 'android-system-disabled' : 'browser-denied',
      canReceiveSystemNotifications: false,
    };
  }

  if (storedDenialFlag) {
    return {
      browserPermission,
      permissionsApiState,
      pushManagerState,
      isAndroid,
      isAndroidTwa,
      isWindowsPwa,
      isStandalone,
      userOptedOut,
      androidSystemDisabled: isAndroidTwa,
      hasStoredToken,
      hasPushSubscription,
      effectiveStatus: isAndroidTwa ? 'android-system-disabled' : 'browser-denied',
      canReceiveSystemNotifications: false,
    };
  }

  return {
    browserPermission,
    permissionsApiState,
    pushManagerState,
    isAndroid,
    isAndroidTwa,
    isWindowsPwa,
    isStandalone,
    userOptedOut,
    androidSystemDisabled: false,
    hasStoredToken,
    hasPushSubscription,
    effectiveStatus: 'default',
    canReceiveSystemNotifications: false,
  };
}

export function isAndroidDeviceClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent || '');
}

export function isAndroidTwaClient(): boolean {
  if (typeof window === 'undefined' || !isAndroidDeviceClient()) return false;
  const ref = typeof document !== 'undefined' ? document.referrer || '' : '';
  return ref.startsWith('android-app://') || isStandalonePWA();
}

export function isWindowsPwaClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /windows/i.test(navigator.userAgent || '') && isStandalonePWA();
}

export function markSystemNotificationDeliveryBlocked(reason = 'delivery-rejected'): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ANDROID_SYSTEM_DISABLED_KEY, 'true');
    localStorage.setItem(ANDROID_SYSTEM_DISABLED_REASON_KEY, reason);
  } catch {}
  window.dispatchEvent(
    new CustomEvent('pos:push-status-changed', {
      detail: {
        permission: getNotificationPermissionState(),
        isSubscribed: false,
        androidSystemDisabled: true,
      },
    })
  );
}

export function clearSystemNotificationDeliveryBlocked(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ANDROID_SYSTEM_DISABLED_KEY);
    localStorage.removeItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
  } catch {}
}

export async function getDetailedPushPermissionStatus(): Promise<PushPermissionSnapshot> {
  const isAndroid = isAndroidDeviceClient();
  const isStandalone = isStandalonePWA();
  const isAndroidTwa = isAndroidTwaClient();
  const isWindowsPwa = isWindowsPwaClient();
  const supported = isWebPushSupported();
  const browserPermission: NotificationPermission | 'unsupported' =
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported';

  let permissionsApiState: PermissionState | 'unsupported' = 'unsupported';
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    try {
      const permStatus = await navigator.permissions.query({ name: 'notifications' as PermissionName });
      if (permStatus?.state) {
        permissionsApiState = permStatus.state;
      }
    } catch {}
  }

  let pushManagerState: PermissionState | 'unsupported' = 'unsupported';
  let hasPushSubscription = false;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (reg?.pushManager) {
        if (typeof reg.pushManager.permissionState === 'function') {
          pushManagerState = await reg.pushManager
            .permissionState({ userVisibleOnly: true })
            .catch(() => 'unsupported' as const);
        }
        if (typeof reg.pushManager.getSubscription === 'function') {
          const sub = await reg.pushManager.getSubscription().catch(() => null);
          hasPushSubscription = Boolean(sub);
        }
      }
    } catch {}
  }

  let userOptedOut = false;
  let storedDenialFlag = false;
  let androidSystemBlockedFlag = false;
  let androidSystemBlockedReason: string | null = null;
  let hasStoredToken = false;
  let userExplicitlyEnabledFlag = false;

  try {
    userOptedOut = localStorage.getItem(PUSH_ENABLED_KEY) === 'false';
    userExplicitlyEnabledFlag = localStorage.getItem(PUSH_ENABLED_KEY) === 'true';
    storedDenialFlag = localStorage.getItem(PUSH_PERMISSION_DENIED_KEY) === 'true';
    androidSystemBlockedFlag = localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true';
    androidSystemBlockedReason = localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
    hasStoredToken = Boolean(localStorage.getItem(FCM_TOKEN_KEY));
  } catch {}

  // Automatically clear permission-api / push-manager block flag if OS + Chrome now both report granted
  if (
    browserPermission === 'granted' &&
    (permissionsApiState === 'granted' || permissionsApiState === 'unsupported') &&
    (pushManagerState === 'granted' || pushManagerState === 'unsupported') &&
    (androidSystemBlockedReason === 'permission-api' || androidSystemBlockedReason === 'push-manager')
  ) {
    clearSystemNotificationDeliveryBlocked();
    androidSystemBlockedFlag = false;
    androidSystemBlockedReason = null;
  }

  // Also clear stale denial flag if user manually re-granted notifications in browser/Android settings
  if (browserPermission === 'granted' && storedDenialFlag && !userOptedOut) {
    try {
      localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
      storedDenialFlag = false;
    } catch {}
  }

  return resolveEffectivePermissionSnapshot({
    supported,
    browserPermission,
    permissionsApiState,
    pushManagerState,
    isAndroid,
    isAndroidTwa,
    isWindowsPwa,
    isStandalone,
    userOptedOut,
    storedDenialFlag,
    androidSystemBlockedFlag,
    androidSystemBlockedReason,
    hasStoredToken,
    hasPushSubscription,
    userExplicitlyEnabledFlag,
  });
}

export function getNotificationPermissionState(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

export async function isDeviceSubscribedToPush(): Promise<boolean> {
  const snapshot = await getDetailedPushPermissionStatus();
  return snapshot.effectiveStatus === 'granted' && snapshot.canReceiveSystemNotifications;
}

export async function subscribeDeviceToWebPush(overrideRole?: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  warning?: string;
  mode?: 'fcm' | 'realtime';
  permission?: NotificationPermission;
  androidSystemDisabled?: boolean;
}> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Web Push is not available in non-browser environments.' };
  }

  // iOS Safari requires adding to Home Screen first for Web Push
  if (isIOSDevice() && !isStandalonePWA() && !('Notification' in window)) {
    return {
      success: false,
      error: 'On iPhone or iPad, push notifications require adding this app to your Home Screen first (tap Share > Add to Home Screen), then launching it from your Home Screen.',
    };
  }

  // Delegate directly to Firebase Cloud Messaging (FCM) with strict permission checks & token reuse
  return requestFcmPermissionAndToken(overrideRole);
}

/**
 * Silently re-registers / verifies this device with the server when permission is already granted.
 * Keeps existing valid tokens intact without prompting or disrupting UI.
 */
export async function resyncPushSubscriptionIfEnabled(overrideRole?: string): Promise<boolean> {
  if (!isWebPushSupported() || Notification.permission !== 'granted') return false;
  try {
    if (localStorage.getItem(PUSH_ENABLED_KEY) === 'false') return false;
  } catch {
    return false;
  }
  return syncFcmTokenSilently(overrideRole);
}

const SOFT_PROMPT_STORAGE_KEY = 'pos_push_soft_prompt_dismissed_until';

export function isSoftPromptDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(SOFT_PROMPT_STORAGE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return !isNaN(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function shouldShowSoftPushPrompt(): boolean {
  if (typeof window === 'undefined' || !isWebPushSupported()) return false;
  // Never prompt if permission was already granted or denied
  if (Notification.permission !== 'default') return false;
  // Never re-prompt if user snoozed, denied, opted out, or Android system notifications are disabled
  if (isSoftPromptDismissed()) return false;
  try {
    if (localStorage.getItem(PUSH_PERMISSION_DENIED_KEY) === 'true') return false;
    if (localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true') return false;
    if (localStorage.getItem(PUSH_ENABLED_KEY) === 'false') return false;
  } catch {
    return false;
  }
  return true;
}

export async function shouldShowSoftPushPromptAsync(): Promise<boolean> {
  if (!shouldShowSoftPushPrompt()) return false;
  const snapshot = await getDetailedPushPermissionStatus();
  return snapshot.effectiveStatus === 'default';
}

export function dismissSoftPushPrompt(days = 3): void {
  if (typeof window === 'undefined') return;
  try {
    const until = Date.now() + Math.max(days, 1) * 86400000;
    localStorage.setItem(SOFT_PROMPT_STORAGE_KEY, String(until));
    window.dispatchEvent(new CustomEvent('pos:push-soft-prompt-updated'));
  } catch {}
}

export function resetSoftPushPromptDismissal(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SOFT_PROMPT_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('pos:push-soft-prompt-updated'));
  } catch {}
}

/**
 * Watches browser Permissions API, app visibility/focus (e.g. returning from Android Settings),
 * and internal push status events so UI reflects real browser + OS state immediately.
 */
export function watchNotificationPermissionChanges(
  onUpdate: (snapshot: PushPermissionSnapshot) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let disposed = false;
  let permStatusObj: PermissionStatus | null = null;

  const emitSnapshot = () => {
    void getDetailedPushPermissionStatus().then((snap) => {
      if (!disposed) {
        onUpdate(snap);
      }
    });
  };

  const handleVisibilityOrFocus = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      emitSnapshot();
    }
  };

  const handleDeliveryBlocked = (e: any) => {
    markSystemNotificationDeliveryBlocked(e?.detail?.reason || 'delivery-rejected');
  };

  const handleDeliveryRestored = () => {
    try {
      if (localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY) === 'delivery-rejected') {
        clearSystemNotificationDeliveryBlocked();
        window.dispatchEvent(
          new CustomEvent('pos:push-status-changed', {
            detail: {
              permission: getNotificationPermissionState(),
              androidSystemDisabled: false,
            },
          })
        );
      }
    } catch {}
  };

  window.addEventListener('pos:push-status-changed', emitSnapshot);
  window.addEventListener('focus', handleVisibilityOrFocus);
  document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  window.addEventListener('pos:notification-delivery-blocked', handleDeliveryBlocked);
  window.addEventListener('pos:notification-delivery-restored', handleDeliveryRestored);

  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((status) => {
        if (disposed || !status) return;
        permStatusObj = status;
        permStatusObj.onchange = () => {
          emitSnapshot();
        };
      })
      .catch(() => {});
  }

  return () => {
    disposed = true;
    window.removeEventListener('pos:push-status-changed', emitSnapshot);
    window.removeEventListener('focus', handleVisibilityOrFocus);
    document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    window.removeEventListener('pos:notification-delivery-blocked', handleDeliveryBlocked);
    window.removeEventListener('pos:notification-delivery-restored', handleDeliveryRestored);
    if (permStatusObj) {
      permStatusObj.onchange = null;
    }
  };
}

/**
 * Background FCM initialization on session load:
 * 1. Warm up the Firebase client and foreground listener.
 * 2. If permission is already granted (and user hasn't disabled notifications), silently verify & reuse/sync FCM token.
 * 3. Does NOT force native permission prompts on page load or clicks.
 */
export function initNativeNotificationPrompt(overrideRole?: string): () => void {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return () => {};
  }

  // Pre-initialize Firebase client in the background
  initFirebaseClient().catch(() => {});

  // If already granted, perform silent token verification/resync in background without re-prompting
  if (Notification.permission === 'granted') {
    syncFcmTokenSilently(overrideRole).catch(() => {});
  }

  return () => {};
}

/**
 * Disables Web Push notifications for this device and unregisters from the server.
 */
export async function unsubscribeDeviceFromWebPush(): Promise<boolean> {
  try {
    localStorage.setItem(PUSH_ENABLED_KEY, 'false');
  } catch {}

  if (!isWebPushSupported()) return true;

  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe().catch(() => {});
      }
      await unregisterFcmDeviceToken().catch(() => {});
    }
    return true;
  } catch (err) {
    console.warn('Error during push unsubscription:', err);
    return false;
  }
}

const activeStreamSubscribers = new Set<(payload: any) => void>();
let sharedEventSource: EventSource | null = null;
let sharedStreamSignature = '';
let sharedReconnectTimeout: any = null;

function buildStreamConnectionInfo() {
  const token = getAuthToken() || '';
  const tenantId = getActiveTenantId() || 1;
  let currentRole = 'ADMIN';
  let currentUserId = 0;
  try {
    const stored = localStorage.getItem('pos_current_user');
    if (stored) {
      const u = JSON.parse(stored);
      if (u.role) currentRole = String(u.role).toUpperCase();
      if (u.id) currentUserId = Number(u.id) || 0;
    }
  } catch {}

  const signature = `${token}|${tenantId}|${currentRole}|${currentUserId}`;
  const params = new URLSearchParams();
  if (token) params.set('__token', token);
  if (tenantId) params.set('__tenantId', String(tenantId));
  params.set('role', currentRole);
  if (currentUserId > 0) params.set('userId', String(currentUserId));
  params.set('_t', String(Date.now()));

  return {
    signature,
    streamUrl: `/api/notifications/stream?${params.toString()}`,
  };
}

function handleSharedIncomingNotification(payload: any, isPlatformAnnouncement: boolean = false) {
  const normalizedPayload = isPlatformAnnouncement
    ? { ...payload, isPlatformAnnouncement: true }
    : payload;
  const dedupeKey = getNotificationDedupeKey(normalizedPayload);

  if (!claimNotificationChannel(dedupeKey, 'sse')) {
    return;
  }

  if (isPlatformAnnouncement) {
    window.dispatchEvent(new CustomEvent('platform:announcement', { detail: payload }));
  }

  // 1. Play audio chime once per notification event
  if (claimNotificationChannel(dedupeKey, 'audio')) {
    try {
      playAudioFeedback.success();
    } catch {}
  }

  // 2. Dispatch custom event for in-app UI toasts & modals
  window.dispatchEvent(
    new CustomEvent('pos:action-notification', { detail: normalizedPayload })
  );

  // 3. Trigger OS desktop notification if permitted and tab is not active.
  // When Web Push (FCM + active SW) is registered on this browser, briefly yield
  // so the Service Worker `push` event can display and claim `os_notification`
  // first without duplicating alerts in background tabs.
  let androidSystemDisabled = false;
  try {
    androidSystemDisabled = localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true';
  } catch {}

  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    !androidSystemDisabled &&
    (document.hidden || !document.hasFocus()) &&
    !isNotificationChannelClaimed(dedupeKey, 'os_notification')
  ) {
    const dispatchOsFallback = () => {
      if (isNotificationChannelClaimed(dedupeKey, 'os_notification')) {
        return;
      }
      if (!claimNotificationChannel(dedupeKey, 'os_notification')) {
        return;
      }
      try {
        const deepLinkUrl = normalizedPayload.deepLinkUrl || normalizedPayload.url || '';
        const isAdminTarget = String(deepLinkUrl).startsWith('/admin') || normalizedPayload.targetRole === 'SUPERADMIN';
        const icon = normalizedPayload.icon || (isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png');
        const rawBadge = normalizedPayload.badge;
        const badge = rawBadge && !String(rawBadge).includes('pwa-192x192') ? rawBadge : '/icons/badge-favicon.png';
        const tag =
          normalizedPayload.tag ||
          normalizedPayload.eventId ||
          `pos-${normalizedPayload.type?.toLowerCase()}-${normalizedPayload.invoiceNumber || Date.now()}`;
        const parsedTimestamp = normalizedPayload.timestamp
          ? Date.parse(String(normalizedPayload.timestamp)) || Number(normalizedPayload.timestamp) || Date.now()
          : Date.now();
        void showGroupedShadeNotification(
          normalizedPayload.title || 'POS Alert',
          {
            body: normalizedPayload.message || 'Transaction confirmed.',
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
              ...normalizedPayload,
              url: deepLinkUrl || '/notifications',
              isAdmin: isAdminTarget ? 'true' : 'false',
              timestamp: parsedTimestamp,
            },
          },
          () => {
            window.focus();
            if (normalizedPayload.deepLinkUrl) {
              window.dispatchEvent(
                new CustomEvent('pos:navigate-deep-link', { detail: normalizedPayload })
              );
            }
          }
        );
      } catch {}
    };

    const hasActiveWebPush =
      isWebPushSupported() &&
      Boolean(navigator.serviceWorker?.controller) &&
      Boolean(localStorage.getItem('pos_fcm_token'));

    if (hasActiveWebPush) {
      setTimeout(dispatchOsFallback, 1200);
    } else {
      dispatchOsFallback();
    }
  }

  for (const subscriber of Array.from(activeStreamSubscribers)) {
    try {
      subscriber(normalizedPayload);
    } catch (err) {
      console.warn('Error in notification stream subscriber:', err);
    }
  }
}

function closeSharedStream() {
  if (sharedReconnectTimeout) {
    clearTimeout(sharedReconnectTimeout);
    sharedReconnectTimeout = null;
  }
  if (sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }
  sharedStreamSignature = '';
}

function ensureSharedStreamConnected() {
  if (activeStreamSubscribers.size === 0) return;
  const { signature, streamUrl } = buildStreamConnectionInfo();

  if (sharedEventSource && sharedStreamSignature === signature) {
    return;
  }

  closeSharedStream();
  sharedStreamSignature = signature;

  try {
    const es = new EventSource(streamUrl);
    sharedEventSource = es;

    es.addEventListener('pos_action', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        handleSharedIncomingNotification(payload, false);
      } catch (e) {
        console.warn('Error parsing POS action event data:', e);
      }
    });

    es.addEventListener('platform_announcement', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        handleSharedIncomingNotification(payload, true);
      } catch (e) {
        console.warn('Error parsing platform announcement event data:', e);
      }
    });

    es.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.type && payload.type !== 'CONNECTED') {
          handleSharedIncomingNotification(payload, false);
        }
      } catch {}
    };

    es.onerror = () => {
      if (sharedEventSource === es) {
        es.close();
        sharedEventSource = null;
        sharedStreamSignature = '';
      }
      if (activeStreamSubscribers.size > 0 && !sharedReconnectTimeout) {
        sharedReconnectTimeout = setTimeout(() => {
          sharedReconnectTimeout = null;
          ensureSharedStreamConnected();
        }, 6000);
      }
    };
  } catch {
    if (activeStreamSubscribers.size > 0 && !sharedReconnectTimeout) {
      sharedReconnectTimeout = setTimeout(() => {
        sharedReconnectTimeout = null;
        ensureSharedStreamConnected();
      }, 8000);
    }
  }
}

/**
 * Connects to the real-time Server-Sent Events (SSE) notification stream using a
 * single shared EventSource per browser tab so mounted components never duplicate deliveries.
 */
export function connectRealtimeNotificationStream(
  onNotification: (payload: any) => void
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }

  activeStreamSubscribers.add(onNotification);
  ensureSharedStreamConnected();

  return () => {
    activeStreamSubscribers.delete(onNotification);
    if (activeStreamSubscribers.size === 0) {
      closeSharedStream();
    }
  };
}

