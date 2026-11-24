import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('Auth, SuperAdmin Login, and Free Trial registration modal share consistent +0.25rem outer spacing', () => {
  const authSrc = readProjectFile('src/components/auth/AuthModal.tsx');
  const saSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');
  const trialSrc = readProjectFile('src/components/saas/FreeTrialOnboardingModal.tsx');

  assert.ok(
    authSrc.includes('w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-md mx-3 my-7 sm:mx-4 sm:my-9'),
    'Store AuthModal must have +0.25rem outer margins and synced calc width'
  );
  assert.ok(
    saSrc.includes('mainClassName="relative z-10 w-full py-9 sm:py-13"'),
    'SuperAdmin Login main container must have +0.25rem vertical padding'
  );
  assert.ok(
    saSrc.includes('w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-md mx-3 sm:mx-4'),
    'SuperAdmin Login card must match Store AuthModal horizontal outer spacing'
  );
  assert.ok(
    trialSrc.includes(
      'w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-xl min-w-0 mx-3 my-7 sm:mx-4 sm:my-9 max-h-[calc(100dvh-3.5rem)] sm:max-h-[calc(100dvh-4.5rem)]'
    ),
    'FreeTrialOnboardingModal must match AuthModal outer margins and update max-h calc bounds'
  );
});

test('Loading cards and public auth/status/onboarding layouts apply +0.25rem outer spacing', () => {
  const loadingSrc = readProjectFile('src/components/common/LoadingWindow.tsx');
  const appSrc = readProjectFile('src/App.tsx');
  const skeletonsSrc = readProjectFile('src/components/common/RouteSkeletons.tsx');
  const publicLayoutSrc = readProjectFile('src/components/common/PublicLayout.tsx');
  const suspendedSrc = readProjectFile('src/components/saas/SuspendedStoreView.tsx');
  const notFoundSrc = readProjectFile('src/components/saas/UnknownStore404View.tsx');
  const onboardingSrc = readProjectFile('src/components/saas/TenantOnboardingWizard.tsx');
  const cssSrc = readProjectFile('src/index.css');

  assert.ok(loadingSrc.includes('mainClassName="relative z-10 px-3 py-7 sm:px-4"'));
  assert.ok(appSrc.includes('bg-slate-200 dark:bg-[#0A0E1A] text-slate-700 dark:text-slate-200 p-7'));
  assert.ok(skeletonsSrc.includes('px-3 py-4 sm:px-4 sm:py-5 bg-slate-950/75'));
  assert.ok(publicLayoutSrc.includes('px-3 py-7 sm:px-5 sm:py-9'));
  assert.ok(suspendedSrc.includes('mainClassName="relative z-10 px-3 py-5 sm:px-5 sm:py-7"'));
  assert.ok(notFoundSrc.includes('mainClassName="p-4.5 sm:p-7 relative"'));
  assert.ok(onboardingSrc.includes('mainClassName="relative z-10 w-full py-6 sm:py-9 px-4 sm:px-7"'));
  assert.ok(cssSrc.includes('padding: 0.875rem;'));
  assert.ok(cssSrc.includes('padding: 1.25rem;'));
});

test('Standard modal overlays have +0.25rem outer padding and zero stale px-2/py-2.5 overlays', () => {
  const filesToCheck = [
    'src/components/auth/UserProfileModal.tsx',
    'src/components/common/InstallAppModal.tsx',
    'src/components/common/CashierIdleWarningModal.tsx',
    'src/components/common/LicenseAgreementModal.tsx',
    'src/components/notifications/NotificationStatusModal.tsx',
    'src/components/notifications/NotificationsView.tsx',
    'src/components/saas/SuperAdminControlPanel.tsx',
    'src/components/saas/SuperAdminFreeTrialsView.tsx',
    'src/components/settings/CreateStaffModal.tsx',
    'src/components/settings/DataBackupRestore.tsx',
    'src/components/settings/SettingsView.tsx',
    'src/components/reports/ReportsDashboard.tsx',
    'src/components/dashboard/DashboardOverview.tsx',
    'src/components/inventory/StockAdjustModal.tsx',
    'src/components/inventory/ProductFormModal.tsx',
    'src/components/inventory/SideEndBoxLabelModal.tsx',
    'src/components/inventory/CsvImportModal.tsx',
    'src/components/inventory/BarcodeGeneratorTool.tsx',
    'src/components/inventory/BarcodeStickerModal.tsx',
    'src/components/pos/InvoicePrintModal.tsx',
    'src/components/pos/ShoeExchangeModal.tsx',
    'src/components/pos/CustomerPicker.tsx',
    'src/components/pos/OfflineSyncModal.tsx',
    'src/components/pos/PosTerminal.tsx',
    'src/components/customers/CustomerFormModal.tsx',
    'src/components/customers/CustomerManagement.tsx',
    'src/components/customers/CustomerDetailsModal.tsx',
    'src/components/purchases/PurchaseManagement.tsx',
    'src/components/purchases/PurchaseReturnDetailsModal.tsx',
    'src/components/purchases/SupplierReturnModal.tsx',
    'src/components/purchases/SupplierPicker.tsx',
    'src/components/suppliers/SupplierPaymentModal.tsx',
    'src/components/suppliers/SupplierManagement.tsx',
    'src/components/suppliers/SupplierLedgerModal.tsx',
  ];

  for (const file of filesToCheck) {
    const src = readProjectFile(file);
    assert.equal(
      /fixed inset-0[^\n"]*\b(px-2|py-2\.5)\b/.test(src),
      false,
      `${file} must not retain stale px-2 or py-2.5 on a fixed inset-0 modal overlay`
    );
  }
});
