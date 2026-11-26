import { hasValidStoredAuthToken } from './authStorage.ts';

export type NotificationActionKey =
  | 'view_invoice'
  | 'view_purchase'
  | 'read_more'
  | 'view_stock'
  | 'open_dashboard'
  | 'open_pos';

export interface NotificationActionDescriptor {
  action: NotificationActionKey;
  label: string;
  url: string;
}

export interface PushNotificationActionItem {
  action: NotificationActionKey;
  title: string;
}

export interface NotificationActionInput {
  kind?: string;
  itemType?: string;
  type?: string;
  title?: string;
  message?: string;
  rawId?: string | number;
  id?: string | number;
  invoiceId?: string | number | null;
  invoiceNumber?: string | null;
  saleId?: string | number | null;
  orderId?: string | number | null;
  returnNumber?: string | null;
  purchaseNumber?: string | null;
  purchaseId?: string | number | null;
  announcementId?: string | number | null;
  notificationId?: string | number | null;
  actionUrl?: string | null;
  deepLinkUrl?: string | null;
  url?: string | null;
  tag?: string | null;
  userRole?: string | null;
  role?: string | null;
  targetRole?: string | null;
  isAdmin?: boolean | string;
}

function cleanIdValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = String(val).trim();
  if (!str || str === 'undefined' || str === 'null') return '';
  return str;
}

