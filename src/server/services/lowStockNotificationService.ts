import { pgClient } from '../../db/index.ts';
import { ensureFcmTokensSchema, ensureNotificationsSchema } from '../../db/schemaInit.ts';
import {
  broadcastSsePosAction,
  DEFAULT_NOTIFICATION_ICON,
  NOTIFICATION_BADGE_ICON,
  sendFcmPushToTokens,
} from '../pushNotificationService.ts';
import { getAppSetting } from './appSettingsService.ts';
import { getTenantNotificationPreferences } from './notificationPreferencesService.ts';
import { getApplicationBaseUrl } from './welcomeService.ts';
import { sendEmail, type SendEmailOptions, type SendEmailResult } from '../utils/email.ts';
import type { StoreNotificationPreferences } from '../../utils/notificationPreferences.ts';

export interface LowStockBatchItem {
  productId: number;
  sku: string;
  article: string;
  name: string;
  barcode?: string;
  remainingStock: number;
  lowStockThreshold: number;
}

export interface LowStockBatchPayload {
  tenantId: number;
  saleId: number;
  invoiceNumber: string;
  storeName?: string;
  cashierName?: string;
  eventId?: string;
  items: LowStockBatchItem[];
}

export interface LowStockDispatchResult {
  triggered: boolean;
  eventId: string;
  itemCount: number;
  notificationId: number | null;
  inAppCreated: boolean;
  emailSent: boolean;
  pushSent: boolean;
  pushSentCount: number;
  errors: string[];
}

export interface LowStockDispatchDeps {
  sendEmailFn?: (opts: SendEmailOptions) => Promise<SendEmailResult>;
  sendFcmPushToTokensFn?: typeof sendFcmPushToTokens;
  broadcastSseFn?: typeof broadcastSsePosAction;
  getPreferencesFn?: (tenantId: number) => Promise<StoreNotificationPreferences>;
}

