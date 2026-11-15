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

function extractItemsFromExistingNotification(
  existing: Notification,
  defaultUrl: string
): ShadeNotificationItem[] {
  const existingData = (existing.data || {}) as Record<string, any>;
  if (Array.isArray(existingData.items) && existingData.items.length > 0) {
    return existingData.items
      .filter((it: any) => it && (it.title || it.body))
      .map((it: any, idx: number) => ({
        title: String(it.title || 'POS Notification'),
        body: String(it.body || ''),
        url: String(it.url || defaultUrl),
        tag: String(it.tag || `${existing.tag || 'item'}-${idx}`),
        timestamp: resolveShadeTimestamp(it.timestamp),
      }));
  }

  const tag = String(existing.tag || '').trim();
  if (!tag || tag === POS_SUMMARY_TAG || tag === ADMIN_SUMMARY_TAG || existingData.isGroupSummary === true) {
    return [];
  }

  return [
    {
      title: String(existingData.notificationTitle || existing.title || 'POS Notification'),
      body: String(existingData.notificationBody || existing.body || ''),
      url: String(existingData.url || defaultUrl),
      tag,
      timestamp: resolveShadeTimestamp((existing as any).timestamp ?? existingData.timestamp),
    },
  ];
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
  const defaultFallbackUrl = isAdminTarget ? '/admin' : '/?tab=reports';
  const incomingTag = String(options.tag || '').trim() || `${isAdminTarget ? 'admin' : 'pos'}-${Date.now()}`;
  const cleanTitle = String(title || 'POS Notification');
  const cleanBody = String(options.body || '');
  const timestamp = resolveShadeTimestamp(options.timestamp ?? options.data?.timestamp);
  const targetUrl = String(options.data?.url || options.data?.deepLinkUrl || defaultFallbackUrl);

  const incomingItem: ShadeNotificationItem = {
    title: cleanTitle,
    body: cleanBody,
    url: targetUrl,
    tag: incomingTag,
    timestamp,
  };

  const itemsByTag = new Map<string, ShadeNotificationItem>();
  const nonSummaryNotificationsToClose: Notification[] = [];
  let alreadyDisplayedForTag = false;

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

      const extracted = extractItemsFromExistingNotification(existing, defaultFallbackUrl);
      for (const item of extracted) {
        itemsByTag.set(item.tag, item);
      }

      if (
        existing.tag === incomingTag ||
        extracted.some((item) => item.tag === incomingTag)
      ) {
        if (options.renotify !== true) {
          alreadyDisplayedForTag = true;
        }
      }

      if (existing.tag !== summaryTag) {
        nonSummaryNotificationsToClose.push(existing);
      }
    }
  }

  // If the Service Worker already displayed this exact notification tag in the shade,
  // avoid showing a second duplicate notification from foreground SSE / onMessage.
  if (alreadyDisplayedForTag) {
    return;
  }

  itemsByTag.set(incomingItem.tag, incomingItem);
  const mergedItems = Array.from(itemsByTag.values()).sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );

  const badge =
    options.badge && !String(options.badge).includes('pwa-192x192')
      ? options.badge
      : NOTIFICATION_BADGE_ICON;
  const icon = options.icon || defaultIcon;

  if (mergedItems.length > MAX_UNGROUPED_SHADE_NOTIFICATIONS) {
    for (const oldNotif of nonSummaryNotificationsToClose) {
      try {
        oldNotif.close();
      } catch {}
    }

    const latestTimestamp = mergedItems[0]?.timestamp || timestamp;
    const uniqueUrls = Array.from(new Set(mergedItems.map((it) => it.url).filter(Boolean)));
    const summaryUrl =
      uniqueUrls.length === 1
        ? uniqueUrls[0]
        : isAdminTarget
        ? '/admin'
        : '/notifications';
    const summaryTitle = isAdminTarget
      ? `${mergedItems.length} Admin Notifications`
      : `${mergedItems.length} POS Notifications`;
    const summaryBody = formatShadeGroupSummaryBody(mergedItems);
    const summaryActions = isAdminTarget
      ? [
          { action: 'open_pos', title: 'Open Admin' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : [
          { action: 'open_notifications', title: 'View All Alerts' },
          { action: 'open_pos', title: 'Open POS' },
          { action: 'dismiss', title: 'Dismiss' },
        ];

    const summaryOptions: ShadeNotificationOptions = {
      ...options,
      body: summaryBody,
      icon,
      badge,
      tag: summaryTag,
      timestamp: latestTimestamp,
      renotify: typeof options.renotify === 'boolean' ? options.renotify : true,
      requireInteraction: typeof options.requireInteraction === 'boolean' ? options.requireInteraction : false,
      vibrate: options.vibrate || [200, 100, 200],
      actions: summaryActions,
      data: {
        ...(options.data || {}),
        url: summaryUrl,
        isAdmin: isAdminTarget ? 'true' : 'false',
        groupKey,
        isGroupSummary: true,
        count: mergedItems.length,
        items: mergedItems,
        notificationTitle: summaryTitle,
        notificationBody: summaryBody,
        timestamp: latestTimestamp,
        tag: summaryTag,
      },
    };

    await registration.showNotification(summaryTitle, summaryOptions);
    return;
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
      count: 1,
      items: [incomingItem],
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
      let reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg || !reg.active) {
        reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500)),
        ]);
      }
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
      const fallbackOptions: ShadeNotificationOptions = {
        ...options,
        requireInteraction: typeof options.requireInteraction === 'boolean' ? options.requireInteraction : false,
        renotify: typeof options.renotify === 'boolean' ? options.renotify : false,
      };
      const notif = new Notification(title, fallbackOptions as NotificationOptions);
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
