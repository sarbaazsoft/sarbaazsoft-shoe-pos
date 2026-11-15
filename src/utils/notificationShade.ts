export const MAX_UNGROUPED_SHADE_NOTIFICATIONS = 1;
export const POS_SUMMARY_TAG = 'pos-grouped-summary';
export const ADMIN_SUMMARY_TAG = 'admin-grouped-summary';
export const NOTIFICATION_BADGE_ICON = '/icons/badge-favicon.png';

export interface ShadeNotificationItem {
  title: string;
  body: string;
  url: string;
  tag: string;
  timestamp: number;
}

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

export async function showGroupedWithRegistration(
  registration: Pick<ServiceWorkerRegistration, 'showNotification'> & {
    getNotifications?: (filter?: GetNotificationOptions) => Promise<Notification[]>;
  },
  title: string,
  options: ShadeNotificationOptions = {}
): Promise<void> {
  if (!registration || typeof registration.showNotification !== 'function') {
    return;
  }

  const isAdminTarget = isAdminNotificationTarget(options);
  const groupKey = isAdminTarget ? 'admin_alerts' : 'pos_alerts';
  const summaryTag = isAdminTarget ? ADMIN_SUMMARY_TAG : POS_SUMMARY_TAG;
  const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
  const incomingTag = String(options.tag || '').trim() || `${isAdminTarget ? 'admin' : 'pos'}-${Date.now()}`;
  const cleanTitle = String(title || 'POS Notification');
  const cleanBody = String(options.body || '');
  const timestamp = resolveShadeTimestamp(options.timestamp ?? options.data?.timestamp);
  const targetUrl = String(
    options.data?.url || options.data?.deepLinkUrl || (isAdminTarget ? '/admin' : '/?tab=reports')
  );

  // Remove any stale legacy merged-summary notification without closing individual notifications
  if (typeof registration.getNotifications === 'function') {
    const existingAll = await registration.getNotifications().catch(() => [] as Notification[]);
    for (const existing of existingAll) {
      if (!existing) continue;
      const existingData = (existing.data || {}) as Record<string, any>;
      const existingIsAdmin =
        existingData.isAdmin === true ||
        existingData.isAdmin === 'true' ||
        String(existingData.url || '').startsWith('/admin') ||
        String(existing.icon || '').includes('/admin/') ||
        existing.tag === ADMIN_SUMMARY_TAG;
      if (
        existingIsAdmin === isAdminTarget &&
        (existing.tag === summaryTag || existingData.isGroupSummary === true)
      ) {
        try {
          existing.close();
        } catch {}
      }
    }
  }

  const defaultActions = isAdminTarget
    ? [
        { action: 'open_pos', title: 'Open Admin' },
        { action: 'dismiss', title: 'Dismiss' },
      ]
    : [
        { action: 'open_pos', title: 'Open POS' },
        { action: 'dismiss', title: 'Dismiss' },
      ];

  const notificationOptions: ShadeNotificationOptions = {
    ...options,
    body: cleanBody,
    icon: options.icon || defaultIcon,
    badge:
      options.badge && !String(options.badge).includes('pwa-192x192')
        ? options.badge
        : NOTIFICATION_BADGE_ICON,
    tag: incomingTag,
    timestamp,
    renotify: typeof options.renotify === 'boolean' ? options.renotify : false,
    vibrate: options.vibrate || [200, 100, 200],
    actions: Array.isArray(options.actions) && options.actions.length > 0 ? options.actions : defaultActions,
    data: {
      ...(options.data || {}),
      url: targetUrl,
      isAdmin: isAdminTarget ? 'true' : 'false',
      groupKey,
      isGroupSummary: false,
      notificationTitle: cleanTitle,
      notificationBody: cleanBody,
      timestamp,
      tag: incomingTag,
    },
  };

  await registration.showNotification(cleanTitle, notificationOptions);
}

export async function showGroupedShadeNotification(
  title: string,
  options: ShadeNotificationOptions = {},
  onFallbackClick?: () => void
): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active && typeof reg.showNotification === 'function') {
        await showGroupedWithRegistration(reg, title, options);
        return true;
      }
    } catch {
      // Fall back to window.Notification if SW showNotification fails
    }
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const notif = new Notification(title, options);
      if (onFallbackClick) {
        notif.onclick = () => {
          onFallbackClick();
          notif.close();
        };
      }
      return true;
    } catch {
      // Android Chrome throws Illegal constructor on `new Notification()` when no active SW handled it
    }
  }

  return false;
}