export function resolveLowStockThreshold(rawThreshold: unknown, fallback: number = 5): number {
  const parsed = Number(rawThreshold);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

export function shouldResetLowStockAlert(
  newStock: number,
  lowStockThreshold: number | null | undefined
): boolean {
  const threshold = resolveLowStockThreshold(lowStockThreshold, 5);
  return Number(newStock) > threshold;
}

export function resolveLowStockActionUrl(): string {
  return '/?tab=inventory&lowStockOnly=true';
}

export interface LowStockEvaluationInput {
  productId: number;
  article?: string | null;
  name?: string | null;
  barcode?: string | null;
  updatedStock: number;
  lowStockThreshold: number | null | undefined;
  isLowStockAlertSent: boolean | null | undefined;
}

export type LowStockEvaluationResult =
  | { shouldAlert: false; reason: 'HEALTHY_STOCK' | 'ALREADY_ALERTED' }
  | { shouldAlert: true; item: LowStockBatchItem };

/**
 * Fast-Fail Guard-Clause Evaluation (strictly in-memory on sold items, zero table scans):
 * - Guard 1 (Healthy Stock): If updatedStock > lowStockThreshold -> immediately skip.
 * - Guard 2 (Already Alerted): If isLowStockAlertSent === true -> immediately skip.
 * - Threshold-Crossing: Only emit when updatedStock <= lowStockThreshold && !isLowStockAlertSent.
 */
export function evaluateLowStockTransition(input: LowStockEvaluationInput): LowStockEvaluationResult {
  const threshold = resolveLowStockThreshold(input.lowStockThreshold, 5);
  const updatedStock = Number(input.updatedStock);

  // Guard 1: Healthy Stock
  if (updatedStock > threshold) {
    return { shouldAlert: false, reason: 'HEALTHY_STOCK' };
  }

  // Guard 2: Already Alerted
  if (input.isLowStockAlertSent === true) {
    return { shouldAlert: false, reason: 'ALREADY_ALERTED' };
  }

  const cleanArticle = String(input.article || '').trim();
  const cleanBarcode = String(input.barcode || '').trim();
  const cleanName = String(input.name || '').trim() || cleanArticle || `Product #${input.productId}`;
  const sku = cleanArticle || cleanBarcode || `PRD-${input.productId}`;

  return {
    shouldAlert: true,
    item: {
      productId: Number(input.productId),
      sku,
      article: cleanArticle,
      name: cleanName,
      barcode: cleanBarcode || undefined,
      remainingStock: updatedStock,
      lowStockThreshold: threshold,
    },
  };
}

function escapeHtml(value: string): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildConsolidatedCopy(
  items: LowStockBatchItem[],
  invoiceNumber: string,
  actionUrl: string
): {
  title: string;
  inAppMessage: string;
  pushBody: string;
} {
  const count = items.length;
  const title =
    count === 1
      ? `Low Stock Alert: ${items[0].name} (${items[0].remainingStock} left)`
      : `Low Stock Alert: ${count} Products Need Restock`;

  const lines = items.map(
    (item) =>
      `• ${item.name} (SKU: ${item.sku}) — Remaining: ${item.remainingStock} / Threshold: ${item.lowStockThreshold}`
  );
  const invoiceLine = invoiceNumber ? `Triggered by Invoice #${invoiceNumber}.` : 'Triggered at POS checkout.';
  const inAppMessage = `${invoiceLine}\n${lines.join('\n')}\nRestock Link: ${actionUrl}`;

  const previewNames = items
    .slice(0, 3)
    .map((item) => `${item.name} (${item.remainingStock} left)`)
    .join(', ');
  const extra = count > 3 ? ` +${count - 3} more` : '';
  const pushBody = `Inv #${invoiceNumber || 'POS'}: ${previewNames}${extra}. Tap to review low-stock inventory.`;

  return { title, inAppMessage, pushBody };
}

function buildLowStockEmailHtml(params: {
  storeName: string;
  invoiceNumber: string;
  cashierName: string;
  items: LowStockBatchItem[];
  restockHref: string;
}): string {
  const { storeName, invoiceNumber, cashierName, items, restockHref } = params;
  const rowsHtml = items
    .map((item) => {
      const isOut = item.remainingStock <= 0;
      const stockColor = isOut ? '#dc2626' : '#d97706';
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #0f172a;">${escapeHtml(item.name)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-family: monospace; color: #475569;">${escapeHtml(item.sku)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 700; color: ${stockColor};">${item.remainingStock}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b;">${item.lowStockThreshold}</td>
        </tr>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Low Stock Inventory Alert</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
    <tr>
      <td style="background: linear-gradient(135deg, #b45309 0%, #d97706 100%); padding: 24px; color: #ffffff;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.9; font-weight: 700;">Inventory Threshold Alert</div>
        <div style="font-size: 20px; font-weight: 800; margin-top: 4px;">${escapeHtml(storeName)}</div>
        <div style="font-size: 13px; color: #fef3c7; margin-top: 4px;">${items.length} product(s) dropped to or below reorder threshold during Invoice #${escapeHtml(invoiceNumber)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px;">
        <p style="margin: 0 0 16px; font-size: 13px; color: #475569;">
          Checkout processed by <strong>${escapeHtml(cashierName)}</strong> on <strong>Invoice #${escapeHtml(invoiceNumber)}</strong>. Please replenish the following stock items:
        </p>

        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f8fafc; color: #475569; text-align: left;">
              <th style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">Product</th>
              <th style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">SKU / Article</th>
              <th style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">Remaining</th>
              <th style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">Threshold</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div style="text-align: center; margin-top: 24px;">
          <a href="${escapeHtml(restockHref)}" style="display: inline-block; background-color: #9333ea; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; padding: 12px 22px; border-radius: 10px;">
            Review &amp; Restock Low-Stock Inventory
          </a>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Post-commit consolidated multi-channel dispatcher with per-channel error isolation.
 * Guarantees failed email/push calls never crash callers or roll back committed invoices.
 */
export async function dispatchBatchedLowStockNotifications(
  payload: LowStockBatchPayload,
  deps?: LowStockDispatchDeps
): Promise<LowStockDispatchResult> {
  const cleanTenantId = Number(payload.tenantId) || 1;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const cleanSaleId = Number(payload.saleId) || 0;
  const cleanInvoice = String(payload.invoiceNumber || '').trim() || String(cleanSaleId);
  const eventId =
    String(payload.eventId || '').trim() ||
    `pos-low-stock-${cleanTenantId}-sale-${cleanSaleId || Date.now()}`;

  if (items.length === 0) {
    return {
      triggered: false,
      eventId,
      itemCount: 0,
      notificationId: null,
      inAppCreated: false,
      emailSent: false,
      pushSent: false,
      pushSentCount: 0,
      errors: [],
    };
  }

  const prefs = deps?.getPreferencesFn
    ? await deps.getPreferencesFn(cleanTenantId)
    : await getTenantNotificationPreferences(cleanTenantId);

  if (!prefs.events.low_stock) {
    return {
      triggered: false,
      eventId,
      itemCount: items.length,
      notificationId: null,
      inAppCreated: false,
      emailSent: false,
      pushSent: false,
      pushSentCount: 0,
      errors: [],
    };
  }

  const actionUrl = resolveLowStockActionUrl();
  const baseUrl = getApplicationBaseUrl();
  const restockHref = baseUrl ? `${baseUrl.replace(/\/+$/, '')}${actionUrl}` : actionUrl;
  const { title, inAppMessage, pushBody } = buildConsolidatedCopy(items, cleanInvoice, actionUrl);
  const errors: string[] = [];

  let notificationId: number | null = null;
  let inAppCreated = false;
  let emailSent = false;
  let pushSent = false;
  let pushSentCount = 0;

  // Channel 1: In-App Notification Record (tenant-scoped for store admins/owners)
  try {
    await ensureNotificationsSchema();
    const insertRes = await pgClient.query<{ id: number }>(
      `INSERT INTO public.notifications (
        tenant_id, target_role, type, title, message, sale_id, invoice_number, action_url, items_json, event_id, is_read
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, false)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id`,
      [
        cleanTenantId,
        'ADMIN',
        'LOW_STOCK',
        title,
        inAppMessage,
        cleanSaleId || null,
        cleanInvoice,
        actionUrl,
        JSON.stringify(items),
        eventId,
      ]
    );
    if (insertRes.rows.length > 0) {
      notificationId = Number(insertRes.rows[0].id) || null;
      inAppCreated = true;
    }
  } catch (err: any) {
    const msg = `In-app insert failed: ${err?.message || err}`;
    errors.push(msg);
    console.warn('[lowStockNotificationService]', msg);
  }

  // Channel 2: Consolidated Email Alert (Configurable via app_settings + Store Preferences, acts as Email Fallback when push is inactive/unavailable)
  try {
    const emailEnabled =
      Boolean(prefs.channels.emailAlerts) &&
      (await getAppSetting('LOW_STOCK_EMAIL_ALERTS_ENABLED', 'true')).toLowerCase() !== 'false';
    if (emailEnabled) {
      const [csRes, usersRes] = await Promise.all([
        pgClient.query<{ company_name: string | null; email: string | null }>(
          `SELECT t.name AS company_name, cs.email
           FROM company_settings cs
           LEFT JOIN tenants t ON t.id = cs.tenant_id
           WHERE cs.tenant_id = $1 LIMIT 1`,
          [cleanTenantId]
        ),
        pgClient.query<{ email: string }>(
          `SELECT email FROM users
           WHERE tenant_id = $1
             AND UPPER(COALESCE(role::text, '')) IN ('ADMIN', 'OWNER')
             AND status = 'APPROVED'
             AND COALESCE(active, true) = true`,
          [cleanTenantId]
        ),
      ]);

      const cs = csRes.rows[0];
      const recipients = new Set<string>();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (cs?.email && emailRegex.test(cs.email.trim())) {
        recipients.add(cs.email.trim().toLowerCase());
      }
      for (const u of usersRes.rows) {
        if (u.email && emailRegex.test(u.email.trim())) {
          recipients.add(u.email.trim().toLowerCase());
        }
      }

      if (recipients.size > 0) {
        const resolvedStoreName = payload.storeName || cs?.company_name || 'SarbaazSoft Shoe Store';
        const html = buildLowStockEmailHtml({
          storeName: resolvedStoreName,
          invoiceNumber: cleanInvoice,
          cashierName: payload.cashierName || 'Counter Staff',
          items,
          restockHref,
        });

        const sendEmailImpl = deps?.sendEmailFn || sendEmail;
        const sendResult = await sendEmailImpl({
          to: Array.from(recipients),
          subject: `[${resolvedStoreName}] ${title}`,
          html,
          text: inAppMessage,
        });
        emailSent = Boolean(sendResult?.delivered);
        if (!sendResult?.delivered && sendResult?.error) {
          errors.push(`Email delivery notice: ${sendResult.error}`);
        }
      }
    }
  } catch (err: any) {
    const msg = `Email dispatch failed: ${err?.message || err}`;
    errors.push(msg);
    console.warn('[lowStockNotificationService]', msg);
  }

  // Channel 3: Consolidated SSE + Push Notification (Configurable via app_settings + Store Preferences, ADMIN/OWNER only)
  try {
    const pushEnabled =
      Boolean(prefs.channels.webPush) &&
      (await getAppSetting('LOW_STOCK_PUSH_ALERTS_ENABLED', 'true')).toLowerCase() !== 'false';
    if (pushEnabled) {
      const nowIso = new Date().toISOString();
      const broadcastSseImpl = deps?.broadcastSseFn || broadcastSsePosAction;
      broadcastSseImpl(cleanTenantId, {
        eventId,
        tag: eventId,
        type: 'STOCK',
        title,
        message: pushBody,
        invoiceNumber: cleanInvoice,
        saleId: cleanSaleId || undefined,
        orderId: cleanSaleId || undefined,
        itemsSummary: items.map((i) => `${i.name} (${i.remainingStock})`).join(', '),
        deepLinkUrl: actionUrl,
        actionTab: 'inventory',
        actionUrl,
        actionLabel: 'Restock Inventory',
        timestamp: nowIso,
        triggeredBy: payload.cashierName || 'POS Checkout',
        targetRole: 'ADMIN',
        targetRoles: ['ADMIN'],
      });

      await ensureFcmTokensSchema();
      const tokensRes = await pgClient.query<{ token: string }>(
        `SELECT token
         FROM public.fcm_tokens
         WHERE tenant_id = $1
           AND UPPER(user_role) IN ('ADMIN', 'OWNER')
           AND tenant_id != 0`,
        [cleanTenantId]
      );
      const tokens = Array.from(
        new Set(tokensRes.rows.map((r) => String(r.token || '').trim()).filter(Boolean))
      );

      if (tokens.length > 0) {
        const sendPushImpl = deps?.sendFcmPushToTokensFn || sendFcmPushToTokens;
        const pushRes = await sendPushImpl(tokens, {
          title,
          body: pushBody,
          deepLinkUrl: actionUrl,
          icon: DEFAULT_NOTIFICATION_ICON,
          badge: NOTIFICATION_BADGE_ICON,
          tag: eventId,
          data: {
            type: 'STOCK',
            itemType: 'LOW_STOCK',
            eventId,
            tag: eventId,
            saleId: String(cleanSaleId || ''),
            invoiceNumber: cleanInvoice,
            actionTab: 'inventory',
            lowStockOnly: 'true',
            itemCount: String(items.length),
            timestamp: nowIso,
          },
        });
        pushSentCount = pushRes.sentCount || 0;
        pushSent = Boolean(pushRes.success && pushSentCount > 0);
        if (!pushRes.success && pushRes.error) {
          errors.push(`Push delivery notice: ${pushRes.error}`);
        }
      }
    }
  } catch (err: any) {
    const msg = `Push dispatch failed: ${err?.message || err}`;
    errors.push(msg);
    console.warn('[lowStockNotificationService]', msg);
  }

  return {
    triggered: true,
    eventId,
    itemCount: items.length,
    notificationId,
    inAppCreated,
    emailSent,
    pushSent,
    pushSentCount,
    errors,
  };
}

/**
 * Schedules batched low-stock delivery asynchronously AFTER the invoice transaction commits.
 * Checkout response never waits on notification I/O.
 */
export function scheduleLowStockBatchDispatch(
  payload: LowStockBatchPayload,
  deps?: LowStockDispatchDeps
): void {
  if (!payload?.items || payload.items.length === 0) {
    return;
  }

  setImmediate(() => {
    void dispatchBatchedLowStockNotifications(payload, deps).catch((err) => {
      console.warn('[lowStockNotificationService] Async post-commit dispatch error:', err?.message || err);
    });
  });
}
