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

function formatShadeItemTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function normalizeInlineText(value: unknown, maxLen: number): string {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function stripLeadingTitleFromBody(title: string, body: string): string {
  const cleanTitle = normalizeInlineText(title, 120);
  const cleanBody = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanBody) return '';
  if (cleanTitle && cleanBody.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
    const rest = cleanBody.slice(cleanTitle.length).replace(/^[\s:•\-—]+/, '').trim();
    return rest;
  }
  return cleanBody;
}

export function formatShadeGroupSummaryBody(items: ShadeNotificationItem[]): string {
  const MAX_VISIBLE_LINES = 6;
  const sorted = [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const hasOverflow = sorted.length > MAX_VISIBLE_LINES;
  const visible = hasOverflow ? sorted.slice(0, MAX_VISIBLE_LINES - 1) : sorted;

  const lines = visible.map((item) => {
    const itemTitle = normalizeInlineText(item.title || 'POS Notification', 48);
    const timeStr = formatShadeItemTime(item.timestamp || Date.now());
    const strippedBody = stripLeadingTitleFromBody(item.title, item.body);
    const shortDetail = normalizeInlineText(strippedBody, 76);
    const headerPart = timeStr ? `• ${itemTitle} • ${timeStr}` : `• ${itemTitle}`;
    return shortDetail ? `${headerPart} — ${shortDetail}` : headerPart;
  });

  if (hasOverflow) {
    const remaining = sorted.length - visible.length;
    lines.push(`• +${remaining} more ${remaining === 1 ? 'alert' : 'alerts'} — Tap to view all`);
  }

  return lines.join('\n');
}

export const MAX_ACTIVE_SHADE_NOTIFICATIONS = 8;

let shadeRegistrationQueue: Promise<void> = Promise.resolve();

export async function showGroupedWithRegistration(
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
    const groupKey = isAdminTarget ? 'admin_alerts' : 'pos_alerts';
    const summaryTag = isAdminTarget ? ADMIN_SUMMARY_TAG : POS_SUMMARY_TAG;
    const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
    const defaultFallbackUrl = isAdminTarget ? '/admin' : '/?tab=reports';
    const incomingTag = String(options.tag || '').trim() || `${isAdminTarget ? 'admin' : 'pos'}-${Date.now()}`;
    const cleanTitle = String(title || 'POS Notification');
    const cleanBody = String(options.body || '');
    const timestamp = resolveShadeTimestamp(options.timestamp ?? options.data?.timestamp);
    const targetUrl = String(options.data?.url || options.data?.deepLinkUrl || defaultFallbackUrl);

    let alreadyDisplayedForTag = false;
    const existingGroupNotifications: Notification[] = [];

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

        if (existingIsAdmin !== isAdminTarget) {
          continue;
        }

        if (
          existing.tag === summaryTag ||
          existing.tag === POS_SUMMARY_TAG ||
          existing.tag === ADMIN_SUMMARY_TAG ||
          existingData.isGroupSummary === true
        ) {
          try {
            existing.close();
          } catch {}
          continue;
        }

        if (existing.tag === incomingTag) {
          if (options.renotify !== true) {
            alreadyDisplayedForTag = true;
          }
        } else {
          existingGroupNotifications.push(existing);
        }
      }

      if (alreadyDisplayedForTag) {
        return;
      }

      if (existingGroupNotifications.length >= MAX_ACTIVE_SHADE_NOTIFICATIONS) {
        const sortedOldestFirst = existingGroupNotifications.slice().sort(
          (a, b) =>
            resolveShadeTimestamp((a as any).timestamp ?? (a.data as any)?.timestamp) -
            resolveShadeTimestamp((b as any).timestamp ?? (b.data as any)?.timestamp)
        );
        const excessCount = existingGroupNotifications.length - (MAX_ACTIVE_SHADE_NOTIFICATIONS - 1);
        for (let i = 0; i < excessCount; i++) {
          try {
            sortedOldestFirst[i]?.close();
          } catch {}
        }
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
        groupKey,
        isGroupSummary: false,
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
        await showGroupedWithRegistration(reg, title, options);
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
