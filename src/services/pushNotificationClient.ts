import {
  ANDROID_SYSTEM_DISABLED_KEY,
  ANDROID_SYSTEM_DISABLED_REASON_KEY,
  FCM_TOKEN_KEY,
  PUSH_ENABLED_KEY,
  PUSH_PERMISSION_DENIED_KEY,
  PUSH_PERMISSION_PROMPTED_KEY,
  PUSH_USER_OPTED_OUT_KEY,
  initFirebaseClient,
  isExplicitUserPushOptOut,
  requestFcmPermissionAndToken,
  resolveActivePushServiceWorker,
  syncFcmTokenSilently,
  unregisterFcmDeviceToken,
} from './firebaseConfig.ts';
import {
  claimNotificationChannel,
  isNotificationChannelClaimed,
} from '../utils/notificationDedupe.ts';
import {
  NOTIFICATION_BADGE_ICON,
  showSingleShadeNotification,
} from '../utils/notificationShade.ts';
import { buildPushNotificationActions, navigateToNotificationUrl } from '../utils/notificationActions.ts';

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

  const permApiBlocked = permissionsApiState === 'denied';
  const pushMgrBlocked = pushManagerState === 'denied';

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

    const active = userExplicitlyEnabledFlag || hasStoredToken || hasPushSubscription || browserPermission === 'granted';
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

let inFlightPermissionSnapshot: Promise<PushPermissionSnapshot> | null = null;

export function getDetailedPushPermissionStatus(): Promise<PushPermissionSnapshot> {
  if (inFlightPermissionSnapshot) {
    return inFlightPermissionSnapshot;
  }
  inFlightPermissionSnapshot = computeDetailedPushPermissionStatus().finally(() => {
    inFlightPermissionSnapshot = null;
  });
  return inFlightPermissionSnapshot;
}

