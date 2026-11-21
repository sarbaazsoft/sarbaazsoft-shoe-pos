import express, { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  registerSseClient,
  saveFcmToken,
  removeFcmToken,
  getFcmStats,
  testFcmPush,
  normalizeVapidPublicKey,
  disconnectOwnerSseClients,
  hasActiveAuthenticatedOwnerSse,
  isStoreOwnerOnline,
  disconnectSuperAdminSseClients,
  hasActiveAuthenticatedSuperAdminSse,
  isSuperAdminOnline,
} from '../pushNotificationService.ts';
import { getAppSetting } from '../services/appSettingsService.ts';
import {
  getStoreNotificationDeliveryStatus,
  getTenantNotificationPreferences,
  saveTenantNotificationPreferences,
} from '../services/notificationPreferencesService.ts';
import {
  extractTokenFromRequest,
  getJwtSecret,
  isTokenRevoked,
  requireAuth,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from '../auth.ts';
import {
  isOwnerRole,
  recordOwnerHeartbeat,
  markOwnerSessionOffline,
  shrinkOwnerSessionGraceWindow,
  hasFreshOwnerHeartbeat,
  isSuperAdminRole,
  recordSuperAdminHeartbeat,
  markSuperAdminSessionOffline,
  shrinkSuperAdminSessionGraceWindow,
  hasFreshSuperAdminHeartbeat,
} from '../services/ownerPresenceService.ts';
import { pgClient } from '../../db/index.ts';
import { ensureNotificationsSchema, ensurePlatformNotificationsSchema } from '../../db/schemaInit.ts';
import {
  cleanOptionalText,
  formatExchangeNotification,
  formatReturnNotification,
  formatReturnReferenceToExchange,
  formatSaleExchangeNotification,
  formatSaleNotification,
  formatSaleReturnNotification,
} from '../../utils/notificationFormatters.ts';

async function resolveStoreNotificationContext(cleanTenantId: number): Promise<{
  isWholesaleTenant: boolean;
  linkedSaleReturnNumbers: Set<string>;
  exchangeLinkedReturnNumbers: Set<string>;
}> {
  const [csRes, combinedSalesRes] = await Promise.all([
    pgClient
      .query<{ business_type: string }>(
        'SELECT business_type FROM company_settings WHERE tenant_id = $1 LIMIT 1',
        [cleanTenantId]
      )
      .catch(() => ({ rows: [] as Array<{ business_type?: string }> })),
    pgClient
      .query<{ notes: string | null; sale_type?: string | null }>(
        `SELECT notes, sale_type FROM sales WHERE tenant_id = $1 AND notes LIKE $2`,
        [cleanTenantId, '%(Return %']
      )
      .catch(() => ({ rows: [] as Array<{ notes: string | null; sale_type?: string | null }> })),
  ]);

  const isWholesaleTenant =
    String(csRes.rows[0]?.business_type || 'RETAIL').toUpperCase() === 'WHOLESALE';

  const linkedSaleReturnNumbers = new Set<string>();
  const exchangeLinkedReturnNumbers = new Set<string>();

  for (const sRow of combinedSalesRes.rows) {
    const notesStr = String(sRow.notes || '');
    const isExchangeSaleNote =
      notesStr.includes('Direct Shoe Exchange') ||
      notesStr.includes('[Standalone: EXCHANGE]') ||
      notesStr.includes('[Combined: SALE_EXCHANGE]');
    const matches = notesStr.matchAll(/(?:Return\s+#?)([A-Z0-9-]+)/gi);
    for (const m of matches) {
      if (m[1]) {
        const cleanRef = m[1].trim().toUpperCase();
        linkedSaleReturnNumbers.add(cleanRef);
        if (isExchangeSaleNote) {
          exchangeLinkedReturnNumbers.add(cleanRef);
        }
      }
    }
  }

  return { isWholesaleTenant, linkedSaleReturnNumbers, exchangeLinkedReturnNumbers };
}

function mapSaleNotificationRow(
  row: any,
  options: {
    isWholesaleTenant: boolean;
    returnByNumber: Map<string, any>;
    includeHistoryFields?: boolean;
  }
) {
  const notesStr = String(row.notes || '');
  const invoiceNo = row.invoice_number || String(row.id);
  const isWholesaleRow =
    options.isWholesaleTenant || String(row.sale_type || '').toUpperCase() === 'WHOLESALE';
  const createdAt = row.created_at || row.sale_date || new Date().toISOString();
  const customerName = cleanOptionalText(row.customer_name) || 'Walk-in Customer';
  const cashierName = cleanOptionalText(row.cashier_name) || 'Counter Staff';
  const paymentMethod = cleanOptionalText(row.payment_method) || 'Cash';

  const returnRefMatch = notesStr.match(/(?:Return\s+#?)([A-Z0-9-]+)/i);
  const matchedReturn = returnRefMatch
    ? options.returnByNumber.get(returnRefMatch[1].trim().toUpperCase())
    : undefined;
  const rawReturnRef = matchedReturn?.return_number || returnRefMatch?.[1] || null;
  const exchangeRef = formatReturnReferenceToExchange(rawReturnRef) || invoiceNo;

  if (!isWholesaleRow) {
    const isExchangeRow =
      notesStr.includes('Direct Shoe Exchange') || notesStr.includes('Wholesale Shoe Return');

    if (isExchangeRow) {
      const netMatch = notesStr.match(/Net Difference:\s*Rs\.\s*(-?\d+)/i);
      const adjustmentAmt = netMatch ? Number(netMatch[1]) : Number(row.total_amount || 0);
      const exchangeQty = Number(matchedReturn?.total_quantity || row.total_quantity || 0);
      const formatted = formatExchangeNotification({
        exchangeNo: exchangeRef,
        returnNo: rawReturnRef,
        invoiceNo,
        amount: adjustmentAmt,
        paymentMethod,
        totalQuantity: exchangeQty,
        customerName,
        cashierName,
      });
      return {
        id: `sale-${row.id}`,
        rawId: row.id,
        ...(options.includeHistoryFields ? { kind: 'OPERATIONAL' as const } : {}),
        itemType: 'EXCHANGE',
        type: 'EXCHANGE',
        title: formatted.title,
        message: formatted.message,
        itemsSummary: formatted.itemsSummary,
        totalAmount: Number(row.total_amount || 0),
        invoiceNumber: invoiceNo,
        exchangeNumber: exchangeRef,
        ...(rawReturnRef ? { returnNumber: rawReturnRef } : {}),
        deepLinkUrl: '/reports',
        ...(options.includeHistoryFields
          ? { expiresAt: null, isRead: Boolean(row.is_dismissed) }
          : { actionTab: 'reports', timestamp: createdAt, isRead: false }),
        createdAt,
      };
    }

    const returnedQty = Number(row.returned_quantity || 0);
    const formatted = formatSaleNotification({
      invoiceNo,
      totalAmount: Number(row.total_amount || 0),
      paymentMethod,
      totalQuantity: Number(row.total_quantity || 0),
      returnedQuantity: returnedQty,
      isWholesale: false,
      customerName,
      cashierName,
    });
    return {
      id: `sale-${row.id}`,
      rawId: row.id,
      ...(options.includeHistoryFields ? { kind: 'OPERATIONAL' as const } : {}),
      itemType: 'SALE',
      type: 'SALE',
      title: formatted.title,
      message: formatted.message,
      itemsSummary: formatted.itemsSummary,
      totalAmount: Number(row.total_amount || 0),
      invoiceNumber: invoiceNo,
      deepLinkUrl: '/reports',
      ...(options.includeHistoryFields
        ? { expiresAt: null, isRead: Boolean(row.is_dismissed) }
        : { actionTab: 'reports', timestamp: createdAt, isRead: false }),
      createdAt,
    };
  }

  const hasLinkedNoteAction =
    Boolean(returnRefMatch) ||
    notesStr.includes('[Combined: SALE_RETURN]') ||
    notesStr.includes('[Combined: SALE_EXCHANGE]') ||
    notesStr.includes('[Standalone: EXCHANGE]') ||
    notesStr.includes('Direct Shoe Exchange') ||
    notesStr.includes('Wholesale Shoe Return');

  const rawSubtotal = Number(row.subtotal ?? 0);
  const rawDiscount = Number(row.discount ?? 0);
  const rawPrevBal = Number(row.previous_balance ?? 0);
  const saleNetSubtotal =
    rawSubtotal > 0
      ? Math.max(0, rawSubtotal - rawDiscount)
      : Math.max(0, Number(row.total_amount || 0) - rawPrevBal);
  const soldQty = Number(row.total_quantity || 0);

  if (!hasLinkedNoteAction) {
    const returnedQty = Number(row.returned_quantity || 0);
    const formatted = formatSaleNotification({
      invoiceNo,
      totalAmount: saleNetSubtotal,
      paymentMethod,
      totalQuantity: soldQty,
      returnedQuantity: returnedQty,
      isWholesale: true,
      customerName,
      cashierName,
    });
    return {
      id: `sale-${row.id}`,
      rawId: row.id,
      ...(options.includeHistoryFields ? { kind: 'OPERATIONAL' as const } : {}),
      itemType: 'SALE',
      type: 'SALE',
      title: formatted.title,
      message: formatted.message,
      itemsSummary: formatted.itemsSummary,
      totalAmount: saleNetSubtotal,
      invoiceNumber: invoiceNo,
      deepLinkUrl: '/reports',
      ...(options.includeHistoryFields
        ? { expiresAt: null, isRead: Boolean(row.is_dismissed) }
        : { actionTab: 'reports', timestamp: createdAt, isRead: false }),
      createdAt,
    };
  }

  const creditMatch = notesStr.match(/Returned Credit:\s*Rs\.\s*(-?\d+(?:\.\d+)?)/i);
  const returnCredit = creditMatch
    ? Number(creditMatch[1])
    : Number(matchedReturn?.total_refund_amount || 0);
  const netMatch = notesStr.match(/Net Difference:\s*Rs\.\s*(-?\d+(?:\.\d+)?)/i);
  const netAmount = netMatch ? Number(netMatch[1]) : saleNetSubtotal - returnCredit;
  const retPairsMatch = notesStr.match(/RetPairs:\s*(\d+)/i);
  const returnedQty = Number(
    matchedReturn?.total_quantity || (retPairsMatch ? Number(retPairsMatch[1]) : 0) || row.returned_quantity || 0
  );

  if (notesStr.includes('[Standalone: EXCHANGE]')) {
    const formatted = formatExchangeNotification({
      exchangeNo: exchangeRef,
      returnNo: rawReturnRef,
      invoiceNo,
      amount: netAmount,
      paymentMethod,
      totalQuantity: returnedQty || soldQty,
      customerName,
      cashierName,
    });
    return {
      id: `sale-${row.id}`,
      rawId: row.id,
      ...(options.includeHistoryFields ? { kind: 'OPERATIONAL' as const } : {}),
      itemType: 'EXCHANGE',
      type: 'EXCHANGE',
      title: formatted.title,
      message: formatted.message,
      itemsSummary: formatted.itemsSummary,
      totalAmount: netAmount,
      invoiceNumber: invoiceNo,
      exchangeNumber: exchangeRef,
      returnNumber: matchedReturn?.return_number || returnRefMatch?.[1],
      deepLinkUrl: '/reports',
      ...(options.includeHistoryFields
        ? { expiresAt: null, isRead: Boolean(row.is_dismissed) }
        : { actionTab: 'reports', timestamp: createdAt, isRead: false }),
      createdAt,
    };
  }

  if (notesStr.includes('[Combined: SALE_EXCHANGE]') || notesStr.includes('Direct Shoe Exchange')) {
    const formatted = formatSaleExchangeNotification({
      exchangeNo: exchangeRef,
      returnNo: rawReturnRef,
      invoiceNo,
      amount: netAmount,
      paymentMethod,
      soldQuantity: soldQty,
      exchangedQuantity: returnedQty,
      customerName,
      cashierName,
    });
    return {
      id: `sale-${row.id}`,
      rawId: row.id,
      ...(options.includeHistoryFields ? { kind: 'OPERATIONAL' as const } : {}),
      itemType: 'SALE_EXCHANGE',
      type: 'SALE_EXCHANGE',
      title: formatted.title,
      message: formatted.message,
      itemsSummary: formatted.itemsSummary,
      totalAmount: netAmount,
      invoiceNumber: invoiceNo,
      exchangeNumber: exchangeRef,
      returnNumber: matchedReturn?.return_number || returnRefMatch?.[1],
      deepLinkUrl: '/reports',
      ...(options.includeHistoryFields
        ? { expiresAt: null, isRead: Boolean(row.is_dismissed) }
        : { actionTab: 'reports', timestamp: createdAt, isRead: false }),
      createdAt,
    };
  }

  const formatted = formatSaleReturnNotification({
    invoiceNo,
    amount: netAmount,
    paymentMethod,
    soldQuantity: soldQty,
    returnedQuantity: returnedQty,
    isWholesale: true,
    customerName,
    cashierName,
  });
  return {
    id: `sale-${row.id}`,
    rawId: row.id,
    ...(options.includeHistoryFields ? { kind: 'OPERATIONAL' as const } : {}),
    itemType: 'SALE_RETURN',
    type: 'SALE_RETURN',
    title: formatted.title,
    message: formatted.message,
    itemsSummary: formatted.itemsSummary,
    totalAmount: netAmount,
    invoiceNumber: invoiceNo,
    returnNumber: matchedReturn?.return_number || returnRefMatch?.[1],
    deepLinkUrl: '/reports',
    ...(options.includeHistoryFields
      ? { expiresAt: null, isRead: Boolean(row.is_dismissed) }
      : { actionTab: 'reports', timestamp: createdAt, isRead: false }),
    createdAt,
  };
}

const router = Router();

function extractRequestSessionId(req: Request, parsedBody?: any): string {
  const raw =
    req.headers['x-session-id'] ||
    req.query.sessionId ||
    req.query.__sessionId ||
    parsedBody?.sessionId ||
    (req.body && typeof req.body === 'object' ? req.body.sessionId : undefined);
  const clean = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '');
  return clean ? clean.slice(0, 64) : 'default';
}

function resolveRequestIdentity(req: Request): {
  tenantId: number;
  userId: number;
  role: string;
  authenticated: boolean;
  sessionId: string;
} {
  const sessionId = extractRequestSessionId(req);

  // 1. Check req.user attached by authMiddleware
  const reqUser = (req as any).user;
  if (reqUser) {
    const role = String(reqUser.role || 'ADMIN').toUpperCase();
    const tid = Number(reqUser.tenantId || reqUser.tenant_id || 0);
    return {
      tenantId: isSuperAdminRole(role) ? 0 : (Number.isInteger(tid) && tid > 0 ? tid : 1),
      userId: Number(reqUser.id || reqUser.userId || 0),
      role,
      authenticated: true,
      sessionId,
    };
  }

  // 2. Check Bearer / custom auth token
  const token = extractTokenFromRequest(req);
  if (token && !isTokenRevoked(token)) {
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as any;
      const role = String(decoded?.role || 'ADMIN').toUpperCase();
      const tid = Number(decoded?.tenantId || 0);
      return {
        tenantId: isSuperAdminRole(role) ? 0 : (Number.isInteger(tid) && tid > 0 ? tid : 1),
        userId: Number(decoded?.id || decoded?.userId || 0),
        role,
        authenticated: true,
        sessionId,
      };
    } catch {}
  }

  // 3. Check query param __token (used by EventSource SSE streams)
  const queryToken = typeof req.query.__token === 'string' ? req.query.__token : '';
  if (queryToken && !isTokenRevoked(queryToken)) {
    try {
      const decoded = jwt.verify(queryToken, getJwtSecret()) as any;
      const role = String(decoded?.role || 'ADMIN').toUpperCase();
      const tid = Number(decoded?.tenantId || 0);
      return {
        tenantId: isSuperAdminRole(role) ? 0 : (Number.isInteger(tid) && tid > 0 ? tid : 1),
        userId: Number(decoded?.id || decoded?.userId || 0),
        role,
        authenticated: true,
        sessionId,
      };
    } catch {}
  }

  // 4. Unauthenticated fallback (cannot mark owner online or receive owner SSE streams)
  const rawRole = req.query.role || req.query.__role || req.headers['x-user-role'];
  const explicitRole = typeof rawRole === 'string' && ['ADMIN', 'CASHIER', 'SUPERADMIN', 'OWNER'].includes(rawRole.toUpperCase())
    ? rawRole.toUpperCase()
    : null;

  const rawUserId = Number(req.query.userId || req.query.__userId || 0);

  const headerTenantId = Number(
    req.headers['x-tenant-id'] ||
    (req as any).tenantResolution?.tenant?.id ||
    req.query.__tenantId ||
    req.query.tenantId ||
    1
  );

  return {
    tenantId: Number.isInteger(headerTenantId) && headerTenantId > 0 ? headerTenantId : 1,
    userId: Number.isInteger(rawUserId) ? rawUserId : 0,
    role: explicitRole || 'ADMIN',
    authenticated: false,
    sessionId,
  };
}

/**
 * 1. GROUPED DROPDOWN ENDPOINT (GET /api/notifications/grouped)
 * Returns capped arrays (e.g. max 5 per tab) for the quick-access bell menu
 * to prevent UI overflow.
 * - Tab 1: Notices (SuperAdmin announcements, system notices, subscription alerts)
 * - Tab 2: Notifications (POS operational counter events, sales, returns)
 */
router.get('/grouped', async (req: Request, res: Response) => {
  try {
    await Promise.all([ensurePlatformNotificationsSchema(), ensureNotificationsSchema()]);
    const { tenantId, userId, role } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '5'), 10) || 5, 1), 10);
    const noticesOnly = String(req.query.noticesOnly || req.query.includeHistory === '0') === '1' || req.query.includeHistory === '0';

    // 1. Fetch active Platform Notices: (expires_at IS NULL OR expires_at > NOW()) and NOT dismissed
    const noticesRes = await pgClient.query<{
      id: number;
      tenant_id: number | null;
      target_role: string;
      title: string;
      message: string;
      type: string;
      action_url: string;
      action_label: string;
      created_by: number | null;
      created_by_name: string | null;
      expires_at: string | null;
      created_at: string;
      is_read: boolean;
    }>(
      `SELECT
         pn.id,
         pn.tenant_id,
         COALESCE(pn.target_role, 'ALL') AS target_role,
         pn.title,
         pn.message,
         pn.type,
         pn.action_url,
         pn.action_label,
         pn.created_by,
         COALESCE(u.name, 'Platform SuperAdmin') AS created_by_name,
         pn.expires_at,
         pn.created_at,
         EXISTS (
           SELECT 1 FROM platform_notification_reads pnr
           WHERE pnr.notification_id = pn.id
             AND (pnr.tenant_id = $1 OR pnr.user_id = $2)
         ) AS is_read
       FROM platform_notifications pn
       LEFT JOIN users u ON u.id = pn.created_by
       WHERE (pn.expires_at IS NULL OR pn.expires_at > NOW())
         AND NOT EXISTS (
           SELECT 1 FROM platform_notification_reads pnr
           WHERE pnr.notification_id = pn.id
             AND (pnr.tenant_id = $1 OR pnr.user_id = $2)
         )
         AND (
           CASE
             WHEN $3 = 'SUPERADMIN' THEN (
               COALESCE(pn.target_role, 'ALL') IN ('ALL', 'SUPERADMIN')
               AND pn.title NOT ILIKE '%welcome%'
               AND pn.message NOT ILIKE '%welcome%'
             )
             WHEN $3 = 'ADMIN' THEN (
               (pn.tenant_id IS NULL OR pn.tenant_id = $1)
               AND COALESCE(pn.target_role, 'ALL') IN ('ALL', 'ADMIN')
               AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
               AND COALESCE(pn.target_role, 'ALL') != 'CASHIER'
               AND pn.title NOT ILIKE 'New Free Trial%'
               AND pn.title NOT ILIKE 'New Renewal Request%'
               AND pn.title NOT ILIKE 'Renewal Request:%'
               AND pn.action_url NOT ILIKE '%/superadmin%'
               AND pn.message NOT ILIKE '%staff account (cashier)%'
             )
             WHEN $3 = 'CASHIER' THEN (
               (pn.tenant_id IS NULL OR pn.tenant_id = $1)
               AND COALESCE(pn.target_role, 'ALL') IN ('ALL', 'CASHIER')
               AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
               AND COALESCE(pn.target_role, 'ALL') != 'ADMIN'
               AND pn.title NOT ILIKE 'Welcome to SarbaazSoft%'
               AND pn.message NOT ILIKE '%thank you for choosing SarbaazSoft%'
               AND pn.title NOT ILIKE 'New Free Trial%'
               AND pn.title NOT ILIKE 'New Renewal Request%'
               AND pn.title NOT ILIKE 'Renewal Request:%'
               AND pn.action_url NOT ILIKE '%/superadmin%'
             )
             ELSE (
               (pn.tenant_id IS NULL OR pn.tenant_id = $1)
               AND COALESCE(pn.target_role, 'ALL') = 'ALL'
               AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
               AND pn.title NOT ILIKE 'New Free Trial%'
               AND pn.title NOT ILIKE 'New Renewal Request%'
               AND pn.title NOT ILIKE 'Renewal Request:%'
               AND pn.action_url NOT ILIKE '%/superadmin%'
             )
           END
         )
       ORDER BY pn.created_at DESC
       LIMIT $4`,
      [cleanTenantId, userId, role, limit]
    ).catch(() => ({ rows: [] }));

    const notices: any[] = noticesRes.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      targetRole: r.target_role,
      title: r.title,
      message: r.message,
      type: r.type,
      actionUrl: r.action_url,
      actionLabel: r.action_label,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      isRead: Boolean(r.is_read),
    }));

    // 2. Fetch active POS Operational Notifications (Sales, Purchases, Returns, Low Stock)
    // Only queried when history is requested (omitted when noticesOnly=1 during lightweight banner load)
    let operationalNotifications: any[] = [];
    if (!noticesOnly && role !== 'SUPERADMIN') {
      const { isWholesaleTenant, linkedSaleReturnNumbers, exchangeLinkedReturnNumbers } =
        await resolveStoreNotificationContext(cleanTenantId);

      const exchangeExcludedList = Array.from(exchangeLinkedReturnNumbers);

      const salesRes = await pgClient.query(
        `SELECT
           s.id,
           s.invoice_number,
           s.sale_type,
           COALESCE(s.subtotal, 0) AS subtotal,
           COALESCE(s.discount, 0) AS discount,
           COALESCE(s.previous_balance, 0) AS previous_balance,
           s.total_amount,
           s.payment_method,
           s.notes,
           s.sale_date,
           s.created_at,
           COALESCE(c.name, 'Walk-in Customer') AS customer_name,
           COALESCE(u.name, 'Counter Staff') AS cashier_name,
           COALESCE((SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0) AS total_quantity,
           COALESCE((
             SELECT SUM(ri.quantity)
             FROM return_items ri
             LEFT JOIN returns r ON ri.return_id = r.id
             LEFT JOIN sale_items si ON ri.sale_item_id = si.id
             WHERE (r.original_sale_id = s.id OR si.sale_id = s.id)
               AND (r.return_number IS NULL OR NOT (UPPER(r.return_number) = ANY($5::text[])))
           ), 0) AS returned_quantity,
           'SALE' AS item_type
         FROM sales s
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN users u ON s.created_by = u.id
         WHERE s.tenant_id = $1
           AND s.created_at >= NOW() - INTERVAL '48 HOURS'
           AND (CASE WHEN $4 = 'CASHIER' THEN s.created_by = $2 ELSE TRUE END)
           AND NOT EXISTS (
             SELECT 1 FROM pos_notification_dismissals pnd
             WHERE pnd.tenant_id = $1
               AND (pnd.user_id = $2 OR pnd.user_id = 0)
               AND pnd.item_type = 'SALE'
               AND pnd.item_id = s.id
           )
         ORDER BY s.created_at DESC
         LIMIT $3`,
        [cleanTenantId, userId, limit, role, exchangeExcludedList]
      ).catch(() => ({ rows: [] }));

      const returnsRes = await pgClient.query(
        `SELECT
           r.id,
           r.return_number,
           r.original_sale_id,
           r.total_refund_amount,
           r.reason,
           r.return_date,
           r.created_at,
           s.invoice_number,
           COALESCE(s.payment_method, r.payment_method) AS payment_method,
           COALESCE(c.name, r.customer_name) AS customer_name,
           COALESCE(u.name, 'Authorized Staff') AS cashier_name,
           COALESCE((SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.return_id = r.id), 0) AS total_quantity,
           'RETURN' AS item_type
         FROM returns r
         LEFT JOIN sales s ON r.original_sale_id = s.id
         LEFT JOIN customers c ON r.customer_id = c.id
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.tenant_id = $1
           AND r.created_at >= NOW() - INTERVAL '48 HOURS'
           AND (CASE WHEN $4 = 'CASHIER' THEN r.created_by = $2 ELSE TRUE END)
           AND NOT EXISTS (
             SELECT 1 FROM pos_notification_dismissals pnd
             WHERE pnd.tenant_id = $1
               AND (pnd.user_id = $2 OR pnd.user_id = 0)
               AND pnd.item_type = 'RETURN'
               AND pnd.item_id = r.id
           )
         ORDER BY r.created_at DESC
         LIMIT $3`,
        [cleanTenantId, userId, Math.max(limit * 5, 50), role]
      ).catch(() => ({ rows: [] }));

      const returnByNumber = new Map<string, any>();
      for (const rRow of returnsRes.rows) {
        if (rRow.return_number) {
          returnByNumber.set(String(rRow.return_number).trim().toUpperCase(), rRow);
        }
      }

      const mappedSales = salesRes.rows.map((row: any) =>
        mapSaleNotificationRow(row, {
          isWholesaleTenant,
          returnByNumber,
          includeHistoryFields: false,
        })
      );

      // Returns linked to an existing sale invoice are consolidated inside Sale Completed;
      // only independent returns (without original_sale_id or linked sale note) emit Return Completed.
      const mappedReturns = returnsRes.rows
        .filter((row: any) => {
          if (Number(row.original_sale_id) > 0) return false;
          const retNo = String(row.return_number || '').trim().toUpperCase();
          return !retNo || !linkedSaleReturnNumbers.has(retNo);
        })
        .slice(0, limit)
        .map((row: any) => {
          const returnNo = row.return_number || String(row.id);
          const formatted = formatReturnNotification({
            returnNo,
            amount: Number(row.total_refund_amount || 0),
            paymentMethod: row.payment_method,
            totalQuantity: Number(row.total_quantity || 0),
            customerName: row.customer_name,
            cashierName: row.cashier_name,
          });
          return {
            id: `return-${row.id}`,
            rawId: row.id,
            itemType: 'RETURN',
            type: 'RETURN',
            title: formatted.title,
            message: formatted.message,
            itemsSummary: formatted.itemsSummary,
            totalAmount: Number(row.total_refund_amount || 0),
            invoiceNumber: '',
            returnNumber: returnNo,
            deepLinkUrl: '/returns',
            actionTab: 'returns',
            createdAt: row.created_at || row.return_date || new Date().toISOString(),
            timestamp: row.created_at || row.return_date || new Date().toISOString(),
            isRead: false,
          };
        });

      let mappedLowStock: any[] = [];
      if (role === 'ADMIN' || role === 'OWNER') {
        const lowStockRes = await pgClient.query<{
          id: number;
          type: string;
          title: string;
          message: string;
          sale_id: number | null;
          invoice_number: string | null;
          action_url: string | null;
          items_json: any;
          created_at: string;
          is_read: boolean;
        }>(
          `SELECT id, type, title, message, sale_id, invoice_number, action_url, items_json, created_at, COALESCE(is_read, false) AS is_read
           FROM public.notifications
           WHERE tenant_id = $1
             AND COALESCE(is_read, false) = false
             AND created_at >= NOW() - INTERVAL '48 HOURS'
           ORDER BY created_at DESC
           LIMIT $2`,
          [cleanTenantId, limit]
        ).catch(() => ({ rows: [] }));

        mappedLowStock = lowStockRes.rows.map((row) => ({
          id: `notif-${row.id}`,
          rawId: row.id,
          itemType: 'LOW_STOCK',
          type: 'STOCK',
          title: row.title,
          message: row.message,
          saleId: row.sale_id || undefined,
          invoiceNumber: row.invoice_number || undefined,
          items: Array.isArray(row.items_json) ? row.items_json : [],
          actionUrl: row.action_url || '/?tab=inventory&lowStockOnly=true',
          deepLinkUrl: row.action_url || '/?tab=inventory&lowStockOnly=true',
          actionTab: 'inventory',
          createdAt: row.created_at || new Date().toISOString(),
          timestamp: row.created_at || new Date().toISOString(),
          isRead: Boolean(row.is_read),
        }));
      }

      // Combine and cap at limit (max 5)
      operationalNotifications = [...mappedLowStock, ...mappedSales, ...mappedReturns]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }

    const unreadNoticesCount = notices.length;
    const unreadNotificationsCount = operationalNotifications.length;
    const totalUnread = unreadNoticesCount + unreadNotificationsCount;

    return res.json({
      notices,
      notifications: operationalNotifications,
      unreadNoticesCount,
      unreadNotificationsCount,
      totalUnread,
      limit,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to retrieve grouped notifications: ' + err.message,
      notices: [],
      notifications: [],
      unreadNoticesCount: 0,
      unreadNotificationsCount: 0,
      totalUnread: 0,
      limit: 5,
    });
  }
});

