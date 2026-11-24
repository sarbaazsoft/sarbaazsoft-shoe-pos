import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { pgClient } from '../src/db/index.ts';
import { ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

async function startNotificationTestServer() {
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

test('Header notification dropdown removes Enable/Test Push controls, hides when granted, warns on denial, and redirects Owner/SuperAdmin to Settings', () => {
  const src = readProjectFile('src/components/common/Header.tsx');

  // Must not import or invoke push enable/test controls directly inside Header
  assert.equal(src.includes('subscribeDeviceToWebPush'), false);
  assert.equal(src.includes('unsubscribeDeviceFromWebPush'), false);
  assert.equal(src.includes('triggerTestNotificationShadeFallback'), false);
  assert.equal(src.includes('handleTogglePushNotifications'), false);
  assert.equal(src.includes('handleSendTestPush'), false);

  const dropdownStart = src.indexOf('{/* Notifications Dropdown Menu */}');
  const feedStart = src.indexOf('{/* Flat Chronological Notification Feed');
  assert.ok(dropdownStart !== -1 && feedStart !== -1 && feedStart > dropdownStart);
  const dropdownSection = src.slice(dropdownStart, feedStart);

  // Enable Push / Test Alert controls must be absent from dropdown UI
  assert.equal(dropdownSection.includes('Enable Push'), false);
  assert.equal(dropdownSection.includes('Disable Push'), false);
  assert.equal(dropdownSection.includes('Test Alert'), false);

  // Permission banner must render nothing when granted
  assert.match(dropdownSection, /\{!isPermissionGranted\s*&&\s*\(/);

  // Exclamation icon + site blocked warning
  assert.ok(dropdownSection.includes('<AlertCircle'));
  assert.ok(dropdownSection.includes('Notifications permission blocked for this site'));
  assert.ok(dropdownSection.includes('Notification permission not granted'));

  // View Settings redirect strictly gated to ADMIN or SUPERADMIN
  assert.match(src, /const\s+canRedirectToSettings\s*=\s*isAdminUser\s*\|\|\s*isSuperAdminUser/);
  assert.match(dropdownSection, /\{canRedirectToSettings\s*&&\s*\(/);
  assert.ok(dropdownSection.includes('View Settings'));
  assert.ok(dropdownSection.includes("new CustomEvent('pos:navigate-settings-tab'"));
  assert.ok(dropdownSection.includes("tab: 'notifications'"));
  assert.ok(dropdownSection.includes("onTabChange?.('settings')"));
});

test('SuperAdminControlPanel notification dropdown removes Enable/Test Push controls, hides when granted, warns on denial, and redirects to Settings notifications tab', () => {
  const src = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');

  const dropdownStart = src.indexOf('{showNotifDropdown && (');
  const filterTabsStart = src.indexOf('{/* Category Filter Tabs */}');
  assert.ok(dropdownStart !== -1 && filterTabsStart !== -1 && filterTabsStart > dropdownStart);
  const dropdownSection = src.slice(dropdownStart, filterTabsStart);

  // Enable Push / Test Alert controls must be absent from dropdown UI
  assert.equal(dropdownSection.includes('Enable Push'), false);
  assert.equal(dropdownSection.includes('Disable Push'), false);
  assert.equal(dropdownSection.includes('Test Alert'), false);

  // Permission banner must render nothing when granted
  assert.match(dropdownSection, /\{!isPermissionGranted\s*&&\s*\(/);

  // Exclamation icon + blocked warning + View Settings redirect
  assert.ok(dropdownSection.includes('<AlertCircle'));
  assert.ok(dropdownSection.includes('Notifications permission blocked for this site'));
  assert.ok(dropdownSection.includes('Notification permission not granted'));
  assert.ok(dropdownSection.includes('View Settings'));
  assert.ok(dropdownSection.includes("setSuperAdminSettingsTab('notifications')"));
  assert.ok(dropdownSection.includes("setActiveTab('settings')"));
  assert.ok(src.includes('initialTab={superAdminSettingsTab}'));

  // SuperAdminControlPanel retains SuperAdmin Test Alert control
  assert.ok(src.includes('handleSendTestPush'));
});

test('SettingsView exposes Device Push Enable/Disable to ADMIN & SUPERADMIN, and isolates Send Test Notification UI & hook state strictly to SUPERADMIN', () => {
  const appSrc = readProjectFile('src/App.tsx');
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  const fcmSettingsSrc = readProjectFile('src/components/settings/NotificationAlertProvidersSettings.tsx');

  // App.tsx routes pos:navigate-settings-tab and keeps CASHIER restricted to printers
  assert.ok(appSrc.includes("window.addEventListener('pos:navigate-settings-tab'"));
  assert.ok(appSrc.includes("effectiveUserRole === 'CASHIER' ? 'printers' : settingsInitialTab"));

  // SettingsView tab authorization rules
  assert.match(
    settingsSrc,
    /\['app_settings',\s*'notifications',\s*'backup',\s*'install'\]\.includes\(/
  );
  assert.match(
    settingsSrc,
    /\['store',\s*'users',\s*'notifications',\s*'printers'\]\.includes\(/
  );
  assert.match(settingsSrc, /if\s*\(isCashier\)\s*\{\s*return\s*'printers';/);
  assert.ok(settingsSrc.includes("window.addEventListener('pos:navigate-settings-tab'"));

  // Tab button and panel gated to (isStoreAdmin || isSuperAdmin)
  assert.match(settingsSrc, /\{\(isStoreAdmin \|\| isSuperAdmin\) && \(\s*<button[\s\S]*?id="settings-tab-notifications"/);
  assert.match(settingsSrc, /\{\(isStoreAdmin \|\| isSuperAdmin\) && activeTab === 'notifications' && \(/);

  // Enable/Disable Device Notifications remains available for Store Owner and SuperAdmin
  assert.ok(settingsSrc.includes('handleToggleDeviceNotifications'));
  assert.ok(settingsSrc.includes('Enable Notifications'));
  assert.ok(settingsSrc.includes('Disable Notifications'));
  assert.ok(settingsSrc.includes('Check Status'));

  // Send Test Notification UI & hook state live inside SuperAdminTestNotificationCard, gated strictly to isSuperAdmin
  assert.ok(settingsSrc.includes('const SuperAdminTestNotificationCard'));
  assert.match(settingsSrc, /\{isSuperAdmin && \(\s*<SuperAdminTestNotificationCard/);
  assert.equal(settingsSrc.includes('POS Test Alert'), false, 'Store/POS test alert fallback copy must be removed');

  // SettingsView root component must not allocate test notification state hooks for Store Owners
  const settingsComponentStart = settingsSrc.indexOf('export const SettingsView:');
  assert.ok(settingsComponentStart !== -1);
  const settingsBody = settingsSrc.slice(settingsComponentStart);
  assert.equal(settingsBody.includes('testNotifTitle'), false);
  assert.equal(settingsBody.includes('testNotifBody'), false);
  assert.equal(settingsBody.includes('isSendingTestNotif'), false);
  assert.equal(settingsBody.includes('testNotifFeedback'), false);
  assert.equal(settingsBody.includes('handleSendSettingsTestNotification'), false);

  // NotificationAlertProvidersSettings also guards Test Push Alert (FCM) strictly to SUPERADMIN
  assert.ok(fcmSettingsSrc.includes("const isSuperAdminUser = getActiveUserRole() === 'SUPERADMIN'"));
  assert.match(fcmSettingsSrc, /if\s*\(!isSuperAdminUser\s*\|\|\s*isTestingPushRef\.current\)\s*return;/);
  assert.match(fcmSettingsSrc, /\{isSuperAdminUser && \(\s*<button[\s\S]*?Test Push Alert \(FCM\)/);
});

test('API endpoint /api/notifications/test-push rejects unauthenticated, ADMIN, and CASHIER callers and allows SUPERADMIN only', async () => {
  await ensureSaasControlPlane();
  const { server, baseUrl } = await startNotificationTestServer();

  let tempAdminId = 0;
  let tempCashierId = 0;
  let tempSuperId = 0;
  try {
    const tenantRes = await pgClient.query<{ id: number }>(
      `SELECT id FROM tenants ORDER BY id ASC LIMIT 1`
    );
    const tenantId = Number(tenantRes.rows[0]?.id || 1);

    const adminInsert = await pgClient.query<{ id: number; email: string }>(
      `INSERT INTO users (tenant_id, name, email, password, role, status, active)
       VALUES ($1, $2, $3, 'hashed-pw', 'ADMIN', 'APPROVED', true)
       RETURNING id, email`,
      [tenantId, 'Test Store Owner RBAC', `owner-testpush-${Date.now()}@store.com`]
    );
    tempAdminId = Number(adminInsert.rows[0].id);

    const cashierInsert = await pgClient.query<{ id: number; email: string }>(
      `INSERT INTO users (tenant_id, name, email, password, role, status, active)
       VALUES ($1, $2, $3, 'hashed-pw', 'CASHIER', 'APPROVED', true)
       RETURNING id, email`,
      [tenantId, 'Test Cashier RBAC', `cashier-testpush-${Date.now()}@store.com`]
    );
    tempCashierId = Number(cashierInsert.rows[0].id);

    const superInsert = await pgClient.query<{ id: number; email: string }>(
      `INSERT INTO users (tenant_id, name, email, password, role, status, active)
       VALUES (0, $1, $2, 'hashed-pw', 'SUPERADMIN', 'APPROVED', true)
       RETURNING id, email`,
      ['Test SuperAdmin RBAC', `super-testpush-${Date.now()}@platform.com`]
    );
    tempSuperId = Number(superInsert.rows[0].id);

    const adminToken = generateToken({
      id: tempAdminId,
      email: adminInsert.rows[0].email,
      name: 'Store Owner',
      role: 'ADMIN',
      tenantId,
      status: 'APPROVED',
    });

    const cashierToken = generateToken({
      id: tempCashierId,
      email: cashierInsert.rows[0].email,
      name: 'Cashier',
      role: 'CASHIER',
      tenantId,
      status: 'APPROVED',
    });

    const superAdminToken = generateToken({
      id: tempSuperId,
      email: superInsert.rows[0].email,
      name: 'SuperAdmin',
      role: 'SUPERADMIN',
      tenantId: 0,
      status: 'APPROVED',
    });

    for (const endpoint of ['/api/notifications/test-push']) {
      const unauthRes = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Unauthorized', message: 'Test' }),
      });
      assert.equal(unauthRes.status, 401, `${endpoint} must reject unauthenticated calls`);

      const ownerRes = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ title: 'Store Owner Test', message: 'Should be forbidden' }),
      });
      assert.equal(ownerRes.status, 403, `${endpoint} must forbid Store Owner (ADMIN)`);
      const ownerBody = (await ownerRes.json()) as any;
      assert.equal(ownerBody.code, 'FORBIDDEN_PLATFORM_OWNER_REQUIRED');

      const cashierRes = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({ title: 'Cashier Test', message: 'Should be forbidden' }),
      });
      assert.equal(cashierRes.status, 403, `${endpoint} must forbid CASHIER`);

      const superResHttp = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
        body: JSON.stringify({
          title: 'SuperAdmin Test Alert',
          message: 'SuperAdmin verification',
          eventId: `rbac-sa-${endpoint.replace(/\W+/g, '-')}-${Date.now()}`,
        }),
      });
      assert.equal(superResHttp.status, 200, `${endpoint} must allow SUPERADMIN`);
      const superBody = (await superResHttp.json()) as any;
      assert.equal(superBody.success, true);
    }
  } finally {
    if (tempAdminId > 0) {
      await pgClient.query('DELETE FROM users WHERE id = $1', [tempAdminId]).catch(() => {});
    }
    if (tempCashierId > 0) {
      await pgClient.query('DELETE FROM users WHERE id = $1', [tempCashierId]).catch(() => {});
    }
    if (tempSuperId > 0) {
      await pgClient.query('DELETE FROM users WHERE id = $1', [tempSuperId]).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('SuperAdmin Push Notification Event Triggers live in Notifications tab while FCM configuration remains untouched in App Config tab', () => {
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  const fcmSrc = readProjectFile('src/components/settings/NotificationAlertProvidersSettings.tsx');

  // Locate App Config section and Notifications section
  const appConfigStart = settingsSrc.indexOf("{isSuperAdmin && activeTab === 'app_settings' && (");
  const printersFallbackStart = settingsSrc.indexOf("{!isSuperAdmin && activeTab === 'printers' && (");
  const notificationsStart = settingsSrc.indexOf("{(isStoreAdmin || isSuperAdmin) && activeTab === 'notifications' && (");
  const systemRestrictedStart = settingsSrc.indexOf("{!isSuperAdmin && (activeTab === 'app_settings'");

  assert.ok(appConfigStart !== -1 && printersFallbackStart > appConfigStart, 'App Config section must exist');
  assert.ok(notificationsStart !== -1 && systemRestrictedStart > notificationsStart, 'Notifications section must exist');

  const appConfigSection = settingsSrc.slice(appConfigStart, printersFallbackStart);
  const notificationsSection = settingsSrc.slice(notificationsStart, systemRestrictedStart);

  // App Config retains FCM settings untouched and excludes notification event triggers
  assert.ok(appConfigSection.includes('<NotificationAlertProvidersSettings'), 'App Config must keep FCM settings component');
  assert.ok(appConfigSection.includes('FCM Notification Settings'), 'App Config must keep FCM Notification Settings tab');
  assert.equal(
    appConfigSection.includes('superadmin-notification-triggers-card'),
    false,
    'SuperAdmin notification triggers card must be removed from App Config tab'
  );
  assert.equal(
    appConfigSection.includes('SUPERADMIN_PUSH_ON_NEW_TRIAL'),
    false,
    'SUPERADMIN_PUSH_ON_* triggers must not remain duplicated inside App Config tab'
  );

  // Notifications tab hosts SuperAdmin Push Notification Event Triggers strictly for isSuperAdmin
  assert.ok(notificationsSection.includes('id="superadmin-notification-triggers-card"'));
  assert.ok(notificationsSection.includes('SuperAdmin Push Notification Event Triggers'));
  assert.ok(notificationsSection.includes('SUPERADMIN_PUSH_ON_NEW_TRIAL'));
  assert.ok(notificationsSection.includes('SUPERADMIN_PUSH_ON_RENEWAL'));
  assert.ok(notificationsSection.includes('SUPERADMIN_PUSH_ON_EXPIRED_STORE'));
  assert.ok(notificationsSection.includes('SUPERADMIN_PUSH_ON_SECURITY_ALERT'));
  assert.ok(notificationsSection.includes('SUPERADMIN_PUSH_ON_SALES'));
  assert.ok(notificationsSection.includes('Save Push Event Triggers'));
  assert.ok(notificationsSection.includes('handleSaveAppSettings(undefined, true)'));

  // Loading effect loads appSettings on either app_settings or notifications for SuperAdmin
  assert.ok(
    settingsSrc.includes("(activeTab === 'app_settings' || activeTab === 'notifications') && isSuperAdmin && !hasLoadedAppSettingsRef.current"),
    'SettingsView must load persisted appSettings triggers when opening Notifications tab'
  );

  // All 8 FCM configuration keys remain intact in NotificationAlertProvidersSettings
  for (const fcmKey of [
    'FCM_PROJECT_ID',
    'FCM_CLIENT_EMAIL',
    'FCM_PRIVATE_KEY',
    'FCM_API_KEY',
    'FCM_MESSAGING_SENDER_ID',
    'FCM_APP_ID',
    'FCM_MEASUREMENT_ID',
    'FCM_VAPID_KEY',
  ]) {
    assert.ok(fcmSrc.includes(fcmKey), `NotificationAlertProvidersSettings must preserve ${fcmKey}`);
  }
});

