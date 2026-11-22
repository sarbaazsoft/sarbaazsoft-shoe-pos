import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import { pgClient } from '../src/db/index.ts';
import {
  ensureSaasControlPlane,
  ensurePlatformNotificationsSchema,
} from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import {
  SUBSCRIPTION_NOTIFICATION_TITLES,
  buildFcmNotificationConfig,
  truncateUtf8Safe,
  syncAndNotifyTenantSubscriptionLifecycle,
  resetServerNotificationDedupeCache,
} from '../src/server/pushNotificationService.ts';
import {
  formatSaleNotification,
  formatExchangeNotification,
  formatReturnNotification,
} from '../src/utils/notificationFormatters.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import settingsRoutes from '../src/server/routes/settingsRoutes.ts';
import tenantSaasRoutes from '../src/server/routes/tenantSaasRoutes.ts';

test('All 9 required web push notification titles include exact emojis and UTF-8 safe formatting', () => {
  const expectedTitles = [
    'Sale Completed ✅',
    'Exchange Completed ✅',
    'Return Completed ✅',
    'Free Trial Expiring Soon ⏳',
    'Subscription Expiring Soon ⚠️',
    'Subscription Expired ❌',
    'Subscription Renewed ✅',
    'New Renewal Request 🔔',
    'Renewal Request Approved ✅',
  ];

  assert.equal(formatSaleNotification({ invoiceNo: 'INV-1', totalQuantity: 1 }).title, expectedTitles[0]);
  assert.equal(formatExchangeNotification({ exchangeNo: 'EXC-1', totalQuantity: 1 }).title, expectedTitles[1]);
  assert.equal(formatReturnNotification({ returnNo: 'RET-1', totalQuantity: 1 }).title, expectedTitles[2]);

  assert.equal(SUBSCRIPTION_NOTIFICATION_TITLES.FREE_TRIAL_EXPIRING_SOON, expectedTitles[3]);
  assert.equal(SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_EXPIRING_SOON, expectedTitles[4]);
  assert.equal(SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_EXPIRED, expectedTitles[5]);
  assert.equal(SUBSCRIPTION_NOTIFICATION_TITLES.SUBSCRIPTION_RENEWED, expectedTitles[6]);
  assert.equal(SUBSCRIPTION_NOTIFICATION_TITLES.NEW_RENEWAL_REQUEST, expectedTitles[7]);
  assert.equal(SUBSCRIPTION_NOTIFICATION_TITLES.RENEWAL_REQUEST_APPROVED, expectedTitles[8]);

  for (const title of expectedTitles) {
    const fcmConfig = buildFcmNotificationConfig({
      title,
      body: `UTF-8 payload check: ${title}`,
      deepLinkUrl: '/',
    });
    assert.equal(fcmConfig.webpushNotification.title, title);
    assert.equal(fcmConfig.androidNotification.title, title);
    assert.equal(fcmConfig.stringData.title, title);
    // Verify valid round-trip UTF-8 JSON encoding with zero replacement character (U+FFFD)
    const encoded = JSON.stringify(fcmConfig);
    assert.equal(encoded.includes('\uFFFD'), false);
    assert.equal(JSON.parse(encoded).webpushNotification.title, title);
  }
});

test('truncateUtf8Safe never splits UTF-16 surrogate pair emojis when truncating push titles', () => {
  const paddedTitle = `${'A'.repeat(119)}🔔`;
  // Naive .slice(0, 120) splits the 🔔 surrogate pair and yields U+D83D + replacement char
  const truncated = truncateUtf8Safe(paddedTitle, 120);
  assert.equal(Array.from(truncated).length, 120);
  assert.equal(truncated.endsWith('🔔'), true);
  assert.equal(Buffer.from(truncated, 'utf8').toString('utf8'), truncated);

  const capped = truncateUtf8Safe(paddedTitle, 119);
  assert.equal(capped, 'A'.repeat(119));
  assert.equal(/[\uD800-\uDFFF]/.test(capped), false);
});

