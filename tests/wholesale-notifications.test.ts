import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import {
  formatSaleNotification,
  formatReturnNotification,
  formatExchangeNotification,
  formatSaleExchangeNotification,
  formatSaleReturnNotification,
} from '../src/utils/notificationFormatters.ts';
import { resolveNotificationActions } from '../src/utils/notificationActions.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import posRoutes from '../src/server/routes/posRoutes.ts';
import returnRoutes from '../src/server/routes/returnRoutes.ts';
import { pgClient } from '../src/db/index.ts';
import { ensureNotificationsSchema, ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import { registerSseClient, resetServerNotificationDedupeCache } from '../src/server/pushNotificationService.ts';

test('Wholesale notification formatters produce clean standard titles and accurate messages without Wholesale or B2B text', () => {
  const sale = formatSaleNotification({
    invoiceNo: 'WS-1025',
    totalAmount: 24000,
    paymentMethod: 'KHATA',
    totalQuantity: 12,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(sale.title, 'Sale Completed ✅');
  assert.equal(
    sale.message,
    '#WS-1025 · Rs. 24,000 (Khata)\n12 Pairs Sold · Al-Madina Footwear\nCashier: Hassan'
  );
  assert.doesNotMatch(`${sale.title} ${sale.message}`, /\b(wholesale|b2b)\b/i);

  const ret = formatReturnNotification({
    invoiceNo: 'WS-1025',
    amount: 6000,
    paymentMethod: 'CASH',
    totalQuantity: 3,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(ret.title, 'Return Completed 🔄');
  assert.equal(
    ret.message,
    '#WS-1025 · Refund: Rs. 6,000 (Cash)\n3 Pairs Returned · Al-Madina Footwear\nProcessed by: Hassan'
  );
  assert.doesNotMatch(`${ret.title} ${ret.message}`, /\b(wholesale|b2b)\b/i);

  const exch = formatExchangeNotification({
    invoiceNo: 'WS-1025',
    amount: 1500,
    paymentMethod: 'ONLINE',
    totalQuantity: 2,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(exch.title, 'Exchange Completed 🔄');
  assert.equal(
    exch.message,
    '#WS-1025 · Adjustment: Rs. 1,500 (Online)\n2 Pairs Exchanged · Al-Madina Footwear\nProcessed by: Hassan'
  );
  assert.doesNotMatch(`${exch.title} ${exch.message}`, /\b(wholesale|b2b)\b/i);

  const saleExchange = formatSaleExchangeNotification({
    invoiceNo: 'WS-1025',
    amount: 18000,
    paymentMethod: 'BANK_TRANSFER',
    soldQuantity: 12,
    exchangedQuantity: 4,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(saleExchange.title, 'Sale & Exchange Completed ✅');
  assert.equal(
    saleExchange.message,
    '#WS-1025 · Net: Rs. 18,000 (Bank Transfer)\n12 Pairs Sold, 4 Pairs Exchanged · Al-Madina Footwear\nCashier: Hassan'
  );
  assert.doesNotMatch(`${saleExchange.title} ${saleExchange.message}`, /\b(wholesale|b2b)\b/i);

  const saleReturn = formatSaleReturnNotification({
    invoiceNo: 'WS-1025',
    amount: 14000,
    paymentMethod: 'KHATA',
    soldQuantity: 12,
    returnedQuantity: 6,
    customerName: 'Al-Madina Footwear',
    cashierName: 'Hassan',
  });
  assert.equal(saleReturn.title, 'Sale & Return Completed ✅');
  assert.equal(
    saleReturn.message,
    '#WS-1025 · Net: Rs. 14,000 (Khata)\n12 Pairs Sold, 6 Pairs Returned · Al-Madina Footwear\nCashier: Hassan'
  );
  assert.doesNotMatch(`${saleReturn.title} ${saleReturn.message}`, /\b(wholesale|b2b)\b/i);

  const refundHeavySaleReturn = formatSaleReturnNotification({
    invoiceNo: 'WS-1026',
    amount: -4000,
    paymentMethod: 'CASH',
    soldQuantity: 1,
    returnedQuantity: 5,
    customerName: 'Bilal Traders',
    cashierName: 'Hassan',
  });
  assert.equal(refundHeavySaleReturn.title, 'Sale & Return Completed ✅');
  assert.equal(
    refundHeavySaleReturn.message,
    '#WS-1026 · Refund: Rs. 4,000 (Cash)\n1 Pair Sold, 5 Pairs Returned · Bilal Traders\nCashier: Hassan'
  );
});

test('All wholesale transaction notification types (SALE, RETURN, EXCHANGE, SALE_RETURN, SALE_EXCHANGE) resolve View Invoice | Open POS', () => {
  for (const type of ['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE'] as const) {
    const actions = resolveNotificationActions({ type, invoiceNumber: 'WS-1025' }, 'ADMIN');
    assert.deepEqual(actions, [
      { action: 'view_invoice', label: 'View Invoice', url: '/invoices/WS-1025' },
      { action: 'open_pos', label: 'Open POS', url: '/pos' },
    ]);
  }
});

test('Wholesale store auto-detection emits accurate, deduplicated notifications across Sale, Return, Exchange, Sale & Return, and Sale & Exchange', async () => {
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

  // Give dealer an opening Khata balance of Rs. 50,000 so we prove notifications use actual transaction totals
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
    ) VALUES ($1, $2, $3, 'Bata', 'Formal', $4, $5, '', '', 1000, 1500, 2000, 2000, 12, true, 240, 5, false, true)
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
    // 1. Standalone Sale: 12 pairs @ Rs. 2000 = Rs. 24,000 on Khata (customer already owes 50,000)
    const saleRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 12, unitPrice: 2000, discount: 0 }],
        customerId,
        paymentMethod: 'KHATA',
        paidAmount: 0,
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleJson = await saleRes.json();
    const saleInv = saleJson.invoiceNumber;
    const origSaleId = saleJson.sale.id;

    await new Promise((r) => setTimeout(r, 30));

    const saleEvt = sseEvents.find((e) => e.data?.invoiceNumber === saleInv);
    assert.ok(saleEvt, 'Expected SSE SALE notification');
    assert.equal(saleEvt!.data.type, 'SALE');
    assert.equal(saleEvt!.data.title, 'Sale Completed ✅');
    assert.equal(
      saleEvt!.data.message,
      `#${saleInv} · Rs. 24,000 (Khata)\n12 Pairs Sold · Madina Shoes Dealer\nCashier: Kamran Staff`
    );
    assert.doesNotMatch(`${saleEvt!.data.title} ${saleEvt!.data.message}`, /\b(wholesale|b2b)\b/i);

    // 2. Separate Return via POST /api/returns: 2 pairs returned @ Rs. 2000 = Rs. 4,000
    const siRows = await pgClient.query<{ id: number }>(
      'SELECT id FROM sale_items WHERE sale_id = $1 AND tenant_id = $2',
      [origSaleId, tenantId]
    );
    const saleItemId = siRows.rows[0].id;

    const retRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        originalSaleId: origSaleId,
        reason: 'Size defect',
        items: [{ saleItemId, quantity: 2, unitRefundPrice: 2000 }],
      }),
    });
    assert.equal(retRes.status, 201);
    await new Promise((r) => setTimeout(r, 30));

    const retEvt = sseEvents.find((e) => e.data?.type === 'RETURN' && e.data?.invoiceNumber === saleInv);
    assert.ok(retEvt, 'Expected SSE RETURN notification');
    assert.equal(retEvt!.data.title, 'Return Completed 🔄');
    assert.equal(
      retEvt!.data.message,
      `#${saleInv} · Refund: Rs. 4,000 (Khata)\n2 Pairs Returned · Madina Shoes Dealer\nProcessed by: Kamran Staff`
    );
    assert.doesNotMatch(`${retEvt!.data.title} ${retEvt!.data.message}`, /\b(wholesale|b2b)\b/i);

    // 3. Combined Sale & Return (direct return modal checkout: 12 sold @ 2000 - 6 returned @ 1500 = Net Rs. 15,000)
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
          reason: 'Defective Sole / Upper',
          items: [{ productId, quantity: 6, unitRefundPrice: 1500 }],
        },
      }),
    });
    assert.equal(saleRetRes.status, 201);
    const saleRetJson = await saleRetRes.json();
    const saleRetInv = saleRetJson.invoiceNumber;
    const saleRetReturnNumber = saleRetJson.returnNumber;

    await new Promise((r) => setTimeout(r, 30));

    const saleRetEvents = sseEvents.filter((e) => e.data?.invoiceNumber === saleRetInv);
    assert.equal(saleRetEvents.length, 1, 'Combined Sale & Return must emit exactly 1 SSE notification');
    assert.equal(saleRetEvents[0].data.type, 'SALE_RETURN');
    assert.equal(saleRetEvents[0].data.title, 'Sale & Return Completed ✅');
    assert.equal(
      saleRetEvents[0].data.message,
      `#${saleRetInv} · Net: Rs. 15,000 (Cash)\n12 Pairs Sold, 6 Pairs Returned · Madina Shoes Dealer\nCashier: Kamran Staff`
    );
    assert.doesNotMatch(`${saleRetEvents[0].data.title} ${saleRetEvents[0].data.message}`, /\b(wholesale|b2b)\b/i);

    // 4. Combined Sale & Exchange (12 sold @ 2000 - 4 exchanged @ 2000 = Net Rs. 16,000)
    const saleExchRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId, quantity: 12, unitPrice: 2000, discount: 0 }],
        customerId,
        paymentMethod: 'ONLINE',
        transactionId: `TXW-${suffix}`,
        paidAmount: 16000,
        exchange: {
          originalSaleId: origSaleId,
          mode: 'EXCHANGE',
          reason: 'Size replacement',
          items: [{ productId, quantity: 4, unitRefundPrice: 2000 }],
        },
      }),
    });
    assert.equal(saleExchRes.status, 201);
    const saleExchJson = await saleExchRes.json();
    const saleExchInv = saleExchJson.invoiceNumber;
    const saleExchReturnNumber = saleExchJson.returnNumber;

    await new Promise((r) => setTimeout(r, 30));

    const saleExchEvents = sseEvents.filter((e) => e.data?.invoiceNumber === saleExchInv);
    assert.equal(saleExchEvents.length, 1, 'Combined Sale & Exchange must emit exactly 1 SSE notification');
    assert.equal(saleExchEvents[0].data.type, 'SALE_EXCHANGE');
    assert.equal(saleExchEvents[0].data.title, 'Sale & Exchange Completed ✅');
    assert.equal(
      saleExchEvents[0].data.message,
      `#${saleExchInv} · Net: Rs. 16,000 (Online)\n12 Pairs Sold, 4 Pairs Exchanged · Madina Shoes Dealer\nCashier: Kamran Staff`
    );
    assert.doesNotMatch(`${saleExchEvents[0].data.title} ${saleExchEvents[0].data.message}`, /\b(wholesale|b2b)\b/i);

    // 5. Standalone Exchange (EXCHANGE_ONLY: 6 pairs @ 2000 swapped for 6 pairs @ 2200 = Adjustment Rs. 1,200)
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
    const exchOnlyReturnNumber = exchOnlyJson.returnNumber;

    await new Promise((r) => setTimeout(r, 30));

    const exchOnlyEvents = sseEvents.filter((e) => e.data?.invoiceNumber === exchOnlyInv);
    assert.equal(exchOnlyEvents.length, 1, 'Standalone Exchange must emit exactly 1 SSE notification');
    assert.equal(exchOnlyEvents[0].data.type, 'EXCHANGE');
    assert.equal(exchOnlyEvents[0].data.title, 'Exchange Completed 🔄');
    assert.equal(
      exchOnlyEvents[0].data.message,
      `#${exchOnlyInv} · Adjustment: Rs. 1,200 (Cash)\n6 Pairs Exchanged · Madina Shoes Dealer\nProcessed by: Kamran Staff`
    );

    // 6. Verify /grouped and /all return all 5 scenarios accurately with ZERO duplicates
    const groupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, { headers });
    assert.equal(groupedRes.status, 200);
    const groupedJson = await groupedRes.json();
    const groupedNotifs: any[] = groupedJson.notifications || [];

    // Expect strictly 5 notifications (1 Sale, 1 Return, 1 Sale & Return, 1 Sale & Exchange, 1 Exchange)
    assert.equal(groupedNotifs.length, 5, `Expected 5 deduplicated notifications, got ${groupedNotifs.length}`);
    assert.equal(groupedNotifs.some((n) => n.returnNumber === saleRetReturnNumber && n.type === 'RETURN'), false);
    assert.equal(groupedNotifs.some((n) => n.returnNumber === saleExchReturnNumber && n.type === 'RETURN'), false);
    assert.equal(groupedNotifs.some((n) => n.returnNumber === exchOnlyReturnNumber && n.type === 'RETURN'), false);

    const gSale = groupedNotifs.find((n) => n.invoiceNumber === saleInv && n.type === 'SALE');
    const gRet = groupedNotifs.find((n) => n.invoiceNumber === saleInv && n.type === 'RETURN');
    const gSaleRet = groupedNotifs.find((n) => n.invoiceNumber === saleRetInv);
    const gSaleExch = groupedNotifs.find((n) => n.invoiceNumber === saleExchInv);
    const gExch = groupedNotifs.find((n) => n.invoiceNumber === exchOnlyInv);

    assert.ok(gSale && gRet && gSaleRet && gSaleExch && gExch);
    assert.equal(gSale.title, 'Sale Completed ✅');
    assert.equal(gSale.message.includes('#WS') || gSale.message.includes(`#${saleInv} · Rs. 24,000`), true);
    assert.equal(gRet.title, 'Return Completed 🔄');
    assert.equal(gSaleRet.type, 'SALE_RETURN');
    assert.equal(gSaleRet.title, 'Sale & Return Completed ✅');
    assert.equal(gSaleRet.message.includes('12 Pairs Sold, 6 Pairs Returned'), true);
    assert.equal(gSaleExch.type, 'SALE_EXCHANGE');
    assert.equal(gSaleExch.title, 'Sale & Exchange Completed ✅');
    assert.equal(gSaleExch.message.includes('12 Pairs Sold, 4 Pairs Exchanged'), true);
    assert.equal(gExch.type, 'EXCHANGE');
    assert.equal(gExch.title, 'Exchange Completed 🔄');

    for (const item of groupedNotifs) {
      assert.doesNotMatch(`${item.title} ${item.message}`, /\b(wholesale|b2b)\b/i);
    }

    // Verify /all also has strictly 5 deduplicated operational notifications
    const allRes = await fetch(`${baseUrl}/api/notifications/all?limit=20&tab=operational`, { headers });
    assert.equal(allRes.status, 200);
    const allJson = await allRes.json();
    const allItems: any[] = allJson.items || [];
    assert.equal(allItems.length, 5, `Expected 5 deduplicated history items, got ${allItems.length}`);
  } finally {
    unregister();
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
