import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
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
});

test('SettingsView exposes Notifications enable & test message UI exclusively to Store Owner (ADMIN) and SUPERADMIN, never CASHIER', () => {
  const appSrc = readProjectFile('src/App.tsx');
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');

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

  // Tab button and panel strictly gated to (isStoreAdmin || isSuperAdmin)
  assert.match(settingsSrc, /\{\(isStoreAdmin \|\| isSuperAdmin\) && \(\s*<button[\s\S]*?id="settings-tab-notifications"/);
  assert.match(settingsSrc, /\{\(isStoreAdmin \|\| isSuperAdmin\) && activeTab === 'notifications' && \(/);

  // Both Enable/Disable Device Notifications and Send Test Notification UI exist in SettingsView
  assert.ok(settingsSrc.includes('handleToggleDeviceNotifications'));
  assert.ok(settingsSrc.includes('Enable Notifications'));
  assert.ok(settingsSrc.includes('Disable Notifications'));
  assert.ok(settingsSrc.includes('Check Status'));
  assert.ok(settingsSrc.includes('handleSendSettingsTestNotification'));
  assert.ok(settingsSrc.includes('Send Test Notification'));
  assert.ok(settingsSrc.includes('api.notifications.testPush'));
  assert.ok(settingsSrc.includes('triggerTestNotificationShadeFallback'));
});
