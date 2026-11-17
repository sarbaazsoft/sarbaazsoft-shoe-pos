import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import http from 'node:http';

import {
  formatSaleNotification,
  formatPurchaseNotification,
  formatReturnNotification,
  formatExchangeNotification,
  formatUnitQuantity,
  formatPairSummary,
  formatPaymentMethodLabel,
  formatNotificationHeaderTitle,
  isCompletedTransactionNotification,
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

test('Unit singular/plural formatting handles pairs, cartons, boxes, and dozens without confusing units', () => {
  assert.equal(formatUnitQuantity(1, 'pair'), '1 pair');
  assert.equal(formatUnitQuantity(2, 'pair'), '2 pairs');
  assert.equal(formatUnitQuantity(1, 'carton'), '1 carton');
  assert.equal(formatUnitQuantity(25, 'carton'), '25 cartons');
  assert.equal(formatUnitQuantity(1, 'box'), '1 box');
  assert.equal(formatUnitQuantity(3, 'box'), '3 boxes');
  assert.equal(formatUnitQuantity(1, 'dozen'), '1 dozen');
  assert.equal(formatUnitQuantity(4, 'dozen'), '4 dozens');
  assert.equal(formatPairSummary(1, 'Sold'), '1 pair Sold');
  assert.equal(formatPairSummary(4, 'Sold'), '4 pairs Sold');
});

test('Retail, Wholesale, Purchase, Independent Return, and Exchange formatters match exact standardized layouts and safely omit missing fields', () => {
  // 1A. Retail Sale - Without Return
  const retailSale = formatSaleNotification({
    invoiceNo: 'INV-000101',
    totalQuantity: 2,
    isWholesale: false,
    customerName: 'Walk-in Customer',
    paymentMethod: 'CASH',
    cashierName: 'Usman Staff',
  });
  assert.equal(retailSale.title, 'Sale Completed ✅');
  assert.equal(
    retailSale.message,
    'Invoice: #INV-000101\n2 pairs sold to Walk-in Customer.\nPayment: Cash\nProcessed by: Usman Staff'
  );
  assert.equal(retailSale.message.includes('Returned:'), false);
  assert.equal(retailSale.message.includes('Net Sold:'), false);

  // 1B. Retail Sale - With Return
  const retailWithReturn = formatSaleNotification({
    invoiceNo: 'INV-000102',
    totalQuantity: 3,
    returnedQuantity: 1,
    isWholesale: false,
    customerName: 'Ahmed Customer',
    paymentMethod: 'CASH',
    cashierName: 'Usman Staff',
  });
  assert.equal(retailWithReturn.title, 'Sale Completed ✅');
  assert.equal(
    retailWithReturn.message,
    'Invoice: #INV-000102\nTotal Sold: 3 pairs\nReturned: 1 pair\nNet Sold: 2 pairs\nSold to: Ahmed Customer\nPayment: Cash\nProcessed by: Usman Staff'
  );

  // 1C. Wholesale Sale - Without Return
  const wholesaleNoReturn = formatSaleNotification({
    invoiceNo: 'INV-000103',
    totalQuantity: 120,
    isWholesale: true,
    customerName: 'National Shoes Wholesale',
    paymentMethod: 'BANK_TRANSFER',
    cashierName: 'Usman Staff',
  });
  assert.equal(wholesaleNoReturn.title, 'Sale Completed ✅');
  assert.equal(
    wholesaleNoReturn.message,
    'Invoice: #INV-000103\nTotal Sold: 120 pairs\nSold to: National Shoes Wholesale\nPayment: Bank Transfer\nProcessed by: Usman Staff'
  );

  // 2. Purchase Completed
  const purchase = formatPurchaseNotification({
    purchaseNo: 'PUR-000025',
    totalQuantity: 25,
    unit: 'carton',
    supplierName: 'Crescent Footwear Co',
    paymentMethod: 'CASH',
    cashierName: 'Usman Staff',
  });
  assert.equal(purchase.title, 'Purchase Completed');
  assert.equal(
    purchase.message,
    'Purchase #: #PUR-000025\n25 cartons purchased from Crescent Footwear Co.\nPayment: Cash\nProcessed by: Usman Staff'
  );

  // 3. Independent Return Completed
  const independentRet = formatReturnNotification({
    returnNo: 'RET-000012',
    amount: 1550,
    paymentMethod: 'CASH',
    totalQuantity: 2,
    customerName: 'Ahmed Customer',
    cashierName: 'Usman Staff',
  });
  assert.equal(independentRet.title, 'Return Completed ✅');
  assert.equal(
    independentRet.message,
    'Return #: #RET-000012\n2 pairs returned by Ahmed Customer.\nRefund: Rs. 1,550 (Cash)\nProcessed by: Usman Staff'
  );

  // 4. Exchange Completed (Additional Payment + Refund + Zero Adjustment)
  const exchPay = formatExchangeNotification({
    exchangeNo: 'EXC-000008',
    amount: 500,
    paymentMethod: 'CASH',
    totalQuantity: 2,
    customerName: 'Ahmed Customer',
    cashierName: 'Usman Staff',
  });
  assert.equal(exchPay.title, 'Exchange Completed ✅');
  assert.equal(
    exchPay.message,
    'Exchange #: #EXC-000008\n2 pairs exchanged by Ahmed Customer.\nAdditional Payment: Rs. 500 (Cash)\nProcessed by: Usman Staff'
  );

  const exchRefund = formatExchangeNotification({
    exchangeNo: 'EXC-000009',
    amount: -350,
    paymentMethod: 'ONLINE',
    totalQuantity: 1,
    customerName: 'Ahmed Customer',
    cashierName: 'Usman Staff',
  });
  assert.equal(
    exchRefund.message,
    'Exchange #: #EXC-000009\n1 pair exchanged by Ahmed Customer.\nRefund: Rs. 350 (Online)\nProcessed by: Usman Staff'
  );

  // Null/undefined/missing optional fields never output 'null', 'undefined', or blank labels
  const sparseSale = formatSaleNotification({
    invoiceNo: 'INV-000199',
    totalQuantity: 1,
    customerName: null,
    paymentMethod: 'undefined',
    cashierName: '',
  });
  assert.equal(sparseSale.message, 'Invoice: #INV-000199\n1 pair sold.');
  assert.equal(/null|undefined/i.test(sparseSale.message), false);

  const sparseReturn = formatReturnNotification({
    returnNo: 'RET-000099',
    totalQuantity: 1,
    amount: 0,
    customerName: undefined,
    paymentMethod: null,
    cashierName: 'null',
  });
  assert.equal(sparseReturn.message, 'Return #: #RET-000099\n1 pair returned.');
  assert.equal(/null|undefined|Refund:/i.test(sparseReturn.message), false);
  assert.equal(/\n\n/.test(retailSale.message), false);
  assert.equal(/\n\n/.test(independentRet.message), false);
  assert.equal(/\n\n/.test(exchPay.message), false);

  assert.equal(formatPaymentMethodLabel('KHATA'), 'Khata');
  assert.equal(formatPaymentMethodLabel('SPLIT'), 'Split');
});

test('NotificationHeaderTitle and header helpers render circular green Check icon without plain emojis across all 4 completed transaction types', () => {
  for (const title of ['Sale Completed', 'Purchase Completed', 'Return Completed', 'Exchange Completed', 'Sale Completed ✅', 'Return Completed 🔄']) {
    assert.equal(isCompletedTransactionNotification({ title }), true);
    assert.equal(/[✅🔄✔]/u.test(formatNotificationHeaderTitle(title)), false);
  }
  assert.equal(isCompletedTransactionNotification({ kind: 'NOTICE', title: 'Sale Completed', type: 'SUCCESS' }), false);

  const headerTitleComp = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'notifications', 'NotificationHeaderTitle.tsx'),
    'utf8'
  );
  assert.match(headerTitleComp, /inline-flex h-6 w-6[\s\S]*items-center justify-center rounded-full bg-green-100 text-green-600/);
  assert.match(headerTitleComp, /<Check className="h-4 w-4" \/>/);

  const headerSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'common', 'Header.tsx'), 'utf8');
  const notificationsViewSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'notifications', 'NotificationsView.tsx'),
    'utf8'
  );
  assert.equal(headerSrc.includes('<NotificationHeaderTitle'), true);
  assert.equal(notificationsViewSrc.includes('<NotificationHeaderTitle'), true);
});