async function computeDetailedPushPermissionStatus(): Promise<PushPermissionSnapshot> {
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
    const rawEnabledVal = localStorage.getItem(PUSH_ENABLED_KEY);
    const rawUserOptedOutVal = localStorage.getItem(PUSH_USER_OPTED_OUT_KEY);
    userExplicitlyEnabledFlag = rawEnabledVal === 'true';
    storedDenialFlag = localStorage.getItem(PUSH_PERMISSION_DENIED_KEY) === 'true';
    androidSystemBlockedFlag = localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true';
    androidSystemBlockedReason = localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY);
    hasStoredToken = Boolean(localStorage.getItem(FCM_TOKEN_KEY));

    // Distinguish genuine user toggle-off from legacy denial-induced PUSH_ENABLED_KEY='false'
    if (rawUserOptedOutVal === 'true') {
      userOptedOut = true;
    } else if (rawEnabledVal === 'false') {
      if (browserPermission === 'granted' && storedDenialFlag) {
        localStorage.removeItem(PUSH_ENABLED_KEY);
        localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
        storedDenialFlag = false;
        userOptedOut = false;
      } else {
        userOptedOut = !storedDenialFlag;
      }
    }
  } catch {}

  // Automatically clear permission-api / push-manager / post-notifications block flags
  // when browser permission is granted and neither Permissions API nor PushManager is explicitly 'denied'
  if (
    browserPermission === 'granted' &&
    permissionsApiState !== 'denied' &&
    pushManagerState !== 'denied' &&
    (androidSystemBlockedReason === 'permission-api' ||
      androidSystemBlockedReason === 'push-manager' ||
      androidSystemBlockedReason === 'post-notifications')
  ) {
    clearSystemNotificationDeliveryBlocked();
    androidSystemBlockedFlag = false;
    androidSystemBlockedReason = null;
  }

  // Also clear stale denial/prompted flags if user manually re-granted notifications in browser/Android settings
  if (browserPermission === 'granted') {
    try {
      localStorage.removeItem(PUSH_PERMISSION_PROMPTED_KEY);
      if (storedDenialFlag && !userOptedOut) {
        localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
        storedDenialFlag = false;
      }
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
  alreadyPrompted?: boolean;
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
  if (isExplicitUserPushOptOut()) return false;
  return syncFcmTokenSilently(overrideRole);
}

export const SOFT_PROMPT_STORAGE_KEY = 'pos_push_soft_prompt_dismissed_until';
export const SOFT_PROMPT_DISMISSED_KEY = 'pos_push_soft_prompt_dismissed';
export const DEFAULT_SOFT_PROMPT_SNOOZE_DAYS = 7;

export function isSoftPromptDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(SOFT_PROMPT_STORAGE_KEY);
    if (raw) {
      const until = Number(raw);
      if (!isNaN(until) && until > 0) {
        if (until > Date.now()) {
          return true;
        }
        // 7-day snooze expired cleanly — allow prompt again if still in 'default' permission state
        localStorage.removeItem(SOFT_PROMPT_STORAGE_KEY);
        localStorage.removeItem(SOFT_PROMPT_DISMISSED_KEY);
        return false;
      }
    }
    if (localStorage.getItem(SOFT_PROMPT_DISMISSED_KEY) === 'true') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function shouldShowSoftPushPrompt(): boolean {
  if (typeof window === 'undefined' || !isWebPushSupported()) return false;
  // iOS Safari browser tabs cannot grant Web Push until added to Home Screen
  if (isIOSDevice() && !isStandalonePWA()) return false;
  // Never prompt if permission was already granted or denied
  if (Notification.permission !== 'default') return false;
  // Never re-prompt if user snoozed, dismissed/prompted once, denied, opted out, or Android system notifications are disabled
  if (isSoftPromptDismissed()) return false;
  try {
    if (localStorage.getItem(PUSH_PERMISSION_PROMPTED_KEY) === 'true') return false;
    if (localStorage.getItem(PUSH_PERMISSION_DENIED_KEY) === 'true') return false;
    if (localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true') return false;
    if (localStorage.getItem(PUSH_USER_OPTED_OUT_KEY) === 'true') return false;
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

export function dismissSoftPushPrompt(days = DEFAULT_SOFT_PROMPT_SNOOZE_DAYS): void {
  if (typeof window === 'undefined') return;
  try {
    const until = Date.now() + Math.max(days, 1) * 86400000;
    localStorage.setItem(SOFT_PROMPT_DISMISSED_KEY, 'true');
    localStorage.setItem(SOFT_PROMPT_STORAGE_KEY, String(until));
    window.dispatchEvent(new CustomEvent('pos:push-soft-prompt-updated'));
  } catch {}
}

export function resetSoftPushPromptDismissal(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SOFT_PROMPT_DISMISSED_KEY);
    localStorage.removeItem(SOFT_PROMPT_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('pos:push-soft-prompt-updated'));
  } catch {}
}

const permissionWatchCallbacks = new Set<(snapshot: PushPermissionSnapshot) => void>();
let sharedWatcherAttached = false;
let sharedPermStatusObj: PermissionStatus | null = null;
let sharedFocusDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function notifyAllPermissionWatchers(): void {
  if (permissionWatchCallbacks.size === 0) return;
  void getDetailedPushPermissionStatus().then((snap) => {
    for (const cb of Array.from(permissionWatchCallbacks)) {
      try {
        cb(snap);
      } catch {}
    }
  });
}

function handleSharedVisibilityOrFocus(): void {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    if (sharedFocusDebounceTimer) clearTimeout(sharedFocusDebounceTimer);
    sharedFocusDebounceTimer = setTimeout(() => {
      sharedFocusDebounceTimer = null;
      notifyAllPermissionWatchers();
    }, 120);
  }
}

function handleSharedDeliveryBlocked(e: any): void {
  markSystemNotificationDeliveryBlocked(e?.detail?.reason || 'delivery-rejected');
}

function handleSharedDeliveryRestored(): void {
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
}

function attachSharedPermissionWatchers(): void {
  if (typeof window === 'undefined' || sharedWatcherAttached) return;
  sharedWatcherAttached = true;

  window.addEventListener('pos:push-status-changed', notifyAllPermissionWatchers);
  window.addEventListener('focus', handleSharedVisibilityOrFocus);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleSharedVisibilityOrFocus);
  }
  window.addEventListener('pos:notification-delivery-blocked', handleSharedDeliveryBlocked);
  window.addEventListener('pos:notification-delivery-restored', handleSharedDeliveryRestored);

  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((status) => {
        if (!sharedWatcherAttached || !status) return;
        sharedPermStatusObj = status;
        sharedPermStatusObj.onchange = () => {
          notifyAllPermissionWatchers();
        };
      })
      .catch(() => {});
  }
}

