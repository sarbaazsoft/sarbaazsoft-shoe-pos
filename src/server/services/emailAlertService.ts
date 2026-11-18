import { pgClient } from '../../db/index.ts';
import { getAppSetting } from './appSettingsService.ts';
import { sendEmail, type SendEmailOptions, type SendEmailResult } from '../utils/email.ts';
import { getApplicationBaseUrl } from './welcomeService.ts';
import { isPlatformSuperAdminOnline } from './ownerPresenceService.ts';
import type { PosActionNotification } from '../pushNotificationService.ts';
import {
  buildTransactionReceiptEmailHtml,
  type TransactionCompanySettings,
  type TransactionReceiptItem,
  type TransactionReturnedItem,
  type TransactionSaleRecord,
} from './transactionReceiptTemplate.ts';

export { buildTransactionReceiptEmailHtml };

function parseReturnNumberFromNotes(notes?: string | null): string {
  if (!notes) return '';
  const match = String(notes).match(/Return\s+#?(RET-[A-Z0-9-]+)/i);
  return match ? match[1].trim() : '';
}

async function hydrateTransactionForEmail(
  cleanTenantId: number,
  payload: PosActionNotification
): Promise<TransactionSaleRecord | null> {
  const numericSaleId = Number(payload.saleId || payload.orderId || 0);
  const cleanInvoiceNumber = String(payload.invoiceNumber || '').trim();
  const numericReturnId = Number(payload.returnId || 0);
  const cleanReturnNumber = String(payload.returnNumber || '').trim();

  try {
    if (numericSaleId > 0 || cleanInvoiceNumber) {
      const saleRes =
        numericSaleId > 0
          ? await pgClient.query<any>(
              `SELECT s.*, u.name AS cashier_name,
                      c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
                      c.shop_name AS customer_shop_name, c.market_name AS customer_market_name,
                      c.city AS customer_city, c.customer_type, c.ntn_number AS customer_ntn
               FROM sales s
               LEFT JOIN users u ON s.created_by = u.id
               LEFT JOIN customers c ON s.customer_id = c.id AND COALESCE(c.tenant_id, 1) = $2
               WHERE s.id = $1 AND COALESCE(s.tenant_id, 1) = $2
               LIMIT 1`,
              [numericSaleId, cleanTenantId]
            )
          : await pgClient.query<any>(
              `SELECT s.*, u.name AS cashier_name,
                      c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
                      c.shop_name AS customer_shop_name, c.market_name AS customer_market_name,
                      c.city AS customer_city, c.customer_type, c.ntn_number AS customer_ntn
               FROM sales s
               LEFT JOIN users u ON s.created_by = u.id
               LEFT JOIN customers c ON s.customer_id = c.id AND COALESCE(c.tenant_id, 1) = $2
               WHERE UPPER(s.invoice_number) = UPPER($1) AND COALESCE(s.tenant_id, 1) = $2
               ORDER BY s.id DESC
               LIMIT 1`,
              [cleanInvoiceNumber, cleanTenantId]
            );

      const saleRow = saleRes.rows[0];
      if (!saleRow) {
        return null;
      }

      const resolvedReturnNumber =
        cleanReturnNumber || parseReturnNumberFromNotes(saleRow.notes);

      const [itemsRes, returnsRes] = await Promise.all([
        pgClient.query<TransactionReceiptItem>(
          `SELECT si.*,
                  COALESCE(p.article, si.product_name) AS article,
                  COALESCE(p.article, si.product_name) AS product_name,
                  p.brand AS brand_name,
                  COALESCE(NULLIF(si.pairs_per_carton, 0), p.pairs_per_carton, 12) AS pairs_per_carton
           FROM sale_items si
           LEFT JOIN products p ON si.product_id = p.id
           WHERE si.sale_id = $1
           ORDER BY si.id ASC`,
          [saleRow.id]
        ),
        pgClient
          .query<TransactionReturnedItem & { return_number?: string; reason?: string }>(
            `SELECT ri.quantity, ri.unit_refund_price, ri.subtotal,
                    COALESCE(p.article, si.product_name, 'Returned Footwear') AS product_name,
                    r.return_number, r.reason
             FROM return_items ri
             JOIN returns r ON ri.return_id = r.id
             LEFT JOIN sale_items si ON ri.sale_item_id = si.id
             LEFT JOIN products p ON ri.product_id = p.id
             WHERE COALESCE(r.tenant_id, 1) = $1
               AND (r.original_sale_id = $2 OR ($3 <> '' AND UPPER(r.return_number) = UPPER($3)))
             ORDER BY ri.id ASC`,
            [cleanTenantId, saleRow.id, resolvedReturnNumber]
          )
          .catch(() => ({ rows: [] as Array<TransactionReturnedItem & { return_number?: string; reason?: string }> })),
      ]);

      const returnedItems = returnsRes.rows || [];
      const exchangeCredit = returnedItems.reduce(
        (sum, r) => sum + (Number(r.subtotal) || 0),
        0
      );

      return {
        ...saleRow,
        items: itemsRes.rows || [],
        returned_items: returnedItems,
        exchange_credit: exchangeCredit > 0 ? exchangeCredit : undefined,
        return_number: resolvedReturnNumber || returnedItems[0]?.return_number || undefined,
      };
    }

    if (numericReturnId > 0 || cleanReturnNumber) {
      const retRes =
        numericReturnId > 0
          ? await pgClient.query<any>(
              `SELECT r.*, u.name AS cashier_name,
                      COALESCE(NULLIF(r.customer_name, ''), c.name) AS resolved_customer_name,
                      c.phone AS customer_phone, c.address AS customer_address,
                      c.shop_name AS customer_shop_name, c.market_name AS customer_market_name,
                      c.city AS customer_city, c.customer_type, c.ntn_number AS customer_ntn
               FROM returns r
               LEFT JOIN users u ON r.created_by = u.id
               LEFT JOIN customers c ON r.customer_id = c.id AND COALESCE(c.tenant_id, 1) = $2
               WHERE r.id = $1 AND COALESCE(r.tenant_id, 1) = $2
               LIMIT 1`,
              [numericReturnId, cleanTenantId]
            )
          : await pgClient.query<any>(
              `SELECT r.*, u.name AS cashier_name,
                      COALESCE(NULLIF(r.customer_name, ''), c.name) AS resolved_customer_name,
                      c.phone AS customer_phone, c.address AS customer_address,
                      c.shop_name AS customer_shop_name, c.market_name AS customer_market_name,
                      c.city AS customer_city, c.customer_type, c.ntn_number AS customer_ntn
               FROM returns r
               LEFT JOIN users u ON r.created_by = u.id
               LEFT JOIN customers c ON r.customer_id = c.id AND COALESCE(c.tenant_id, 1) = $2
               WHERE UPPER(r.return_number) = UPPER($1) AND COALESCE(r.tenant_id, 1) = $2
               ORDER BY r.id DESC
               LIMIT 1`,
              [cleanReturnNumber, cleanTenantId]
            );

      const retRow = retRes.rows[0];
      if (!retRow) {
        return null;
      }

      const retItemsRes = await pgClient
        .query<TransactionReturnedItem>(
          `SELECT ri.quantity, ri.unit_refund_price, ri.subtotal,
                  COALESCE(p.article, si.product_name, 'Returned Footwear') AS product_name
           FROM return_items ri
           LEFT JOIN sale_items si ON ri.sale_item_id = si.id
           LEFT JOIN products p ON ri.product_id = p.id
           WHERE ri.return_id = $1
           ORDER BY ri.id ASC`,
          [retRow.id]
        )
        .catch(() => ({ rows: [] as TransactionReturnedItem[] }));

      return {
        id: retRow.id,
        return_number: retRow.return_number,
        sale_date: retRow.return_date,
        total_amount: retRow.total_refund_amount,
        payment_method: retRow.payment_method || 'CASH',
        cashier_name: retRow.cashier_name || payload.cashierName,
        customer_name: retRow.resolved_customer_name || payload.customerName,
        customer_phone: retRow.customer_phone,
        customer_address: retRow.customer_address,
        customer_shop_name: retRow.customer_shop_name,
        customer_market_name: retRow.customer_market_name,
        customer_city: retRow.customer_city,
        customer_type: retRow.customer_type,
        customer_ntn: retRow.customer_ntn,
        reason: retRow.reason,
        returned_items: retItemsRes.rows || [],
      };
    }
  } catch (hydrateErr: any) {
    console.warn('[emailAlertService] Non-blocking invoice hydration notice:', hydrateErr?.message || hydrateErr);
  }

  return null;
}

/**
 * Dispatches an instant transactional email alert to the Store Owner
 * (and optionally SuperAdmin) whenever a cashier processes a sale, return, or exchange.
 */
export async function dispatchPosEmailAlert(
  tenantId: number,
  payload: PosActionNotification
): Promise<boolean> {
  const actionType = String(payload.type || '').toUpperCase();
  if (!['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE'].includes(actionType)) {
    return false;
  }
  const cleanTenantId = Number(tenantId) || 1;

  // 1. Check global master switch
  const masterEnabled = (await getAppSetting('EMAIL_POS_ALERTS_ENABLED', 'true')).toLowerCase() !== 'false';
  if (!masterEnabled) return false;

  try {
    // 2. Fetch store settings and store owner email addresses
    const [csRes, usersRes] = await Promise.all([
      pgClient.query<TransactionCompanySettings>(
        `SELECT t.name AS company_name,
                cs.address, cs.phone, cs.email, cs.strn, cs.tax_id,
                cs.currency_symbol, cs.invoice_footer, cs.business_type,
                cs.show_receipt_logo, cs.receipt_logo, cs.logo
         FROM company_settings cs
         LEFT JOIN tenants t ON t.id = cs.tenant_id
         WHERE COALESCE(cs.tenant_id, 1) = $1 LIMIT 1`,
        [cleanTenantId]
      ),
      pgClient.query<{ email: string }>(
        `SELECT email FROM users
         WHERE tenant_id = $1 AND role = 'ADMIN' AND status = 'APPROVED' AND COALESCE(active, true) = true`,
        [cleanTenantId]
      ),
    ]);

    const cs = csRes.rows[0] || null;
    const recipients = new Set<string>();

    if (cs?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cs.email.trim())) {
      recipients.add(cs.email.trim().toLowerCase());
    }

    for (const u of usersRes.rows) {
      if (u.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email.trim())) {
        recipients.add(u.email.trim().toLowerCase());
      }
    }

    // Optional SuperAdmin audit copy — also skips email when SuperAdmin is currently online
    const notifySuperAdmin = (await getAppSetting('EMAIL_SUPERADMIN_ON_SALES', 'false')).toLowerCase() === 'true';
    if (notifySuperAdmin && !isPlatformSuperAdminOnline()) {
      const superAdminEmail = ((await getAppSetting('GMAIL_USER', '')) || '').trim().toLowerCase();
      if (superAdminEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(superAdminEmail)) {
        recipients.add(superAdminEmail);
      }
    }

    if (recipients.size === 0) {
      return false;
    }

    // 3. Hydrate complete authoritative invoice / return data from PostgreSQL
    const hydratedSale = await hydrateTransactionForEmail(cleanTenantId, payload);

    // 4. Dynamically render responsive receipt email embedding full in-app invoice preview
    const emailRender = buildTransactionReceiptEmailHtml({
      payload,
      sale: hydratedSale,
      companySettings: cs,
      generatedAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    });

    const recipientList = Array.from(recipients);
    const sendRes = await sendEmail({
      to: recipientList,
      subject: emailRender.subject,
      html: emailRender.html,
    });

    if (sendRes.delivered) {
      console.log(`✉️ POS transaction email alert delivered to ${recipientList.join(', ')} via system email provider (${sendRes.provider})`);
      return true;
    } else {
      console.warn(`[emailAlertService] Delivery notice: ${sendRes.error}`);
      return false;
    }
  } catch (err: any) {
    console.warn('[emailAlertService] Exception during POS email dispatch:', err?.message || err);
    return false;
  }
}

