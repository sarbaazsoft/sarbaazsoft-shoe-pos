import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('SettingsView uses concise, consistent SaaS POS tab names including Staff', () => {
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');

  // Verify concise tab labels exist on their corresponding tab buttons
  const expectedTabs: Array<{ id: string; label: string; disallowed?: string[] }> = [
    { id: 'id="settings-tab-store"', label: '<span>Store</span>', disallowed: ['Shop &amp; Invoice Settings', 'Shop & Invoice Settings'] },
    { id: 'id="settings-tab-users"', label: '<span>Staff</span>', disallowed: ['Cashier Approvals &amp; Staff', 'Add Cashier &amp; Staff', 'Add Cashier & Staff'] },
    { id: 'id="settings-tab-app-settings"', label: '<span>App Config</span>' },
    { id: 'id="settings-tab-notifications"', label: '<span>Notifications</span>' },
    { id: 'id="settings-tab-appearance"', label: '<span>Appearance</span>', disallowed: ['Appearance &amp; Colors', 'Appearance & Colors'] },
    { id: 'id="settings-tab-backup"', label: '<span>Backup</span>', disallowed: ['Data Backup &amp; Restore', 'Data Backup & Restore'] },
    { id: 'id="settings-tab-install"', label: '<span>Installer</span>', disallowed: ['Server Installer &amp; Security', 'Server Installer & Security'] },
    { id: 'id="settings-tab-printers"', label: '<span>Printers</span>', disallowed: ['Hardware &amp; Printers', 'Hardware & Printers'] },
  ];

  for (const tab of expectedTabs) {
    const startIdx = settingsSrc.indexOf(tab.id);
    assert.ok(startIdx !== -1, `Expected tab button ${tab.id} to exist`);
    const tabSnippet = settingsSrc.slice(startIdx, startIdx + 950);
    assert.ok(tabSnippet.includes(tab.label), `Expected ${tab.id} to contain ${tab.label}`);
    for (const oldLabel of tab.disallowed || []) {
      assert.equal(
        tabSnippet.includes(oldLabel),
        false,
        `Lengthy tab label "${oldLabel}" should be removed from ${tab.id}`
      );
    }
  }

  // Staff tab remains Store Admin gated
  assert.ok(settingsSrc.includes('{isStoreAdmin && (\n          <button\n            id="settings-tab-users"'));
  assert.ok(settingsSrc.includes("{activeTab === 'users' && isStoreAdmin && ("));
});

test('SettingsView eliminates null Suspense fallbacks and uses layout-matching skeletons and centered Loading... spinner', () => {
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  const skeletonsSrc = readProjectFile('src/components/common/RouteSkeletons.tsx');

  // Zero null fallbacks in SettingsView
  assert.equal(
    settingsSrc.includes('<Suspense fallback={null}>'),
    false,
    'SettingsView must not have empty Suspense fallback={null}'
  );

  // Content-heavy tabs use layout-matching SettingsTabSkeleton
  assert.ok(settingsSrc.includes('<Suspense fallback={<SettingsTabSkeleton tab="appearance" />}>'));
  assert.ok(settingsSrc.includes('<Suspense fallback={<SettingsTabSkeleton tab="printers" />}>'));
  assert.ok(settingsSrc.includes('<Suspense fallback={<SettingsTabSkeleton tab="backup" />}>'));
  assert.ok(settingsSrc.includes('<Suspense fallback={isStoreAdmin ? <SettingsTabSkeleton tab="notifications_prefs" /> : null}>'));
  assert.ok(settingsSrc.includes('<Suspense fallback={<SettingsTabSkeleton tab="integrations" />}>'));

  // Simpler / modal / inline loading states reuse CenteredLoadingSpinner with "Loading..."
  assert.ok(settingsSrc.includes('<Suspense fallback={<CenteredLoadingSpinner variant="modal" label="Loading..." />}>'));
  assert.ok(settingsSrc.includes('<CenteredLoadingSpinner variant="inline" label="Loading..."'));

  // Shared loaders are exported and theme-aware (light + dark)
  assert.ok(skeletonsSrc.includes('export const CenteredLoadingSpinner'));
  assert.ok(skeletonsSrc.includes('export const SettingsTabSkeleton'));
  assert.ok(skeletonsSrc.includes("label = 'Loading...'"));
  assert.ok(skeletonsSrc.includes('bg-white dark:bg-[#131B2E]'));
  assert.ok(skeletonsSrc.includes('text-slate-600 dark:text-slate-300'));
  assert.ok(skeletonsSrc.includes('role="status"'));
  assert.ok(skeletonsSrc.includes('aria-live="polite"'));
});
