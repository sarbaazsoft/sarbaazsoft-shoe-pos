import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readWorkspaceFile = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('src/index.css defines subtle modal fade-in and scale-up animations with reduced-motion and print guards', () => {
  const css = readWorkspaceFile('src/index.css');

  assert.match(css, /@keyframes modalBackdropFadeIn/);
  assert.match(css, /@keyframes modalPanelEnter[\s\S]*scale\(0\.96\)[\s\S]*transform:\s*none/);
  assert.match(css, /\.modal-backdrop-enter\s*\{[\s\S]*modalBackdropFadeIn/);
  assert.match(css, /\.modal-panel-enter\s*\{[\s\S]*modalPanelEnter/);
  assert.match(css, /\.form-modal-theme\.fixed\.inset-0:not\(\[data-motion-modal="true"\]\)/);
  assert.match(css, /\.form-modal-theme\.fixed\.inset-0\s*>\s*:not\(\[data-motion-modal="true"\]\):not\(\[aria-hidden="true"\]\):not\(\.hidden\)/);
  assert.match(css, /\.animate-in\.fade-in\.zoom-in-95:not\(\[data-motion-modal="true"\]\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*modalBackdropFadeIn/);
  assert.match(css, /@media print[\s\S]*\.modal-panel-enter[\s\S]*animation:\s*none\s*!important/);
});

test('Framer Motion modal elements opt out of duplicate CSS modal entrance animations', () => {
  const motionModalFiles = [
    { path: 'src/components/inventory/StockAdjustModal.tsx', count: 2 },
    { path: 'src/components/inventory/ProductFormModal.tsx', count: 2 },
    { path: 'src/components/inventory/BarcodeGeneratorTool.tsx', count: 2 },
    { path: 'src/components/inventory/CsvImportModal.tsx', count: 2 },
    { path: 'src/components/inventory/BarcodeStickerModal.tsx', count: 2 },
    { path: 'src/components/inventory/SideEndBoxLabelModal.tsx', count: 2 },
    { path: 'src/components/settings/CreateStaffModal.tsx', count: 2 },
    { path: 'src/components/saas/FreeTrialOnboardingModal.tsx', count: 2 },
    { path: 'src/components/suppliers/SupplierPaymentModal.tsx', count: 1 },
    { path: 'src/components/suppliers/SupplierLedgerModal.tsx', count: 1 },
    { path: 'src/components/customers/CustomerManagement.tsx', count: 1 },
    { path: 'src/components/settings/SettingsView.tsx', count: 1 },
    { path: 'src/components/notifications/NotificationStatusModal.tsx', count: 1 },
    { path: 'src/components/pos/OfflineSyncModal.tsx', count: 1 },
  ];

  for (const entry of motionModalFiles) {
    const src = readWorkspaceFile(entry.path);
    const matches = src.match(/data-motion-modal="true"/g) || [];
    assert.equal(
      matches.length,
      entry.count,
      `${entry.path} should mark ${entry.count} Framer Motion modal element(s) with data-motion-modal="true"`
    );
  }
});

test('Standalone non-form-modal-theme modals apply modal-backdrop-enter and modal-panel-enter classes', () => {
  const notificationsView = readWorkspaceFile('src/components/notifications/NotificationsView.tsx');
  assert.ok(notificationsView.includes('modal-backdrop-enter fixed inset-0'));
  assert.ok(notificationsView.includes('modal-panel-enter relative w-full max-w-lg'));

  const dataBackupRestore = readWorkspaceFile('src/components/settings/DataBackupRestore.tsx');
  assert.ok(dataBackupRestore.includes('modal-backdrop-enter fixed inset-0'));
  assert.ok(dataBackupRestore.includes('modal-panel-enter w-full max-w-md sm:max-w-lg lg:max-w-xl'));

  const reportsDashboard = readWorkspaceFile('src/components/reports/ReportsDashboard.tsx');
  assert.equal((reportsDashboard.match(/modal-backdrop-enter fixed inset-0/g) || []).length, 2);
  assert.equal((reportsDashboard.match(/modal-panel-enter w-full/g) || []).length, 2);

  const statusModal = readWorkspaceFile('src/components/notifications/NotificationStatusModal.tsx');
  assert.ok(statusModal.includes('modal-backdrop-enter fixed inset-0'));

  const offlineModal = readWorkspaceFile('src/components/pos/OfflineSyncModal.tsx');
  assert.ok(offlineModal.includes('modal-backdrop-enter fixed inset-0'));
});

test('FreeTrialOnboardingModal and PasswordRequirementsTooltip prevent horizontal overflow and extra blank width on small devices', () => {
  const tooltip = readWorkspaceFile('src/components/common/PasswordRequirementsTooltip.tsx');
  assert.ok(tooltip.includes('{isOpen && ('), 'Tooltip popover should only mount when open');
  assert.ok(!tooltip.includes('left-1/2 -translate-x-1/2'), 'Top/bottom tooltip must align inward (right-0) instead of overflowing right');
  assert.ok(tooltip.includes("top: 'bottom-full right-0 mb-2'"));

  const modal = readWorkspaceFile('src/components/saas/FreeTrialOnboardingModal.tsx');
  assert.ok(modal.includes('overflow-y-auto overflow-x-hidden'), 'Overlay and body must prevent horizontal scroll');
  assert.ok(modal.includes('w-full max-w-lg sm:max-w-xl lg:max-w-2xl min-w-0 my-auto max-h-[92dvh] sm:max-h-[90dvh]'), 'Modal panel should use responsive breakpoints without horizontal overflow');
  assert.ok(modal.includes('className="flex flex-col flex-1 min-h-0 min-w-0 w-full"'));
  assert.ok(modal.includes('p-5 sm:p-8 md:p-10 space-y-4 sm:space-y-5 flex-1 min-w-0 w-full overflow-y-auto overflow-x-hidden'));
  assert.ok(modal.includes('w-full min-w-0 p-4 sm:p-6 rounded-2xl'));
  assert.ok(modal.includes('grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0'));
});

test('Multi-column form grids align sibling labels on one non-wrapping row so inputs never misalign vertically', () => {
  const freeTrial = readWorkspaceFile('src/components/saas/FreeTrialOnboardingModal.tsx');
  assert.ok(
    freeTrial.includes('flex items-center justify-between gap-2 mb-1.5 min-h-[20px] min-w-0'),
    'FreeTrialOnboardingModal Name and Phone label rows should share exact single-line height'
  );
  assert.ok(
    !freeTrial.includes('flex flex-wrap items-center justify-between gap-1 mb-1.5'),
    'FreeTrialOnboardingModal must not flex-wrap top label hints above the Phone input'
  );

  const guardedFiles = [
    { path: 'src/components/saas/InstallationWizard.tsx', expectedMinH: 'min-h-[24px]' },
    { path: 'src/components/settings/CreateStaffModal.tsx', expectedMinH: 'min-h-[20px]' },
    { path: 'src/components/saas/SuperAdminControlPanel.tsx', expectedMinH: 'min-h-[22px]' },
    { path: 'src/components/saas/TenantOnboardingWizard.tsx', expectedMinH: 'min-h-[22px]' },
    { path: 'src/components/settings/SettingsView.tsx', expectedMinH: 'min-h-[24px]' },
    { path: 'src/components/settings/NotificationAlertProvidersSettings.tsx', expectedMinH: 'min-h-[20px]' },
    { path: 'src/components/suppliers/SupplierManagement.tsx', expectedMinH: 'min-h-[22px]' },
    { path: 'src/components/purchases/SupplierPicker.tsx', expectedMinH: 'min-h-[22px]' },
  ];

  for (const entry of guardedFiles) {
    const src = readWorkspaceFile(entry.path);
    assert.ok(
      src.includes(entry.expectedMinH) && src.includes('truncate') && src.includes('whitespace-nowrap'),
      `${entry.path} should enforce single-line min-height label alignment and non-wrapping status pills`
    );
  }

  const productModal = readWorkspaceFile('src/components/inventory/ProductFormModal.tsx');
  assert.ok(
    productModal.includes('sm:min-h-[2rem]'),
    'ProductFormModal pricing cards should keep helper text uniform height so adjacent inputs stay level'
  );
});

