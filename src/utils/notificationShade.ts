export const NOTIFICATION_BADGE_ICON = '/icons/badge-favicon.png';

export interface ShadeNotificationOptions extends NotificationOptions {
  vibrate?: number[];
  renotify?: boolean;
  timestamp?: number;
  actions?: Array<{ action: string; title: string; icon?: string }>;
  data?: Record<string, any>;
}

function isAdminNotificationTarget(options: ShadeNotificationOptions = {}): boolean {
  const data = options.data || {};
  const url = String(data.url || data.deepLinkUrl || '');
  return (
    data.isAdmin === true ||
    data.isAdmin === 'true' ||
    url.startsWith('/admin') ||
    String(options.icon || '').includes('/admin/')
  );
}

function resolveShadeTimestamp(rawTimestamp: unknown): number {
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

let shadeRegistrationQueue: Promise<void> = Promise.resolve();

function hashShadeKey(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Displays a single standalone notification through an active ServiceWorkerRegistration.
 * Every notification is treated as an independent message with its own unique tag —
 * zero grouping, zero summary cards, and zero cross-message merging regardless of type.
 */
export async function showSingleNotificationWithRegistration(
  registration: Pick<ServiceWorkerRegistration, 'showNotification'> & {
    getNotifications?: (filter?: GetNotificationOptions) => Promise<Notification[]>;
  },
  title: string,
  options: ShadeNotificationOptions = {}
): Promise<void> {
  const run = async () => {
    if (!registration || typeof registration.showNotification !== 'function') {
      return;
    }

    const isAdminTarget = isAdminNotificationTarget(options);
    const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
    const defaultFallbackUrl = isAdminTarget ? '/admin' : '/?tab=reports';
    const explicitTag = String(
      options.tag || options.data?.tag || options.data?.eventId || options.data?.event_id || ''
    ).trim();
    const cleanTitle = String(title || 'POS Notification');
    const cleanBody = String(options.body || '');
    const timestamp = resolveShadeTimestamp(options.timestamp ?? options.data?.timestamp);
    const targetUrl = String(options.data?.url || options.data?.deepLinkUrl || defaultFallbackUrl);
    const incomingTag =
      explicitTag ||
      `${isAdminTarget ? 'admin' : 'pos'}-${hashShadeKey(`${cleanTitle}|${cleanBody}|${targetUrl}`)}`;

    if (typeof registration.getNotifications === 'function') {
      const existingAll = await registration.getNotifications().catch(() => [] as Notification[]);
      const alreadyDisplayedForTag = existingAll.some(
        (existing) => existing && existing.tag === incomingTag && options.renotify !== true
      );
      if (alreadyDisplayedForTag) {
        return;
      }
    }

    const badge =
      options.badge && !String(options.badge).includes('pwa-192x192')
        ? options.badge
        : NOTIFICATION_BADGE_ICON;
    const icon = options.icon || defaultIcon;
    const hasReceiptLink = targetUrl.includes('invoice') || targetUrl.includes('return');

    const defaultActions = isAdminTarget
      ? [
          { action: 'open_pos', title: 'Open Admin' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : hasReceiptLink
      ? [
          { action: 'open_receipt', title: 'Open Receipt' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : [
          { action: 'open_pos', title: 'Open POS' },
          { action: 'dismiss', title: 'Dismiss' },
        ];

    const notificationOptions: ShadeNotificationOptions = {
      ...options,
      body: cleanBody,
      icon,
      badge,
      tag: incomingTag,
      timestamp,
      renotify: typeof options.renotify === 'boolean' ? options.renotify : false,
      requireInteraction: typeof options.requireInteraction === 'boolean' ? options.requireInteraction : false,
      vibrate: options.vibrate || [200, 100, 200],
      actions: Array.isArray(options.actions) && options.actions.length > 0 ? options.actions : defaultActions,
      data: {
        ...(options.data || {}),
        url: targetUrl,
        isAdmin: isAdminTarget ? 'true' : 'false',
        notificationTitle: cleanTitle,
        notificationBody: cleanBody,
        timestamp,
        eventId: options.data?.eventId || incomingTag,
        tag: incomingTag,
      },
    };

    await registration.showNotification(cleanTitle, notificationOptions);
  };

  const nextTask = shadeRegistrationQueue.then(run, run);
  shadeRegistrationQueue = nextTask.catch(() => {});
  return nextTask;
}

export async function showSingleShadeNotification(
  title: string,
  options: ShadeNotificationOptions = {},
  onFallbackClick?: () => void
): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  if ('serviceWorker' in navigator) {
    try {
      let reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg && typeof navigator.serviceWorker.register === 'function') {
        reg = await navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .catch(() => undefined);
      }
      if (!reg || !reg.active) {
        reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2000)),
        ]);
      }
      if (reg && reg.active && typeof reg.showNotification === 'function') {
        await showSingleNotificationWithRegistration(reg, title, options);
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
          window.dispatchEvent(new CustomEvent('pos:notification-delivery-restored'));
        }
        return true;
      }
    } catch (swErr: any) {
      const errName = String(swErr?.name || '').toLowerCase();
      const errMsg = String(swErr?.message || swErr || '').toLowerCase();
      const isPermissionOrDelegationError =
        errName === 'notallowederror' ||
        errName === 'securityerror' ||
        errMsg.includes('permission') ||
        errMsg.includes('not allowed') ||
        errMsg.includes('blocked') ||
        errMsg.includes('disabled');
      if (
        isPermissionOrDelegationError &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        typeof window !== 'undefined' &&
        typeof CustomEvent !== 'undefined'
      ) {
        window.dispatchEvent(
          new CustomEvent('pos:notification-delivery-blocked', {
            detail: { reason: 'delivery-rejected' },
          })
        );
        return false;
      }
      // Fall back to window.Notification if SW showNotification fails for non-permission reasons
    }
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      // Strip ServiceWorker-only options (`actions`, `vibrate`, `renotify`) so `new Notification()`
      // never throws TypeError ("Actions are only supported for persistent notifications") in Chromium.
      const { actions: _actions, vibrate: _vibrate, renotify: _renotify, ...windowSafeOptions } = options;
      const fallbackOptions: NotificationOptions = {
        ...windowSafeOptions,
        requireInteraction: typeof options.requireInteraction === 'boolean' ? options.requireInteraction : false,
      };
      const notif = new Notification(title, fallbackOptions);
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos:notification-delivery-restored'));
      }
      if (onFallbackClick) {
        notif.onclick = () => {
          onFallbackClick();
          notif.close();
        };
      }
      return true;
    } catch (fallbackErr: any) {
      // Android Chrome throws Illegal constructor on `new Notification()` when no active SW handled it,
      // or NotAllowedError if OS notifications are blocked.
      const errName = String(fallbackErr?.name || '').toLowerCase();
      if (
        errName === 'notallowederror' &&
        typeof window !== 'undefined' &&
        typeof CustomEvent !== 'undefined'
      ) {
        window.dispatchEvent(
          new CustomEvent('pos:notification-delivery-blocked', {
            detail: { reason: 'delivery-rejected' },
          })
        );
      }
    }
  }

  return false;
}
