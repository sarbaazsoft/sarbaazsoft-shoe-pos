import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import { pgClient } from '../src/db/index.ts';
import { ensureNotificationsSchema, ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import posRoutes from '../src/server/routes/posRoutes.ts';
import purchaseRoutes from '../src/server/routes/purchaseRoutes.ts';
import productRoutes from '../src/server/routes/productRoutes.ts';
import inventoryRoutes from '../src/server/routes/inventoryRoutes.ts';
import returnRoutes from '../src/server/routes/returnRoutes.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import {
  registerSseClient,
  removeFcmToken,
  saveFcmToken,
} from '../src/server/pushNotificationService.ts';
import { updateAppSettings } from '../src/server/services/appSettingsService.ts';
import {
  dispatchBatchedLowStockNotifications,
  evaluateLowStockTransition,
  shouldResetLowStockAlert,
  type LowStockBatchItem,
} from '../src/server/services/lowStockNotificationService.ts';

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/pos', posRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/returns', returnRoutes);
  app.use('/api/notifications', notificationRoutes);
  return http.createServer(app);
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out after ${timeoutMs}ms waiting for async low-stock condition`);
}

test('Guard-clause unit checks: healthy stock skip, already alerted skip, threshold crossing, and restock reset', () => {
  const healthy = evaluateLowStockTransition({
    productId: 10,
    article: 'NK-100',
    name: 'Nike Air',
    barcode: '111000',
    updatedStock: 6,
    lowStockThreshold: 5,
    isLowStockAlertSent: false,
  });
  assert.equal(healthy.shouldAlert, false);
  if (!healthy.shouldAlert) {
    assert.equal(healthy.reason, 'HEALTHY_STOCK');
  }

  const alreadySent = evaluateLowStockTransition({
    productId: 10,
    article: 'NK-100',
    name: 'Nike Air',
    barcode: '111000',
    updatedStock: 3,
    lowStockThreshold: 5,
    isLowStockAlertSent: true,
  });
  assert.equal(alreadySent.shouldAlert, false);
  if (!alreadySent.shouldAlert) {
    assert.equal(alreadySent.reason, 'ALREADY_ALERTED');
  }

  const exactCrossing = evaluateLowStockTransition({
    productId: 10,
    article: 'NK-100',
    name: 'Nike Air',
    barcode: '111000',
    updatedStock: 5,
    lowStockThreshold: 5,
    isLowStockAlertSent: false,
  });
  assert.equal(exactCrossing.shouldAlert, true);
  if (exactCrossing.shouldAlert) {
    assert.equal(exactCrossing.item.sku, 'NK-100');
    assert.equal(exactCrossing.item.remainingStock, 5);
    assert.equal(exactCrossing.item.lowStockThreshold, 5);
  }

  assert.equal(shouldResetLowStockAlert(5, 5), false);
  assert.equal(shouldResetLowStockAlert(6, 5), true);
  assert.equal(shouldResetLowStockAlert(0, 0), false);
  assert.equal(shouldResetLowStockAlert(1, 0), true);
});

test('End-to-end POS checkout low-stock evaluation, zero duplicate spam, rollback safety, restock auto-reset, and visibility isolation', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureNotificationsSchema();

  const server = createTestServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const suffix = Date.now().toString().slice(-6);
  const cashierEmail = `cashier.lowstock.${suffix}@balochshoes.com`;
  const insertedCashier = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'CASHIER', 'APPROVED')
     RETURNING id`,
    [1, 'LowStock Cashier', cashierEmail, '+923009998877', 'hash', '1234']
  );
  const cashierId = insertedCashier.rows[0].id;

  const adminToken = generateToken({
    id: 2,
    tenantId: 1,
    name: 'Store Owner',
    email: 'admin@balochshoes.com',
    role: 'ADMIN',
    status: 'APPROVED',
  });
  const cashierToken = generateToken({
    id: cashierId,
    tenantId: 1,
    name: 'LowStock Cashier',
    email: cashierEmail,
    role: 'CASHIER',
    status: 'APPROVED',
  });
  const superAdminToken = generateToken({
    id: 1,
    tenantId: 0,
    name: 'Super Admin',
    email: 'superadmin@sarbaazsoft.com',
    role: 'SUPERADMIN',
    status: 'APPROVED',
  });

  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
    'X-Tenant-Id': '1',
  };
  const cashierHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cashierToken}`,
    'X-Tenant-Id': '1',
  };
  const superAdminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superAdminToken}`,
  };

  const createdProductIds: number[] = [];

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    await pgClient.query('DELETE FROM public.notifications WHERE tenant_id = $1', [1]);

    const createProduct = async (payload: {
      article: string;
      barcode: string;
      totalStock: number;
      lowStockThreshold: number;
    }) => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          article: payload.article,
          name: payload.article,
          barcode: payload.barcode,
          brand: 'Bata',
          category: 'Men',
          costPrice: 1000,
          maxPrice: 2000,
          totalStock: payload.totalStock,
          lowStockThreshold: payload.lowStockThreshold,
        }),
      });
      assert.equal(res.status, 201);
      const data = (await res.json()) as { productId: number };
      createdProductIds.push(data.productId);
      return data.productId;
    };

    // P1: Healthy even after sale (10 -> 8 > 5)
    const p1Id = await createProduct({
      article: `LS-H-${suffix}`,
      barcode: `88101${suffix.slice(-4)}`,
      totalStock: 10,
      lowStockThreshold: 5,
    });
    // P2: Crosses threshold (8 -> 5 <= 5)
    const p2Id = await createProduct({
      article: `LS-C1-${suffix}`,
      barcode: `88102${suffix.slice(-4)}`,
      totalStock: 8,
      lowStockThreshold: 5,
    });
    // P3: Crosses threshold (4 -> 2 <= 4)
    const p3Id = await createProduct({
      article: `LS-C2-${suffix}`,
      barcode: `88103${suffix.slice(-4)}`,
      totalStock: 4,
      lowStockThreshold: 4,
    });
    // P4: Already below threshold and already alerted (Guard 2 must skip)
    const p4Id = await createProduct({
      article: `LS-AA-${suffix}`,
      barcode: `88104${suffix.slice(-4)}`,
      totalStock: 3,
      lowStockThreshold: 5,
    });
    await pgClient.query('UPDATE products SET is_low_stock_alert_sent = true WHERE id = $1 AND tenant_id = $2', [
      p4Id,
      1,
    ]);

    // 1. Transaction Rollback Test: P2 crosses threshold first, then insufficient stock on P1 forces rollback
    const failCheckoutRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [
          { productId: p2Id, quantity: 3, unitPrice: 2000, discount: 0 },
          { productId: p1Id, quantity: 999, unitPrice: 2000, discount: 0 },
        ],
        paymentMethod: 'CASH',
        paidAmount: 2004000,
      }),
    });
    assert.equal(failCheckoutRes.status, 400);

    // Wait briefly to confirm NO async notification leaked on rollback
    await new Promise((resolve) => setTimeout(resolve, 60));
    const afterRollbackNotifs = await pgClient.query('SELECT * FROM public.notifications WHERE tenant_id = $1', [1]);
    assert.equal(afterRollbackNotifs.rows.length, 0);

    // Restore P2 stock/flag explicitly for mockStore (non-ACID array mock)
    await pgClient.query('UPDATE products SET total_stock = 8, is_low_stock_alert_sent = false WHERE id = $1 AND tenant_id = $2', [
      p2Id,
      1,
    ]);

    // 2. Valid Multi-Item Checkout: P1 stays healthy, P2 & P3 cross threshold, P4 already alerted
    const saleRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [
          { productId: p1Id, quantity: 2, unitPrice: 2000, discount: 0 }, // 10 -> 8 (healthy)
          { productId: p2Id, quantity: 3, unitPrice: 2000, discount: 0 }, // 8 -> 5 (crossed!)
          { productId: p3Id, quantity: 2, unitPrice: 2000, discount: 0 }, // 4 -> 2 (crossed!)
          { productId: p4Id, quantity: 1, unitPrice: 2000, discount: 0 }, // 3 -> 2 (already alerted!)
        ],
        paymentMethod: 'CASH',
        paidAmount: 16000,
      }),
    });
    assert.equal(saleRes.status, 201);
    const saleBody = (await saleRes.json()) as { invoiceNumber: string; sale: { id: number } };

    // Verify atomic flags updated inside checkout transaction
    const flagsRes = await pgClient.query<{ id: number; total_stock: number; is_low_stock_alert_sent: boolean }>(
      'SELECT id, total_stock, is_low_stock_alert_sent FROM products WHERE tenant_id = $1',
      [1]
    );
    const byId = new Map(flagsRes.rows.map((r) => [Number(r.id), r]));
    assert.equal(byId.get(p1Id)?.is_low_stock_alert_sent, false);
    assert.equal(byId.get(p2Id)?.is_low_stock_alert_sent, true);
    assert.equal(byId.get(p3Id)?.is_low_stock_alert_sent, true);
    assert.equal(byId.get(p4Id)?.is_low_stock_alert_sent, true);

    // Wait for non-blocking post-commit async dispatcher
    await waitForCondition(async () => {
      const nRes = await pgClient.query('SELECT * FROM public.notifications WHERE tenant_id = $1', [1]);
      return nRes.rows.length === 1;
    });

    const notifRows = await pgClient.query<any>('SELECT * FROM public.notifications WHERE tenant_id = $1', [1]);
    assert.equal(notifRows.rows.length, 1);
    const consolidated = notifRows.rows[0];
    assert.equal(consolidated.invoice_number, saleBody.invoiceNumber);
    assert.equal(consolidated.action_url, '/?tab=inventory&lowStockOnly=true');
    assert.equal(consolidated.target_role, 'ADMIN');
    const notifItems = Array.isArray(consolidated.items_json) ? consolidated.items_json : [];
    assert.equal(notifItems.length, 2);
    assert.deepEqual(
      notifItems.map((x: LowStockBatchItem) => x.productId).sort((a: number, b: number) => a - b),
      [p2Id, p3Id].sort((a, b) => a - b)
    );

    // 3. Subsequent Sale on P2 while already alerted -> Guard 2 skips cleanly, zero duplicate notifications
    const repeatSaleRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: p2Id, quantity: 1, unitPrice: 2000, discount: 0 }], // 5 -> 4
        paymentMethod: 'CASH',
        paidAmount: 2000,
      }),
    });
    assert.equal(repeatSaleRes.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const afterRepeat = await pgClient.query('SELECT * FROM public.notifications WHERE tenant_id = $1', [1]);
    assert.equal(afterRepeat.rows.length, 1, 'Repeated sale below threshold must not duplicate low-stock alerts');

    // 4. Visibility & Dismissal via notificationRoutes
    const groupedAdminRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, {
      headers: adminHeaders,
    });
    assert.equal(groupedAdminRes.status, 200);
    const groupedAdmin = (await groupedAdminRes.json()) as { notifications: any[] };
    const lowStockNotif = groupedAdmin.notifications.find((n) => n.id === `notif-${consolidated.id}`);
    assert.ok(lowStockNotif, 'Store ADMIN must see consolidated low-stock notification');
    assert.equal(lowStockNotif.itemType, 'LOW_STOCK');
    assert.equal(lowStockNotif.actionUrl, '/?tab=inventory&lowStockOnly=true');

    // Cashiers must NEVER see low-stock alerts
    const groupedCashierRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, {
      headers: cashierHeaders,
    });
    const groupedCashier = (await groupedCashierRes.json()) as { notifications: any[] };
    assert.equal(
      groupedCashier.notifications.some((n) => n.itemType === 'LOW_STOCK'),
      false,
      'Cashiers must not receive low-stock alerts'
    );

    // SuperAdmin must NEVER see store low-stock alerts
    const groupedSaRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, {
      headers: superAdminHeaders,
    });
    const groupedSa = (await groupedSaRes.json()) as { notifications: any[] };
    assert.equal(groupedSa.notifications.some((n) => n.itemType === 'LOW_STOCK'), false);

    // Dismiss low-stock notification
    const dismissRes = await fetch(`${baseUrl}/api/notifications/${lowStockNotif.id}/dismiss`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ itemType: 'LOW_STOCK' }),
    });
    assert.equal(dismissRes.status, 200);

    const groupedAfterDismiss = (await (
      await fetch(`${baseUrl}/api/notifications/grouped?limit=10`, { headers: adminHeaders })
    ).json()) as { notifications: any[] };
    assert.equal(
      groupedAfterDismiss.notifications.some((n) => n.id === lowStockNotif.id),
      false,
      'Dismissed low-stock alert must leave active grouped dropdown'
    );

    // 5. Partial Restock keeps is_low_stock_alert_sent = true (P2 is at 4, threshold 5 -> adjust to 5)
    const partialAdjRes = await fetch(`${baseUrl}/api/inventory/adjust`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        productId: p2Id,
        newStock: 5,
        notes: 'Partial recount still at threshold',
      }),
    });
    assert.equal(partialAdjRes.status, 200);
    const p2AfterPartial = await pgClient.query<{ is_low_stock_alert_sent: boolean }>(
      'SELECT is_low_stock_alert_sent FROM products WHERE id = $1 AND tenant_id = $2',
      [p2Id, 1]
    );
    assert.equal(p2AfterPartial.rows[0].is_low_stock_alert_sent, true);

    // 6a. Full Replenishment via Purchase Order resets P2 is_low_stock_alert_sent = false
    const purRes = await fetch(`${baseUrl}/api/purchases`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        supplierName: 'Test Shoe Supplier',
        items: [{ productId: p2Id, quantity: 7, unitPurchasePrice: 1000 }], // 5 + 7 = 12 > 5
        paidAmount: 7000,
      }),
    });
    assert.equal(purRes.status, 201);

    // 6b. Full Replenishment via Inventory Adjust resets P3 is_low_stock_alert_sent = false
    const fullAdjRes = await fetch(`${baseUrl}/api/inventory/adjust`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        productId: p3Id,
        newStock: 10, // > 4
        notes: 'Warehouse transfer restock',
      }),
    });
    assert.equal(fullAdjRes.status, 200);

    // 6c. Full Replenishment via Product PUT resets P4 is_low_stock_alert_sent = false
    const putProdRes = await fetch(`${baseUrl}/api/products/${p4Id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        totalStock: 10, // > 5
      }),
    });
    assert.equal(putProdRes.status, 200);

    const postRestockRes = await pgClient.query<{ id: number; is_low_stock_alert_sent: boolean }>(
      'SELECT id, is_low_stock_alert_sent FROM products WHERE tenant_id = $1',
      [1]
    );
    const postRestockMap = new Map(postRestockRes.rows.map((r) => [Number(r.id), r.is_low_stock_alert_sent]));
    assert.equal(postRestockMap.get(p2Id), false, 'Purchase restock > threshold must reset flag');
    assert.equal(postRestockMap.get(p3Id), false, 'Inventory adjust > threshold must reset flag');
    assert.equal(postRestockMap.get(p4Id), false, 'Product PUT > threshold must reset flag');

    // 7. Re-crossing threshold after restock fires a fresh alert!
    const reCrossRes = await fetch(`${baseUrl}/api/pos/checkout`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        items: [{ productId: p2Id, quantity: 9, unitPrice: 2000, discount: 0 }], // 12 -> 3 <= 5
        paymentMethod: 'CASH',
        paidAmount: 18000,
      }),
    });
    assert.equal(reCrossRes.status, 201);
    const reCrossBody = (await reCrossRes.json()) as {
      sale: {
        id: number;
        items: Array<{ id: number; product_id: number }>;
      };
    };

    await waitForCondition(async () => {
      const nRes = await pgClient.query('SELECT * FROM public.notifications WHERE tenant_id = $1', [1]);
      return nRes.rows.length === 2;
    });

    // 8. Return Restock auto-reset test: returning 3 units of P2 (3 -> 6 > 5) resets flag to false!
    const reCrossSaleItem = reCrossBody.sale.items.find((si) => Number(si.product_id) === p2Id);
    assert.ok(reCrossSaleItem, 'Expected P2 sale_item in checkout response');

    const returnRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({
        originalSaleId: reCrossBody.sale.id,
        reason: 'Wrong size',
        items: [
          {
            saleItemId: reCrossSaleItem.id,
            productId: p2Id,
            quantity: 3,
            unitRefundPrice: 2000,
          },
        ],
      }),
    });
    assert.equal(returnRes.status, 201);
    const p2AfterReturn = await pgClient.query<{ total_stock: number; is_low_stock_alert_sent: boolean }>(
      'SELECT total_stock, is_low_stock_alert_sent FROM products WHERE id = $1 AND tenant_id = $2',
      [p2Id, 1]
    );
    assert.equal(p2AfterReturn.rows[0].total_stock, 6);
    assert.equal(p2AfterReturn.rows[0].is_low_stock_alert_sent, false, 'Return restock > threshold must reset flag');
  } finally {
    await pgClient.query('DELETE FROM users WHERE id = $1', [cashierId]).catch(() => {});
    for (const pid of createdProductIds) {
      await pgClient.query('DELETE FROM products WHERE id = $1', [pid]).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Multi-channel batched dispatcher: 1 email + 1 FCM push to ADMINs only, configurable toggles, and strict error isolation', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureNotificationsSchema();

  await pgClient.query('DELETE FROM public.notifications WHERE tenant_id = $1', [1]);
  await saveFcmToken(1, 2, 'ADMIN', 'admin-tok-lowstock-1', 'Chrome', 'Owner Phone');
  await saveFcmToken(1, 99, 'CASHIER', 'cashier-tok-lowstock-1', 'Chrome', 'Counter POS');

  const adminSse: string[] = [];
  const cashierSse: string[] = [];
  const unregisterAdmin = registerSseClient(1, 2, 'ADMIN', {
    write: (chunk: string) => {
      adminSse.push(chunk);
      return true;
    },
  } as any);
  const unregisterCashier = registerSseClient(1, 99, 'CASHIER', {
    write: (chunk: string) => {
      cashierSse.push(chunk);
      return true;
    },
  } as any);

  const emailCalls: Array<{ to: string | string[]; subject: string; html: string }> = [];
  const fcmCalls: Array<{ tokens: string[]; tag?: string; deepLinkUrl?: string; title: string }> = [];

  try {
    await updateAppSettings(
      {
        LOW_STOCK_EMAIL_ALERTS_ENABLED: 'true',
        LOW_STOCK_PUSH_ALERTS_ENABLED: 'true',
      },
      'SUPERADMIN'
    );

    const batchItems: LowStockBatchItem[] = [
      {
        productId: 501,
        sku: 'ART-501',
        article: 'ART-501',
        name: 'Classic Loafer',
        remainingStock: 4,
        lowStockThreshold: 5,
      },
      {
        productId: 502,
        sku: 'ART-502',
        article: 'ART-502',
        name: 'Sport Sneaker',
        remainingStock: 0,
        lowStockThreshold: 3,
      },
    ];

    const res1 = await dispatchBatchedLowStockNotifications(
      {
        tenantId: 1,
        saleId: 777,
        invoiceNumber: 'INV-000777',
        cashierName: 'Ali Cashier',
        items: batchItems,
      },
      {
        sendEmailFn: async (opts) => {
          emailCalls.push({ to: opts.to, subject: opts.subject, html: opts.html });
          return { delivered: true, provider: 'resend', messageId: 'msg-777' };
        },
        sendFcmPushToTokensFn: async (tokens, payload) => {
          fcmCalls.push({
            tokens,
            tag: payload.tag,
            deepLinkUrl: payload.deepLinkUrl,
            title: payload.title,
          });
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
      }
    );

    assert.equal(res1.triggered, true);
    assert.equal(res1.itemCount, 2);
    assert.equal(res1.inAppCreated, true);
    assert.equal(res1.emailSent, true);
    assert.equal(res1.pushSent, true);
    assert.equal(res1.errors.length, 0);

    // Verify consolidated single email contains both items & direct restock link
    assert.equal(emailCalls.length, 1);
    assert.ok(emailCalls[0].html.includes('ART-501'));
    assert.ok(emailCalls[0].html.includes('ART-502'));
    assert.ok(
      emailCalls[0].html.includes('/?tab=inventory&amp;lowStockOnly=true') ||
        emailCalls[0].html.includes('/?tab=inventory&lowStockOnly=true')
    );

    // Verify consolidated single FCM push targets ADMIN token ONLY (not cashier)
    assert.equal(fcmCalls.length, 1);
    assert.ok(fcmCalls[0].tokens.includes('admin-tok-lowstock-1'));
    assert.equal(fcmCalls[0].tokens.includes('cashier-tok-lowstock-1'), false);
    assert.equal(fcmCalls[0].deepLinkUrl, '/?tab=inventory&lowStockOnly=true');
    assert.equal(fcmCalls[0].tag, 'pos-low-stock-1-sale-777');

    // Verify SSE event delivered to ADMIN only
    assert.equal(adminSse.length, 1);
    assert.equal(cashierSse.length, 0);
    assert.ok(adminSse[0].includes('"type":"STOCK"'));

    // Verify Error Isolation: throwing email & throwing FCM must NOT crash or prevent in-app notification
    const resIsolated = await dispatchBatchedLowStockNotifications(
      {
        tenantId: 1,
        saleId: 778,
        invoiceNumber: 'INV-000778',
        items: [batchItems[0]],
      },
      {
        sendEmailFn: async () => {
          throw new Error('SMTP connection timeout');
        },
        sendFcmPushToTokensFn: async () => {
          throw new Error('FCM quota exceeded');
        },
      }
    );

    assert.equal(resIsolated.triggered, true);
    assert.equal(resIsolated.inAppCreated, true);
    assert.equal(resIsolated.emailSent, false);
    assert.equal(resIsolated.pushSent, false);
    assert.equal(resIsolated.errors.length, 2);

    // Verify Configurable Channel Toggles
    await updateAppSettings(
      {
        LOW_STOCK_EMAIL_ALERTS_ENABLED: 'false',
        LOW_STOCK_PUSH_ALERTS_ENABLED: 'false',
      },
      'SUPERADMIN'
    );

    const resDisabled = await dispatchBatchedLowStockNotifications(
      {
        tenantId: 1,
        saleId: 779,
        invoiceNumber: 'INV-000779',
        items: [batchItems[1]],
      },
      {
        sendEmailFn: async (opts) => {
          emailCalls.push({ to: opts.to, subject: opts.subject, html: opts.html });
          return { delivered: true, provider: 'resend' };
        },
        sendFcmPushToTokensFn: async (tokens, payload) => {
          fcmCalls.push({ tokens, title: payload.title });
          return { success: true, sentCount: 1, failureCount: 0 };
        },
      }
    );

    assert.equal(resDisabled.inAppCreated, true);
    assert.equal(resDisabled.emailSent, false);
    assert.equal(resDisabled.pushSent, false);
    assert.equal(emailCalls.length, 1);
    assert.equal(fcmCalls.length, 1);
  } finally {
    await updateAppSettings(
      {
        LOW_STOCK_EMAIL_ALERTS_ENABLED: 'true',
        LOW_STOCK_PUSH_ALERTS_ENABLED: 'true',
      },
      'SUPERADMIN'
    );
    unregisterAdmin();
    unregisterCashier();
    await removeFcmToken('admin-tok-lowstock-1').catch(() => {});
    await removeFcmToken('cashier-tok-lowstock-1').catch(() => {});
  }
});
