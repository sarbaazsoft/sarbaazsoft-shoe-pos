import { Router } from 'express';
import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import { pgClient } from '../../db/index.ts';
import { requireAuth } from '../auth.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { extractStrictTenantId } from '../../db/tenantDb.ts';
import { ensureCustomerLedgerSchema, ensureDatabaseSchema } from '../../db/schemaInit.ts';
import { notifyPosAction } from '../pushNotificationService.ts';
import { getAppSetting } from '../services/appSettingsService.ts';
import { reconcileInvoiceBalance } from '../../utils/posCalculations.ts';
import { fetchLockedCustomerPreviousBalance, recordCustomerSaleKhataEntry } from '../services/ledgerService.ts';
import {
  evaluateLowStockTransition,
  scheduleLowStockBatchDispatch,
  shouldResetLowStockAlert,
  type LowStockBatchItem,
} from '../services/lowStockNotificationService.ts';
import {
  cleanOptionalText,
  formatExchangeNotification,
  formatReturnReferenceToExchange,
  formatSaleExchangeNotification,
  formatSaleNotification,
  formatSaleReturnNotification,
} from '../../utils/notificationFormatters.ts';

const router = Router();

// Helper to generate next unique invoice number scoped to tenant
async function generateInvoiceNumber(tenantId: number): Promise<string> {
  const prefix = (await getAppSetting('INVOICE_PREFIX', 'INV-')).trim() || 'INV-';

  const lastSale = await pgClient.query<{ invoice_number: string }>(
    `SELECT invoice_number FROM sales WHERE COALESCE(tenant_id, 1) = $1 AND invoice_number LIKE $2 ORDER BY id DESC LIMIT 1`,
    [tenantId, `${prefix}%`]
  );

  let nextNum = 1;
  if (lastSale.rows.length > 0) {
    const rawNum = lastSale.rows[0].invoice_number.slice(prefix.length);
    const parsed = parseInt(rawNum, 10);
    if (!isNaN(parsed)) {
      nextNum = parsed + 1;
    }
  }

  const padded = String(nextNum).padStart(6, '0');
  return `${prefix}${padded}`;
}

// Helper to generate next unique return number scoped to tenant
async function generateReturnNumber(tenantId: number): Promise<string> {
  const lastRet = await pgClient.query<{ return_number: string }>(
    "SELECT return_number FROM returns WHERE COALESCE(tenant_id, 1) = $1 AND return_number LIKE 'RET-%' ORDER BY id DESC LIMIT 1",
    [tenantId]
  );
  let nextNum = 1;
  if (lastRet.rows.length > 0) {
    const rawNum = lastRet.rows[0].return_number.slice(4);
    const parsed = parseInt(rawNum, 10);
    if (!isNaN(parsed)) {
      nextNum = parsed + 1;
    }
  }
  const padded = String(nextNum).padStart(6, '0');
  return `RET-${padded}`;
}

const inFlightClientTxCheckouts = new Map<string, Promise<any>>();

function createCheckoutDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// POST /api/pos/checkout - Atomic Sale & Direct Shoe Exchange Processing (Strictly Scoped to req.user.tenantId)
router.post('/checkout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = extractStrictTenantId(req);
  const {
    items = [],
    customerId = null,
    paymentMethod = 'CASH',
    notes = '',
    isMinPriceOverridden = false,
    adminOverrideEmail = null,
    adminOverridePassword = null,
    exchange = null,
    clientTxId = null,
    saleDate = null,
  } = req.body;

  const cleanClientTxId = typeof clientTxId === 'string' && clientTxId.trim() ? clientTxId.trim() : null;
  const txLockKey = cleanClientTxId ? `${tenantId}:${cleanClientTxId}` : null;

  if (txLockKey && inFlightClientTxCheckouts.has(txLockKey)) {
    try {
      const existingResult = await inFlightClientTxCheckouts.get(txLockKey);
      if (existingResult) {
        return res.status(200).json({
          message: 'Sale previously synchronized.',
          invoiceNumber: existingResult.invoiceNumber,
          alreadySynced: true,
          sale: existingResult.sale,
        });
      }
    } catch {
      // Fall through to DB check or fresh execution if prior attempt rolled back
    }
  }

  if (cleanClientTxId) {
    const existingSync = await pgClient.query<any>(
      "SELECT id, invoice_number, total_amount FROM sales WHERE COALESCE(tenant_id, 1) = $1 AND (client_tx_id = $2 OR notes LIKE $3) LIMIT 1",
      [tenantId, cleanClientTxId, `%[Offline Tx: ${cleanClientTxId}]%`]
    );
    if (existingSync.rows.length > 0) {
      const saleRow = existingSync.rows[0];
      return res.status(200).json({
        message: 'Sale previously synchronized.',
        invoiceNumber: saleRow.invoice_number,
        alreadySynced: true,
        sale: saleRow,
      });
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty. Please add replacement shoes to checkout.' });
  }

  const user = req.user!;
  let verifiedOverrideAdminId: number | null = null;

  const settingsRes = await pgClient.query<{ pricing_mode: string; business_type: string }>(
    'SELECT pricing_mode, business_type FROM company_settings WHERE COALESCE(tenant_id, 1) = $1 LIMIT 1',
    [tenantId]
  );
  const isFixedMode = String(settingsRes.rows[0]?.pricing_mode || 'FIXED').toUpperCase() === 'FIXED';
  const isWholesaleStore = String(settingsRes.rows[0]?.business_type || 'RETAIL').toUpperCase() === 'WHOLESALE';
  const normalizedPaymentMethod = String(paymentMethod).toUpperCase();
  const transactionId = String(req.body.transactionId ?? req.body.transaction_id ?? '').trim();
  if (normalizedPaymentMethod === 'CARD') {
    return res.status(400).json({ error: 'Card payments are currently unavailable.' });
  }
  if ((normalizedPaymentMethod === 'ONLINE' || normalizedPaymentMethod === 'BANK_TRANSFER') && !transactionId) {
    return res.status(400).json({ error: 'A transaction ID is required for online and bank transfer payments.' });
  }
  if (normalizedPaymentMethod === 'SPLIT') {
    const splitOnlineAmount = Math.max(0, parseFloat(String(req.body.splitOnlineAmount ?? req.body.split_online_amount ?? 0)) || 0);
    if (splitOnlineAmount > 0 && !transactionId) {
      return res.status(400).json({ error: 'A transaction or reference ID is required for the digital/card portion of split payment.' });
    }
  }
  if (!isWholesaleStore && normalizedPaymentMethod === 'KHATA') {
    return res.status(400).json({ error: 'Khata credit is available only for wholesale stores.' });
  }

  for (const item of items) {
    const prodRes = await pgClient.query<{
      cost_price: string;
      name: string;
      article: string;
      min_price: number | null;
      max_price: number | null;
    }>(
      'SELECT COALESCE(cost_price, 0) as cost_price, name, article, COALESCE(min_price, 0) as min_price, COALESCE(max_price, 0) as max_price FROM products WHERE id = $1 AND COALESCE(tenant_id, 1) = $2',
      [item.productId, tenantId]
    );

    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: `Product ID ${item.productId} not found in your store.` });
    }

    const prod = prodRes.rows[0];
    const costPrice = Math.round(parseFloat(prod.cost_price || '0'));
    const prodIdentifier = prod.article || prod.name;
    const itemQty = parseInt(item.quantity, 10);
    const parsedUnitPrice = parseFloat(item.unitPrice);
    const parsedDiscount = item.discount !== undefined && item.discount !== null ? parseFloat(item.discount) : 0;

    if (!Number.isFinite(itemQty) || itemQty <= 0) {
      return res.status(400).json({ error: `Invalid quantity for "${prodIdentifier}".` });
    }
    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) {
      return res.status(400).json({ error: `Invalid unit price for "${prodIdentifier}".` });
    }
    if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > parsedUnitPrice * itemQty) {
      return res.status(400).json({ error: `Invalid discount for "${prodIdentifier}".` });
    }

    const effectiveUnitPrice = Math.round((parsedUnitPrice * itemQty - parsedDiscount) / itemQty);

    let minAllowedPrice = 0;
    if (isFixedMode) {
      minAllowedPrice = prod.max_price && prod.max_price > 0
        ? Math.round(Number(prod.max_price))
        : costPrice;
    } else {
      minAllowedPrice = prod.min_price && prod.min_price > 0
        ? Math.round(Number(prod.min_price))
        : costPrice;
    }

    if (effectiveUnitPrice < minAllowedPrice) {
      if (user.role === 'ADMIN' || user.role === 'SUPERADMIN') {
        verifiedOverrideAdminId = user.id;
      } else if (isMinPriceOverridden && adminOverrideEmail && adminOverridePassword) {
        const adminCheck = await pgClient.query<any>(
          'SELECT id, password_hash, role, status FROM users WHERE LOWER(email) = LOWER($1) AND COALESCE(tenant_id, 1) = $2',
          [adminOverrideEmail.trim(), tenantId]
        );
        if (
          adminCheck.rows.length === 0 ||
          adminCheck.rows[0].role !== 'ADMIN' ||
          adminCheck.rows[0].status !== 'APPROVED'
        ) {
          return res.status(403).json({
            error: `Selling "${prodIdentifier}" below minimum price (Rs. ${minAllowedPrice}) is rejected. Invalid Admin credentials.`,
          });
        }
        const isPassValid = await bcrypt.compare(adminOverridePassword, adminCheck.rows[0].password_hash);
        if (!isPassValid) {
          return res.status(403).json({
            error: `Selling "${prodIdentifier}" below minimum price (Rs. ${minAllowedPrice}) is rejected. Incorrect Admin password.`,
          });
        }
        verifiedOverrideAdminId = adminCheck.rows[0].id;
      } else {
        return res.status(400).json({
          error: `Minimum Price Violation: "${prodIdentifier}" cannot be sold below saved minimum price of Rs. ${minAllowedPrice} without Admin authorization.`,
          requiresAdminOverride: true,
          productId: item.productId,
          productName: prodIdentifier,
          minSalePrice: minAllowedPrice,
          attemptedPrice: effectiveUnitPrice,
        });
      }
    }
  }

  try {
    await ensureDatabaseSchema();
    await ensureCustomerLedgerSchema();
  } catch (err: any) {
    return res.status(500).json({ error: 'Could not prepare the database for checkout: ' + err.message });
  }

  let txLockDeferred: ReturnType<typeof createCheckoutDeferred<any>> | null = null;

  await pgClient.query('BEGIN');

  try {
    const invoiceNumber = await generateInvoiceNumber(tenantId);
    let calculatedSubtotal = 0;
    let calculatedTotalDiscount = 0;

    let totalExchangeCredit = 0;
    let generatedReturnNumber: string | null = null;
    const validatedReturnItems: Array<{
      saleItemId: number;
      productId: number;
      productName: string;
      quantity: number;
      unitRefundPrice: number;
      subtotal: number;
      prevStock: number;
      newStock: number;
    }> = [];

    const rawExchangeMode = String(exchange?.mode || exchange?.type || exchange?.transactionType || '').trim().toUpperCase();
    const exchangeReasonLower = String(exchange?.reason || '').trim().toLowerCase();
    const isStandaloneExchangeMode =
      rawExchangeMode === 'EXCHANGE_ONLY' || Boolean(exchange?.isStandaloneExchange);

    let origSale: any = null;
    if (isWholesaleStore && exchange && Array.isArray(exchange.items) && exchange.items.length > 0) {
      // -----------------------------------------------------------------------
      // Wholesale Direct Return / Combined Exchange Flow
      // Returned pairs directly restocked into inventory and credited to current invoice
      // -----------------------------------------------------------------------
      if (exchange.originalSaleId && Number(exchange.originalSaleId) > 0) {
        try {
          const origSaleRes = await pgClient.query('SELECT * FROM sales WHERE id = $1 AND COALESCE(tenant_id, 1) = $2', [exchange.originalSaleId, tenantId]);
          if (origSaleRes.rows.length > 0) {
            origSale = origSaleRes.rows[0];
          }
        } catch {}
      }

      for (const rItem of exchange.items) {
        const retQty = parseInt(rItem.quantity, 10);
        const refundPrice = parseFloat(rItem.unitRefundPrice);
        const prodId = parseInt(rItem.productId, 10);
        if (isNaN(retQty) || retQty <= 0 || !prodId) continue;
        if (!Number.isFinite(refundPrice) || refundPrice < 0) {
          throw new Error(`Invalid refund price for returned product #${prodId}.`);
        }

        const prodRes = await pgClient.query<{
          id: number;
          total_stock: number;
          article: string;
          low_stock_threshold: number;
          is_low_stock_alert_sent: boolean;
        }>(
          'SELECT id, total_stock, COALESCE(article, id::text) as article, COALESCE(low_stock_threshold, 5) AS low_stock_threshold, COALESCE(is_low_stock_alert_sent, false) AS is_low_stock_alert_sent FROM products WHERE id = $1 AND COALESCE(tenant_id, 1) = $2 FOR UPDATE',
          [prodId, tenantId]
        );
        if (prodRes.rows.length === 0) {
          throw new Error(`Product #${prodId} not found in inventory.`);
        }
        const prevStock = prodRes.rows[0].total_stock;
        const newStock = prevStock + retQty;
        const nextAlertSent = shouldResetLowStockAlert(newStock, prodRes.rows[0].low_stock_threshold)
          ? false
          : Boolean(prodRes.rows[0].is_low_stock_alert_sent);
        const itemCredit = Math.round(retQty * refundPrice * 100) / 100;
        totalExchangeCredit += itemCredit;

        await pgClient.query(
          'UPDATE products SET total_stock = $1, is_low_stock_alert_sent = $2, updated_at = NOW() WHERE id = $3 AND COALESCE(tenant_id, 1) = $4',
          [newStock, nextAlertSent, prodId, tenantId]
        );

        validatedReturnItems.push({
          saleItemId: 0,
          productId: prodId,
          productName: rItem.productName || prodRes.rows[0].article || `Product #${prodId}`,
          quantity: retQty,
          unitRefundPrice: refundPrice,
          subtotal: itemCredit,
          prevStock,
          newStock,
        });
      }

      if (validatedReturnItems.length > 0) {
        generatedReturnNumber = await generateReturnNumber(tenantId);
        const returnRes = await pgClient.query<{ id: number }>(
          `INSERT INTO returns (
            tenant_id, return_number, original_sale_id, customer_id, return_date, 
            total_refund_amount, reason, created_by
          ) VALUES ($1, $2, $3, $4, NOW()::date::text, $5, $6, $7)
          RETURNING id`,
          [
            tenantId,
            generatedReturnNumber,
            origSale ? origSale.id : null,
            customerId ? parseInt(customerId, 10) : (origSale ? origSale.customer_id : null),
            totalExchangeCredit,
            (exchange.reason || 'Direct Shoe Return').trim(),
            user.id,
          ]
        );
        const returnId = returnRes.rows[0].id;

        for (const v of validatedReturnItems) {
          await pgClient.query(
            `INSERT INTO return_items (tenant_id, return_id, sale_item_id, product_id, quantity, unit_refund_price, subtotal)
             VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
            [tenantId, returnId, v.productId, v.quantity, v.unitRefundPrice, v.subtotal]
          );

          await pgClient.query(
            `INSERT INTO stock_movements (
              tenant_id, product_id, qty_change, prev_stock, new_stock, movement_type, reference_id, user_id, notes
            ) VALUES ($1, $2, $3, $4, $5, 'SALE_RETURN', $6, $7, $8)`,
            [
              tenantId,
              v.productId,
              v.quantity,
              v.prevStock,
              v.newStock,
              generatedReturnNumber,
              user.id,
              `Shoe Return (${generatedReturnNumber}): ${v.quantity} pairs returned at Rs. ${v.unitRefundPrice}/pair (${exchange.reason || 'Restocked into inventory'})`,
            ]
          );
        }
      }
    } else if (exchange && exchange.originalSaleId && Array.isArray(exchange.items) && exchange.items.length > 0) {
      // -----------------------------------------------------------------------
      // Retail Direct Shoe Exchange Flow (Original retail logic preserved untouched)
      // -----------------------------------------------------------------------
      const origSaleRes = await pgClient.query('SELECT * FROM sales WHERE id = $1 AND COALESCE(tenant_id, 1) = $2', [exchange.originalSaleId, tenantId]);
      if (origSaleRes.rows.length === 0) {
        throw new Error('Original sale record for exchange not found in this store.');
      }
      origSale = origSaleRes.rows[0];

      for (const rItem of exchange.items) {
        const retQty = parseInt(rItem.quantity, 10);
        const refundPrice = parseFloat(rItem.unitRefundPrice);
        if (isNaN(retQty) || retQty <= 0) continue;
        if (!Number.isFinite(refundPrice) || refundPrice < 0) {
          throw new Error('Invalid refund price for exchange item.');
        }

        const siRes = await pgClient.query<{ id: number; product_id: number; product_name: string; quantity: number }>(
          'SELECT id, product_id, product_name, quantity FROM sale_items WHERE id = $1 AND sale_id = $2',
          [rItem.saleItemId, exchange.originalSaleId]
        );
        if (siRes.rows.length === 0) {
          throw new Error(`Sale item ${rItem.saleItemId} does not match original invoice.`);
        }
        const saleItem = siRes.rows[0];

        const prevReturnsRes = await pgClient.query<{ total_returned: string }>(
          'SELECT COALESCE(SUM(quantity), 0) as total_returned FROM return_items WHERE sale_item_id = $1',
          [saleItem.id]
        );
        const alreadyReturned = parseInt(prevReturnsRes.rows[0].total_returned, 10);
        const maxReturnable = saleItem.quantity - alreadyReturned;

        if (retQty > maxReturnable) {
          throw new Error(
            `Cannot exchange ${retQty} of "${saleItem.product_name}". Maximum returnable is ${maxReturnable}.`
          );
        }

        const prodRes = await pgClient.query<{
          id: number;
          total_stock: number;
          low_stock_threshold: number;
          is_low_stock_alert_sent: boolean;
        }>(
          'SELECT id, total_stock, COALESCE(low_stock_threshold, 5) AS low_stock_threshold, COALESCE(is_low_stock_alert_sent, false) AS is_low_stock_alert_sent FROM products WHERE id = $1 AND COALESCE(tenant_id, 1) = $2 FOR UPDATE',
          [saleItem.product_id, tenantId]
        );
        if (prodRes.rows.length === 0) {
          throw new Error(`Product ${saleItem.product_id} not found.`);
        }
        const prevStock = prodRes.rows[0].total_stock;
        const newStock = prevStock + retQty;
        const nextAlertSent = shouldResetLowStockAlert(newStock, prodRes.rows[0].low_stock_threshold)
          ? false
          : Boolean(prodRes.rows[0].is_low_stock_alert_sent);
        const itemCredit = Math.round(retQty * refundPrice * 100) / 100;
        totalExchangeCredit += itemCredit;

        await pgClient.query(
          'UPDATE products SET total_stock = $1, is_low_stock_alert_sent = $2, updated_at = NOW() WHERE id = $3 AND COALESCE(tenant_id, 1) = $4',
          [newStock, nextAlertSent, saleItem.product_id, tenantId]
        );

        validatedReturnItems.push({
          saleItemId: saleItem.id,
          productId: saleItem.product_id,
          productName: saleItem.product_name,
          quantity: retQty,
          unitRefundPrice: refundPrice,
          subtotal: itemCredit,
          prevStock,
          newStock,
        });
      }

      if (validatedReturnItems.length > 0) {
        generatedReturnNumber = await generateReturnNumber(tenantId);
        const returnRes = await pgClient.query<{ id: number }>(
          `INSERT INTO returns (
            tenant_id, return_number, original_sale_id, customer_id, return_date, 
            total_refund_amount, reason, created_by
          ) VALUES ($1, $2, $3, $4, NOW()::date::text, $5, $6, $7)
          RETURNING id`,
          [
            tenantId,
            generatedReturnNumber,
            origSale.id,
            customerId ? parseInt(customerId, 10) : origSale.customer_id,
            totalExchangeCredit,
            (exchange.reason || 'Direct Shoe Exchange at POS').trim(),
            user.id,
          ]
        );
        const returnId = returnRes.rows[0].id;

        for (const v of validatedReturnItems) {
          await pgClient.query(
            `INSERT INTO return_items (tenant_id, return_id, sale_item_id, product_id, quantity, unit_refund_price, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [tenantId, returnId, v.saleItemId, v.productId, v.quantity, v.unitRefundPrice, v.subtotal]
          );

          await pgClient.query(
            `INSERT INTO stock_movements (
              tenant_id, product_id, qty_change, prev_stock, new_stock, movement_type, reference_id, user_id, notes
            ) VALUES ($1, $2, $3, $4, $5, 'SALE_RETURN', $6, $7, $8)`,
            [
              tenantId,
              v.productId,
              v.quantity,
              v.prevStock,
              v.newStock,
              generatedReturnNumber,
              user.id,
              `Direct Shoe Exchange for Invoice ${origSale.invoice_number}: ${exchange.reason || 'Size/style exchange'}`,
            ]
          );
        }
      }
    }

    const validatedItems: Array<{
      productId: number;
      productName: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      subtotal: number;
      purchasePrice: number;
      prevStock: number;
      newStock: number;
    }> = [];

    const lowStockBatchMap = new Map<number, LowStockBatchItem>();

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const unitPrice = parseFloat(item.unitPrice);
      const discount = parseFloat(item.discount || 0);

      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Invalid quantity (${qty}) for item.`);
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error(`Invalid unit price for product #${item.productId}.`);
      }
      if (!Number.isFinite(discount) || discount < 0 || discount > unitPrice * qty) {
        throw new Error(`Invalid discount for product #${item.productId}.`);
      }

      const pRes = await pgClient.query<{
        id: number;
        name: string;
        article: string;
        barcode: string;
        total_stock: number;
        cost_price: string;
        low_stock_threshold: number;
        is_low_stock_alert_sent: boolean;
      }>(
        `SELECT id, name, article, barcode, total_stock, COALESCE(cost_price, 0) as cost_price,
                COALESCE(low_stock_threshold, 5) AS low_stock_threshold,
                COALESCE(is_low_stock_alert_sent, false) AS is_low_stock_alert_sent
         FROM products WHERE id = $1 AND COALESCE(tenant_id, 1) = $2 FOR UPDATE`,
        [item.productId, tenantId]
      );

      if (pRes.rows.length === 0) {
        throw new Error(`Product ID ${item.productId} does not exist in your store.`);
      }

      const product = pRes.rows[0];
      const prodIdentifier = product.article || product.name;
      const prevStock = product.total_stock;

      if (prevStock < qty) {
        throw new Error(
          `Insufficient stock for "${prodIdentifier}". Available: ${prevStock}, Requested: ${qty}.`
        );
      }

      const newStock = prevStock - qty;
      const subtotal = unitPrice * qty - discount;
      calculatedSubtotal += unitPrice * qty;
      calculatedTotalDiscount += discount;

      // Fast-fail in-memory guard-clause evaluation on sold item only (zero table scans)
      const lowStockEval = evaluateLowStockTransition({
        productId: product.id,
        article: product.article,
        name: product.name,
        barcode: product.barcode,
        updatedStock: newStock,
        lowStockThreshold: product.low_stock_threshold,
        isLowStockAlertSent: product.is_low_stock_alert_sent,
      });

      if (lowStockEval.shouldAlert) {
        await pgClient.query(
          'UPDATE products SET total_stock = $1, is_low_stock_alert_sent = $2, updated_at = NOW() WHERE id = $3 AND COALESCE(tenant_id, 1) = $4',
          [newStock, true, product.id, tenantId]
        );
        lowStockBatchMap.set(product.id, lowStockEval.item);
      } else {
        await pgClient.query(
          'UPDATE products SET total_stock = $1, updated_at = NOW() WHERE id = $2 AND COALESCE(tenant_id, 1) = $3',
          [newStock, product.id, tenantId]
        );
        const existingInBatch = lowStockBatchMap.get(product.id);
        if (existingInBatch) {
          existingInBatch.remainingStock = newStock;
        }
      }

      validatedItems.push({
        productId: product.id,
        productName: prodIdentifier,
        quantity: qty,
        unitPrice,
        discount,
        subtotal,
        purchasePrice: parseFloat(product.cost_price || '0'),
        prevStock,
        newStock,
      });
    }

    const netDifference = Math.round((calculatedSubtotal - calculatedTotalDiscount - totalExchangeCredit) * 100) / 100;
    const isExplicitWholesaleExchange =
      isWholesaleStore &&
      (isStandaloneExchangeMode ||
        rawExchangeMode === 'EXCHANGE' ||
        rawExchangeMode === 'SALE_EXCHANGE' ||
        Boolean(exchange?.isExchange) ||
        (Boolean(origSale) && !exchangeReasonLower.includes('return')) ||
        (!rawExchangeMode &&
          (exchangeReasonLower.includes('exchange') ||
            exchangeReasonLower.includes('size replacement') ||
            exchangeReasonLower.includes('swap'))));

    let exchangeNote: string | null = null;
    if (validatedReturnItems.length > 0) {
      if (isWholesaleStore) {
        const totalReturnedPairs = validatedReturnItems.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
        if (isStandaloneExchangeMode) {
          exchangeNote = `[Standalone: EXCHANGE] Shoe Exchange (Return #${generatedReturnNumber}, RetPairs: ${totalReturnedPairs}). Returned Credit: Rs. ${Math.round(totalExchangeCredit)}. Net Difference: Rs. ${Math.round(netDifference)}`;
        } else if (isExplicitWholesaleExchange) {
          exchangeNote = `[Combined: SALE_EXCHANGE] Sale & Exchange (Return #${generatedReturnNumber}, RetPairs: ${totalReturnedPairs}). Returned Credit: Rs. ${Math.round(totalExchangeCredit)}. Net Difference: Rs. ${Math.round(netDifference)}`;
        } else {
          exchangeNote = `[Combined: SALE_RETURN] Sale & Return (Return #${generatedReturnNumber}, RetPairs: ${totalReturnedPairs}). Returned Credit: Rs. ${Math.round(totalExchangeCredit)}. Net Difference: Rs. ${Math.round(netDifference)}`;
        }
      } else {
        exchangeNote = `Direct Shoe Exchange against ${origSale?.invoice_number || exchange.originalInvoiceNumber} (Return ${generatedReturnNumber}). Returned Credit: Rs. ${Math.round(totalExchangeCredit)}. Net Difference: Rs. ${Math.round(netDifference)}`;
      }
    }
    const offlineNote = clientTxId ? `[Offline Tx: ${clientTxId.trim()}]` : null;
    const splitNote = normalizedPaymentMethod === 'SPLIT'
      ? `[Split Payment: Cash Rs. ${req.body.splitCashAmount ?? req.body.split_cash_amount ?? 0} + ${req.body.splitDigitalType || 'Digital'} Rs. ${req.body.splitOnlineAmount ?? req.body.split_online_amount ?? 0}${transactionId ? ` (Ref: ${transactionId})` : ''}]`
      : null;
    const finalNotes = [notes?.trim(), exchangeNote, offlineNote, splitNote].filter(Boolean).join(' | ') || null;

    const effectiveSaleDate = saleDate && typeof saleDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(saleDate)
      ? saleDate.slice(0, 10)
      : null;

    const saleType = isWholesaleStore ? 'WHOLESALE' : 'RETAIL';
    const totalCartons = Math.max(0, parseFloat(String(req.body.totalCartons || req.body.total_cartons || 0)) || 0);

    // Fetch authoritative customer previous balance
    let customerPreviousBalance = 0;
    const targetCustomerId = customerId ? parseInt(customerId, 10) : (origSale ? origSale.customer_id : null);
    if (targetCustomerId && isWholesaleStore) {
      customerPreviousBalance = await fetchLockedCustomerPreviousBalance(targetCustomerId, tenantId);
    }

    // First compute authoritative totalAmountDue with 0 paid so missing paidAmount defaults to totalAmountDue
    const preReconciliation = reconcileInvoiceBalance({
      isWholesaleStore,
      customerPreviousBalance,
      calculatedSubtotal,
      calculatedTotalDiscount,
      totalExchangeCredit,
      effectivePaidAmount: 0,
    });
    const totalAmountDuePre = preReconciliation.totalAmountDue;

    let paymentReceived = 0;
    const rawPaid = typeof req.body.paidAmount !== 'undefined'
      ? req.body.paidAmount
      : (typeof req.body.amountReceived !== 'undefined'
        ? req.body.amountReceived
        : req.body.cashReceived);

    if (paymentMethod === 'KHATA') {
      paymentReceived = typeof rawPaid === 'number' ? rawPaid : (parseFloat(String(rawPaid || 0)) || 0);
    } else {
      paymentReceived = typeof rawPaid === 'number'
        ? rawPaid
        : (parseFloat(String(rawPaid ?? totalAmountDuePre)) || totalAmountDuePre);
    }
    const effectivePaidAmount = Number.isFinite(paymentReceived) ? Math.max(0, Math.round(paymentReceived * 100) / 100) : 0;

    const {
      currentCartTotal,
      totalAmountDue,
      remainingBalance,
      balanceChange,
      changeGivenDue,
    } = reconcileInvoiceBalance({
      isWholesaleStore,
      customerPreviousBalance,
      calculatedSubtotal,
      calculatedTotalDiscount,
      totalExchangeCredit,
      effectivePaidAmount,
    });

    if (!isWholesaleStore && effectivePaidAmount < totalAmountDue) {
      throw new Error('Retail checkout requires full payment. Partial payments and Khata credit are not allowed.');
    }

    if (txLockKey && !inFlightClientTxCheckouts.has(txLockKey)) {
      txLockDeferred = createCheckoutDeferred<any>();
      txLockDeferred.promise.catch(() => {});
      inFlightClientTxCheckouts.set(txLockKey, txLockDeferred.promise);
    }

    let saleId: number;
    try {
      const saleRes = await pgClient.query<{ id: number }>(
        `INSERT INTO sales (
          tenant_id, invoice_number, sale_type, customer_id, sale_date, subtotal, discount, 
          total_amount, total_cartons,
          previous_balance, paid_amount, remaining_balance,
          payment_method, cash_received, change_given, 
          created_by, is_min_price_overridden, overridden_by, notes, transaction_id, client_tx_id
        ) VALUES ($1, $2, $3, $4, COALESCE($19, NOW()::date::text), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $20, $21)
        RETURNING id`,
        [
          tenantId,
          invoiceNumber,
          saleType,
          targetCustomerId,
          calculatedSubtotal,
          calculatedTotalDiscount,
          totalAmountDue,
          totalCartons,
          customerPreviousBalance,
          effectivePaidAmount,
          remainingBalance,
          paymentMethod,
          effectivePaidAmount,
          changeGivenDue,
          user.id,
          verifiedOverrideAdminId !== null,
          verifiedOverrideAdminId,
          finalNotes,
          effectiveSaleDate,
          transactionId,
          cleanClientTxId,
        ]
      );
      saleId = saleRes.rows[0].id;
    } catch (insertErr: any) {
      if (txLockKey) {
        inFlightClientTxCheckouts.delete(txLockKey);
        txLockDeferred?.reject(insertErr);
        txLockDeferred = null;
      }
      if (cleanClientTxId && (insertErr?.code === '23505' || String(insertErr?.message || '').includes('sales_tenant_client_tx_id'))) {
        await pgClient.query('ROLLBACK');
        const existingSync = await pgClient.query<any>(
          "SELECT id, invoice_number, total_amount FROM sales WHERE COALESCE(tenant_id, 1) = $1 AND (client_tx_id = $2 OR notes LIKE $3) LIMIT 1",
          [tenantId, cleanClientTxId, `%[Offline Tx: ${cleanClientTxId}]%`]
        );
        if (existingSync.rows.length > 0) {
          const saleRow = existingSync.rows[0];
          return res.status(200).json({
            message: 'Sale previously synchronized.',
            invoiceNumber: saleRow.invoice_number,
            alreadySynced: true,
            sale: saleRow,
          });
        }
      }
      throw insertErr;
    }

    for (let idx = 0; idx < validatedItems.length; idx++) {
      const v = validatedItems[idx];
      const origItem = items[idx] || {};
      const packingType = String(origItem.packingType || origItem.packing_type || 'PAIR').toUpperCase() === 'CARTON' ? 'CARTON' : 'PAIR';
      const cartonQuantity = Math.max(0, parseFloat(String(origItem.cartonQuantity || origItem.carton_quantity || 0)) || 0);
      const pairsPerCarton = Math.max(1, parseInt(String(origItem.pairsPerCarton || origItem.pairs_per_carton || 1), 10) || 1);

      await pgClient.query(
        `INSERT INTO sale_items (
          tenant_id, sale_id, product_id, product_name, packing_type, carton_quantity, pairs_per_carton,
          quantity, unit_price, discount, subtotal, purchase_price
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [tenantId, saleId, v.productId, v.productName, packingType, cartonQuantity, pairsPerCarton, v.quantity, v.unitPrice, v.discount, v.subtotal, v.purchasePrice]
      );

      await pgClient.query(
        `INSERT INTO stock_movements (
          tenant_id, product_id, qty_change, prev_stock, new_stock, movement_type, reference_id, user_id, notes
        ) VALUES ($1, $2, $3, $4, $5, 'SALE', $6, $7, $8)`,
        [
          tenantId,
          v.productId,
          -v.quantity,
          v.prevStock,
          v.newStock,
          invoiceNumber,
          user.id,
          `POS Sale Checkout (${invoiceNumber})`,
        ]
      );
    }

    // Update Customer outstanding_balance = Remaining_Balance and record in Khata Ledger history
    if (targetCustomerId && isWholesaleStore) {
      await recordCustomerSaleKhataEntry({
        tenantId,
        customerId: targetCustomerId,
        effectiveSaleDate,
        saleId,
        invoiceNumber,
        currentCartTotal,
        effectivePaidAmount,
        balanceChange,
        remainingBalance,
        paymentMethod,
        notes: `Invoice #${invoiceNumber} (Items: Rs. ${calculatedSubtotal - calculatedTotalDiscount}${totalExchangeCredit > 0 ? `, Return: -Rs. ${totalExchangeCredit}` : ''}, Prev Khata: Rs. ${customerPreviousBalance})`,
      });
    }

    const fullSale = await pgClient.query(
      `SELECT s.*, u.name as cashier_name, c.name as customer_name, c.phone as customer_phone,
              c.shop_name as customer_shop_name, c.city as customer_city, c.market_name as customer_market_name,
              c.customer_type, c.ntn_number as customer_ntn,
              COALESCE(c.outstanding_balance, c.current_balance, 0)::numeric as customer_outstanding_balance,
              COALESCE(c.current_balance, c.outstanding_balance, 0)::numeric as customer_current_balance
       FROM sales s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN customers c ON s.customer_id = c.id
       WHERE s.id = $1 AND COALESCE(s.tenant_id, 1) = $2`,
      [saleId, tenantId]
    );

    const saleItemsRes = await pgClient.query(
      `SELECT si.*, COALESCE(p.article, si.product_name) as article, COALESCE(p.article, si.product_name) as product_name,
              COALESCE(p.pairs_per_carton, 12) as pairs_per_carton, p.allow_half_carton
       FROM sale_items si
       LEFT JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = $1 ORDER BY si.id ASC`,
      [saleId]
    );

    const csRes = await pgClient.query('SELECT * FROM company_settings WHERE COALESCE(tenant_id, 1) = $1 LIMIT 1', [tenantId]);

    await pgClient.query('COMMIT');

    // Non-blocking post-commit consolidated low-stock dispatch (never slows down checkout)
    if (lowStockBatchMap.size > 0) {
      scheduleLowStockBatchDispatch({
        tenantId,
        saleId,
        invoiceNumber,
        cashierName: user.name || 'Counter Staff',
        items: Array.from(lowStockBatchMap.values()),
      });
    }

    // Instant Real-Time Push Notification Trigger for Store Owners/Admins
    try {
      const isExchangeAction = validatedReturnItems.length > 0;
      const cashierDisplayName = cleanOptionalText(user.name) || 'Counter Staff';
      const customerDisplayName = cleanOptionalText(fullSale.rows[0]?.customer_name) || 'Walk-in Customer';
      const soldQuantity = validatedItems.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const returnedQuantity = validatedReturnItems.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      const actualSaleAmount = Math.max(0, Math.round((calculatedSubtotal - calculatedTotalDiscount) * 100) / 100);
      const unit = cleanOptionalText(req.body.unit) || 'pair';
      const exchangeNumber = formatReturnReferenceToExchange(generatedReturnNumber) || invoiceNumber;

      if (isWholesaleStore) {
        if (!isExchangeAction) {
          const formattedSale = formatSaleNotification({
            invoiceNo: invoiceNumber,
            totalAmount: actualSaleAmount,
            paymentMethod,
            totalQuantity: soldQuantity,
            returnedQuantity: 0,
            unit,
            isWholesale: true,
            customerName: customerDisplayName,
            cashierName: cashierDisplayName,
          });
          notifyPosAction(tenantId, {
            eventId: `pos-sale-${tenantId}-sale-${saleId}`,
            type: 'SALE',
            title: formattedSale.title,
            message: formattedSale.message,
            invoiceNumber,
            orderId: saleId,
            saleId,
            totalAmount: actualSaleAmount,
            customerName: customerDisplayName,
            cashierName: cashierDisplayName,
            cashierId: user.id,
            itemsSummary: formattedSale.itemsSummary,
            deepLinkUrl: `/?tab=reports&viewInvoice=${encodeURIComponent(invoiceNumber)}`,
            timestamp: new Date().toISOString(),
            triggeredBy: cashierDisplayName,
            targetRole: 'ALL',
            targetRoles: ['ADMIN', 'CASHIER'],
          }).catch((err) => console.warn('Push notification delivery notice:', err));
        } else {
          const oldItemsStr = validatedReturnItems.map((r) => `${r.quantity}x ${r.productName}`).join(', ');
          const newItemsStr = validatedItems.map((i) => `${i.quantity}x ${i.productName}`).join(', ');

          if (isStandaloneExchangeMode) {
            const formattedExchange = formatExchangeNotification({
              exchangeNo: exchangeNumber,
              returnNo: generatedReturnNumber,
              invoiceNo: invoiceNumber,
              amount: netDifference,
              paymentMethod,
              totalQuantity: returnedQuantity || soldQuantity,
              unit,
              customerName: customerDisplayName,
              cashierName: cashierDisplayName,
            });
            notifyPosAction(tenantId, {
              eventId: `pos-exchange-${tenantId}-sale-${saleId}`,
              type: 'EXCHANGE',
              title: formattedExchange.title,
              message: formattedExchange.message,
              invoiceNumber,
              exchangeNumber,
              returnNumber: generatedReturnNumber || undefined,
              orderId: saleId,
              saleId,
              totalAmount: actualSaleAmount,
              netDifference,
              customerName: customerDisplayName,
              cashierName: cashierDisplayName,
              cashierId: user.id,
              itemsSummary: formattedExchange.itemsSummary,
              exchangeDetails: {
                oldItems: oldItemsStr,
                newItems: newItemsStr,
                netDifference,
              },
              deepLinkUrl: `/?tab=reports&viewInvoice=${encodeURIComponent(invoiceNumber)}`,
              timestamp: new Date().toISOString(),
              triggeredBy: cashierDisplayName,
              targetRole: 'ALL',
              targetRoles: ['ADMIN', 'CASHIER'],
            }).catch((err) => console.warn('Push notification delivery notice:', err));
          } else if (isExplicitWholesaleExchange) {
            const formattedSaleExchange = formatSaleExchangeNotification({
              exchangeNo: exchangeNumber,
              returnNo: generatedReturnNumber,
              invoiceNo: invoiceNumber,
              amount: netDifference,
              paymentMethod,
              soldQuantity,
              exchangedQuantity: returnedQuantity,
              unit,
              customerName: customerDisplayName,
              cashierName: cashierDisplayName,
            });
            notifyPosAction(tenantId, {
              eventId: `pos-sale-exchange-${tenantId}-sale-${saleId}`,
              type: 'SALE_EXCHANGE',
              title: formattedSaleExchange.title,
              message: formattedSaleExchange.message,
              invoiceNumber,
              exchangeNumber,
              returnNumber: generatedReturnNumber || undefined,
              orderId: saleId,
              saleId,
              totalAmount: netDifference,
              netDifference,
              customerName: customerDisplayName,
              cashierName: cashierDisplayName,
              cashierId: user.id,
              itemsSummary: formattedSaleExchange.itemsSummary,
              exchangeDetails: {
                oldItems: oldItemsStr,
                newItems: newItemsStr,
                netDifference,
              },
              deepLinkUrl: `/?tab=reports&viewInvoice=${encodeURIComponent(invoiceNumber)}`,
              timestamp: new Date().toISOString(),
              triggeredBy: cashierDisplayName,
              targetRole: 'ALL',
              targetRoles: ['ADMIN', 'CASHIER'],
            }).catch((err) => console.warn('Push notification delivery notice:', err));
          } else {
            const formattedSaleReturn = formatSaleReturnNotification({
              invoiceNo: invoiceNumber,
              amount: netDifference,
              paymentMethod,
              soldQuantity,
              returnedQuantity,
              unit,
              isWholesale: true,
              customerName: customerDisplayName,
              cashierName: cashierDisplayName,
            });
            notifyPosAction(tenantId, {
              eventId: `pos-sale-return-${tenantId}-sale-${saleId}`,
              type: 'SALE_RETURN',
              title: formattedSaleReturn.title,
              message: formattedSaleReturn.message,
              invoiceNumber,
              returnNumber: generatedReturnNumber || undefined,
              orderId: saleId,
              saleId,
              totalAmount: netDifference,
              netDifference,
              customerName: customerDisplayName,
              cashierName: cashierDisplayName,
              cashierId: user.id,
              itemsSummary: formattedSaleReturn.itemsSummary,
              exchangeDetails: {
                oldItems: oldItemsStr,
                newItems: newItemsStr,
                netDifference,
              },
              deepLinkUrl: `/?tab=reports&viewInvoice=${encodeURIComponent(invoiceNumber)}`,
              timestamp: new Date().toISOString(),
              triggeredBy: cashierDisplayName,
              targetRole: 'ALL',
              targetRoles: ['ADMIN', 'CASHIER'],
            }).catch((err) => console.warn('Push notification delivery notice:', err));
          }
        }
      } else if (isExchangeAction) {
        const oldItemsStr = validatedReturnItems.map((r) => `${r.quantity}x ${r.productName}`).join(', ');
        const newItemsStr = validatedItems.map((i) => `${i.quantity}x ${i.productName}`).join(', ');
        const exchangedQuantity = returnedQuantity || soldQuantity;
        const formattedExchange = formatExchangeNotification({
          exchangeNo: exchangeNumber,
          returnNo: generatedReturnNumber,
          invoiceNo: invoiceNumber,
          amount: netDifference,
          paymentMethod,
          totalQuantity: exchangedQuantity,
          unit,
          customerName: customerDisplayName,
          cashierName: cashierDisplayName,
        });
        notifyPosAction(tenantId, {
          eventId: `pos-exchange-${tenantId}-sale-${saleId}`,
          type: 'EXCHANGE',
          title: formattedExchange.title,
          message: formattedExchange.message,
          invoiceNumber,
          exchangeNumber,
          returnNumber: generatedReturnNumber || undefined,
          orderId: saleId,
          saleId,
          totalAmount: totalAmountDue,
          netDifference,
          customerName: customerDisplayName,
          cashierName: cashierDisplayName,
          cashierId: user.id,
          itemsSummary: formattedExchange.itemsSummary,
          exchangeDetails: {
            oldItems: oldItemsStr,
            newItems: newItemsStr,
            netDifference,
          },
          deepLinkUrl: `/?tab=reports&viewInvoice=${encodeURIComponent(invoiceNumber)}`,
          timestamp: new Date().toISOString(),
          triggeredBy: cashierDisplayName,
          targetRole: 'ALL',
          targetRoles: ['ADMIN', 'CASHIER'],
        }).catch((err) => console.warn('Push notification delivery notice:', err));
      } else {
        const formattedSale = formatSaleNotification({
          invoiceNo: invoiceNumber,
          totalAmount: totalAmountDue,
          paymentMethod,
          totalQuantity: soldQuantity,
          returnedQuantity: 0,
          unit,
          isWholesale: false,
          customerName: customerDisplayName,
          cashierName: cashierDisplayName,
        });
        notifyPosAction(tenantId, {
          eventId: `pos-sale-${tenantId}-sale-${saleId}`,
          type: 'SALE',
          title: formattedSale.title,
          message: formattedSale.message,
          invoiceNumber,
          orderId: saleId,
          saleId,
          totalAmount: totalAmountDue,
          customerName: customerDisplayName,
          cashierName: cashierDisplayName,
          cashierId: user.id,
          itemsSummary: formattedSale.itemsSummary,
          deepLinkUrl: `/?tab=reports&viewInvoice=${encodeURIComponent(invoiceNumber)}`,
          timestamp: new Date().toISOString(),
          triggeredBy: cashierDisplayName,
          targetRole: 'ALL',
          targetRoles: ['ADMIN', 'CASHIER'],
        }).catch((err) => console.warn('Push notification delivery notice:', err));
      }
    } catch (notifErr) {
      console.warn('Notification trigger error:', notifErr);
    }

    const responsePayload = {
      message: validatedReturnItems.length > 0
        ? (isWholesaleStore ? `Shoe Return processed. Return #${generatedReturnNumber} generated.` : `Direct Shoe Exchange completed. Return ${generatedReturnNumber} generated.`)
        : 'Sale completed successfully.',
      invoiceNumber,
      returnNumber: generatedReturnNumber,
      clientTxId: cleanClientTxId || null,
      netDifference,
      exchangeCredit: totalExchangeCredit,
      sale: {
        ...(fullSale.rows[0] as any),
        items: saleItemsRes.rows,
        returned_items: validatedReturnItems,
        exchange_credit: totalExchangeCredit,
        net_difference: netDifference,
        return_number: generatedReturnNumber,
        original_invoice_number: origSale?.invoice_number || exchange?.originalInvoiceNumber,
      },
      companySettings: csRes.rows[0] || null,
    };

    if (txLockKey) {
      txLockDeferred?.resolve(responsePayload);
      txLockDeferred = null;
      inFlightClientTxCheckouts.delete(txLockKey);
    }

    res.status(201).json(responsePayload);
  } catch (txErr: any) {
    if (txLockKey) {
      txLockDeferred?.reject(txErr);
      txLockDeferred = null;
      inFlightClientTxCheckouts.delete(txLockKey);
    }
    await pgClient.query('ROLLBACK');
    console.error('POS Checkout Transaction Failed:', txErr);
    res.status(400).json({ error: txErr.message || 'Transaction failed. Stock has been preserved.' });
  }
});