function detachSharedPermissionWatchersIfIdle(): void {
  if (!sharedWatcherAttached || permissionWatchCallbacks.size > 0 || typeof window === 'undefined') {
    return;
  }
  sharedWatcherAttached = false;
  if (sharedFocusDebounceTimer) {
    clearTimeout(sharedFocusDebounceTimer);
    sharedFocusDebounceTimer = null;
  }
  window.removeEventListener('pos:push-status-changed', notifyAllPermissionWatchers);
  window.removeEventListener('focus', handleSharedVisibilityOrFocus);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleSharedVisibilityOrFocus);
  }
  window.removeEventListener('pos:notification-delivery-blocked', handleSharedDeliveryBlocked);
  window.removeEventListener('pos:notification-delivery-restored', handleSharedDeliveryRestored);
  if (sharedPermStatusObj) {
    sharedPermStatusObj.onchange = null;
    sharedPermStatusObj = null;
  }
}

/**
 * Shared singleton observer for browser Permissions API, app visibility/focus
 * (e.g. returning from Android Settings), and internal push status events.
 * Consolidates all subscribers onto one set of browser listeners.
 */
export function watchNotificationPermissionChanges(
  onUpdate: (snapshot: PushPermissionSnapshot) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  permissionWatchCallbacks.add(onUpdate);
  attachSharedPermissionWatchers();

  return () => {
    permissionWatchCallbacks.delete(onUpdate);
    detachSharedPermissionWatchersIfIdle();
  };
}

let lastNativePromptInitKey = '';
let lastNativePromptInitAt = 0;

/**
 * Background Firebase client warm-up on session load:
 * 1. Initializes the Firebase app + foreground `onMessage` listener in the background.
 * 2. NEVER calls `Notification.requestPermission()` automatically on page load or login.
 * 3. When notification permission is ALREADY `'granted'` (and user did not opt out), silently
 *    ensures the root SW is active and syncs/rotates the device FCM token once per
 *    (tenantId, userId, role, config) session so other devices and role switches stay reachable.
 */
export function initNativeNotificationPrompt(overrideRole?: string): () => void {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return () => {};
  }

  const normalizedRole = String(overrideRole || 'ADMIN').toUpperCase();
  let sessionUserId = 0;
  let sessionTenantId = 0;
  try {
    const rawUser = typeof localStorage !== 'undefined' ? localStorage.getItem('pos_current_user') : null;
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      sessionUserId = Number(parsed?.id || 0);
      sessionTenantId = Number(parsed?.tenantId || parsed?.tenant_id || 0);
    }
  } catch {}

  const initKey = `${normalizedRole}:${sessionTenantId}:${sessionUserId}`;
  const now = Date.now();
  if (lastNativePromptInitKey === initKey && now - lastNativePromptInitAt < 5000) {
    return () => {};
  }
  lastNativePromptInitKey = initKey;
  lastNativePromptInitAt = now;

  // Pre-initialize Firebase client & foreground listeners (never calls requestPermission)
  initFirebaseClient().catch(() => {});

  // Silently sync/rotate FCM token ONLY if permission is already granted & user has not opted out
  if (Notification.permission === 'granted' && !isExplicitUserPushOptOut() && isWebPushSupported()) {
    void resolveActivePushServiceWorker()
      .then(() => resyncPushSubscriptionIfEnabled(normalizedRole))
      .catch(() => {});
  }

  return () => {};
}

