import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import http from 'node:http';

import { pgClient } from '../src/db/index.ts';
import { ensureNotificationsSchema, ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import returnRoutes from '../src/server/routes/returnRoutes.ts';
import {
  notifyPosAction,
  enrichPosPushNotificationPayload,
  registerSseClient,
  resetServerNotificationDedupeCache,
} from '../src/server/pushNotificationService.ts';
import { createDefaultNotificationPreferences } from '../src/utils/notificationPreferences.ts';

test('notifyPosAction guarantees total pairs, customer name, and cashier in Web Push body and FCM data even on sparse payloads', async () => {
  resetServerNotificationDedupeCache();
  const capturedPushes: Array<{ tokens: string[]; payload: any }> = [];
  const capturedEmails: Array<any> = [];
  const prefs = createDefaultNotificationPreferences();

  await notifyPosAction(
    1,
    {
      eventId: 'push-req-sparse-sale',
      type: 'SALE',
      title: 'Sale Completed ✅',
      message: 'Invoice #INV-9090',
      invoiceNumber: 'INV-9090',
      saleId: 9090,
      totalAmount: 5000,
      totalPairs: 3,
      deepLinkUrl: '/?tab=reports&viewInvoice=INV-9090',
      timestamp: '2026-11-22T10:00:00.000Z',
    },
    {
      getPreferencesFn: async () => prefs,
      isFirebaseReadyFn: async () => true,
      fetchFcmTokensFn: async () => [{ token: 'owner-token-1', user_role: 'ADMIN', user_id: 1 }],
      sendFcmPushToTokensFn: async (tokens, payload) => {
        capturedPushes.push({ tokens, payload });
        return { success: true, sentCount: tokens.length, failureCount: 0 };
      },
      dispatchPosEmailAlertFn: async (_tenantId, payload) => {
        capturedEmails.push(payload);
        return true;
      },
    }
  );

  assert.equal(capturedPushes.length, 1);
  const fcmPayload = capturedPushes[0].payload;
  assert.match(fcmPayload.body, /Total Pairs:\s*3 pairs/i);
  assert.match(fcmPayload.body, /Customer:\s*Walk-in Customer/i);
  assert.match(fcmPayload.body, /Processed by:\s*Counter Staff/i);
  assert.equal(fcmPayload.data.totalPairs, '3');
  assert.equal(fcmPayload.data.customerName, 'Walk-in Customer');
  assert.equal(fcmPayload.data.cashierName, 'Counter Staff');

  // When standard formatted body already includes pairs, customer, and cashier, body stays clean without duplication
  const alreadyComplete = enrichPosPushNotificationPayload({
    type: 'SALE',
    title: 'Sale Completed ✅',
    message: 'Invoice: #INV-9091\n4 pairs sold to Sara Khan.\nPayment: Cash\nProcessed by: Ali Cashier',
    invoiceNumber: 'INV-9091',
    totalPairs: 4,
    customerName: 'Sara Khan',
    cashierName: 'Ali Cashier',
    deepLinkUrl: '/?tab=reports&viewInvoice=INV-9091',
    timestamp: '2026-11-22T10:05:00.000Z',
  });
  assert.equal(
    alreadyComplete.message,
    'Invoice: #INV-9091\n4 pairs sold to Sara Khan.\nPayment: Cash\nProcessed by: Ali Cashier'
  );
  assert.equal(alreadyComplete.resolvedTotalPairs, 4);
  assert.equal(alreadyComplete.resolvedCustomerName, 'Sara Khan');
  assert.equal(alreadyComplete.resolvedCashierName, 'Ali Cashier');
});

test('Independent return without explicit customer name defaults to Walk-in Customer and emits pairs + cashier', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureNotificationsSchema();
  resetServerNotificationDedupeCache();

  const tenantId = 1;
  const suffix = Date.now().toString().slice(-6);

  const userRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, 'hash', '1234', 'ADMIN', 'APPROVED')
     RETURNING id`,
    [tenantId, 'Zeeshan Counter', `zeeshan.${suffix}@shoepos.test`, '+923001234500']
  );
  const adminUserId = userRes.rows[0].id;

  const prodRes = await pgClient.query<{ id: number }>(
    `INSERT INTO products (
      tenant_id, tenant_product_no, name, brand, category, article, barcode,
      primary_image_url, description, cost_price, min_price, max_price,
      pairs_per_carton, allow_half_carton, total_stock, low_stock_threshold, is_low_stock_alert_sent, active
    ) VALUES ($1, $2, 'Metro Sandal', 'Metro', 'Sandals', $3, $4, '', '', 900, 1200, 1500, 12, true, 50, 5, false, true)
    RETURNING id`,
    [tenantId, 9500 + Number(suffix), `MS-${suffix}`, `BCMS-${suffix}`]
  );
  const productId = prodRes.rows[0].id;

  const sseEvents: Array<any> = [];
  const unregister = registerSseClient(tenantId, adminUserId, 'ADMIN', {
    write: (chunk: string) => {
      for (const line of String(chunk).split('\n')) {
        if (line.startsWith('data:')) {
          try {
            sseEvents.push(JSON.parse(line.slice(5).trim()));
          } catch {}
        }
      }
      return true;
    },
  } as any);

  const app = express();
  app.use(express.json());
  app.use('/api/returns', returnRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const token = generateToken({
    id: adminUserId,
    email: `zeeshan.${suffix}@shoepos.test`,
    name: 'Zeeshan Counter',
    role: 'ADMIN',
    status: 'APPROVED',
    tenantId,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/returns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': String(tenantId),
      },
      body: JSON.stringify({
        reason: 'Walk-in return test',
        paymentMethod: 'CASH',
        items: [{ productId, quantity: 2, unitRefundPrice: 1200 }],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    await new Promise((r) => setTimeout(r, 40));

    const evt = sseEvents.find((e) => e?.returnNumber === body.returnNumber);
    assert.ok(evt, 'Expected independent return event');
    assert.equal(evt.totalPairs, 2);
    assert.equal(evt.customerName, 'Walk-in Customer');
    assert.equal(evt.cashierName, 'Zeeshan Counter');
    assert.match(evt.message, /2 pairs returned by Walk-in Customer\./);
    assert.match(evt.message, /Processed by:\s*Zeeshan Counter/);
  } finally {
    unregister();
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Service Worker and foreground FCM client enforce total pairs, customer name, and cashier fallbacks', () => {
  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const firebaseCfgSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'firebaseConfig.ts'), 'utf8');

  assert.match(swSrc, /function formatPosAlertBodyWithRequiredFields/);
  assert.match(swSrc, /Total Pairs:/);
  assert.match(swSrc, /Customer:/);
  assert.match(swSrc, /Processed by:/);

  assert.match(firebaseCfgSrc, /Total Pairs:/);
  assert.match(firebaseCfgSrc, /Customer:/);
  assert.match(firebaseCfgSrc, /Processed by:/);
  assert.match(firebaseCfgSrc, /totalPairs:/);
  assert.match(firebaseCfgSrc, /customerName:/);
  assert.match(firebaseCfgSrc, /cashierName:/);
});