/**
 * 2. DEDICATED HISTORY ENDPOINT (GET /api/notifications/all)
 * Supports pagination, search filters, category filters, and sorting for a full historical view.
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    await Promise.all([ensurePlatformNotificationsSchema(), ensureNotificationsSchema()]);
    const { tenantId, userId, role } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;

    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '15'), 10) || 15, 1), 100);
    const tabFilter = String(req.query.tab || req.query.category || 'all').toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const unreadOnly = String(req.query.unreadOnly || 'false') === 'true';

    // 1. Fetch historical Platform Notices
    let noticeItems: any[] = [];
    if (tabFilter === 'all' || tabFilter === 'notices' || tabFilter === 'announcements' || tabFilter === 'urgent') {
      const noticesQuery = await pgClient.query<{
        id: number;
        tenant_id: number | null;
        target_role: string;
        title: string;
        message: string;
        type: string;
        action_url: string;
        action_label: string;
        created_by: number | null;
        created_by_name: string | null;
        expires_at: string | null;
        created_at: string;
        is_read: boolean;
      }>(
        `SELECT
           pn.id,
           pn.tenant_id,
           COALESCE(pn.target_role, 'ALL') AS target_role,
           pn.title,
           pn.message,
           pn.type,
           pn.action_url,
           pn.action_label,
           pn.created_by,
           COALESCE(u.name, 'Platform SuperAdmin') AS created_by_name,
           pn.expires_at,
           pn.created_at,
           EXISTS (
             SELECT 1 FROM platform_notification_reads pnr
             WHERE pnr.notification_id = pn.id
               AND (pnr.tenant_id = $1 OR pnr.user_id = $2)
           ) AS is_read
         FROM platform_notifications pn
         LEFT JOIN users u ON u.id = pn.created_by
         WHERE (
           CASE
             WHEN $3 = 'SUPERADMIN' THEN (
               COALESCE(pn.target_role, 'ALL') IN ('ALL', 'SUPERADMIN')
               AND pn.title NOT ILIKE 'Welcome to SarbaazSoft%' AND pn.message NOT ILIKE '%thank you for choosing SarbaazSoft%'
             )
             WHEN $3 = 'ADMIN' THEN (
               (pn.tenant_id IS NULL OR pn.tenant_id = $1)
               AND COALESCE(pn.target_role, 'ALL') IN ('ALL', 'ADMIN')
               AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
               AND COALESCE(pn.target_role, 'ALL') != 'CASHIER'
               AND pn.title NOT ILIKE 'New Free Trial%'
               AND pn.title NOT ILIKE 'New Renewal Request%'
               AND pn.title NOT ILIKE 'Renewal Request:%'
               AND pn.action_url NOT ILIKE '%/superadmin%'
               AND pn.message NOT ILIKE '%staff account (cashier)%'
             )
             WHEN $3 = 'CASHIER' THEN (
               (pn.tenant_id IS NULL OR pn.tenant_id = $1)
               AND COALESCE(pn.target_role, 'ALL') IN ('ALL', 'CASHIER')
               AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
               AND COALESCE(pn.target_role, 'ALL') != 'ADMIN'
               AND pn.title NOT ILIKE 'Welcome to SarbaazSoft%' AND pn.message NOT ILIKE '%thank you for choosing SarbaazSoft%'
               AND pn.title NOT ILIKE 'New Free Trial%'
               AND pn.title NOT ILIKE 'New Renewal Request%'
               AND pn.title NOT ILIKE 'Renewal Request:%'
               AND pn.action_url NOT ILIKE '%/superadmin%'
             )
             ELSE (
               (pn.tenant_id IS NULL OR pn.tenant_id = $1)
               AND COALESCE(pn.target_role, 'ALL') = 'ALL'
               AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
               AND pn.title NOT ILIKE 'New Free Trial%'
               AND pn.title NOT ILIKE 'New Renewal Request%'
               AND pn.title NOT ILIKE 'Renewal Request:%'
               AND pn.action_url NOT ILIKE '%/superadmin%'
             )
           END
         )
         ORDER BY pn.created_at DESC
         LIMIT 300`,
        [cleanTenantId, userId, role]
      ).catch(() => ({ rows: [] }));

      noticeItems = noticesQuery.rows.map((r) => ({
        id: `notice-${r.id}`,
        rawId: r.id,
        kind: 'NOTICE',
        itemType: 'NOTICE',
        type: r.type,
        title: r.title,
        message: r.message,
        actionUrl: r.action_url,
        actionLabel: r.action_label,
        deepLinkUrl: r.action_url,
        tenantId: r.tenant_id,
        targetRole: r.target_role,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        isRead: Boolean(r.is_read),
      }));
    }

    // 2. Fetch historical POS Operational Activity (Sales, Returns, Exchanges, & Low Stock)
    // Cashiers ONLY view historical notifications for their own operations (never LOW_STOCK)
    let operationalItems: any[] = [];
    if (
      role !== 'SUPERADMIN' &&
      (tabFilter === 'all' ||
        tabFilter === 'notifications' ||
        tabFilter === 'operational' ||
        tabFilter === 'sales' ||
        tabFilter === 'returns' ||
        tabFilter === 'stock' ||
        tabFilter === 'low_stock')
    ) {
      const { isWholesaleTenant, linkedSaleReturnNumbers, exchangeLinkedReturnNumbers } =
        await resolveStoreNotificationContext(cleanTenantId);

      const exchangeExcludedList = Array.from(exchangeLinkedReturnNumbers);

      const salesRes = await pgClient.query(
        `SELECT
           s.id,
           s.invoice_number,
           s.sale_type,
           COALESCE(s.subtotal, 0) AS subtotal,
           COALESCE(s.discount, 0) AS discount,
           COALESCE(s.previous_balance, 0) AS previous_balance,
           s.total_amount,
           s.payment_method,
           s.notes,
           s.sale_date,
           s.created_at,
           COALESCE(c.name, 'Walk-in Customer') AS customer_name,
           COALESCE(u.name, 'Counter Staff') AS cashier_name,
           COALESCE((SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0) AS total_quantity,
           COALESCE((
             SELECT SUM(ri.quantity)
             FROM return_items ri
             LEFT JOIN returns r ON ri.return_id = r.id
             LEFT JOIN sale_items si ON ri.sale_item_id = si.id
             WHERE (r.original_sale_id = s.id OR si.sale_id = s.id)
               AND (r.return_number IS NULL OR NOT (UPPER(r.return_number) = ANY($4::text[])))
           ), 0) AS returned_quantity,
           EXISTS (
             SELECT 1 FROM pos_notification_dismissals pnd
             WHERE pnd.tenant_id = $1
               AND (pnd.user_id = $2 OR pnd.user_id = 0)
               AND pnd.item_type = 'SALE'
               AND pnd.item_id = s.id
           ) AS is_dismissed
         FROM sales s
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN users u ON s.created_by = u.id
         WHERE s.tenant_id = $1
           AND (CASE WHEN $3 = 'CASHIER' THEN s.created_by = $2 ELSE TRUE END)
         ORDER BY s.created_at DESC
         LIMIT 200`,
        [cleanTenantId, userId, role, exchangeExcludedList]
      ).catch(() => ({ rows: [] }));

      const returnsRes = await pgClient.query(
        `SELECT
           r.id,
           r.return_number,
           r.original_sale_id,
           r.total_refund_amount,
           r.reason,
           r.return_date,
           r.created_at,
           s.invoice_number,
           COALESCE(s.payment_method, r.payment_method) AS payment_method,
           COALESCE(c.name, r.customer_name) AS customer_name,
           COALESCE(u.name, 'Authorized Staff') AS cashier_name,
           COALESCE((SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.return_id = r.id), 0) AS total_quantity,
           EXISTS (
             SELECT 1 FROM pos_notification_dismissals pnd
             WHERE pnd.tenant_id = $1
               AND (pnd.user_id = $2 OR pnd.user_id = 0)
               AND pnd.item_type = 'RETURN'
               AND pnd.item_id = r.id
           ) AS is_dismissed
         FROM returns r
         LEFT JOIN sales s ON r.original_sale_id = s.id
         LEFT JOIN customers c ON r.customer_id = c.id
         LEFT JOIN users u ON r.created_by = u.id
         WHERE r.tenant_id = $1
           AND (CASE WHEN $3 = 'CASHIER' THEN r.created_by = $2 ELSE TRUE END)
         ORDER BY r.created_at DESC
         LIMIT 200`,
        [cleanTenantId, userId, role]
      ).catch(() => ({ rows: [] }));

      const returnByNumber = new Map<string, any>();
      for (const rRow of returnsRes.rows) {
        if (rRow.return_number) {
          returnByNumber.set(String(rRow.return_number).trim().toUpperCase(), rRow);
        }
      }

      const mappedSales = salesRes.rows.map((row: any) =>
        mapSaleNotificationRow(row, {
          isWholesaleTenant,
          returnByNumber,
          includeHistoryFields: true,
        })
      );

      const mappedReturns = returnsRes.rows
        .filter((row: any) => {
          if (Number(row.original_sale_id) > 0) return false;
          const retNo = String(row.return_number || '').trim().toUpperCase();
          return !retNo || !linkedSaleReturnNumbers.has(retNo);
        })
        .map((row: any) => {
          const returnNo = row.return_number || String(row.id);
          const formatted = formatReturnNotification({
            returnNo,
            amount: Number(row.total_refund_amount || 0),
            paymentMethod: row.payment_method,
            totalQuantity: Number(row.total_quantity || 0),
            customerName: row.customer_name,
            cashierName: row.cashier_name,
          });
          return {
            id: `return-${row.id}`,
            rawId: row.id,
            kind: 'OPERATIONAL',
            itemType: 'RETURN',
            type: 'RETURN',
            title: formatted.title,
            message: formatted.message,
            itemsSummary: formatted.itemsSummary,
            totalAmount: Number(row.total_refund_amount || 0),
            invoiceNumber: '',
            returnNumber: returnNo,
            deepLinkUrl: '/returns',
            createdAt: row.created_at || row.return_date || new Date().toISOString(),
            expiresAt: null,
            isRead: Boolean(row.is_dismissed),
          };
        });

      let mappedLowStock: any[] = [];
      if (role === 'ADMIN' || role === 'OWNER') {
        const lowStockRes = await pgClient.query<{
          id: number;
          type: string;
          title: string;
          message: string;
          sale_id: number | null;
          invoice_number: string | null;
          action_url: string | null;
          items_json: any;
          created_at: string;
          is_read: boolean;
        }>(
          `SELECT id, type, title, message, sale_id, invoice_number, action_url, items_json, created_at, COALESCE(is_read, false) AS is_read
           FROM public.notifications
           WHERE tenant_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [cleanTenantId]
        ).catch(() => ({ rows: [] }));

        mappedLowStock = lowStockRes.rows.map((row) => ({
          id: `notif-${row.id}`,
          rawId: row.id,
          kind: 'OPERATIONAL',
          itemType: 'LOW_STOCK',
          type: 'STOCK',
          title: row.title,
          message: row.message,
          invoiceNumber: row.invoice_number || undefined,
          saleId: row.sale_id || undefined,
          items: Array.isArray(row.items_json) ? row.items_json : [],
          actionUrl: row.action_url || '/?tab=inventory&lowStockOnly=true',
          actionLabel: 'Restock Inventory',
          deepLinkUrl: row.action_url || '/?tab=inventory&lowStockOnly=true',
          createdAt: row.created_at || new Date().toISOString(),
          expiresAt: null,
          isRead: Boolean(row.is_read),
        }));
      }

      if (tabFilter === 'sales') {
        operationalItems = mappedSales;
      } else if (tabFilter === 'returns') {
        operationalItems = [
          ...mappedSales.filter((s: any) =>
            ['SALE_RETURN', 'SALE_EXCHANGE', 'EXCHANGE'].includes(String(s.type || '').toUpperCase())
          ),
          ...mappedReturns,
        ];
      } else if (tabFilter === 'stock' || tabFilter === 'low_stock') {
        operationalItems = mappedLowStock;
      } else {
        operationalItems = [...mappedLowStock, ...mappedSales, ...mappedReturns];
      }
    }

    // Calculate aggregate stats across all loaded items
    const totalNotices = noticeItems.length;
    const totalOperational = operationalItems.length;
    const unreadNotices = noticeItems.filter((i) => !i.isRead).length;
    const unreadOperational = operationalItems.filter((i) => !i.isRead).length;

    let combined = [...noticeItems, ...operationalItems];

    // Filter by type if specific tab was selected
    if (tabFilter === 'urgent') {
      combined = combined.filter((i) => i.type === 'URGENT');
    }

    // Filter by search keyword
    if (search) {
      combined = combined.filter(
        (i) =>
          (i.title || '').toLowerCase().includes(search) ||
          (i.message || '').toLowerCase().includes(search) ||
          (i.invoiceNumber || '').toLowerCase().includes(search) ||
          (i.purchaseNumber || '').toLowerCase().includes(search) ||
          (i.returnNumber || '').toLowerCase().includes(search)
      );
    }

    // Filter by unread
    if (unreadOnly) {
      combined = combined.filter((i) => !i.isRead);
    }

    // Sorting
    combined.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });

    const total = combined.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const pagedItems = combined.slice(offset, offset + limit);

    return res.json({
      items: pagedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      stats: {
        totalNotices,
        totalOperational,
        unreadNotices,
        unreadOperational,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to retrieve notification history: ' + err.message,
      items: [],
      pagination: { page: 1, limit: 15, total: 0, totalPages: 1 },
      stats: { totalNotices: 0, totalOperational: 0, unreadNotices: 0, unreadOperational: 0 },
    });
  }
});

/**
 * 2.5. DISMISS WELCOME BANNER ENDPOINT (POST /api/notifications/dismiss-welcome)
 * Permanently marks the welcome banner as dismissed in the PostgreSQL database (tenants.welcome_dismissed = true)
 * and records read status for any platform welcome notices so they never reappear.
 */