export interface SuperAdminEmailAlertPayload {
  id?: number;
  eventId?: string;
  title: string;
  message: string;
  type?: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp?: string;
}

function escapeEmailHtml(value: string): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildSuperAdminAlertEmailHtml(
  payload: SuperAdminEmailAlertPayload,
  consoleHref: string
): { subject: string; html: string; text: string } {
  const title = String(payload.title || 'SuperAdmin Platform Alert').trim();
  const message = String(payload.message || 'A new platform notification requires your attention.').trim();
  const alertType = String(payload.type || 'INFO').trim().toUpperCase();
  const actionLabel = String(payload.actionLabel || 'Open SuperAdmin Console').trim();
  const timestampStr = payload.timestamp
    ? new Date(payload.timestamp).toLocaleString()
    : new Date().toLocaleString();

  const badgeColors =
    alertType === 'URGENT' || alertType === 'SECURITY' || alertType === 'EXPIRED'
      ? { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca', header: '#991b1b' }
      : alertType === 'WARNING' || alertType === 'SYSTEM'
      ? { bg: '#fef3c7', text: '#b45309', border: '#fde68a', header: '#92400e' }
      : { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe', header: '#5b21b6' };

  const subject = `[SuperAdmin Alert] ${title}`;
  const text = `${title}\n\nType: ${alertType}\nTime: ${timestampStr}\n\n${message}\n\nOpen Console: ${consoleHref}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeEmailHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 16px;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(15,23,42,0.06);">
    <tr>
      <td style="background:linear-gradient(135deg,#0f172a 0%,${badgeColors.header} 100%);padding:24px 28px;color:#ffffff;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;opacity:0.85;">SarbaazSoft POS SaaS • Platform C-Panel</div>
        <div style="font-size:20px;font-weight:800;margin-top:6px;">SuperAdmin Alert Notification</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        <div style="margin-bottom:14px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;background-color:${badgeColors.bg};color:${badgeColors.text};border:1px solid ${badgeColors.border};">
            ${escapeEmailHtml(alertType)}
          </span>
          <span style="font-size:12px;color:#64748b;margin-left:10px;">${escapeEmailHtml(timestampStr)}</span>
        </div>
        <h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">${escapeEmailHtml(title)}</h2>
        <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line;">
          ${escapeEmailHtml(message)}
        </div>
        <div style="text-align:center;margin:26px 0 8px;">
          <a href="${escapeEmailHtml(consoleHref)}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 24px;border-radius:10px;">
            ${escapeEmailHtml(actionLabel)}
          </a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5;">
        Sent to your SuperAdmin email because no active SuperAdmin browser/app session is currently online. Sign in to the console to receive real-time in-app &amp; push notifications instead.
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html, text };
}

export interface SuperAdminEmailDeps {
  fetchRecipientEmailsFn?: () => Promise<string[]>;
  sendEmailFn?: (opts: SendEmailOptions) => Promise<SendEmailResult>;
}

/**
 * Dispatches an email alert to SuperAdmin (used when SuperAdmin is offline/logged out).
 */
export async function dispatchSuperAdminEmailAlert(
  payload: SuperAdminEmailAlertPayload,
  deps?: SuperAdminEmailDeps
): Promise<boolean> {
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = new Set<string>();

    if (deps?.fetchRecipientEmailsFn) {
      const provided = await deps.fetchRecipientEmailsFn();
      for (const e of provided) {
        if (e && emailRegex.test(String(e).trim())) {
          recipients.add(String(e).trim().toLowerCase());
        }
      }
    } else {
      const saUsersRes = await pgClient
        .query<{ email: string }>(
          `SELECT email FROM users
           WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN'
             AND status = 'APPROVED'
             AND COALESCE(active, true) = true`
        )
        .catch(() => ({ rows: [] as Array<{ email: string }> }));

      for (const u of saUsersRes.rows) {
        if (u.email && emailRegex.test(u.email.trim())) {
          recipients.add(u.email.trim().toLowerCase());
        }
      }

      if (recipients.size === 0) {
        const gmailFallback = ((await getAppSetting('GMAIL_USER', '')) || '').trim().toLowerCase();
        if (gmailFallback && emailRegex.test(gmailFallback)) {
          recipients.add(gmailFallback);
        }
      }
    }

    if (recipients.size === 0) {
      return false;
    }

    const baseUrl = getApplicationBaseUrl();
    const rawAction = String(payload.actionUrl || '/superadmin').trim() || '/superadmin';
    const consoleHref =
      rawAction.startsWith('http')
        ? rawAction
        : baseUrl
        ? `${baseUrl.replace(/\/+$/, '')}${rawAction.startsWith('/') ? rawAction : `/${rawAction}`}`
        : rawAction;

    const rendered = buildSuperAdminAlertEmailHtml(payload, consoleHref);
    const sendEmailImpl = deps?.sendEmailFn || sendEmail;
    const recipientList = Array.from(recipients);
    const sendRes = await sendEmailImpl({
      to: recipientList,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: 'category', value: 'superadmin_alert' }],
    });

    if (sendRes?.delivered) {
      console.log(`✉️ SuperAdmin email alert delivered to ${recipientList.join(', ')} (${sendRes.provider})`);
      return true;
    }
    if (sendRes?.error) {
      console.warn(`[emailAlertService] SuperAdmin email notice: ${sendRes.error}`);
    }
    return false;
  } catch (err: any) {
    console.warn('[emailAlertService] Exception during SuperAdmin email dispatch:', err?.message || err);
    return false;
  }
}

export interface StoreNoticeEmailAlertPayload {
  id?: number;
  eventId?: string;
  title: string;
  message: string;
  type?: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp?: string;
  fallbackReason?: string | null;
}

export function buildStoreNoticeEmailHtml(
  payload: StoreNoticeEmailAlertPayload,
  storeName: string,
  actionHref: string
): { subject: string; html: string; text: string } {
  const title = String(payload.title || 'Store Notification Alert').trim();
  const message = String(payload.message || 'You have a new store alert.').trim();
  const alertType = String(payload.type || 'INFO').trim().toUpperCase();
  const actionLabel = String(payload.actionLabel || 'Open Store Dashboard').trim();
  const timestampStr = payload.timestamp
    ? new Date(payload.timestamp).toLocaleString()
    : new Date().toLocaleString();

  const subject = `[${storeName}] ${title}`;
  const text = `${storeName}\n${title}\n\nType: ${alertType}\nTime: ${timestampStr}\n\n${message}\n\nOpen Store: ${actionHref}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeEmailHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 16px;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 16px rgba(15,23,42,0.06);">
    <tr>
      <td style="background:linear-gradient(135deg,#4c1d95 0%,#7c3aed 100%);padding:22px 26px;color:#ffffff;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.3px;opacity:0.9;">${escapeEmailHtml(storeName)}</div>
        <div style="font-size:19px;font-weight:800;margin-top:6px;">Store Notification Alert</div>
      </td>
    </tr>
    <tr>
      <td style="padding:26px;">
        <div style="margin-bottom:12px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;background-color:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe;">
            ${escapeEmailHtml(alertType)}
          </span>
          <span style="font-size:12px;color:#64748b;margin-left:10px;">${escapeEmailHtml(timestampStr)}</span>
        </div>
        <h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">${escapeEmailHtml(title)}</h2>
        <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line;">
          ${escapeEmailHtml(message)}
        </div>
        <div style="text-align:center;margin:24px 0 8px;">
          <a href="${escapeEmailHtml(actionHref)}" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 24px;border-radius:10px;">
            ${escapeEmailHtml(actionLabel)}
          </a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 26px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5;">
        Delivered to your registered Store Owner email based on your Store Notification Preferences &amp; Email Fallback configuration.
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html, text };
}

export async function dispatchStoreNoticeEmailAlert(
  tenantId: number,
  payload: StoreNoticeEmailAlertPayload,
  deps?: { sendEmailFn?: (opts: SendEmailOptions) => Promise<SendEmailResult> }
): Promise<boolean> {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return false;

  const masterEnabled = (await getAppSetting('EMAIL_POS_ALERTS_ENABLED', 'true')).toLowerCase() !== 'false';
  if (!masterEnabled) return false;

  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const [csRes, usersRes] = await Promise.all([
      pgClient
        .query<{ company_name: string | null; email: string | null }>(
          `SELECT t.name AS company_name, cs.email
           FROM company_settings cs
           LEFT JOIN tenants t ON t.id = cs.tenant_id
           WHERE COALESCE(cs.tenant_id, 1) = $1 LIMIT 1`,
          [cleanTenantId]
        )
        .catch(() => ({ rows: [] as Array<{ company_name: string | null; email: string | null }> })),
      pgClient
        .query<{ email: string }>(
          `SELECT email FROM users
           WHERE tenant_id = $1
             AND UPPER(COALESCE(role::text, '')) IN ('ADMIN', 'OWNER')
             AND status = 'APPROVED'
             AND COALESCE(active, true) = true`,
          [cleanTenantId]
        )
        .catch(() => ({ rows: [] as Array<{ email: string }> })),
    ]);

    const cs = csRes.rows[0] || null;
    const recipients = new Set<string>();
    if (cs?.email && emailRegex.test(cs.email.trim())) {
      recipients.add(cs.email.trim().toLowerCase());
    }
    for (const u of usersRes.rows) {
      if (u.email && emailRegex.test(u.email.trim())) {
        recipients.add(u.email.trim().toLowerCase());
      }
    }

    if (recipients.size === 0) return false;

    const storeName = String(cs?.company_name || 'SarbaazSoft Shoe Store').trim();
    const baseUrl = getApplicationBaseUrl();
    const rawAction = String(payload.actionUrl || '/').trim() || '/';
    const actionHref = rawAction.startsWith('http')
      ? rawAction
      : baseUrl
      ? `${baseUrl.replace(/\/+$/, '')}${rawAction.startsWith('/') ? rawAction : `/${rawAction}`}`
      : rawAction;

    const rendered = buildStoreNoticeEmailHtml(payload, storeName, actionHref);
    const sendEmailImpl = deps?.sendEmailFn || sendEmail;
    const sendRes = await sendEmailImpl({
      to: Array.from(recipients),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: 'category', value: 'store_notice_alert' }],
    });

    return Boolean(sendRes?.delivered);
  } catch (err: any) {
    console.warn('[emailAlertService] Exception during store notice email dispatch:', err?.message || err);
    return false;
  }
}
