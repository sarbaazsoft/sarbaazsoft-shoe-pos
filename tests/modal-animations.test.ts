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
  assert.ok(dataBackupRestore.includes('modal-panel-enter w-full max-w-lg'));

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
  assert.ok(modal.includes('w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-xl min-w-0 mx-3 my-7 sm:mx-4 sm:my-9 max-h-[calc(100dvh-3.5rem)] sm:max-h-[calc(100dvh-4.5rem)]'), 'Modal panel should match +0.25rem responsive outer margin without horizontal overflow');
  assert.ok(modal.includes('className="flex flex-col flex-1 min-h-0 min-w-0 w-full"'));
  assert.ok(modal.includes('p-4 sm:p-7 space-y-3 sm:space-y-4 flex-1 min-w-0 w-full overflow-y-auto overflow-x-hidden'));
  assert.ok(modal.includes('w-full min-w-0 p-3.5 sm:p-5 rounded-2xl'));
  assert.ok(modal.includes('grid grid-cols-1 sm:grid-cols-2 gap-3.5 min-w-0'));
});

