import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import http from 'node:http';

import {
  formatSaleNotification,
  formatReturnNotification,
  formatExchangeNotification,
  formatPairSummary,
  formatPaymentMethodLabel,
} from '../src/utils/notificationFormatters.ts';
import { resolveNotificationActions } from '../src/utils/notificationActions.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import posRoutes from '../src/server/routes/posRoutes.ts';
import returnRoutes from '../src/server/routes/returnRoutes.ts';
import { pgClient } from '../src/db/index.ts';
import { ensureNotificationsSchema, ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import { registerSseClient, resetServerNotificationDedupeCache } from '../src/server/pushNotificationService.ts';

test('formatPairSummary handles singular (1 Pair) and plural (N Pairs) accurately across Sale, Return, and Exchange', () => {
  assert.equal(formatPairSummary(1, 'Sold'), '1 Pair Sold');
  assert.equal(formatPairSummary(4, 'Sold'), '4 Pairs Sold');
  assert.equal(formatPairSummary(1, 'Returned'), '1 Pair Returned');
  assert.equal(formatPairSummary(3, 'Returned'), '3 Pairs Returned');
  assert.equal(formatPairSummary(1, 'Exchanged'), '1 Pair Exchanged');
  assert.equal(formatPairSummary(2, 'Exchanged'), '2 Pairs Exchanged');
  assert.equal(formatPairSummary(0, 'Sold'), '0 Pairs Sold');
});

test('formatSaleNotification, formatReturnNotification, and formatExchangeNotification match exact templates without header invoice duplication', () => {
  const sale = formatSaleNotification({
    invoiceNo: 'INV-000101',
    totalAmount: 4800,
    paymentMethod: 'CASH',
    totalQuantity: 4,
    customerName: 'Bilal Traders',
    cashierName: 'Ali',
  });
  assert.equal(sale.title, 'Sale Completed ✅');
  assert.equal(
    sale.message,
    '#INV-000101 · Rs. 4,800 (Cash)\n4 Pairs Sold · Bilal Traders\nCashier: Ali'
  );
  assert.equal(sale.title.includes('INV-000101'), false);

  const singlePairSale = formatSaleNotification({
    invoiceNo: '#INV-000102',
    totalAmount: 1500,
    paymentMethod: 'ONLINE',
    totalQuantity: 1,
    customerName: 'Walk-in Customer',
    cashierName: 'Sara',
  });
  assert.equal(singlePairSale.title, 'Sale Completed ✅');
  assert.equal(
    singlePairSale.message,
    '#INV-000102 · Rs. 1,500 (Online)\n1 Pair Sold · Walk-in Customer\nCashier: Sara'
  );

  const ret = formatReturnNotification({
    invoiceNo: 'INV-000101',
    amount: 1200,
    paymentMethod: 'CASH',
    totalQuantity: 1,
    customerName: 'Bilal Traders',
    cashierName: 'Ali',
  });
  assert.equal(ret.title, 'Return Completed 🔄');
  assert.equal(
    ret.message,
    '#INV-000101 · Refund: Rs. 1,200 (Cash)\n1 Pair Returned · Bilal Traders\nProcessed by: Ali'
  );
  assert.equal(ret.title.includes('INV-000101'), false);

  const exch = formatExchangeNotification({
    invoiceNo: 'INV-000105',
    amount: 600,
    paymentMethod: 'BANK_TRANSFER',
    totalQuantity: 2,
    customerName: 'Hamza Khan',
    cashierName: 'Zain',
  });
  assert.equal(exch.title, 'Exchange Completed 🔄');
  assert.equal(
    exch.message,
    '#INV-000105 · Adjustment: Rs. 600 (Bank Transfer)\n2 Pairs Exchanged · Hamza Khan\nProcessed by: Zain'
  );
  assert.equal(exch.title.includes('INV-000105'), false);

  assert.equal(formatPaymentMethodLabel('KHATA'), 'Khata');
  assert.equal(formatPaymentMethodLabel('SPLIT'), 'Split');
});

test('All POS transaction notifications (Sale, Return, Exchange) resolve View Invoice | Open POS actions', () => {
  for (const type of ['SALE', 'RETURN', 'EXCHANGE'] as const) {
    const actions = resolveNotificationActions({ type, invoiceNumber: 'INV-9001' }, 'ADMIN');
    assert.deepEqual(actions, [
      { action: 'view_invoice', label: 'View Invoice', url: '/invoices/INV-9001' },
      { action: 'open_pos', label: 'Open POS', url: '/pos' },
    ]);
  }
});

test('POST /api/pos/checkout (Sale & Exchange), POST /api/returns, GET /api/notifications/grouped & /all emit standardized templates', async () => {
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
    ) VALUES ($1, $2, $3, 'Nike', 'Sneakers', $4, $5, '', '', 1500, 2000, 2500, 2500, 12, true, 50, 5, false, true)
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

  try {
    // 1. Process a 3-pair Sale
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
      `#${saleInv} · Rs. 7,500 (Cash)\n3 Pairs Sold · Tariq Footwear\nCashier: Usman Cashier`
    );
    assert.equal(saleEvt!.data.message.includes(`NAM-${suffix}`), false);

    // 2. Process a 1-pair Return
    const saleItemsRows = await pgClient.query<{ id: number }>(
      'SELECT id FROM sale_items WHERE sale_id = $1 AND tenant_id = $2',
      [origSaleId, tenantId]
    );
    const saleItemId = saleItemsRows.rows[0].id;

    const retRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        originalSaleId: origSaleId,
        reason: 'Size issue',
        items: [{ saleItemId, quantity: 1, unitRefundPrice: 2500 }],
      }),
    });
    assert.equal(retRes.status, 201);
    await new Promise((r) => setTimeout(r, 40));

    const retEvt = sseEvents.find((e) => e.data?.type === 'RETURN' && e.data?.invoiceNumber === saleInv);
    assert.ok(retEvt, 'Expected SSE RETURN notification');
    assert.equal(retEvt!.data.title, 'Return Completed 🔄');
    assert.equal(
      retEvt!.data.message,
      `#${saleInv} · Refund: Rs. 2,500 (Cash)\n1 Pair Returned · Tariq Footwear\nProcessed by: Usman Cashier`
    );

    // 3. Process a 1-pair Exchange
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
    assert.equal(exchEvt!.data.title, 'Exchange Completed 🔄');
    assert.equal(
      exchEvt!.data.message,
      `#${exchInv} · Adjustment: Rs. 300 (Online)\n1 Pair Exchanged · Tariq Footwear\nProcessed by: Usman Cashier`
    );

    // 4. Verify /grouped and /all return the same standardized templates
    const groupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, { headers });
    assert.equal(groupedRes.status, 200);
    const groupedJson = await groupedRes.json();
    const groupedNotifs: any[] = groupedJson.notifications || [];

    const groupedSale = groupedNotifs.find((n) => n.type === 'SALE' && n.invoiceNumber === saleInv);
    const groupedExch = groupedNotifs.find((n) => n.type === 'EXCHANGE' && n.invoiceNumber === exchInv);
    const groupedRet = groupedNotifs.find((n) => n.type === 'RETURN' && n.invoiceNumber === saleInv);

    assert.ok(groupedSale && groupedExch && groupedRet);
    assert.equal(groupedSale.title, 'Sale Completed ✅');
    assert.equal(groupedExch.title, 'Exchange Completed 🔄');
    assert.equal(groupedRet.title, 'Return Completed 🔄');
    assert.equal(groupedSale.message.includes('3 Pairs Sold · Tariq Footwear'), true);
    assert.equal(groupedRet.message.includes('1 Pair Returned · Tariq Footwear'), true);
    assert.equal(groupedExch.message.includes('1 Pair Exchanged · Tariq Footwear'), true);

    const allRes = await fetch(`${baseUrl}/api/notifications/all?limit=20`, { headers });
    assert.equal(allRes.status, 200);
    const allJson = await allRes.json();
    const allItems: any[] = allJson.items || [];
    const allSale = allItems.find((n) => n.type === 'SALE' && n.invoiceNumber === saleInv);
    assert.ok(allSale);
    assert.equal(allSale.title, 'Sale Completed ✅');
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
