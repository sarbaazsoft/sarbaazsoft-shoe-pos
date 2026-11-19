import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function walkComponentFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkComponentFiles(full));
    } else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

test('CSS includes @media screen overflow-x clip and touch-action manipulation without modifying @media print', () => {
  const css = readProjectFile('src/index.css');
  assert.ok(css.includes('@media screen'), 'Expected @media screen block in src/index.css');
  assert.match(css, /@media screen\s*\{[\s\S]*overflow-x:\s*clip;/);
  assert.match(css, /@media screen\s*\{[\s\S]*touch-action:\s*manipulation;/);
  assert.ok(css.includes('@media print'), 'Expected existing @media print rules to remain intact');
});

test('All <kbd> shortcut hints in components are gated to desktop viewports (>= 1024px)', () => {
  const files = walkComponentFiles(path.join(process.cwd(), 'src/components'));
  const unGatedMatches: string[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      if (!line.includes('<kbd')) return;
      // Check current line or surrounding preceding lines for desktop gating (`hidden lg:`, `!isMobile`, or `isDesktop`)
      const windowStart = Math.max(0, idx - 22);
      const contextWindow = lines.slice(windowStart, idx + 2).join('\n');
      const isGated =
        contextWindow.includes('hidden lg:') ||
        contextWindow.includes('!isMobile') ||
        contextWindow.includes('isDesktop');

      if (!isGated) {
        unGatedMatches.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    unGatedMatches,
    [],
    `Found <kbd> hints without desktop gating (<1024px hidden):\n${unGatedMatches.join('\n')}`
  );
});

test('Shell, skeletons, auth, and modals adopt dynamic viewport units (dvh) instead of mobile-clipping vh/-screen classes', () => {
  const appSrc = readProjectFile('src/App.tsx');
  assert.ok(appSrc.includes('min-h-dvh'), 'App.tsx should use min-h-dvh');
  assert.ok(appSrc.includes('h-dvh lg:h-screen'), 'App.tsx workspace should use h-dvh lg:h-screen');

  const skeletonsSrc = readProjectFile('src/components/common/RouteSkeletons.tsx');
  assert.equal(skeletonsSrc.includes('min-h-screen'), false, 'RouteSkeletons should replace min-h-screen with min-h-dvh');
  assert.ok(skeletonsSrc.includes('min-h-dvh'));

  const dvhChecks: Array<[string, string[]]> = [
    ['src/components/common/Sidebar.tsx', ['max-h-dvh']],
    ['src/components/common/LoadingWindow.tsx', ['min-h-dvh']],
    ['src/components/common/PublicLayout.tsx', ['min-h-dvh']],
    ['src/components/common/InstallAppModal.tsx', ['max-h-[92dvh]']],
    ['src/components/common/CashierIdleWarningModal.tsx', ['max-h-[92dvh]']],
    ['src/components/auth/UserProfileModal.tsx', ['max-h-[92dvh]']],
    ['src/components/auth/AuthModal.tsx', ['min-h-dvh']],
    ['src/components/pos/InvoicePrintModal.tsx', ['max-h-[94dvh]']],
    ['src/components/pos/ShoeExchangeModal.tsx', ['max-h-[92dvh]']],
    ['src/components/pos/OfflineSyncModal.tsx', ['max-h-[92dvh]']],
    ['src/components/pos/CustomerPicker.tsx', ['max-h-[92dvh]', 'max-h-[52dvh]']],
    ['src/components/dashboard/DashboardOverview.tsx', ['min-h-dvh', 'max-h-[94dvh]']],
    ['src/components/inventory/StockAdjustModal.tsx', ['max-h-[92dvh]']],
    ['src/components/inventory/ProductFormModal.tsx', ['max-h-[94dvh]']],
    ['src/components/inventory/BarcodeGeneratorTool.tsx', ['max-h-[95dvh]']],
    ['src/components/purchases/PurchaseManagement.tsx', ['max-h-[94dvh]', 'max-h-[92dvh]']],
    ['src/components/purchases/SupplierPicker.tsx', ['max-h-[92dvh]', 'max-h-[52dvh]']],
    ['src/components/suppliers/SupplierPaymentModal.tsx', ['max-h-[92dvh]']],
    ['src/components/suppliers/SupplierLedgerModal.tsx', ['max-h-[92dvh]']],
    ['src/components/customers/CustomerFormModal.tsx', ['max-h-[92dvh]']],
    ['src/components/customers/CustomerDetailsModal.tsx', ['max-h-[92dvh]']],
    ['src/components/settings/SettingsView.tsx', ['max-h-[92dvh]']],
    ['src/components/settings/CreateStaffModal.tsx', ['max-h-[92dvh]']],
    ['src/components/notifications/NotificationStatusModal.tsx', ['max-h-[92dvh]']],
    ['src/components/notifications/NotificationsView.tsx', ['min-h-dvh', 'max-h-[92dvh]']],
    ['src/components/saas/TenantOnboardingWizard.tsx', ['min-h-dvh']],
    ['src/components/saas/InstallationWizard.tsx', ['max-h-[94dvh]']],
    ['src/components/saas/FreeTrialOnboardingModal.tsx', ['max-h-[92dvh]']],
    ['src/components/saas/SaasLandingPage.tsx', ['min-h-dvh']],
    ['src/components/saas/SuperAdminControlPanel.tsx', ['min-h-dvh', 'max-h-dvh', 'max-h-[92dvh]']],
  ];

  for (const [relPath, tokens] of dvhChecks) {
    const src = readProjectFile(relPath);
    for (const token of tokens) {
      assert.ok(src.includes(token), `Expected ${relPath} to include ${token}`);
    }
  }
});

test('Touch-friendly control sizing, wrapping toolbars, and responsive scanner inputs preserve mobile ergonomics and desktop layout', () => {
  const sidebarSrc = readProjectFile('src/components/common/Sidebar.tsx');
  assert.ok(sidebarSrc.includes('w-11 h-11'));
  assert.ok(sidebarSrc.includes('min-h-[44px]'));
  assert.ok(sidebarSrc.includes('hidden lg:inline text-[10px] font-mono'));

  const headerSrc = readProjectFile('src/components/common/Header.tsx');
  assert.ok(headerSrc.includes('h-10 min-w-[40px] sm:min-w-0 sm:h-8.5'));
  assert.ok(headerSrc.includes('id="header-mobile-search-trigger"'));

  const themeSrc = readProjectFile('src/components/common/ThemeDropdown.tsx');
  assert.ok(themeSrc.includes('h-10 min-w-[40px] sm:min-w-0 sm:h-8.5'));
  assert.ok(themeSrc.includes('max-h-[calc(100dvh-5.5rem)]'));
  assert.ok(themeSrc.includes('max-w-[calc(100vw-2rem)]'));

  const posSrc = readProjectFile('src/components/pos/PosTerminal.tsx');
  assert.ok(posSrc.includes('min-w-[36px] min-h-[36px]'));
  assert.ok(posSrc.includes('id="pos-mobile-scanner-trigger"'));

  const purchaseSrc = readProjectFile('src/components/purchases/PurchaseManagement.tsx');
  assert.ok(purchaseSrc.includes('pr-10 sm:pr-28'));
  assert.ok(purchaseSrc.includes('hidden sm:inline-block absolute right-9'));

  const printerSrc = readProjectFile('src/components/settings/PrinterHardwareSettings.tsx');
  assert.ok(printerSrc.includes('w-full sm:w-auto sm:flex-1 sm:min-w-[180px]'));

  const softPromptSrc = readProjectFile('src/components/notifications/PushNotificationSoftPrompt.tsx');
  assert.ok(softPromptSrc.includes('w-full sm:w-auto sm:flex-1 sm:min-w-[180px]'));

  const superAdminSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');
  assert.ok(superAdminSrc.includes('w-11 h-11 flex items-center justify-center'));
  assert.ok(superAdminSrc.includes('min-h-[44px]'));
  assert.equal(superAdminSrc.includes('<kbd className="text-[10px] font-mono font-bold'), false);
});

test('SaaS landing Navbar maintains balanced margins, shortened mobile subtitle, and overflow-free mobile/tablet/desktop layout', () => {
  const navbarSrc = readProjectFile('src/components/saas/Navbar.tsx');

  // Left brand column must shrink cleanly on mobile/tablet so right-side ThemeDropdown is never clipped
  assert.ok(
    navbarSrc.includes('flex items-center gap-2 sm:gap-3 flex-1 min-w-0 lg:flex-initial lg:shrink-0'),
    'Navbar left column must use flex-1 min-w-0 on mobile/tablet'
  );
  assert.equal(
    navbarSrc.includes('flex items-center gap-2.5 sm:gap-3 shrink-0 min-w-0'),
    false,
    'Navbar left column must not trap width with shrink-0 on small screens'
  );

  // Mobile/tablet drawer threshold moves to lg (1024px) so 768px tablet portrait never overflows
  assert.ok(navbarSrc.includes('window.innerWidth >= 1024'));
  assert.ok(navbarSrc.includes('className="flex lg:hidden shrink-0"'));
  assert.ok(navbarSrc.includes('className="hidden lg:flex items-center gap-0.5 xl:gap-2 shrink-0'));
  assert.ok(navbarSrc.includes('className="hidden lg:flex items-center gap-2 xl:gap-2.5 font-courgette"'));
  assert.ok(navbarSrc.includes('max-h-[calc(100dvh-4.5rem)]'));

  // Balanced outer container & symmetric right action spacing (no mr-0.5 or space-x-*)
  assert.ok(navbarSrc.includes('max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'));
  assert.ok(navbarSrc.includes('className="flex items-center gap-2 lg:gap-2.5 shrink-0"'));
  assert.equal(navbarSrc.includes('mr-0.5'), false);

  // Mobile subtitle is shortened while full subtitle remains visible on sm+ screens
  assert.ok(navbarSrc.includes('resolveMobileSubtitle'));
  assert.ok(navbarSrc.includes('<span className="sm:hidden truncate">{compactSubtitle}</span>'));
  assert.ok(navbarSrc.includes('<span className="hidden sm:inline truncate lg:max-w-[180px] xl:max-w-none">{subtitle}</span>'));
});