router.post('/dismiss-welcome', async (req: Request, res: Response) => {
  try {
    await ensurePlatformNotificationsSchema();
    const { tenantId, userId } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;

    // 1. Permanently update tenants table
    await pgClient.query(
      `UPDATE tenants SET welcome_dismissed = true WHERE id = $1`,
      [cleanTenantId]
    ).catch(() => {});

    // 2. Mark any welcome notices in platform_notifications as read for this tenant/user
    await pgClient.query(
      `INSERT INTO platform_notification_reads (notification_id, tenant_id, user_id, read_at)
       SELECT pn.id, $1, $2, NOW()
       FROM platform_notifications pn
       WHERE (pn.tenant_id IS NULL OR pn.tenant_id = $1)
         AND (
           pn.title ILIKE '%welcome%'
           OR pn.message ILIKE '%welcome%'
           OR pn.message ILIKE '%thank you for choosing%'
         )
       ON CONFLICT (notification_id, tenant_id, user_id) DO UPDATE SET read_at = NOW()`,
      [cleanTenantId, userId]
    ).catch(() => {});

    return res.json({ success: true, message: 'Welcome message dismissed permanently.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to dismiss welcome banner: ' + err.message });
  }
});

/**
 * 3. DISMISS MUTATION ENDPOINT (POST /api/notifications/:id/dismiss & /dismiss)
 * Instantly records user dismissal to remove the notice or operational item from active drawers.
 */
