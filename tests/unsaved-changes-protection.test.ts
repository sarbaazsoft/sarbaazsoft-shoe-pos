import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveTargetDirtyScopes,
  executeSaveScopesAndProceed,
  areSnapshotsEqual,
  type UnsavedScopeMeta,
} from '../src/context/UnsavedChangesContext.tsx';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const ALL_SETTINGS_TABS = [
  { tabId: 'store', scopeId: 'settings:store', label: 'Store Settings' },
  { tabId: 'users', scopeId: 'settings:users', label: 'Staff Settings' },
  { tabId: 'app_settings', scopeId: 'settings:app_settings', label: 'App Configuration' },
  { tabId: 'notifications', scopeId: 'settings:notifications', label: 'Notification Settings' },
  { tabId: 'appearance', scopeId: 'settings:appearance', label: 'Appearance Settings' },
  { tabId: 'backup', scopeId: 'settings:backup', label: 'Backup & Restore' },
  { tabId: 'install', scopeId: 'settings:install', label: 'Server Installer' },
  { tabId: 'printers', scopeId: 'settings:printers', label: 'Printer & Hardware Settings' },
] as const;

test('UnsavedChangesContext tracks every Settings tab independently without cross-tab interference', () => {
  for (const target of ALL_SETTINGS_TABS) {
    const entries: UnsavedScopeMeta[] = ALL_SETTINGS_TABS.map((item) => ({
      scopeId: item.scopeId,
      label: item.label,
      isDirty: item.scopeId === target.scopeId,
      isActive: item.scopeId === target.scopeId,
    }));

    const blocking = resolveTargetDirtyScopes(entries);
    assert.equal(blocking.length, 1, `Only ${target.scopeId} should block navigation`);
    assert.equal(blocking[0].scopeId, target.scopeId);

    // Clean check: when navigating from a non-dirty tab, inactive dirty scopes must not spuriously block active navigation
    const switchedInactiveEntries: UnsavedScopeMeta[] = ALL_SETTINGS_TABS.map((item) => ({
      scopeId: item.scopeId,
      label: item.label,
      isDirty: item.scopeId === target.scopeId,
      isActive: false,
    }));
    const activeOnlyBlocking = resolveTargetDirtyScopes(switchedInactiveEntries, { activeOnly: true });
    assert.equal(activeOnlyBlocking.length, 0);

    // Explicitly checking all scopes when leaving SettingsView still catches all dirty scopes
    const globalBlocking = resolveTargetDirtyScopes(entries, { activeOnly: false });
    assert.deepEqual(
      globalBlocking.map((s) => s.scopeId),
      [target.scopeId]
    );
  }
});

test('UnsavedChangesContext allows immediate navigation when no active scopes are dirty (zero prompts)', async () => {
  const cleanEntries: UnsavedScopeMeta[] = ALL_SETTINGS_TABS.map((item) => ({
    scopeId: item.scopeId,
    label: item.label,
    isDirty: false,
    isActive: item.tabId === 'store',
  }));

  const blocking = resolveTargetDirtyScopes(cleanEntries);
  assert.equal(blocking.length, 0);

  let navigated = false;
  const result = await executeSaveScopesAndProceed([], () => {
    navigated = true;
  });
  assert.equal(result.ok, true);
  assert.equal(navigated, true);
});

test('executeSaveScopesAndProceed proceeds on save success and halts navigation when save returns false or throws', async () => {
  // 1. Save succeeds -> proceeds
  let persisted = false;
  let navigatedOnSuccess = false;
  const okResult = await executeSaveScopesAndProceed(
    [
      {
        label: 'Store Settings',
        save: async () => {
          persisted = true;
          return true;
        },
      },
    ],
    () => {
      navigatedOnSuccess = true;
    }
  );
  assert.equal(okResult.ok, true);
  assert.equal(persisted, true);
  assert.equal(navigatedOnSuccess, true);

  // 2. Save validation failure (returns false) -> blocks navigation & reports error
  let navigatedOnFalse = false;
  const failFalseResult = await executeSaveScopesAndProceed(
    [
      {
        label: 'Store Settings',
        save: async () => false,
      },
    ],
    () => {
      navigatedOnFalse = true;
    }
  );
  assert.equal(failFalseResult.ok, false);
  assert.ok(failFalseResult.error?.includes('Store Settings'));
  assert.equal(navigatedOnFalse, false, 'Navigation MUST NOT proceed when save returns false');

  // 3. Save network/API error (throws) -> blocks navigation & propagates message
  let navigatedOnThrow = false;
  const failThrowResult = await executeSaveScopesAndProceed(
    [
      {
        label: 'App Configuration',
        save: async () => {
          throw new Error('SMTP host cannot be empty');
        },
      },
    ],
    () => {
      navigatedOnThrow = true;
    }
  );
  assert.equal(failThrowResult.ok, false);
  assert.equal(failThrowResult.error, 'SMTP host cannot be empty');
  assert.equal(navigatedOnThrow, false, 'Navigation MUST NOT proceed when save throws');
});