test('All POS transaction notifications resolve expected action buttons', () => {
  for (const type of ['SALE', 'RETURN', 'EXCHANGE'] as const) {
    const actions = resolveNotificationActions({ type, invoiceNumber: 'INV-9001' }, 'ADMIN');
    assert.deepEqual(actions, [
      { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-9001' },
      { action: 'open_pos', label: 'Open POS', url: '/pos' },
    ]);
  }
  assert.deepEqual(
    resolveNotificationActions({ type: 'RETURN', returnNumber: 'RET-000012' }, 'ADMIN'),
    [
      { action: 'view_invoice', label: 'View Invoice', url: '/returns' },
      { action: 'open_pos', label: 'Open POS', url: '/pos' },
    ]
  );
  assert.deepEqual(
    resolveNotificationActions({ type: 'PURCHASE', purchaseNumber: 'PUR-000025' }, 'ADMIN'),
    [
      { action: 'view_purchase', label: 'View Purchase', url: '/?tab=purchases' },
      { action: 'open_pos', label: 'Open POS', url: '/pos' },
    ]
  );
});

test('Retail store end-to-end: Checkout, Same-Invoice Return consolidation, Independent Return, Exchange, Purchase, and Cashier isolation', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureNotificationsSchema();
  resetServerNotificationDedupeCache();

  const tenantId = 1;
  const suffix = Date.now().toString().slice(-6);

  const userRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED')
     RETURNING id`,
    [tenantId, 'Usman Cashier', `usman.${suffix}@shoepos.test`, '+923001112233', 'hash', '1234']
  );
  const adminUserId = userRes.rows[0].id;

  const cashierRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'CASHIER', 'APPROVED')
     RETURNING id`,
    [tenantId, 'Counter Cashier', `cashier.${suffix}@shoepos.test`, '+923001112244', 'hash', '1234']
  );
  const cashierUserId = cashierRes.rows[0].id;

  const custRes = await pgClient.query<{ id: number }>(
    `INSERT INTO customers (tenant_id, name, phone, shop_name, market_name, city, email, address, notes, credit_limit, current_balance, outstanding_balance, ntn_number, customer_type)
     VALUES ($1, $2, $3, '', '', '', '', '', '', 0, 0, 0, '', 'RETAILER')
     RETURNING id`,
    [tenantId, 'Tariq Footwear', '03001234567']
  );
  const customerId = custRes.rows[0].id;

  const prodRes = await pgClient.query<{ id: number }>(
    `INSERT INTO products (
      tenant_id, tenant_product_no, name, brand, category, article, barcode,
      primary_image_url, description, cost_price, min_price, max_price, selling_price,
      pairs_per_carton, allow_half_carton, total_stock, low_stock_threshold, is_low_stock_alert_sent, active
    ) VALUES ($1, $2, $3, 'Nike', 'Sneakers', $4, $5, '', '', 1500, 2000, 2500, 2500, 12, true, 100, 5, false, true)
    RETURNING id`,
    [tenantId, 9000 + Number(suffix), 'Nike Air Max 90', `NAM-${suffix}`, `BC-${suffix}`]
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
    email: `usman.${suffix}@shoepos.test`,
    name: 'Usman Cashier',
    role: 'ADMIN',
    status: 'APPROVED',
    tenantId,
  });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': String(tenantId),
  };

  const cashierToken = generateToken({
    id: cashierUserId,
    email: `cashier.${suffix}@shoepos.test`,
    name: 'Counter Cashier',
    role: 'CASHIER',
    status: 'APPROVED',
    tenantId,
  });
  const cashierHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cashierToken}`,
    'X-Tenant-Id': String(tenantId),
  };

  try {
    // 1. Retail Sale - Without Return (3 pairs)
    const saleRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 3, unitPrice: 2500, discount: 0 }],
        customerId,
        paymentMethod: 'CASH',
        paidAmount: 7500,
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleJson = await saleRes.json();
    const saleInv = saleJson.invoiceNumber;
    const origSaleId = saleJson.sale.id;

    await new Promise((r) => setTimeout(r, 40));

    const saleEvt = sseEvents.find((e) => e.data?.type === 'SALE' && e.data?.invoiceNumber === saleInv);
    assert.ok(saleEvt, 'Expected SSE SALE notification');
    assert.equal(saleEvt!.data.title, 'Sale Completed ✅');
    assert.equal(
      saleEvt!.data.message,
      `Invoice: #${saleInv}\n3 pairs sold to Tariq Footwear.\nPayment: Cash\nProcessed by: Usman Cashier`
    );

    // 2. Retail Sale - With Return against same invoice (1 pair returned) -> updates Sale Completed, NO Return Completed
    const saleItemsRows = await pgClient.query<{ id: number }>(
      'SELECT id FROM sale_items WHERE sale_id = $1 AND tenant_id = $2',
      [origSaleId, tenantId]
    );
    const saleItemId = saleItemsRows.rows[0].id;

    const beforeSameInvoiceReturn = sseEvents.length;
    const retSameRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        originalSaleId: origSaleId,
        reason: 'Size issue',
        items: [{ saleItemId, quantity: 1, unitRefundPrice: 2500 }],
      }),
    });
    assert.equal(retSameRes.status, 201);
    await new Promise((r) => setTimeout(r, 40));

    const sameInvEvents = sseEvents.slice(beforeSameInvoiceReturn);
    assert.equal(sameInvEvents.some((e) => e.data?.type === 'RETURN'), false);
    const consolidatedEvt = sameInvEvents.find(
      (e) => e.data?.type === 'SALE' && e.data?.invoiceNumber === saleInv
    );
    assert.ok(consolidatedEvt);
    assert.equal(consolidatedEvt!.data.title, 'Sale Completed ✅');
    assert.equal(
      consolidatedEvt!.data.message,
      `Invoice: #${saleInv}\nTotal Sold: 3 pairs\nReturned: 1 pair\nNet Sold: 2 pairs\nSold to: Tariq Footwear\nPayment: Cash\nProcessed by: Usman Cashier`
    );

    // 3. Independent Return Completed (no originalSaleId)
    const beforeIndepReturn = sseEvents.length;
    const indepRetRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reason: 'Independent return',
        customerName: 'Tariq Footwear',
        paymentMethod: 'CASH',
        items: [{ productId, quantity: 2, unitRefundPrice: 1550 }],
      }),
    });
    assert.equal(indepRetRes.status, 201);
    const indepRetJson = await indepRetRes.json();
    const indepRetNo = indepRetJson.returnNumber;

    await new Promise((r) => setTimeout(r, 40));

    const indepRetEvt = sseEvents.slice(beforeIndepReturn).find((e) => e.data?.type === 'RETURN');
    assert.ok(indepRetEvt, 'Expected SSE RETURN notification for independent return');
    assert.equal(indepRetEvt!.data.title, 'Return Completed ✅');
    assert.equal(
      indepRetEvt!.data.message,
      `Return #: #${indepRetNo}\n2 pairs returned by Tariq Footwear.\nRefund: Rs. 3,100 (Cash)\nProcessed by: Usman Cashier`
    );

    // 4. Exchange Completed (1 pair exchanged with Rs. 300 Additional Payment)
    const exchRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 1, unitPrice: 2800, discount: 0 }],
        customerId,
        paymentMethod: 'ONLINE',
        transactionId: `TXN-${suffix}`,
        paidAmount: 300,
        exchange: {
          originalSaleId: origSaleId,
          reason: 'Size swap',
          items: [{ saleItemId, quantity: 1, unitRefundPrice: 2500 }],
        },
      }),
    });
    assert.equal(exchRes.status, 201);
    const exchJson = await exchRes.json();
    const exchInv = exchJson.invoiceNumber;

    await new Promise((r) => setTimeout(r, 40));

    const exchEvt = sseEvents.find((e) => e.data?.type === 'EXCHANGE' && e.data?.invoiceNumber === exchInv);
    assert.ok(exchEvt, 'Expected SSE EXCHANGE notification');
    assert.equal(exchEvt!.data.title, 'Exchange Completed ✅');
    assert.ok(exchEvt!.data.message.includes('1 pair exchanged by Tariq Footwear.'));
    assert.ok(exchEvt!.data.message.includes('Additional Payment: Rs. 300 (Online)'));
    assert.ok(exchEvt!.data.message.includes('Processed by: Usman Cashier'));

    // 5. Purchase & Supplier Purchase Return must NOT generate any notification alerts
    const sseCountBeforeAdminOps = sseEvents.length;
    const purRes = await fetch(`${baseUrl}/api/purchases`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        supplierName: 'Metro Wholesalers',
        paymentMethod: 'CASH',
        paidAmount: 15000,
        unit: 'carton',
        items: [{ productId, quantity: 10, unitCost: 1500 }],
      }),
    });
    assert.equal(purRes.status, 201);
    const purJson = await purRes.json();
    const purNo = purJson.purchaseNumber;

    const purRetRes = await fetch(`${baseUrl}/api/purchase-returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        supplierName: 'Metro Wholesalers',
        purchaseId: purJson.purchaseId,
        reason: 'Defective sole',
        items: [{ productId, quantity: 1, unitCost: 1500 }],
      }),
    });
    assert.equal(purRetRes.status, 201);

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(
      sseEvents.slice(sseCountBeforeAdminOps).length,
      0,
      'Purchases and supplier purchase returns must emit ZERO SSE notifications'
    );

    // 5b. Cashier-created Independent Return & Exchange emit exact same notification message format as Owner-created
    const beforeCashierIndepRet = sseEvents.length;
    const cashierIndepRetRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        reason: 'Independent return',
        customerName: 'Tariq Footwear',
        paymentMethod: 'CASH',
        items: [{ productId, quantity: 2, unitRefundPrice: 1550 }],
      }),
    });
    assert.equal(cashierIndepRetRes.status, 201);
    const cashierIndepRetJson = await cashierIndepRetRes.json();
    const cashierIndepRetNo = cashierIndepRetJson.returnNumber;

    await new Promise((r) => setTimeout(r, 40));
    const cashierIndepRetEvt = sseEvents.slice(beforeCashierIndepRet).find((e) => e.data?.type === 'RETURN');
    assert.ok(cashierIndepRetEvt, 'Expected SSE RETURN notification when created by Cashier');
    assert.equal(cashierIndepRetEvt!.data.title, 'Return Completed ✅');
    assert.equal(
      cashierIndepRetEvt!.data.message,
      `Return #: #${cashierIndepRetNo}\n2 pairs returned by Tariq Footwear.\nRefund: Rs. 3,100 (Cash)\nProcessed by: Counter Cashier`
    );

    const cashierExchRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId, quantity: 1, unitPrice: 2800, discount: 0 }],
        customerId,
        paymentMethod: 'ONLINE',
        transactionId: `TXN-C-${suffix}`,
        paidAmount: 300,
        exchange: {
          originalSaleId: origSaleId,
          reason: 'Size swap',
          items: [{ saleItemId, quantity: 1, unitRefundPrice: 2500 }],
        },
      }),
    });
    assert.equal(cashierExchRes.status, 201);
    const cashierExchJson = await cashierExchRes.json();
    const cashierExchInv = cashierExchJson.invoiceNumber;

    await new Promise((r) => setTimeout(r, 40));
    const cashierExchEvt = sseEvents.find((e) => e.data?.type === 'EXCHANGE' && e.data?.invoiceNumber === cashierExchInv);
    assert.ok(cashierExchEvt, 'Expected SSE EXCHANGE notification when created by Cashier');
    assert.equal(cashierExchEvt!.data.title, 'Exchange Completed ✅');
    assert.ok(cashierExchEvt!.data.message.includes('1 pair exchanged by Tariq Footwear.'));
    assert.ok(cashierExchEvt!.data.message.includes('Additional Payment: Rs. 300 (Online)'));
    assert.ok(cashierExchEvt!.data.message.includes('Processed by: Counter Cashier'));

    // 6. Verify /grouped and /all for ADMIN include Sale (consolidated), Independent Return, Exchange, and ZERO Purchase alerts
    const groupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, { headers });
    assert.equal(groupedRes.status, 200);
    const groupedJson = await groupedRes.json();
    const groupedNotifs: any[] = groupedJson.notifications || [];

    const groupedSale = groupedNotifs.find((n) => n.type === 'SALE' && n.invoiceNumber === saleInv);
    const groupedSameInvRet = groupedNotifs.find((n) => n.type === 'RETURN' && n.invoiceNumber === saleInv);
    const groupedIndepRet = groupedNotifs.find((n) => n.type === 'RETURN' && n.returnNumber === indepRetNo);
    const groupedExch = groupedNotifs.find((n) => n.type === 'EXCHANGE' && n.invoiceNumber === exchInv);
    const groupedPur = groupedNotifs.find((n) => n.type === 'PURCHASE' || n.purchaseNumber === purNo);

    assert.ok(groupedSale);
    assert.equal(groupedSameInvRet, undefined, 'Same-invoice return must NOT generate Return Completed in /grouped');
    assert.ok(groupedIndepRet);
    assert.ok(groupedExch);
    assert.equal(groupedPur, undefined, 'Purchases must NEVER appear in /grouped');
    assert.equal(groupedSale.title, 'Sale Completed ✅');
    assert.equal(groupedSale.message.includes('Total Sold: 3 pairs\nReturned: 1 pair\nNet Sold: 2 pairs'), true);
    assert.equal(groupedIndepRet.title, 'Return Completed ✅');
    assert.equal(groupedExch.title, 'Exchange Completed ✅');

    // Verify CASHIER never receives PURCHASE notifications in /grouped or /all
    const cashierGroupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, { headers: cashierHeaders });
    assert.equal(cashierGroupedRes.status, 200);
    const cashierGrouped = await cashierGroupedRes.json();
    assert.equal((cashierGrouped.notifications || []).some((n: any) => n.type === 'PURCHASE'), false);

    const allRes = await fetch(`${baseUrl}/api/notifications/all?limit=20`, { headers });
    assert.equal(allRes.status, 200);
    const allJson = await allRes.json();
    const allItems: any[] = allJson.items || [];
    const allSale = allItems.find((n) => n.type === 'SALE' && n.invoiceNumber === saleInv);
    assert.ok(allSale);
    assert.equal(allSale.title, 'Sale Completed ✅');
    assert.equal(allSale.message.includes('Total Sold: 3 pairs\nReturned: 1 pair\nNet Sold: 2 pairs'), true);
    assert.equal(allItems.some((n) => n.type === 'PURCHASE' || n.purchaseNumber === purNo), false, 'Purchases must NEVER appear in /all');
  } finally {
    unregister();
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('All checkbox inputs and containers across POS UI use circular styling (border-radius: 50% and rounded-full)', () => {
  const indexCss = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8');
  assert.match(indexCss, /input\[type="checkbox"\][\s\S]*?border-radius:\s*50%\s*!important/);

  const componentsDir = path.join(process.cwd(), 'src', 'components');
  const tsxFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.tsx')) tsxFiles.push(fullPath);
    }
  };
  walk(componentsDir);

  const extractInputTags = (src: string): string[] => {
    const tags: string[] = [];
    let i = 0;
    while (i < src.length) {
      const start = src.indexOf('<input', i);
      if (start === -1) break;
      const nextChar = src[start + 6];
      if (nextChar && !/[\s/>]/.test(nextChar)) {
        i = start + 6;
        continue;
      }
      let pos = start + 6;
      let braceDepth = 0;
      let quote: '"' | "'" | '`' | null = null;
      while (pos < src.length) {
        const ch = src[pos];
        if (quote) {
          if (ch === '\\') {
            pos += 2;
            continue;
          }
          if (ch === quote) quote = null;
        } else {
          if (ch === '"' || ch === "'" || ch === '`') quote = ch;
          else if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
          else if (ch === '>' && braceDepth === 0) {
            tags.push(src.slice(start, pos + 1));
            pos++;
            break;
          }
        }
        pos++;
      }
      i = pos;
    }
    return tags;
  };

  let checkboxCount = 0;
  for (const file of tsxFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const tag of extractInputTags(content)) {
      if (!/type\s*=\s*["']checkbox["']/.test(tag)) continue;
      checkboxCount++;
      assert.equal(
        /\brounded-full\b/.test(tag),
        true,
        `Checkbox in ${path.relative(process.cwd(), file)} must include rounded-full: ${tag}`
      );
      assert.equal(
        /\brounded(?:-(?:sm|md|lg|xl))?\b(?!-full)/.test(tag),
        false,
        `Checkbox in ${path.relative(process.cwd(), file)} must not have square rounded classes: ${tag}`
      );
    }
  }
  assert.ok(checkboxCount >= 20, `Expected at least 20 checkbox inputs scanned, found ${checkboxCount}`);
});
