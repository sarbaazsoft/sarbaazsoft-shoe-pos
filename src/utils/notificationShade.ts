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

function formatSummaryPreviewLines(items: ShadeNotificationItem[], totalCount: number): string {
  const previewLines = items.slice(0, 4).map((item) => {
    const cleanTitle = String(item.title || 'POS Alert').trim();
    const cleanBody = String(item.body || '').replace(/\s+/g, ' ').trim();
    return cleanBody ? `• ${cleanTitle}: ${cleanBody}` : `• ${cleanTitle}`;
  });
  if (totalCount > 4) {
    previewLines.push(`+${totalCount - 4} more alerts — tap to view all`);
  }
  return previewLines.join('\n');
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

  if (typeof registration.getNotifications !== 'function') {
    await registration.showNotification(title, options);
    return;
  }

  const isAdminTarget = isAdminNotificationTarget(options);
  const summaryTag = isAdminTarget ? ADMIN_SUMMARY_TAG : POS_SUMMARY_TAG;
  const defaultIcon = isAdminTarget ? '/admin/pwa-192x192.png' : '/pwa-192x192.png';
  const incomingTag = String(options.tag || '').trim();

  const existingAll = await registration.getNotifications().catch(() => [] as Notification[]);
  const sameScope = existingAll.filter((n) => {
    const nData = (n?.data || {}) as Record<string, any>;
    const nIsAdmin =
      nData.isAdmin === true ||
      nData.isAdmin === 'true' ||
      String(nData.url || '').startsWith('/admin') ||
      String(n?.icon || '').includes('/admin/') ||
      n?.tag === ADMIN_SUMMARY_TAG;
    return nIsAdmin === isAdminTarget;
  });

  const existingSummary = sameScope.find(
    (n) => n?.tag === summaryTag || n?.data?.isGroupSummary === true
  );
  const otherActive = sameScope.filter(
    (n) =>
      n !== existingSummary &&
      n?.tag !== summaryTag &&
      n?.data?.isGroupSummary !== true &&
      (!incomingTag || n?.tag !== incomingTag)
  );

  const summaryItems: ShadeNotificationItem[] = Array.isArray(existingSummary?.data?.groupedItems)
    ? existingSummary.data.groupedItems
    : [];
  const alreadyInSummary = Boolean(
    incomingTag && summaryItems.some((item) => item && item.tag === incomingTag)
  );

  const baseSummaryCount = existingSummary
    ? Math.max(Number(existingSummary.data?.groupedCount || 1), summaryItems.length || 1)
    : 0;
  const totalCount =
    baseSummaryCount + otherActive.length + (alreadyInSummary ? 0 : 1);

  if (!existingSummary && totalCount <= MAX_UNGROUPED_SHADE_NOTIFICATIONS) {
    await registration.showNotification(title, options);
    return;
  }

  const incomingItem: ShadeNotificationItem = {
    title: String(title || 'POS Notification'),
    body: String(options.body || ''),
    url: String(options.data?.url || options.data?.deepLinkUrl || (isAdminTarget ? '/admin' : '/notifications')),
    tag: incomingTag,
    timestamp: Date.now(),
  };

  const activeItems: ShadeNotificationItem[] = otherActive.map((n) => ({
    title: String(n?.title || 'POS Notification'),
    body: String(n?.body || ''),
    url: String(n?.data?.url || (isAdminTarget ? '/admin' : '/notifications')),
    tag: String(n?.tag || ''),
    timestamp: Number((n as any)?.timestamp || Date.now()),
  }));

  const combined = [incomingItem, ...activeItems, ...summaryItems];
  const deduped: ShadeNotificationItem[] = [];
  const seenTags = new Set<string>();
  for (const item of combined) {
    if (item.tag) {
      if (seenTags.has(item.tag)) continue;
      seenTags.add(item.tag);
    }
    deduped.push(item);
  }

  for (const n of otherActive) {
    try {
      n.close();
    } catch {}
  }

  const summaryTitle = `${totalCount} ${isAdminTarget ? 'Admin' : 'POS'} Notifications`;
  const summaryBody = formatSummaryPreviewLines(deduped, totalCount);
  const targetUrl = isAdminTarget ? '/admin' : '/notifications';

  const summaryOptions: ShadeNotificationOptions = {
    body: summaryBody,
    icon: defaultIcon,
    badge:
      options.badge && !String(options.badge).includes('pwa-192x192')
        ? options.badge
        : NOTIFICATION_BADGE_ICON,
    tag: summaryTag,
    renotify: true,
    requireInteraction: Boolean(options.requireInteraction),
    vibrate: options.vibrate || [200, 100, 200],
    data: {
      url: targetUrl,
      isAdmin: isAdminTarget ? 'true' : 'false',
      isGroupSummary: true,
      groupedCount: totalCount,
      groupedItems: deduped.slice(0, 25),
    },
    actions: [
      { action: 'open_notifications', title: 'View All' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  await registration.showNotification(summaryTitle, summaryOptions);
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