function extractInvoiceId(input: NotificationActionInput, candidateUrls: string[]): string {
  const direct =
    cleanIdValue(input.invoiceId) ||
    cleanIdValue(input.invoiceNumber);
  if (direct) return direct;

  for (const rawUrl of candidateUrls) {
    if (!rawUrl) continue;
    const pathMatch = rawUrl.match(/\/invoices\/([^/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch {
        return pathMatch[1];
      }
    }
    try {
      const parsed = new URL(rawUrl, 'https://localhost');
      const qp = parsed.searchParams.get('viewInvoice') || parsed.searchParams.get('invoice');
      if (qp && qp.trim()) return qp.trim();
    } catch {}
  }

  const fallbackId =
    cleanIdValue(input.saleId) ||
    cleanIdValue(input.orderId) ||
    (String(input.itemType || '').toUpperCase() === 'SALE' ? cleanIdValue(input.rawId) : '');
  if (fallbackId) return fallbackId;

  const titleOrMsg = `${input.title || ''} ${input.message || ''}`;
  const hashMatch = titleOrMsg.match(/#([A-Z0-9][A-Z0-9-]*)/i);
  if (hashMatch && hashMatch[1] && !/^(?:RET|EXC|PUR)-/i.test(hashMatch[1])) {
    return hashMatch[1];
  }

  return '';
}

function extractAnnouncementId(input: NotificationActionInput, candidateUrls: string[]): string {
  const direct =
    cleanIdValue(input.announcementId) ||
    cleanIdValue(input.notificationId) ||
    (String(input.kind || '').toUpperCase() === 'NOTICE'
      ? cleanIdValue(input.rawId) || cleanIdValue(input.id).replace(/^notice-/i, '')
      : '');
  if (direct) return direct;

  for (const rawUrl of candidateUrls) {
    if (!rawUrl) continue;
    const pathMatch = rawUrl.match(/\/announcements\/([^/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch {
        return pathMatch[1];
      }
    }
  }

  const rawIdStr = cleanIdValue(input.id);
  if (/^(?:notice|platform)-(\d+)$/i.test(rawIdStr)) {
    return rawIdStr.replace(/^(?:notice|platform)-/i, '');
  }
  const tagStr = cleanIdValue(input.tag);
  if (/^platform-(?:notice-)?(\d+)$/i.test(tagStr)) {
    return tagStr.replace(/^platform-(?:notice-)?/i, '');
  }

  return '';
}

/**
 * Resolves up to 2 notification action buttons (dynamic primary + persistent "Open POS").
 * Never produces custom "Dismiss" or "Unsubscribe" actions.
 */
export function resolveNotificationActions(
  input: NotificationActionInput = {},
  currentUserRole?: string | null
): NotificationActionDescriptor[] {
  const type = String(input.type || '').trim().toUpperCase();
  const itemType = String(input.itemType || '').trim().toUpperCase();
  const kind = String(input.kind || '').trim().toUpperCase();
  const candidateUrls = [input.actionUrl, input.deepLinkUrl, input.url]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean);
  const combinedUrl = candidateUrls.join(' ').toLowerCase();

  let primaryAction: NotificationActionDescriptor | null = null;

  const isLowStock =
    type === 'LOW_STOCK' ||
    type === 'STOCK' ||
    itemType === 'LOW_STOCK' ||
    combinedUrl.includes('filter=low-stock') ||
    combinedUrl.includes('lowstockonly=true');

  const isReturn = type === 'RETURN' || itemType === 'RETURN';
  const isPurchase = type === 'PURCHASE' || itemType === 'PURCHASE';
  const hasExplicitInvoiceId = Boolean(cleanIdValue(input.invoiceId));

  const tagStr = cleanIdValue(input.tag).toLowerCase();

  const hasAnnouncementHint =
    type === 'ANNOUNCEMENT' ||
    itemType === 'ANNOUNCEMENT' ||
    itemType === 'NOTICE' ||
    kind === 'NOTICE' ||
    combinedUrl.includes('/announcements/') ||
    tagStr.startsWith('platform-') ||
    (['INFO', 'WARNING', 'URGENT', 'SUCCESS'].includes(type) && !isLowStock && !isReturn && !isPurchase);

  const isInvoice =
    hasExplicitInvoiceId ||
    (!isLowStock &&
      !isPurchase &&
      (type === 'INVOICE' ||
        type === 'SALE' ||
        type === 'RETURN' ||
        type === 'EXCHANGE' ||
        type === 'SALE_RETURN' ||
        type === 'SALE_EXCHANGE' ||
        itemType === 'INVOICE' ||
        itemType === 'SALE' ||
        itemType === 'RETURN' ||
        itemType === 'EXCHANGE' ||
        itemType === 'SALE_RETURN' ||
        itemType === 'SALE_EXCHANGE' ||
        combinedUrl.includes('/invoices/') ||
        combinedUrl.includes('viewinvoice=') ||
        combinedUrl.includes('invoice=')));

  if (isInvoice) {
    const invoiceId = extractInvoiceId(input, candidateUrls);
    primaryAction = {
      action: 'view_invoice',
      label: 'View Invoice',
      url: invoiceId ? `/invoices/${encodeURIComponent(invoiceId)}` : isReturn ? '/returns' : '/reports',
    };
  } else if (isLowStock) {
    primaryAction = {
      action: 'view_stock',
      label: 'View Stock',
      url: '/inventory?filter=low-stock',
    };
  } else if (isPurchase) {
    primaryAction = {
      action: 'view_purchase',
      label: 'View Purchase',
      url: '/?tab=purchases',
    };
  } else if (hasAnnouncementHint) {
    const announcementId = extractAnnouncementId(input, candidateUrls);
    primaryAction = {
      action: 'read_more',
      label: 'Read More',
      url: announcementId ? `/announcements/${encodeURIComponent(announcementId)}` : '/notifications',
    };
  } else {
    // Fallback for any other notification type:
    // OWNER / ADMIN sees "Dashboard" -> /dashboard; other roles omit Button 1 completely.
    const resolvedRole = String(
      currentUserRole || input.userRole || input.role || ''
    )
      .trim()
      .toUpperCase();
    if (resolvedRole === 'OWNER' || resolvedRole === 'ADMIN') {
      primaryAction = {
        action: 'open_dashboard',
        label: 'Dashboard',
        url: '/dashboard',
      };
    }
  }

  const secondaryAction: NotificationActionDescriptor = {
    action: 'open_pos',
    label: 'Open POS',
    url: '/pos',
  };

  return primaryAction ? [primaryAction, secondaryAction] : [secondaryAction];
}

/**
 * Formats resolved actions into Web Push `NotificationOptions.actions` (max 2 items).
 */
export function buildPushNotificationActions(
  input: NotificationActionInput = {},
  currentUserRole?: string | null
): PushNotificationActionItem[] {
  return resolveNotificationActions(input, currentUserRole)
    .slice(0, 2)
    .map((btn) => ({
      action: btn.action,
      title: btn.label,
    }));
}

/**
 * Resolves a notification URL or action path into either an internal SPA path or external URL,
 * routing via client-side navigation (`pos:navigate-deep-link`) when the app is open and
 * authenticated, while preserving standard document navigation when unauthenticated or external.
 */
export function navigateToNotificationUrl(url: string, fallbackPayload?: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) return;

  let internalUrl = cleanUrl;

  if (/^https?:\/\//i.test(cleanUrl)) {
    try {
      const parsed = new URL(cleanUrl);
      if (parsed.origin !== window.location.origin) {
        window.location.assign(cleanUrl);
        return;
      }
      internalUrl = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch {
      window.location.assign(cleanUrl);
      return;
    }
  } else if (!internalUrl.startsWith('/')) {
    internalUrl = `/${internalUrl}`;
  }

  const pathnameOnly = internalUrl.split(/[?#]/)[0].toLowerCase();
  const isPortalDocumentRoute =
    pathnameOnly === '/install' ||
    pathnameOnly.startsWith('/install/') ||
    pathnameOnly === '/auth' ||
    pathnameOnly.startsWith('/auth/') ||
    pathnameOnly === '/login' ||
    pathnameOnly.startsWith('/login/') ||
    pathnameOnly === '/verify-email' ||
    pathnameOnly.startsWith('/verify-email/');

  if (isPortalDocumentRoute || !hasValidStoredAuthToken()) {
    window.location.assign(internalUrl);
    return;
  }

  window.dispatchEvent(
    new CustomEvent('pos:navigate-deep-link', {
      detail: {
        ...(fallbackPayload || {}),
        url: internalUrl,
        deepLinkUrl: internalUrl,
      },
    })
  );
}