/**
 * Disables Web Push notifications for this device and unregisters from the server.
 */
export async function unsubscribeDeviceFromWebPush(): Promise<boolean> {
  try {
    localStorage.setItem(PUSH_ENABLED_KEY, 'false');
    localStorage.setItem(PUSH_USER_OPTED_OUT_KEY, 'true');
    localStorage.removeItem(PUSH_PERMISSION_DENIED_KEY);
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

/**
 * Subscribes to foreground Firebase Cloud Messaging notifications (`pos:fcm-notification`)
 * without opening any legacy SSE streams or polling timers.
 */
export function subscribeForegroundNotifications(
  onNotification: (payload: any) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    if (detail) {
      onNotification(detail);
    }
  };

  window.addEventListener('pos:fcm-notification', handler);
  return () => {
    window.removeEventListener('pos:fcm-notification', handler);
  };
}

/**
 * Ensures a Test Alert produces a real OS/shade notification on the current Chrome or Android TWA
 * device whenever permission is granted, yielding briefly for SW FCM delivery if this device has
 * a local FCM token and never duplicating if SW already claimed `os_notification`.
 */
export async function triggerTestNotificationShadeFallback(params: {
  eventId: string;
  title: string;
  body: string;
  url?: string;
  isAdmin?: boolean;
  fcmSentCount?: number;
}): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;

  let androidSystemDisabled = false;
  let hasLocalToken = false;
  try {
    androidSystemDisabled =
      localStorage.getItem(ANDROID_SYSTEM_DISABLED_KEY) === 'true' &&
      localStorage.getItem(ANDROID_SYSTEM_DISABLED_REASON_KEY) === 'delivery-rejected';
    hasLocalToken = Boolean(localStorage.getItem(FCM_TOKEN_KEY));
  } catch {}

  if (androidSystemDisabled || isExplicitUserPushOptOut()) return false;

  const dedupeKey = `id:${params.eventId}`;
  const shouldYieldForSw =
    hasLocalToken &&
    (params.fcmSentCount || 0) > 0 &&
    isWebPushSupported();

  if (shouldYieldForSw) {
    await new Promise<void>((resolve) => setTimeout(resolve, 3500));
  }

  if (isNotificationChannelClaimed(dedupeKey, 'os_notification')) {
    return false;
  }
  if (!claimNotificationChannel(dedupeKey, 'os_notification')) {
    return false;
  }

  const isAdminTarget = Boolean(params.isAdmin);
  const icon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
  const targetUrl = params.url || (isAdminTarget ? '/admin' : '/pos');
  let activeUserRole = '';
  try {
    const rawUser = localStorage.getItem('pos_current_user');
    if (rawUser) {
      activeUserRole = String(JSON.parse(rawUser)?.role || '').toUpperCase();
    }
  } catch {}
  const testData = {
    type: 'TEST_PUSH',
    url: targetUrl,
    isAdmin: isAdminTarget ? 'true' : 'false',
    eventId: params.eventId,
    tag: params.eventId,
    userRole: activeUserRole,
  };

  return showSingleShadeNotification(
    params.title,
    {
      body: params.body,
      icon,
      badge: NOTIFICATION_BADGE_ICON,
      tag: params.eventId,
      timestamp: Date.now(),
      requireInteraction: false,
      renotify: false,
      actions: buildPushNotificationActions(testData, activeUserRole),
      data: testData,
    },
    () => {
      window.focus();
      navigateToNotificationUrl(targetUrl, testData);
    }
  );
}

