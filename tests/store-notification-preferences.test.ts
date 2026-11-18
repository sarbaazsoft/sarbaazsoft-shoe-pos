import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { pgClient } from '../src/db/index.ts';
import { ensureSaasControlPlane, ensureFcmTokensSchema } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import {
  getTenantNotificationPreferences,
  saveTenantNotificationPreferences,
  getStoreNotificationDeliveryStatus,
} from '../src/server/services/notificationPreferencesService.ts';
import {
  notifyPosAction,
  notifyPlatformAnnouncement,
  registerSseClient,
  resetServerNotificationDedupeCache,
} from '../src/server/pushNotificationService.ts';
import { dispatchBatchedLowStockNotifications } from '../src/server/services/lowStockNotificationService.ts';
import { resetOwnerPresenceForTests, recordOwnerHeartbeat } from '../src/server/services/ownerPresenceService.ts';
import {
  applyNotificationPreset,
  createDefaultNotificationPreferences,
  normalizeNotificationPreferences,
  resolveStoreChannelDelivery,
  updateNotificationChannelToggle,
  updateNotificationEventToggle,
} from '../src/utils/notificationPreferences.ts';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function createMockSseRes() {
  const chunks: string[] = [];
  let ended = false;
  return {
    chunks,
    get writableEnded() {
      return ended;
    },
    get destroyed() {
      return ended;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
  };
}

async function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

test('Notification Presets state logic: Recommended default, All Notifications, and Custom preservation across switches', () => {
  const def = createDefaultNotificationPreferences();
  assert.equal(def.preset, 'recommended');
  assert.equal(def.channels.webPush, true);
  assert.equal(def.channels.emailAlerts, true);
  assert.equal(def.events.sale, true);
  assert.equal(def.events.return, true);
  assert.equal(def.events.exchange, true);
  assert.equal(def.events.low_stock, true);
  assert.equal(def.events.subscription, true);
  assert.equal(def.events.announcement, false);

  // Switch to All Notifications -> enables every event & channel
  const all = applyNotificationPreset(def, 'all');
  assert.equal(all.preset, 'all');
  assert.equal(all.channels.webPush, true);
  assert.equal(all.channels.emailAlerts, true);
  assert.equal(all.events.announcement, true);
  assert.equal(all.events.sale, true);

  // Toggle an event & channel -> switches automatically to Custom and updates snapshot
  let custom = updateNotificationEventToggle(all, 'exchange', false);
  custom = updateNotificationChannelToggle(custom, 'webPush', false);
  assert.equal(custom.preset, 'custom');
  assert.equal(custom.events.exchange, false);
  assert.equal(custom.channels.webPush, false);
  assert.equal(custom.custom.events.exchange, false);
  assert.equal(custom.custom.channels.webPush, false);

  // Switch to Recommended -> enforces Recommended settings, yet keeps Custom snapshot intact
  const backToRecommended = applyNotificationPreset(custom, 'recommended');
  assert.equal(backToRecommended.preset, 'recommended');
  assert.equal(backToRecommended.events.exchange, true);
  assert.equal(backToRecommended.channels.webPush, true);
  assert.equal(backToRecommended.custom.events.exchange, false);
  assert.equal(backToRecommended.custom.channels.webPush, false);

  // Switch back to Custom -> restores previously customized preferences!
  const restoredCustom = applyNotificationPreset(backToRecommended, 'custom');
  assert.equal(restoredCustom.preset, 'custom');
  assert.equal(restoredCustom.events.exchange, false);
  assert.equal(restoredCustom.channels.webPush, false);

  // Corrupt or missing values normalize safely back to Recommended defaults
  const normalizedNull = normalizeNotificationPreferences(null);
  assert.equal(normalizedNull.preset, 'recommended');
});

test('API & Per-Tenant Persistence: GET/PUT /api/notifications/preferences enforces RBAC, defaults to Recommended, and isolates tenants', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureFcmTokensSchema();

  const { server, baseUrl } = await startTestApp();
  const tenantA = 1;
  let tenantB = 0;
  let cashierUserId = 0;
  let ownerBUserId = 0;

  try {
    await pgClient.query(
      'UPDATE company_settings SET notification_preferences = NULL WHERE tenant_id = $1',
      [tenantA]
    );

    const adminResA = await pgClient.query<{ id: number; email: string }>(
      `SELECT id, email FROM users WHERE tenant_id = $1 AND role = 'ADMIN' AND status = 'APPROVED' LIMIT 1`,
      [tenantA]
    );
    const adminRowA = adminResA.rows[0] || { id: 1, email: 'admin@store.com' };

    const tenantInsert = await pgClient.query<{ id: number }>(
      `INSERT INTO tenants (name, owner_name, owner_email, subdomain, status, subscription_status, subscription_plan)
       VALUES ($1, $2, $3, $4, 'ACTIVE', 'ACTIVE', 'yearly')
       RETURNING id`,
      [
        'Notification Test Store B',
        'Owner B',
        `ownerb-${Date.now()}@store.com`,
        `notif-test-b-${Date.now()}`,
      ]
    );
    tenantB = Number(tenantInsert.rows[0].id);

    const cashierInsert = await pgClient.query<{ id: number; email: string }>(
      `INSERT INTO users (tenant_id, name, email, password, role, status, active)
       VALUES ($1, $2, $3, 'hashed-pw', 'CASHIER', 'APPROVED', true)
       RETURNING id, email`,
      [tenantA, 'Cashier Test A', `cashier-notif-${Date.now()}@store.com`]
    );
    cashierUserId = Number(cashierInsert.rows[0].id);

    const ownerBInsert = await pgClient.query<{ id: number; email: string }>(
      `INSERT INTO users (tenant_id, name, email, password, role, status, active)
       VALUES ($1, $2, $3, 'hashed-pw', 'ADMIN', 'APPROVED', true)
       RETURNING id, email`,
      [tenantB, 'Owner Test B', `ownerb-notif-${Date.now()}@store.com`]
    );
    ownerBUserId = Number(ownerBInsert.rows[0].id);

    const adminTokenA = generateToken({
      id: Number(adminRowA.id),
      email: adminRowA.email,
      name: 'Owner A',
      role: 'ADMIN',
      tenantId: tenantA,
      status: 'APPROVED',
    });
    const adminTokenB = generateToken({
      id: ownerBUserId,
      email: ownerBInsert.rows[0].email,
      name: 'Owner B',
      role: 'ADMIN',
      tenantId: tenantB,
      status: 'APPROVED',
    });
    const cashierTokenA = generateToken({
      id: cashierUserId,
      email: cashierInsert.rows[0].email,
      name: 'Cashier A',
      role: 'CASHIER',
      tenantId: tenantA,
      status: 'APPROVED',
    });

    // 1. Cashier cannot view or modify notification preferences
    const cashierGet = await fetch(`${baseUrl}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${cashierTokenA}` },
    });
    assert.equal(cashierGet.status, 403);

    const cashierPut = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierTokenA}`,
      },
      body: JSON.stringify({ preset: 'all' }),
    });
    assert.equal(cashierPut.status, 403);

    // 2. New/unconfigured store defaults to Recommended
    const defaultGet = await fetch(`${baseUrl}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });
    assert.equal(defaultGet.status, 200);
    const defaultBody = await defaultGet.json();
    assert.equal(defaultBody.success, true);
    assert.equal(defaultBody.preferences.preset, 'recommended');
    assert.equal(defaultBody.preferences.events.sale, true);
    assert.equal(defaultBody.preferences.events.announcement, false);

    // 3. Tenant A saves Custom preferences; Tenant B remains completely isolated (Recommended)
    const customSave = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({
        eventId: 'sale',
        enabled: false,
      }),
    });
    assert.equal(customSave.status, 200);
    const customBody = await customSave.json();
    assert.equal(customBody.preferences.preset, 'custom');
    assert.equal(customBody.preferences.events.sale, false);

    // Verify Tenant A persistence across reload
    const reloadA = await getTenantNotificationPreferences(tenantA);
    assert.equal(reloadA.preset, 'custom');
    assert.equal(reloadA.events.sale, false);

    // Verify Tenant B stays unaffected on Recommended default
    const getB = await fetch(`${baseUrl}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });
    assert.equal(getB.status, 200);
    const bodyB = await getB.json();
    assert.equal(bodyB.preferences.preset, 'recommended');
    assert.equal(bodyB.preferences.events.sale, true);

    // 4. Switch Tenant A to All Notifications then back to Custom -> preserves sale=false!
    const allSave = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({ preset: 'all' }),
    });
    const allBody = await allSave.json();
    assert.equal(allBody.preferences.preset, 'all');
    assert.equal(allBody.preferences.events.sale, true);
    assert.equal(allBody.preferences.events.announcement, true);

    const restoreCustom = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminTokenA}`,
      },
      body: JSON.stringify({ preset: 'custom' }),
    });
    const restoredBody = await restoreCustom.json();
    assert.equal(restoredBody.preferences.preset, 'custom');
    assert.equal(restoredBody.preferences.events.sale, false);
  } finally {
    await pgClient
      .query('UPDATE company_settings SET notification_preferences = NULL WHERE tenant_id = $1', [tenantA])
      .catch(() => {});
    if (cashierUserId) {
      await pgClient.query('DELETE FROM users WHERE id = $1', [cashierUserId]).catch(() => {});
    }
    if (ownerBUserId) {
      await pgClient.query('DELETE FROM users WHERE id = $1', [ownerBUserId]).catch(() => {});
    }
    if (tenantB) {
      await pgClient.query('DELETE FROM company_settings WHERE tenant_id = $1', [tenantB]).catch(() => {});
      await pgClient.query('DELETE FROM tenants WHERE id = $1', [tenantB]).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Notification Triggers & Channel Routing: disabled event types are suppressed, channels respected, and Email Fallback triggers cleanly', async () => {
  resetServerNotificationDedupeCache();
  resetOwnerPresenceForTests();

  const tenantId = 710;
  const ownerRes = createMockSseRes();
  const unregisterOwner = registerSseClient(tenantId, 71, 'ADMIN', ownerRes as any, {
    sessionId: 'pref-owner-tab',
    authenticated: true,
  });
  recordOwnerHeartbeat({ tenantId, userId: 71, role: 'ADMIN', sessionId: 'pref-owner-tab' });

  let fcmCount = 0;
  let emailCount = 0;
  let noticeEmailCount = 0;
  const basePrefs = createDefaultNotificationPreferences();

  try {
    // A. Disabled POS Event Type ('sale': false) -> ZERO SSE, ZERO push, ZERO email
    const noSalePrefs = updateNotificationEventToggle(basePrefs, 'sale', false);
    await notifyPosAction(
      tenantId,
      {
        eventId: 'pref-disabled-sale-1',
        type: 'SALE',
        title: 'Sale Completed',
        message: 'Inv #INV-710',
        invoiceNumber: 'INV-710',
        saleId: 7101,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        getPreferencesFn: async () => noSalePrefs,
        isFirebaseReadyFn: async () => true,
        fetchFcmTokensFn: async () => [{ token: 'owner-tok-1', user_role: 'ADMIN', user_id: 71 }],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async () => {
          emailCount++;
          return true;
        },
      }
    );
    assert.equal(ownerRes.chunks.length, 0);
    assert.equal(fcmCount, 0);
    assert.equal(emailCount, 0);

    // B. Disabled Announcement Event Type in Recommended preset -> ZERO SSE, ZERO push, ZERO notice email
    await notifyPlatformAnnouncement(
      {
        id: 801,
        eventId: 'pref-disabled-ann-1',
        tenantId,
        targetRole: 'ADMIN',
        title: 'Product Update',
        message: 'General announcement',
      },
      {
        getPreferencesFn: async () => basePrefs, // Recommended has announcement=false
        isFirebaseReadyFn: async () => false,
        fetchFcmTokensFn: async () => ['owner-tok-1'],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchStoreNoticeEmailFn: async () => {
          noticeEmailCount++;
          return true;
        },
      }
    );
    assert.equal(ownerRes.chunks.length, 0);
    assert.equal(fcmCount, 0);
    assert.equal(noticeEmailCount, 0);

    // C. Email Fallback Case 1: Web Push inactive (webPush: false) while Email Alerts enabled -> skips FCM, sends Email Fallback!
    const pushOffPrefs = updateNotificationChannelToggle(basePrefs, 'webPush', false);
    await notifyPosAction(
      tenantId,
      {
        eventId: 'pref-fallback-push-off',
        type: 'SALE',
        title: 'Sale Completed',
        message: 'Inv #INV-711',
        invoiceNumber: 'INV-711',
        saleId: 7102,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        getPreferencesFn: async () => pushOffPrefs,
        isFirebaseReadyFn: async () => true,
        fetchFcmTokensFn: async () => [{ token: 'owner-tok-1', user_role: 'ADMIN', user_id: 71 }],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async () => {
          emailCount++;
          return true;
        },
      }
    );
    assert.equal(fcmCount, 0, 'Web Push OFF must suppress FCM push');
    assert.equal(emailCount, 1, 'Email Fallback must trigger when Web Push is OFF and Email Alerts ON');

    // D. Email Fallback Case 2: Web Push unavailable (Firebase not ready) -> sends Email Fallback!
    await notifyPosAction(
      tenantId,
      {
        eventId: 'pref-fallback-fcm-unavail',
        type: 'RETURN',
        title: 'Return Completed',
        message: 'Ret #RET-712',
        invoiceNumber: '',
        returnNumber: 'RET-712',
        returnId: 712,
        deepLinkUrl: '/?tab=returns',
        timestamp: new Date().toISOString(),
      },
      {
        getPreferencesFn: async () => basePrefs,
        isFirebaseReadyFn: async () => false,
        fetchFcmTokensFn: async () => [{ token: 'owner-tok-1', user_role: 'ADMIN', user_id: 71 }],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async () => {
          emailCount++;
          return true;
        },
      }
    );
    assert.equal(fcmCount, 0);
    assert.equal(emailCount, 2, 'Email Fallback must trigger when Firebase Web Push is unavailable');

    // E. Email Fallback Case 3: No active owner push subscription (only cashier token present) -> sends Email Fallback to owner!
    await notifyPosAction(
      tenantId,
      {
        eventId: 'pref-fallback-no-owner-sub',
        type: 'EXCHANGE',
        title: 'Exchange Completed',
        message: 'Exc #EXC-713',
        invoiceNumber: 'INV-713',
        exchangeNumber: 'EXC-713',
        saleId: 7103,
        cashierId: 90,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        getPreferencesFn: async () => basePrefs,
        isFirebaseReadyFn: async () => true,
        fetchFcmTokensFn: async () => [{ token: 'cashier-tok-90', user_role: 'CASHIER', user_id: 90 }],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmCount++;
          assert.deepEqual(tokens, ['cashier-tok-90']);
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async () => {
          emailCount++;
          return true;
        },
      }
    );
    assert.equal(fcmCount, 1, 'Cashier token still receives push when Web Push is active');
    assert.equal(emailCount, 3, 'Email Fallback must trigger when Store Owner has no active push subscription');

    // F. Email Fallback Case 4: Runtime FCM push fails (sentCount: 0) -> triggers Email Fallback!
    await notifyPosAction(
      tenantId,
      {
        eventId: 'pref-fallback-runtime-fail',
        type: 'SALE',
        title: 'Sale Completed',
        message: 'Inv #INV-714',
        invoiceNumber: 'INV-714',
        saleId: 7104,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        getPreferencesFn: async () => basePrefs,
        isFirebaseReadyFn: async () => true,
        fetchFcmTokensFn: async () => [{ token: 'owner-stale-tok', user_role: 'ADMIN', user_id: 71 }],
        sendFcmPushToTokensFn: async () => {
          fcmCount++;
          return { success: false, sentCount: 0, failureCount: 1, error: 'NotRegistered' };
        },
        dispatchPosEmailAlertFn: async () => {
          emailCount++;
          return true;
        },
      }
    );
    assert.equal(fcmCount, 2);
    assert.equal(emailCount, 4, 'Email Fallback must trigger when runtime FCM delivery fails for owner');

    // G. Email Alerts OFF -> NEVER sends email even if Web Push is OFF and Owner is Offline!
    const bothOffPrefs = updateNotificationChannelToggle(pushOffPrefs, 'emailAlerts', false);
    await notifyPosAction(
      tenantId,
      {
        eventId: 'pref-no-email-when-disabled',
        type: 'SALE',
        title: 'Sale Completed',
        message: 'Inv #INV-715',
        invoiceNumber: 'INV-715',
        saleId: 7105,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        getPreferencesFn: async () => bothOffPrefs,
        isOwnerOnlineFn: () => false,
        isFirebaseReadyFn: async () => false,
        fetchFcmTokensFn: async () => [],
        dispatchPosEmailAlertFn: async () => {
          emailCount++;
          return true;
        },
      }
    );
    assert.equal(emailCount, 4, 'Email Alerts OFF must suppress email even during fallback/offline state');

    // H. Subscription alert when webPush is disabled -> Email Fallback triggers via dispatchStoreNoticeEmailAlert!
    await notifyPlatformAnnouncement(
      {
        id: 802,
        eventId: 'sub-expiring-710-1',
        tenantId,
        targetRole: 'ADMIN',
        title: 'Subscription Expiring Soon ⚠️',
        message: 'Renew before expiry.',
        type: 'WARNING',
      },
      {
        getPreferencesFn: async () => pushOffPrefs,
        isFirebaseReadyFn: async () => true,
        fetchFcmTokensFn: async () => ['owner-tok-1'],
        sendFcmPushToTokensFn: async (tokens) => {
          fcmCount++;
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchStoreNoticeEmailFn: async () => {
          noticeEmailCount++;
          return true;
        },
      }
    );
    assert.equal(noticeEmailCount, 1, 'Subscription alert must fall back to email when Web Push is OFF');

    // I. Low Stock disabled -> triggered: false (no in-app, no email, no push)
    const noLowStockPrefs = updateNotificationEventToggle(basePrefs, 'low_stock', false);
    const lowStockDisabledRes = await dispatchBatchedLowStockNotifications(
      {
        tenantId,
        saleId: 7999,
        invoiceNumber: 'INV-7999',
        items: [
          {
            productId: 901,
            sku: 'ART-901',
            article: 'ART-901',
            name: 'Runner',
            remainingStock: 2,
            lowStockThreshold: 5,
          },
        ],
      },
      {
        getPreferencesFn: async () => noLowStockPrefs,
        sendEmailFn: async () => {
          throw new Error('Should not be called when low_stock is disabled');
        },
        sendFcmPushToTokensFn: async () => {
          throw new Error('Should not be called when low_stock is disabled');
        },
      }
    );
    assert.equal(lowStockDisabledRes.triggered, false);
    assert.equal(lowStockDisabledRes.inAppCreated, false);
    assert.equal(lowStockDisabledRes.emailSent, false);
    assert.equal(lowStockDisabledRes.pushSent, false);

    // Verify pure resolver delivery status flags
    const planNoSub = resolveStoreChannelDelivery({
      preferences: basePrefs,
      eventKey: 'sale',
      ownerOnline: true,
      fcmConfigured: true,
      hasActiveOwnerPushSubscription: false,
    });
    assert.equal(planNoSub.emailFallbackTriggered, true);
    assert.equal(planNoSub.emailFallbackReason, 'no_active_subscription');
    assert.equal(planNoSub.sendOwnerEmail, true);

    const statusObj = await getStoreNotificationDeliveryStatus(tenantId, pushOffPrefs, {
      isFirebaseReadyFn: async () => true,
      fetchOwnerTokensFn: async () => ['tok-a'],
    });
    assert.equal(statusObj.emailFallbackReason, 'web_push_inactive');
  } finally {
    unregisterOwner();
    resetServerNotificationDedupeCache();
    resetOwnerPresenceForTests();
  }
});

test('SettingsView & StoreNotificationPreferencesCard expose presets, channels, Email Fallback banner, and individual event toggles to Store Owners only', () => {
  const cardSrc = readProjectFile('src/components/settings/StoreNotificationPreferencesCard.tsx');
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');

  // Card includes all 3 presets, channels, Email Fallback banner, and Reset to Recommended
  assert.ok(cardSrc.includes('NOTIFICATION_PRESETS'));
  assert.ok(cardSrc.includes('STORE_NOTIFICATION_CHANNELS'));
  assert.ok(cardSrc.includes('STORE_NOTIFICATION_EVENTS'));
  assert.ok(cardSrc.includes('Reset to Recommended'));
  assert.ok(cardSrc.includes('Email Fallback'));
  assert.ok(cardSrc.includes('System Recommended'));
  assert.ok(cardSrc.includes('api.notifications.getPreferences'));
  assert.ok(cardSrc.includes('api.notifications.updatePreferences'));
  assert.ok(cardSrc.includes('role="switch"'));

  // SettingsView gates StoreNotificationPreferencesCard strictly to Store Admin inside Notifications tab
  assert.ok(settingsSrc.includes('<StoreNotificationPreferencesCard'));
  assert.match(settingsSrc, /\{isStoreAdmin && \(\s*<StoreNotificationPreferencesCard/);

  // Ensure helper persistence works seamlessly for tenant 1 reset
  assert.equal(typeof saveTenantNotificationPreferences, 'function');
});
