import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import {
  formatSaleNotification,
  formatPurchaseNotification,
  formatReturnNotification,
  formatExchangeNotification,
  formatSaleExchangeNotification,
  formatSaleReturnNotification,
} from '../src/utils/notificationFormatters.ts';
import { resolveNotificationActions } from '../src/utils/notificationActions.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import posRoutes from '../src/server/routes/posRoutes.ts';
import purchaseRoutes from '../src/server/routes/purchaseRoutes.ts';
import purchaseReturnRoutes from '../src/server/routes/purchaseReturnRoutes.ts';
import returnRoutes from '../src/server/routes/returnRoutes.ts';
import { pgClient } from '../src/db/index.ts';
import { ensureNotificationsSchema, ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import { registerSseClient, resetServerNotificationDedupeCache } from '../src/server/pushNotificationService.ts';

test('Wholesale notification formatters match standardized structure for Sale, Sale w/ Return, Purchase, Independent Return, Exchange', () => {
  const wholesaleSale = formatSaleNotification({
    invoiceNo: 'INV-1025',
    totalQuantity: 120,
    unit: 'pair',
    isWholesale: true,
    customerName: 'Al-Madina Footwear',
    paymentMethod: 'BANK_TRANSFER',
    cashierName: 'Hassan',
  });
  assert.equal(wholesaleSale.title, 'Sale Completed ✅');
  assert.equal(
    wholesaleSale.message,
    'Invoice: #INV-1025\nTotal Sold: 120 pairs\nSold to: Al-Madina Footwear\nPayment: Bank Transfer\nProcessed by: Hassan'
  );
  assert.equal(wholesaleSale.message.includes('Returned:'), false);
  assert.equal(wholesaleSale.message.includes('Net Sold:'), false);
  assert.doesNotMatch(`${wholesaleSale.title} ${wholesaleSale.message}`, /\b(wholesale|b2b)\b/i);

  const wholesaleSaleWithReturn = formatSaleNotification({
    invoiceNo: 'INV-1026',
    totalQuantity: 120,
    returnedQuantity: 20,
    unit: 'pair',
    isWholesale: true,
    customerName: 'Al-Madina Footwear',
    paymentMethod: 'BANK_TRANSFER',
    cashierName: 'Hassan',
  });
  assert.equal(wholesaleSaleWithReturn.title, 'Sale Completed ✅');
  assert.equal(
    wholesaleSaleWithReturn.message,
    'Invoice: #INV-1026\nTotal Sold: 120 pairs\nReturned: 20 pairs\nNet Sold: 100 pairs\nSold to: Al-Madina Footwear\nPayment: Bank Transfer\nProcessed by: Hassan'
  );

  const purchase = formatPurchaseNotification({
    purchaseNo: 'PUR-000025',
    totalQuantity: 25,
    unit: 'carton',
    supplierName: 'Beacon Suppliers',
    paymentMethod: 'CASH',
    cashierName: 'Hassan',
  });
  assert.equal(purchase.title, 'Purchase Completed');
  assert.equal(
    purchase.message,
    'Purchase #: #PUR-000025\n25 cartons purchased from Beacon Suppliers.\nPayment: Cash\nProcessed by: Hassan'
  );

  const ret = formatReturnNotification({
    returnNo: 'RET-000012',
    amount: 6000,
    paymentMethod: 'CASH',
    totalQuantity: 3,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(ret.title, 'Return Completed ✅');
  assert.equal(
    ret.message,
    'Return #: #RET-000012\n3 pairs returned by Al-Madina Footwear.\nRefund: Rs. 6,000 (Cash)\nProcessed by: Hassan'
  );

  const exch = formatExchangeNotification({
    exchangeNo: 'EXC-000008',
    amount: 1500,
    paymentMethod: 'ONLINE',
    totalQuantity: 2,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(exch.title, 'Exchange Completed ✅');
  assert.equal(
    exch.message,
    'Exchange #: #EXC-000008\n2 pairs exchanged by Al-Madina Footwear.\nAdditional Payment: Rs. 1,500 (Online)\nProcessed by: Hassan'
  );

  const saleExchange = formatSaleExchangeNotification({
    exchangeNo: 'EXC-000009',
    amount: -500,
    paymentMethod: 'CASH',
    soldQuantity: 12,
    exchangedQuantity: 4,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(saleExchange.title, 'Exchange Completed ✅');
  assert.equal(
    saleExchange.message,
    'Exchange #: #EXC-000009\n4 pairs exchanged by Al-Madina Footwear.\nRefund: Rs. 500 (Cash)\nProcessed by: Hassan'
  );

  const saleReturn = formatSaleReturnNotification({
    invoiceNo: 'INV-1027',
    amount: 14000,
    paymentMethod: 'KHATA',
    soldQuantity: 12,
    returnedQuantity: 6,
    isWholesale: true,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(saleReturn.title, 'Sale Completed ✅');
  assert.equal(
    saleReturn.message,
    'Invoice: #INV-1027\nTotal Sold: 12 pairs\nReturned: 6 pairs\nNet Sold: 6 pairs\nSold to: Al-Madina Footwear\nPayment: Khata\nProcessed by: Hassan'
  );
});

test('All wholesale transaction notification types resolve appropriate View action + Open POS', () => {
  for (const type of ['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE'] as const) {
    const actions = resolveNotificationActions({ type, invoiceNumber: 'INV-1025' }, 'ADMIN');
    assert.deepEqual(actions, [
      { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-1025' },
      { action: 'open_pos', label: 'Open POS', url: '/pos' },
    ]);
  }

  const purchaseActions = resolveNotificationActions(
    { type: 'PURCHASE', purchaseNumber: 'PUR-000025' },
    'ADMIN'
  );
  assert.deepEqual(purchaseActions, [
    { action: 'view_purchase', label: 'View Purchase', url: '/?tab=purchases' },
    { action: 'open_pos', label: 'Open POS', url: '/pos' },
  ]);
});

test('Wholesale store emits standardized notifications: Sale w/o Return, Same-Invoice Return consolidating into Sale Completed, Combined Sale & Return, Exchange, and Purchase', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureNotificationsSchema();
  resetServerNotificationDedupeCache();

  const suffix = Date.now().toString().slice(-6);
  const tenantRes = await pgClient.query<{ id: number }>(
    `INSERT INTO tenants (name, slug, subdomain, status, plan)
     VALUES ($1, $2, $3, 'ACTIVE', 'PRO')
     RETURNING id`,
    [`Star Shoes ${suffix}`, `star-shoes-${suffix}`, `star-${suffix}`]
  );
  const tenantId = tenantRes.rows[0].id;

  await pgClient.query(
    `INSERT INTO company_settings (
      tenant_id, address, phone, email, currency, currency_symbol, pricing_mode, business_type, allow_half_carton, low_stock_threshold
    ) VALUES ($1, 'Lahore', '03000000000', $2, 'PKR', 'Rs.', 'FLEXIBLE', 'WHOLESALE', true, 5)`,
    [tenantId, `star.${suffix}@shoepos.test`]
  );

  const userRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED')
     RETURNING id`,
    [tenantId, 'Kamran Staff', `kamran.${suffix}@shoepos.test`, '+923009998877', 'hash', '1234']
  );
  const adminUserId = userRes.rows[0].id;

  const custRes = await pgClient.query<{ id: number }>(
    `INSERT INTO customers (tenant_id, name, phone, shop_name, market_name, city, email, address, notes, credit_limit, current_balance, outstanding_balance, ntn_number, customer_type)
     VALUES ($1, $2, $3, '', '', '', '', '', '', 200000, 50000, 50000, '', 'WHOLESALER')
     RETURNING id`,
    [tenantId, 'Madina Shoes Dealer', '03007776655']
  );
  const customerId = custRes.rows[0].id;

  const prodRes = await pgClient.query<{ id: number }>(
    `INSERT INTO products (
      tenant_id, tenant_product_no, name, brand, category, article, barcode,
      primary_image_url, description, cost_price, min_price, max_price, selling_price,
      pairs_per_carton, allow_half_carton, total_stock, low_stock_threshold, is_low_stock_alert_sent, active
    ) VALUES ($1, $2, $3, 'Bata', 'Formal', $4, $5, '', '', 1000, 1500, 2000, 2000, 12, true, 500, 5, false, true)
    RETURNING id`,
    [tenantId, 1001, 'Bata Executive', `BEX-${suffix}`, `BCW-${suffix}`]
  );
  const productId = prodRes.rows[0].id;

  const sseEvents: Array<{ event: string; data: any }> = [];
  const unregister = registerSseClient(tenantId, adminUserId, 'ADMIN', {
    write: (chunk: string) => {
      const lines = String(chunk).split('\n');
      let evtName = '';
      let dataLine = '';
      for (const line of lines) {
        if (line.startsWith('event:')) evtName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      }
      if (evtName && dataLine) {
        try {
          sseEvents.push({ event: evtName, data: JSON.parse(dataLine) });
        } catch {}
      }
      return true;
    },
  } as any);

  const app = express();
  app.use(express.json());
  app.use('/api/pos', posRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/purchase-returns', purchaseReturnRoutes);
  app.use('/api/returns', returnRoutes);
  app.use('/api/notifications', notificationRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const token = generateToken({
    id: adminUserId,
    email: `kamran.${suffix}@shoepos.test`,
    name: 'Kamran Staff',
    role: 'ADMIN',
    status: 'APPROVED',
    tenantId,
  });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': String(tenantId),
  };

  try {
    // 1. Standalone Wholesale Sale: 120 pairs @ Rs. 2000 on Bank Transfer
    const saleRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 120, unitPrice: 2000, discount: 0 }],
        customerId,
        paymentMethod: 'BANK_TRANSFER',
        transactionId: `BT-${suffix}`,
        paidAmount: 240000,
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleJson = await saleRes.json();
    const saleInv = saleJson.invoiceNumber;
    const origSaleId = saleJson.sale.id;

    await new Promise((r) => setTimeout(r, 40));

    const saleEvt = sseEvents.find((e) => e.data?.invoiceNumber === saleInv && e.data?.type === 'SALE');
    assert.ok(saleEvt, 'Expected SSE SALE notification');
    assert.equal(saleEvt!.data.title, 'Sale Completed ✅');
    assert.equal(
      saleEvt!.data.message,
      `Invoice: #${saleInv}\nTotal Sold: 120 pairs\nSold to: Madina Shoes Dealer\nPayment: Bank Transfer\nProcessed by: Kamran Staff`
    );

    // 2. Return against same Wholesale invoice: 20 pairs returned -> updates Sale Completed, NEVER emits Return Completed
    const siRows = await pgClient.query<{ id: number }>(
      'SELECT id FROM sale_items WHERE sale_id = $1 AND tenant_id = $2',
      [origSaleId, tenantId]
    );
    const saleItemId = siRows.rows[0].id;

    const sseCountBeforeReturn = sseEvents.length;
    const retRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        originalSaleId: origSaleId,
        reason: 'Size defect',
        items: [{ saleItemId, quantity: 20, unitRefundPrice: 2000 }],
      }),
    });
    assert.equal(retRes.status, 201);
    await new Promise((r) => setTimeout(r, 40));

    const newEventsAfterSameInvoiceReturn = sseEvents.slice(sseCountBeforeReturn);
    assert.equal(
      newEventsAfterSameInvoiceReturn.some((e) => e.data?.type === 'RETURN'),
      false,
      'Same-invoice return must NOT emit a separate Return Completed notification'
    );
    const updatedSaleEvt = newEventsAfterSameInvoiceReturn.find(
      (e) => e.data?.type === 'SALE' && e.data?.invoiceNumber === saleInv
    );
    assert.ok(updatedSaleEvt, 'Expected updated Sale Completed notification on same-invoice return');
    assert.equal(updatedSaleEvt!.data.title, 'Sale Completed ✅');
    assert.equal(
      updatedSaleEvt!.data.message,
      `Invoice: #${saleInv}\nTotal Sold: 120 pairs\nReturned: 20 pairs\nNet Sold: 100 pairs\nSold to: Madina Shoes Dealer\nPayment: Bank Transfer\nProcessed by: Kamran Staff`
    );

    // 3. Combined Sale & Return (direct return checkout: 12 pairs sold, 6 pairs returned)
    const saleRetRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 12, unitPrice: 2000, discount: 0 }],
        customerId,
        paymentMethod: 'CASH',
        paidAmount: 15000,
        exchange: {
          originalSaleId: 0,
          mode: 'RETURN',
          reason: 'Defective Sole',
          items: [{ productId, quantity: 6, unitRefundPrice: 1500 }],
        },
      }),
    });
    assert.equal(saleRetRes.status, 201);
    const saleRetJson = await saleRetRes.json();
    const saleRetInv = saleRetJson.invoiceNumber;

    await new Promise((r) => setTimeout(r, 40));

    const saleRetEvents = sseEvents.filter((e) => e.data?.invoiceNumber === saleRetInv);
    assert.equal(saleRetEvents.length, 1, 'Combined Sale & Return must emit exactly 1 SSE notification');
    assert.equal(saleRetEvents[0].data.title, 'Sale Completed ✅');
    assert.equal(
      saleRetEvents[0].data.message,
      `Invoice: #${saleRetInv}\nTotal Sold: 12 pairs\nReturned: 6 pairs\nNet Sold: 6 pairs\nSold to: Madina Shoes Dealer\nPayment: Cash\nProcessed by: Kamran Staff`
    );

    // 4. Standalone Exchange (EXCHANGE_ONLY: 6 pairs swapped with +1200 additional payment)
    const exchOnlyRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 6, unitPrice: 2200, discount: 0 }],
        customerId,
        paymentMethod: 'CASH',
        paidAmount: 1200,
        exchange: {
          originalSaleId: origSaleId,
          mode: 'EXCHANGE_ONLY',
          reason: 'Product exchange',
          items: [{ productId, quantity: 6, unitRefundPrice: 2000 }],
        },
      }),
    });
    assert.equal(exchOnlyRes.status, 201);
    const exchOnlyJson = await exchOnlyRes.json();
    const exchOnlyInv = exchOnlyJson.invoiceNumber;

    await new Promise((r) => setTimeout(r, 40));

    const exchOnlyEvents = sseEvents.filter((e) => e.data?.invoiceNumber === exchOnlyInv);
    assert.equal(exchOnlyEvents.length, 1, 'Standalone Exchange must emit exactly 1 SSE notification');
    assert.equal(exchOnlyEvents[0].data.type, 'EXCHANGE');
    assert.equal(exchOnlyEvents[0].data.title, 'Exchange Completed ✅');
    assert.ok(exchOnlyEvents[0].data.message.includes('6 pairs exchanged by Madina Shoes Dealer.'));
    assert.ok(exchOnlyEvents[0].data.message.includes('Additional Payment: Rs. 1,200 (Cash)'));
    assert.ok(exchOnlyEvents[0].data.message.includes('Processed by: Kamran Staff'));

    // 5. Purchase & Supplier Purchase Return must NOT generate any notification alerts
    const sseCountBeforeAdminActivity = sseEvents.length;
    const purRes = await fetch(`${baseUrl}/api/purchases`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        supplierName: 'Beacon Suppliers',
        paymentMethod: 'CASH',
        paidAmount: 25000,
        unit: 'carton',
        items: [{ productId, quantity: 25, unitCost: 1000 }],
      }),
    });
    assert.equal(purRes.status, 201);
    const purJson = await purRes.json();
    const purNo = purJson.purchaseNumber;

    const purRetRes = await fetch(`${baseUrl}/api/purchase-returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        supplierName: 'Beacon Suppliers',
        purchaseId: purJson.purchaseId,
        reason: 'Damaged cartons',
        items: [{ productId, quantity: 2, unitCost: 1000 }],
      }),
    });
    assert.equal(purRetRes.status, 201);

    await new Promise((r) => setTimeout(r, 40));
    const eventsAfterPurchaseAndSupplierReturn = sseEvents.slice(sseCountBeforeAdminActivity);
    assert.equal(
      eventsAfterPurchaseAndSupplierReturn.length,
      0,
      'Purchases and supplier purchase returns must emit ZERO SSE notifications'
    );

    // 6. Verify /grouped and /all return the consolidated sale/return/exchange notifications accurately and omit purchases
    const groupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, { headers });
    assert.equal(groupedRes.status, 200);
    const groupedJson = await groupedRes.json();
    const groupedNotifs: any[] = groupedJson.notifications || [];

    const gSale = groupedNotifs.find((n) => n.invoiceNumber === saleInv && n.type === 'SALE');
    const gRetForSameInv = groupedNotifs.find((n) => n.invoiceNumber === saleInv && n.type === 'RETURN');
    const gSaleRet = groupedNotifs.find((n) => n.invoiceNumber === saleRetInv);
    const gExch = groupedNotifs.find((n) => n.invoiceNumber === exchOnlyInv);
    const gPurchase = groupedNotifs.find((n) => n.type === 'PURCHASE' || n.purchaseNumber === purNo);

    assert.ok(gSale, 'Expected consolidated Sale Completed in grouped notifications');
    assert.equal(gRetForSameInv, undefined, 'Same-invoice return must NOT appear as separate Return Completed in /grouped');
    assert.equal(gSale.title, 'Sale Completed ✅');
    assert.equal(
      gSale.message,
      `Invoice: #${saleInv}\nTotal Sold: 120 pairs\nReturned: 20 pairs\nNet Sold: 100 pairs\nSold to: Madina Shoes Dealer\nPayment: Bank Transfer\nProcessed by: Kamran Staff`
    );
    assert.ok(gSaleRet);
    assert.equal(gSaleRet.title, 'Sale Completed ✅');
    assert.ok(gExch);
    assert.equal(gExch.title, 'Exchange Completed ✅');
    assert.equal(gPurchase, undefined, 'Purchases must NOT appear in /api/notifications/grouped');

    const allRes = await fetch(`${baseUrl}/api/notifications/all?limit=25`, { headers });
    assert.equal(allRes.status, 200);
    const allJson = await allRes.json();
    const allItems: any[] = allJson.items || [];
    assert.equal(
      allItems.some((n) => n.type === 'PURCHASE' || n.purchaseNumber === purNo),
      false,
      'Purchases must NOT appear in /api/notifications/all'
    );
  } finally {
    unregister();
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