router.post(['/:id/dismiss', '/dismiss'], async (req: Request, res: Response) => {
  try {
    await Promise.all([ensurePlatformNotificationsSchema(), ensureNotificationsSchema()]);
    const { tenantId, userId } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;

    const rawIdParam = req.params.id || req.body?.id || '';
    const itemType = String(req.body?.itemType || '').toUpperCase();
    const cleanIdStr = String(rawIdParam).trim();

    if (!cleanIdStr) {
      return res.status(400).json({ error: 'Notification ID is required.' });
    }

    if (cleanIdStr.startsWith('notif-') || itemType === 'LOW_STOCK') {
      const notifId = parseInt(cleanIdStr.replace(/^notif-/, ''), 10);
      if (Number.isInteger(notifId) && notifId > 0) {
        await pgClient.query(
          `UPDATE public.notifications
           SET is_read = true, read_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [notifId, cleanTenantId]
        );
      }
    } else if (cleanIdStr.startsWith('notice-') || itemType === 'NOTICE' || /^\d+$/.test(cleanIdStr)) {
      const numericId = parseInt(cleanIdStr.replace(/^notice-/, ''), 10);
      if (Number.isInteger(numericId) && numericId > 0) {
        await pgClient.query(
          `INSERT INTO platform_notification_reads (notification_id, tenant_id, user_id, read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (notification_id, tenant_id, user_id) DO UPDATE SET read_at = NOW()`,
          [numericId, cleanTenantId, userId]
        );
      }
    } else if (cleanIdStr.startsWith('sale-') || itemType === 'SALE') {
      const saleId = parseInt(cleanIdStr.replace(/^sale-/, ''), 10);
      if (Number.isInteger(saleId) && saleId > 0) {
        await pgClient.query(
          `INSERT INTO pos_notification_dismissals (tenant_id, user_id, item_type, item_id, dismissed_at)
           VALUES ($1, $2, 'SALE', $3, NOW())
           ON CONFLICT (tenant_id, user_id, item_type, item_id) DO UPDATE SET dismissed_at = NOW()`,
          [cleanTenantId, userId, saleId]
        );
      }
    } else if (cleanIdStr.startsWith('return-') || itemType === 'RETURN') {
      const returnId = parseInt(cleanIdStr.replace(/^return-/, ''), 10);
      if (Number.isInteger(returnId) && returnId > 0) {
        await pgClient.query(
          `INSERT INTO pos_notification_dismissals (tenant_id, user_id, item_type, item_id, dismissed_at)
           VALUES ($1, $2, 'RETURN', $3, NOW())
           ON CONFLICT (tenant_id, user_id, item_type, item_id) DO UPDATE SET dismissed_at = NOW()`,
          [cleanTenantId, userId, returnId]
        );
      }
    } else if (cleanIdStr.startsWith('purchase-') || itemType === 'PURCHASE') {
      const purchaseId = parseInt(cleanIdStr.replace(/^purchase-/, ''), 10);
      if (Number.isInteger(purchaseId) && purchaseId > 0) {
        await pgClient.query(
          `INSERT INTO pos_notification_dismissals (tenant_id, user_id, item_type, item_id, dismissed_at)
           VALUES ($1, $2, 'PURCHASE', $3, NOW())
           ON CONFLICT (tenant_id, user_id, item_type, item_id) DO UPDATE SET dismissed_at = NOW()`,
          [cleanTenantId, userId, purchaseId]
        );
      }
    }

    return res.json({ success: true, message: 'Notification dismissed successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to dismiss notification: ' + err.message });
  }
});


/**
 * 5. DISMISS ALL MUTATION (POST /api/notifications/dismiss-all & /mark-all-read)
 */
router.post(['/dismiss-all', '/mark-all-read'], async (req: Request, res: Response) => {
  try {
    await Promise.all([ensurePlatformNotificationsSchema(), ensureNotificationsSchema()]);
    const { tenantId, userId, role } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;

    // 1. Dismiss/read all eligible platform notices
    await pgClient.query(
      `INSERT INTO platform_notification_reads (notification_id, tenant_id, user_id, read_at)
       SELECT pn.id, $1, $2, NOW()
       FROM platform_notifications pn
       WHERE (pn.tenant_id IS NULL OR pn.tenant_id = $1)
         AND (pn.expires_at IS NULL OR pn.expires_at > NOW())
         AND (
           CASE
             WHEN $3 = 'SUPERADMIN' THEN COALESCE(pn.target_role, 'ALL') IN ('ALL', 'SUPERADMIN')
             ELSE COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
           END
         )
       ON CONFLICT (notification_id, tenant_id, user_id) DO UPDATE SET read_at = NOW()`,
      [cleanTenantId, userId, role]
    ).catch(() => {});

    // 2. Dismiss/read all recent 48-hour sales, returns & admin low-stock alerts
    if (role !== 'SUPERADMIN') {
      if (role === 'ADMIN' || role === 'OWNER') {
        await pgClient.query(
          `UPDATE public.notifications
           SET is_read = true, read_at = NOW()
           WHERE tenant_id = $1 AND COALESCE(is_read, false) = false`,
          [cleanTenantId]
        ).catch(() => {});
      }

      await pgClient.query(
        `INSERT INTO pos_notification_dismissals (tenant_id, user_id, item_type, item_id, dismissed_at)
         SELECT $1, $2, 'SALE', s.id, NOW()
         FROM sales s
         WHERE s.tenant_id = $1
           AND s.created_at >= NOW() - INTERVAL '48 HOURS'
           AND (CASE WHEN $3 = 'CASHIER' THEN s.created_by = $2 ELSE TRUE END)
         ON CONFLICT (tenant_id, user_id, item_type, item_id) DO UPDATE SET dismissed_at = NOW()`,
        [cleanTenantId, userId, role]
      ).catch(() => {});

      await pgClient.query(
        `INSERT INTO pos_notification_dismissals (tenant_id, user_id, item_type, item_id, dismissed_at)
         SELECT $1, $2, 'RETURN', r.id, NOW()
         FROM returns r
         WHERE r.tenant_id = $1
           AND r.created_at >= NOW() - INTERVAL '48 HOURS'
           AND (CASE WHEN $3 = 'CASHIER' THEN r.created_by = $2 ELSE TRUE END)
         ON CONFLICT (tenant_id, user_id, item_type, item_id) DO UPDATE SET dismissed_at = NOW()`,
        [cleanTenantId, userId, role]
      ).catch(() => {});
    }

    return res.json({ success: true, message: 'All notifications dismissed/marked as read.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to dismiss all notifications: ' + err.message });
  }
});


// POST /api/notifications/platform/:id/dismiss - Mark announcement as read/dismissed
router.post('/platform/:id/dismiss', async (req: Request, res: Response) => {
  try {
    await ensurePlatformNotificationsSchema();
    const { tenantId, userId } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;
    const notificationId = parseInt(req.params.id, 10);

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    await pgClient.query(
      `INSERT INTO platform_notification_reads (notification_id, tenant_id, user_id, read_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (notification_id, tenant_id, user_id) DO UPDATE SET read_at = NOW()`,
      [notificationId, cleanTenantId, userId]
    );

    res.json({ success: true, message: 'Notification dismissed.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to dismiss notification: ' + err.message });
  }
});

// POST /api/notifications/platform/dismiss-all - Mark all announcements as read for this store
router.post('/platform/dismiss-all', async (req: Request, res: Response) => {
  try {
    await ensurePlatformNotificationsSchema();
    const { tenantId, userId } = resolveRequestIdentity(req);
    const cleanTenantId = tenantId || 1;

    await pgClient.query(
      `INSERT INTO platform_notification_reads (notification_id, tenant_id, user_id, read_at)
       SELECT pn.id, $1, $2, NOW()
       FROM platform_notifications pn
       WHERE (pn.tenant_id IS NULL OR pn.tenant_id = $1)
         AND (pn.expires_at IS NULL OR pn.expires_at > NOW())
         AND COALESCE(pn.target_role, 'ALL') != 'SUPERADMIN'
       ON CONFLICT (notification_id, tenant_id, user_id) DO UPDATE SET read_at = NOW()`,
      [cleanTenantId, userId]
    );

    res.json({ success: true, message: 'All notifications dismissed.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to dismiss all notifications: ' + err.message });
  }
});

// ============================================================================
// FIREBASE CLOUD MESSAGING (FCM) ENDPOINTS
// ============================================================================

// GET /api/notifications/fcm-config - Return public client Firebase config
router.get('/fcm-config', async (_req: Request, res: Response) => {
  try {
    const projectId = (await getAppSetting('FCM_PROJECT_ID', '')).trim();
    const apiKey = (await getAppSetting('FCM_API_KEY', '')).trim();
    const messagingSenderId = (await getAppSetting('FCM_MESSAGING_SENDER_ID', '')).trim();
    const appId = (await getAppSetting('FCM_APP_ID', '')).trim();
    const measurementId = (await getAppSetting('FCM_MEASUREMENT_ID', '')).trim();
    const rawVapidKey = (await getAppSetting('FCM_VAPID_KEY', '')).trim();
    const vapidKey = normalizeVapidPublicKey(rawVapidKey);

    const isConfigured = Boolean(projectId && apiKey);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      configured: isConfigured,
      projectId,
      apiKey,
      messagingSenderId,
      appId,
      measurementId,
      vapidKey,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve FCM configuration' });
  }
});

// GET /api/notifications/fcm-stats - Return device registration metrics & SDK status
router.get('/fcm-stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getFcmStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve FCM stats' });
  }
});

// POST /api/notifications/fcm-token - Register or update a device FCM token
router.post('/fcm-token', async (req: Request, res: Response) => {
  try {
    const identity = resolveRequestIdentity(req);
    const token = String(req.body?.token || req.body?.fcmToken || '').trim();
    const previousToken = String(req.body?.previousToken || '').trim();

    if (!token) {
      return res.status(400).json({ success: false, error: 'FCM device token is required' });
    }

    const tenantId = Number(req.body?.tenantId || identity.tenantId) || 1;
    const userId = Number(req.body?.userId || identity.userId) || 0;
    const rawRole = req.body?.userRole || req.body?.role || identity.role || 'ADMIN';
    const role = String(rawRole).toUpperCase();
    const userAgent = String(req.headers['user-agent'] || req.body?.userAgent || '');
    const deviceName = String(req.body?.deviceName || '');

    const success = await saveFcmToken(
      tenantId,
      userId,
      role,
      token,
      userAgent,
      deviceName,
      previousToken
    );
    res.json({ success, tenantId, role });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to register FCM token' });
  }
});

// POST & DELETE /api/notifications/fcm-token/remove - Unregister a device FCM token
router.all(['/fcm-token/remove', '/fcm-token/delete'], async (req: Request, res: Response) => {
  try {
    const token = req.body?.token || req.query?.token;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }
    const success = await removeFcmToken(String(token));
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to remove FCM token' });
  }
});

// POST /api/notifications/test-fcm and /api/notifications/test-push - Send live FCM test push alert (SuperAdmin only)
router.post(['/test-fcm', '/test-push'], requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customTitle = req.body?.title;
    const customMessage = req.body?.message;
    const eventId = typeof req.body?.eventId === 'string' ? req.body.eventId : undefined;

    const result = await testFcmPush(0, customTitle, customMessage, eventId ? { eventId } : undefined);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to trigger test FCM alert' });
  }
});

function resolvePreferencesTenantId(req: AuthenticatedRequest): number | null {
  const user = req.user;
  if (!user) return null;
  const roleUpper = String(user.role || '').toUpperCase();
  if (isSuperAdminRole(roleUpper)) {
    const requested = Number(req.query.tenantId || req.body?.tenantId || 1);
    return Number.isInteger(requested) && requested > 0 ? requested : 1;
  }
  if (isOwnerRole(roleUpper)) {
    const tid = Number(user.tenantId || 1);
    return Number.isInteger(tid) && tid > 0 ? tid : 1;
  }
  return null;
}

// GET /api/notifications/preferences - Retrieve store notification preferences & delivery status
router.get('/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cleanTenantId = resolvePreferencesTenantId(req);
    if (cleanTenantId === null) {
      return res.status(403).json({
        success: false,
        error: 'Only store owners or administrators can view store notification preferences.',
      });
    }

    const preferences = await getTenantNotificationPreferences(cleanTenantId);
    const deliveryStatus = await getStoreNotificationDeliveryStatus(cleanTenantId, preferences);

    return res.json({
      success: true,
      tenantId: cleanTenantId,
      preferences,
      deliveryStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load notification preferences',
    });
  }
});

// PUT, PATCH, POST /api/notifications/preferences - Save store notification preferences & preset
router.all('/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!['PUT', 'PATCH', 'POST'].includes(req.method.toUpperCase())) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    const cleanTenantId = resolvePreferencesTenantId(req);
    if (cleanTenantId === null) {
      return res.status(403).json({
        success: false,
        error: 'Only store owners or administrators can update notification preferences.',
      });
    }

    const preferences = await saveTenantNotificationPreferences(cleanTenantId, req.body);
    const deliveryStatus = await getStoreNotificationDeliveryStatus(cleanTenantId, preferences);

    return res.json({
      success: true,
      tenantId: cleanTenantId,
      preferences,
      deliveryStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to update notification preferences',
    });
  }
});


// POST /api/notifications/presence/heartbeat - Record authenticated owner/superadmin online presence
router.post('/presence/heartbeat', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const sessionId = extractRequestSessionId(req);
  let recorded = false;
  let online = false;

  if (isSuperAdminRole(user.role)) {
    recorded = recordSuperAdminHeartbeat({
      userId: user.id,
      role: user.role,
      sessionId,
    });
    online = isSuperAdminOnline();
  } else if (isOwnerRole(user.role)) {
    recorded = recordOwnerHeartbeat({
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
      sessionId,
    });
    online = isStoreOwnerOnline(user.tenantId);
  }

  res.json({
    ok: true,
    recorded,
    online,
    role: user.role,
    sessionId,
  });
});

// POST /api/notifications/presence/offline - Mark owner/superadmin session offline (supports navigator.sendBeacon)
router.post('/presence/offline', express.text({ type: 'text/plain' }), (req: Request, res: Response) => {
  let parsedBody: any = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      parsedBody = JSON.parse(req.body);
    } catch {}
  }

  const rawToken =
    extractTokenFromRequest(req) ||
    (typeof req.query.__token === 'string' ? req.query.__token : '') ||
    (typeof parsedBody?.token === 'string' ? parsedBody.token : '');

  if (rawToken) {
    try {
      const decoded = jwt.verify(rawToken, getJwtSecret()) as any;
      const tenantId = Number(decoded?.tenantId || 0);
      const userId = Number(decoded?.id || decoded?.userId || 0);
      const role = String(decoded?.role || '').toUpperCase();
      const rawSession =
        req.headers['x-session-id'] ||
        req.query.sessionId ||
        req.query.__sessionId ||
        parsedBody?.sessionId;
      const sessionId = rawSession ? String(rawSession).trim() : undefined;

      if (userId > 0 && isSuperAdminRole(role)) {
        markSuperAdminSessionOffline({ userId, sessionId });
        disconnectSuperAdminSseClients(userId, sessionId);
      } else if (tenantId > 0 && userId > 0 && isOwnerRole(role)) {
        markOwnerSessionOffline({ tenantId, userId, sessionId });
        disconnectOwnerSseClients(tenantId, userId, sessionId);
      }
    } catch {}
  }

  res.status(200).json({ ok: true });
});

// GET /api/notifications/presence/status - Check current store owner / superadmin online status
router.get('/presence/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (isSuperAdminRole(req.user?.role)) {
    return res.json({
      superAdminOnline: isSuperAdminOnline(),
      hasSse: hasActiveAuthenticatedSuperAdminSse(),
      hasHeartbeat: hasFreshSuperAdminHeartbeat(),
    });
  }
  const tenantId = Number(req.user?.tenantId || 0);
  return res.json({
    ownerOnline: isStoreOwnerOnline(tenantId),
    hasSse: hasActiveAuthenticatedOwnerSse(tenantId),
    hasHeartbeat: hasFreshOwnerHeartbeat(tenantId),
  });
});

// GET /api/notifications/stream - Server-Sent Events (SSE) real-time stream with role isolation
router.get('/stream', (req: Request, res: Response) => {
  const { tenantId, userId, role, authenticated, sessionId } = resolveRequestIdentity(req);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Immediately acknowledge connection with role metadata
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      type: 'CONNECTED',
      tenantId,
      role,
      authenticated,
      sessionId,
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  const unregister = registerSseClient(tenantId, userId, role, res, {
    authenticated,
    sessionId,
  });

  const isAuthenticatedOwnerStream = authenticated && isOwnerRole(role) && userId > 0 && tenantId > 0;
  const isAuthenticatedSuperAdminStream = authenticated && isSuperAdminRole(role) && userId > 0;

  if (isAuthenticatedOwnerStream) {
    recordOwnerHeartbeat({ tenantId, userId, role, sessionId });
  } else if (isAuthenticatedSuperAdminStream) {
    recordSuperAdminHeartbeat({ userId, role, sessionId });
  }

  // Heartbeat to keep connection open across reverse proxies and firewalls
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (isAuthenticatedOwnerStream) {
        recordOwnerHeartbeat({ tenantId, userId, role, sessionId });
      } else if (isAuthenticatedSuperAdminStream) {
        recordSuperAdminHeartbeat({ userId, role, sessionId });
      }
    } catch {
      clearInterval(heartbeatInterval);
      unregister();
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    unregister();
    if (isAuthenticatedOwnerStream) {
      shrinkOwnerSessionGraceWindow({ tenantId, userId, sessionId });
    } else if (isAuthenticatedSuperAdminStream) {
      shrinkSuperAdminSessionGraceWindow({ userId, sessionId });
    }
  });
});

export default router;