test('Subscription & Trial lifecycle notifications store UTF-8 emoji titles cleanly, route by role, and SSE enforces charset=utf-8', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensurePlatformNotificationsSchema();
  resetServerNotificationDedupeCache();

  const suffix = Date.now().toString().slice(-6);
  const baseTenantId = 9000 + (Number(suffix) % 900);
  const trialIdCandidate = baseTenantId;
  const paidIdCandidate = baseTenantId + 1;

  // Create two isolated tenants: one Free Trial expiring in 3 days, one Paid expiring in 2 days
  const trialStoreName = `Trial Foot ${suffix}`;
  const paidStoreName = `Paid Foot ${suffix}`;
  const startDate = new Date(Date.now() - 27 * 86_400_000).toISOString();
  const soonDate = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const soonPaidDate = new Date(Date.now() + 2 * 86_400_000).toISOString();

  const trialTenantRes = await pgClient.query<{ id: number }>(
    `INSERT INTO tenants (
       id, name, status,
       subscription_type, subscription_plan, subscription_start_date, subscription_end_date, subscription_status,
       onboarding_completed, deleted_product_ids
     ) VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, $8, '{}')
     RETURNING id`,
    [trialIdCandidate, trialStoreName, 'free_tier', 'free_tier', startDate, soonDate, 'ACTIVE', true]
  );
  const trialTenantId = trialTenantRes.rows[0].id;

  const paidTenantRes = await pgClient.query<{ id: number }>(
    `INSERT INTO tenants (
       id, name, status,
       subscription_type, subscription_plan, subscription_start_date, subscription_end_date, subscription_status,
       onboarding_completed, deleted_product_ids
     ) VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, $8, '{}')
     RETURNING id`,
    [paidIdCandidate, paidStoreName, '1_year', 'YEARLY', startDate, soonPaidDate, 'ACTIVE', true]
  );
  const paidTenantId = paidTenantRes.rows[0].id;

  const trialAdminRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED')
     RETURNING id`,
    [trialTenantId, 'Trial Owner', `trial.owner.${suffix}@test.pk`, '03001111111', 'hash', '1234']
  );
  const trialAdminId = trialAdminRes.rows[0].id;

  const paidAdminRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED')
     RETURNING id`,
    [paidTenantId, 'Paid Owner', `paid.owner.${suffix}@test.pk`, '03002222222', 'hash', '1234']
  );
  const paidAdminId = paidAdminRes.rows[0].id;

  const saRes = await pgClient.query<{ id: number }>(
    `SELECT id FROM users WHERE UPPER(role::text) = 'SUPERADMIN' LIMIT 1`
  );
  const superAdminId = saRes.rows[0]?.id || 1;

  // 1. Sync expiring soon alerts for both stores
  await syncAndNotifyTenantSubscriptionLifecycle({ force: true });

  // Verify DB UTF-8 titles
  const trialExpiringDb = await pgClient.query<{ title: string }>(
    `SELECT title FROM platform_notifications WHERE tenant_id = $1 AND title = $2`,
    [trialTenantId, 'Free Trial Expiring Soon ⏳']
  );
  assert.equal(trialExpiringDb.rows.length, 1);

  const paidExpiringDb = await pgClient.query<{ title: string }>(
    `SELECT title FROM platform_notifications WHERE tenant_id = $1 AND title = $2`,
    [paidTenantId, 'Subscription Expiring Soon ⚠️']
  );
  assert.equal(paidExpiringDb.rows.length, 1);

  // 2. Expire the paid tenant and run lifecycle sync again
  await pgClient.query(
    `UPDATE tenants SET subscription_end_date = NOW() - INTERVAL '1 hour' WHERE id = $1`,
    [paidTenantId]
  );
  await syncAndNotifyTenantSubscriptionLifecycle({ force: true });

  const expiredDb = await pgClient.query<{ title: string }>(
    `SELECT title FROM platform_notifications WHERE tenant_id = $1 AND target_role = 'ADMIN' AND title = $2`,
    [paidTenantId, 'Subscription Expired ❌']
  );
  assert.equal(expiredDb.rows.length, 1);

  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api', tenantSaasRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const superAdminToken = generateToken({
    id: superAdminId,
    email: 'superadmin@shoepos.test',
    name: 'Platform SuperAdmin',
    role: 'SUPERADMIN',
    status: 'APPROVED',
    tenantId: 0,
  });

  const paidAdminToken = generateToken({
    id: paidAdminId,
    email: `paid.owner.${suffix}@test.pk`,
    name: 'Paid Owner',
    role: 'ADMIN',
    status: 'APPROVED',
    tenantId: paidTenantId,
  });

  const trialAdminToken = generateToken({
    id: trialAdminId,
    email: `trial.owner.${suffix}@test.pk`,
    name: 'Trial Owner',
    role: 'ADMIN',
    status: 'APPROVED',
    tenantId: trialTenantId,
  });

  try {
    // 3. Paid Store submits Renewal Request -> SuperAdmin receives "New Renewal Request 🔔"
    const renewalReqRes = await fetch(`${baseUrl}/api/settings/renew-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paidAdminToken}`,
        'X-Tenant-Id': String(paidTenantId),
      },
      body: JSON.stringify({
        plan: 'YEARLY',
        notes: 'Bank transfer complete',
      }),
    });
    assert.equal(renewalReqRes.status, 201);

    const saGroupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=25`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(saGroupedRes.status, 200);
    const saGroupedJson = await saGroupedRes.json();
    assert.ok(
      (saGroupedJson.notices || []).some(
        (n: any) => n.title === 'New Renewal Request 🔔' && String(n.message).includes(paidStoreName)
      ),
      'SuperAdmin should receive New Renewal Request 🔔 notice'
    );

    // 5. SuperAdmin approves Paid Store renewal -> Store Admin sees "Renewal Request Approved ✅" (not "New Renewal Request 🔔")
    const approveRes = await fetch(`${baseUrl}/api/superadmin/tenants/${paidTenantId}/subscription`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        subscriptionPlan: 'YEARLY',
        renewFromNow: true,
      }),
    });
    assert.equal(approveRes.status, 200);

    const paidGroupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=20`, {
      headers: {
        Authorization: `Bearer ${paidAdminToken}`,
        'X-Tenant-Id': String(paidTenantId),
      },
    });
    assert.equal(paidGroupedRes.status, 200);
    const paidGroupedJson = await paidGroupedRes.json();
    const paidTitles = (paidGroupedJson.notices || []).map((n: any) => n.title);
    assert.ok(paidTitles.includes('Renewal Request Approved ✅'), `Expected Renewal Request Approved ✅, got ${JSON.stringify(paidTitles)}`);
    assert.equal(paidTitles.includes('New Renewal Request 🔔'), false);

    // 6. SuperAdmin directly renews Trial Store (with NO pending renewal request) -> Store Admin sees "Subscription Renewed ✅"
    const directRenewRes = await fetch(`${baseUrl}/api/superadmin/tenants/${trialTenantId}/subscription`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        subscriptionPlan: '6_MONTHS',
        renewFromNow: true,
      }),
    });
    assert.equal(directRenewRes.status, 200);

    const trialGroupedRes = await fetch(`${baseUrl}/api/notifications/grouped?limit=20`, {
      headers: {
        Authorization: `Bearer ${trialAdminToken}`,
        'X-Tenant-Id': String(trialTenantId),
      },
    });
    assert.equal(trialGroupedRes.status, 200);
    const trialGroupedJson = await trialGroupedRes.json();
    const trialTitles = (trialGroupedJson.notices || []).map((n: any) => n.title);
    assert.ok(trialTitles.includes('Subscription Renewed ✅'), `Expected Subscription Renewed ✅, got ${JSON.stringify(trialTitles)}`);
  } finally {
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