test('areSnapshotsEqual compares nested Settings baselines accurately for Save & Discard detection', () => {
  const saved = {
    name: 'Sarbaaz Shoes',
    receiptWidth: '80mm',
    categories: { newSale: true, dailySummary: false },
    flags: ['a', 'b'],
  };
  const identical = {
    name: 'Sarbaaz Shoes',
    receiptWidth: '80mm',
    categories: { newSale: true, dailySummary: false },
    flags: ['a', 'b'],
    optionalIgnored: undefined,
  };
  const modified = {
    ...saved,
    categories: { newSale: false, dailySummary: false },
  };

  assert.equal(areSnapshotsEqual(saved, identical), true);
  assert.equal(areSnapshotsEqual(saved, modified), false);
});

test('Every Settings tab implements Save, Discard, and Stay semantics without auto-persisting drafts', () => {
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  const appearanceSrc = readProjectFile('src/components/settings/AppearanceSettingsTab.tsx');
  const printerSrc = readProjectFile('src/components/settings/PrinterHardwareSettings.tsx');
  const storeNotifSrc = readProjectFile('src/components/settings/StoreNotificationPreferencesCard.tsx');
  const fcmSrc = readProjectFile('src/components/settings/NotificationAlertProvidersSettings.tsx');
  const backupSrc = readProjectFile('src/components/settings/DataBackupRestore.tsx');
  const staffModalSrc = readProjectFile('src/components/settings/CreateStaffModal.tsx');

  // 1. Store Settings (store)
  assert.ok(settingsSrc.includes("useRegisterUnsavedScope('settings:store'"));
  assert.ok(settingsSrc.includes('savedStoreForm'));
  assert.ok(settingsSrc.includes('handleDiscardStoreChanges'));
  assert.ok(settingsSrc.includes('id="store-discard-changes-btn"'));

  // 2. Staff Settings (users)
  assert.ok(settingsSrc.includes("useRegisterUnsavedScope('settings:users'"));
  assert.ok(settingsSrc.includes('pendingUserEdits'));
  assert.ok(settingsSrc.includes('handleSaveStaffChanges'));
  assert.ok(settingsSrc.includes('handleDiscardStaffChanges'));
  assert.ok(settingsSrc.includes('id="staff-save-changes-btn"'));
  assert.ok(settingsSrc.includes('id="staff-discard-changes-btn"'));
  assert.ok(staffModalSrc.includes('onDirtyChange'));

  // 3. App Configuration (app_settings) + FCM provider sub-tab
  assert.ok(settingsSrc.includes("useRegisterUnsavedScope('settings:app_settings'"));
  assert.ok(settingsSrc.includes('savedAppSettings'));
  assert.ok(settingsSrc.includes('handleDiscardAppConfigChanges'));
  assert.ok(settingsSrc.includes('id="app-config-discard-changes-btn"'));
  assert.ok(fcmSrc.includes("useRegisterUnsavedScope('settings:app_settings_fcm'"));
  assert.ok(fcmSrc.includes('onFcmDraftChange'));

  // 4. Notifications (notifications) — both Store Admin card and SuperAdmin triggers
  assert.ok(storeNotifSrc.includes("useRegisterUnsavedScope('settings:notifications'"));
  assert.ok(storeNotifSrc.includes('id="store-notif-save-btn"'));
  assert.ok(storeNotifSrc.includes('id="store-notif-discard-btn"'));
  assert.ok(
    settingsSrc.includes("isSuperAdmin ? 'settings:notifications' : 'settings:notifications_superadmin_inactive'"),
    'SuperAdmin notifications trigger scope must use non-colliding scope ID for non-SuperAdmin'
  );
  assert.ok(settingsSrc.includes('id="superadmin-notif-discard-changes-btn"'));

  // 5. Appearance (appearance)
  assert.ok(appearanceSrc.includes("useRegisterUnsavedScope('settings:appearance'"));
  assert.ok(appearanceSrc.includes('handleCancel'));
  assert.ok(appearanceSrc.includes('handleApplyAndSave'));

  // 6. Backup (backup)
  assert.ok(backupSrc.includes("useRegisterUnsavedScope('settings:backup'"));
  assert.ok(backupSrc.includes('handleDiscardBackupChanges'));

  // 7. Installer (install)
  assert.ok(settingsSrc.includes("useRegisterUnsavedScope('settings:install'"));
  assert.ok(settingsSrc.includes('id="install-discard-changes-btn"'));
  assert.ok(settingsSrc.includes('isDropConfirmPending'));

  // 8. Printers (printers)
  assert.ok(printerSrc.includes("useRegisterUnsavedScope('settings:printers'"));
  assert.ok(printerSrc.includes('id="printer-save-settings-btn"'));
  assert.ok(printerSrc.includes('id="printer-discard-changes-btn"'));
  assert.ok(printerSrc.includes('data-testid="printers-unsaved-badge"'));

  // None of the settings components may rely on blocking window.alert or window.confirm
  for (const [name, src] of [
    ['SettingsView.tsx', settingsSrc],
    ['AppearanceSettingsTab.tsx', appearanceSrc],
    ['PrinterHardwareSettings.tsx', printerSrc],
    ['StoreNotificationPreferencesCard.tsx', storeNotifSrc],
    ['NotificationAlertProvidersSettings.tsx', fcmSrc],
    ['DataBackupRestore.tsx', backupSrc],
    ['CreateStaffModal.tsx', staffModalSrc],
  ]) {
    assert.equal(/\bwindow\.(?:alert|confirm)\s*\(/.test(src), false, `${name} must not call window.alert/window.confirm`);
    assert.equal(/(?<![\w.])(?:alert|confirm)\s*\(/.test(src), false, `${name} must not call bare alert/confirm`);
  }
});

test('Global navigation protection covers Modal UI, main.tsx provider, SettingsView, App.tsx, Header.tsx, and SuperAdminControlPanel.tsx', () => {
  const modalSrc = readProjectFile('src/components/common/UnsavedChangesModal.tsx');
  const contextSrc = readProjectFile('src/context/UnsavedChangesContext.tsx');
  const mainSrc = readProjectFile('src/main.tsx');
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  const appSrc = readProjectFile('src/App.tsx');
  const headerSrc = readProjectFile('src/components/common/Header.tsx');
  const superAdminSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');

  // Confirmation dialog exposes all 3 required choices + error container
  assert.ok(modalSrc.includes('id="unsaved-changes-dialog"'));
  assert.ok(modalSrc.includes('id="unsaved-changes-save-btn"'));
  assert.ok(modalSrc.includes('Save Changes'));
  assert.ok(modalSrc.includes('id="unsaved-changes-discard-btn"'));
  assert.ok(modalSrc.includes('Discard Changes'));
  assert.ok(modalSrc.includes('id="unsaved-changes-stay-btn"'));
  assert.ok(modalSrc.includes('Stay'));
  assert.ok(modalSrc.includes('data-testid="unsaved-changes-error"'));

  // beforeunload + provider wiring
  assert.ok(contextSrc.includes("window.addEventListener('beforeunload'"));
  assert.ok(mainSrc.includes('<UnsavedChangesProvider>'));

  // SettingsView guards internal tab switches and event-driven tab switches
  assert.ok(settingsSrc.includes('const handleSelectTab = useCallback'));
  assert.ok(settingsSrc.includes('requestNavigation(() => setActiveTab('));

  // App.tsx guards sidebar/header tabs, domain switching, deep links, popstate, role switch, and manual logout ONLY (never idle auto-logout)
  assert.ok(appSrc.includes('hasDirtyMatchingScopes'));
  assert.ok(appSrc.includes("window.addEventListener('popstate'"));
  assert.ok(appSrc.includes('handleSwitchRole'));
  assert.ok(appSrc.includes('executeLogout(true)'));
  assert.ok(appSrc.includes('requestNavigation(() => {\n      executeLogout(false)'));
  assert.ok(appSrc.includes('requestNavigation(() => executeNavigateDomain(target))'));

  // Header Cashier switch delegates solely to guarded onSwitchRole when passed
  assert.match(
    headerSrc,
    /if\s*\(onSwitchRole\)\s*\{\s*onSwitchRole\('CASHIER'\);\s*\}\s*else\s*\{[\s\S]*?onTabChange\?\.\('pos'\);/
  );

  // SuperAdminControlPanel guards workspace tab switches, history popstate, and settings shortcut redirects
  assert.ok(superAdminSrc.includes('useUnsavedChanges'));
  assert.ok(superAdminSrc.includes('requestNavigation(() => setActiveTabRaw(nextTab))'));
  assert.ok(superAdminSrc.includes('applySuperAdminPopState'));
});