// GET /api/pos/sales - List sales scoped strictly by req.user.tenantId
router.get('/sales', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = extractStrictTenantId(req);
    const { search, limit = 50 } = req.query;
    let query = `
      SELECT s.id, s.invoice_number, s.customer_id, c.name as customer_name, 
             s.sale_date, s.subtotal, s.discount, s.total_amount, 
             s.payment_method, s.cash_received, s.change_given, 
             s.created_by, u.name as cashier_name, s.is_min_price_overridden,
             s.notes, s.created_at
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id AND COALESCE(c.tenant_id, 1) = $1
      LEFT JOIN users u ON s.created_by = u.id
      WHERE COALESCE(s.tenant_id, 1) = $1
    `;
    const params: any[] = [tenantId];

    if (search && typeof search === 'string') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(s.invoice_number) LIKE $${params.length} OR LOWER(c.name) LIKE $${params.length} OR c.phone LIKE $${params.length})`;
    }

    query += ` ORDER BY s.id DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(String(limit), 10) || 50);

    const result = await pgClient.query(query, params);
    res.json({ sales: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch sales: ' + err.message });
  }
});

// GET /api/pos/sales/:id - Single Sale Details scoped strictly by req.user.tenantId
router.get('/sales/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = extractStrictTenantId(req);
    const id = parseInt(req.params.id, 10);
    const saleRes = await pgClient.query(
      `SELECT s.*, u.name as cashier_name, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
              c.customer_type, c.shop_name as customer_shop_name, c.market_name as customer_market_name, c.city as customer_city,
              c.ntn_number as customer_ntn
       FROM sales s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN customers c ON s.customer_id = c.id AND COALESCE(c.tenant_id, 1) = $2
       WHERE s.id = $1 AND COALESCE(s.tenant_id, 1) = $2`,
      [id, tenantId]
    );

    if (saleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sale record not found in your store.' });
    }

    const itemsRes = await pgClient.query(
      `SELECT si.*, COALESCE(p.article, si.product_name) as article, COALESCE(p.article, si.product_name) as product_name,
              COALESCE(p.pairs_per_carton, 12) as pairs_per_carton, p.allow_half_carton 
       FROM sale_items si
       LEFT JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = $1 ORDER BY si.id ASC`,
      [id]
    );

    const settingsRes = await pgClient.query('SELECT * FROM company_settings WHERE COALESCE(tenant_id, 1) = $1 LIMIT 1', [tenantId]);

    res.json({
      sale: {
        ...(saleRes.rows[0] as any),
        items: itemsRes.rows,
      },
      companySettings: settingsRes.rows[0] || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch sale details: ' + err.message });
  }
});

export default router;
