import { pgClient } from '../../db/index.ts';
import { getAppSetting } from './appSettingsService.ts';
import { sendEmail } from '../utils/email.ts';
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

    // Optional SuperAdmin CC
    const notifySuperAdmin = (await getAppSetting('EMAIL_SUPERADMIN_ON_SALES', 'false')).toLowerCase() === 'true';
    if (notifySuperAdmin) {
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
