import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('Auth, SuperAdmin Login, and Free Trial registration modal apply responsive breakpoint sizing and backdrop padding', () => {
  const authSrc = readProjectFile('src/components/auth/AuthModal.tsx');
  const saSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');
  const trialSrc = readProjectFile('src/components/saas/FreeTrialOnboardingModal.tsx');

  assert.ok(
    authSrc.includes('mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"') &&
      authSrc.includes('w-full max-w-md sm:max-w-lg lg:max-w-xl mx-auto my-auto') &&
      authSrc.includes('p-5 sm:p-8 md:p-10'),
    'Store AuthModal must use responsive breakpoint sizing and backdrop padding'
  );
  assert.ok(
    saSrc.includes('mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"') &&
      saSrc.includes('w-full max-w-md sm:max-w-lg lg:max-w-xl mx-auto my-auto') &&
      saSrc.includes('p-5 sm:p-8 md:p-10'),
    'SuperAdmin Login card must match Store AuthModal responsive sizing and backdrop padding'
  );
  assert.ok(
    trialSrc.includes('p-4 sm:p-6 md:p-8 overflow-y-auto overflow-x-hidden') &&
      trialSrc.includes('w-full max-w-lg sm:max-w-xl lg:max-w-2xl min-w-0 my-auto') &&
      trialSrc.includes('p-5 sm:p-8 md:p-10 space-y-4 sm:space-y-5'),
    'FreeTrialOnboardingModal must use responsive lg:max-w-2xl sizing, backdrop padding, and progressive inner padding'
  );
});

test('Loading cards and public auth/status/onboarding layouts apply responsive sizing and backdrop padding', () => {
  const loadingSrc = readProjectFile('src/components/common/LoadingWindow.tsx');
  const appSrc = readProjectFile('src/App.tsx');
  const skeletonsSrc = readProjectFile('src/components/common/RouteSkeletons.tsx');
  const publicLayoutSrc = readProjectFile('src/components/common/PublicLayout.tsx');
  const suspendedSrc = readProjectFile('src/components/saas/SuspendedStoreView.tsx');
  const notFoundSrc = readProjectFile('src/components/saas/UnknownStore404View.tsx');
  const onboardingSrc = readProjectFile('src/components/saas/TenantOnboardingWizard.tsx');
  const cssSrc = readProjectFile('src/index.css');

  assert.ok(
    loadingSrc.includes('mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"') &&
      loadingSrc.includes('w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto my-auto') &&
      loadingSrc.includes('p-6 sm:p-8')
  );
  assert.ok(
    appSrc.includes('p-4 sm:p-6 md:p-8 overflow-y-auto') &&
      appSrc.includes('w-full max-w-xs sm:max-w-sm md:max-w-md my-auto') &&
      appSrc.includes('p-6 sm:p-8')
  );
  assert.ok(
    skeletonsSrc.includes('p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-950/75') &&
      skeletonsSrc.includes('w-full max-w-xs sm:max-w-sm md:max-w-md') &&
      skeletonsSrc.includes('p-6 sm:p-8')
  );
  assert.ok(publicLayoutSrc.includes('p-4 sm:p-6 md:p-8 overflow-y-auto'));
  assert.ok(
    suspendedSrc.includes('mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"') &&
      suspendedSrc.includes('w-full max-w-md sm:max-w-lg lg:max-w-xl mx-auto my-auto') &&
      suspendedSrc.includes('p-5 sm:p-8 md:p-10')
  );
  assert.ok(
    notFoundSrc.includes('mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"') &&
      notFoundSrc.includes('w-full max-w-md sm:max-w-lg lg:max-w-xl mx-auto my-auto') &&
      notFoundSrc.includes('p-5 sm:p-8 md:p-10')
  );
  assert.ok(
    onboardingSrc.includes('mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"') &&
      onboardingSrc.includes('w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto my-auto') &&
      onboardingSrc.includes('p-6 sm:p-8')
  );
  assert.ok(cssSrc.includes('padding: 1rem;') && cssSrc.includes('padding: 1.5rem;') && cssSrc.includes('padding: 2rem;'));
});

test('Standard modal overlays have responsive p-4 sm:p-6 md:p-8 backdrop padding, overflow-y-auto, and zero stale px-2/py-2.5 overlays', () => {
  const filesToCheck = [
    'src/components/auth/UserProfileModal.tsx',
    'src/components/common/InstallAppModal.tsx',
    'src/components/common/CashierIdleWarningModal.tsx',
    'src/components/common/LicenseAgreementModal.tsx',
    'src/components/common/UnsavedChangesModal.tsx',
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
    assert.equal(
      /fixed inset-0[^\n"]*p-4 sm:p-6 md:p-8/.test(src),
      true,
      `${file} must apply p-4 sm:p-6 md:p-8 backdrop padding on modal overlays`
    );
    assert.equal(
      /fixed inset-0[^\n"]*overflow-y-auto/.test(src),
      true,
      `${file} must apply overflow-y-auto on modal overlays`
    );
  }
});
