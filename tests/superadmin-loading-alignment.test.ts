import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AnalyticsOverviewSkeleton,
  DirectoryCrudSkeleton,
  FeedLedgerSkeleton,
  RouteSkeleton,
} from '../src/components/common/RouteSkeletons.tsx';
import { SuperAdminReportsView } from '../src/components/saas/SuperAdminReportsView.tsx';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('SuperAdmin & Store Loading UI Alignment', () => {
  it('renders unified minimal LoadingWindow without extra captions, technical jargon, or divergent Shield styling', () => {
    const loadingSrc = readSrc('src/components/common/LoadingWindow.tsx');

    // Unified rounded-2xl ShoeIcon container used for both Store and SuperAdmin
    assert.ok(loadingSrc.includes('<ShoeIcon'));
    assert.ok(
      loadingSrc.includes("src={logoSrc || (isSuperAdminView ? '/admin/pwa-192x192.png' : '/pwa-192x192.png')}")
    );
    assert.ok(
      loadingSrc.includes('w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 flex items-center justify-center shadow-lg border border-purple-500/25')
    );

    // Minimal subtle loader + short friendly copy
    assert.ok(loadingSrc.includes('animate-spin'));
    assert.ok(loadingSrc.includes('<Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-pulse" />'));
    assert.ok(loadingSrc.includes("'Opening your dashboard...'"));
    assert.ok(loadingSrc.includes("'Opening your store...'"));
    assert.ok(!loadingSrc.includes('<Shield'), 'LoadingWindow should not render divergent Shield icon visuals for SuperAdmin');

    // Strip out extra captions & technical/framework terminology from visible UI
    const jsxStart = loadingSrc.indexOf('return (');
    const loadingJsx = jsxStart !== -1 ? loadingSrc.slice(jsxStart) : loadingSrc;
    for (const forbidden of [
      'Laravel',
      'Node.js',
      'PostgreSQL',
      'Control Plane',
      'telemetry',
      'protocols',
      'Offline Resilient',
      'Database Scoped',
      'Tenant Scoped',
      'Multi-Tenant',
      'Dual-engine',
      'Wholesale & Retail POS Suite',
      'offline sales cache',
    ]) {
      assert.equal(
        loadingJsx.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `LoadingWindow JSX must not contain technical/extra caption "${forbidden}"`
      );
    }
  });

  it('uses LoadingWindow only after successful login and as the post-login Suspense fallback for SuperAdminControlPanel in App.tsx', () => {
    const appSrc = readSrc('src/App.tsx');

    // Unauthenticated routes must never render LoadingWindow
    const installerStart = appSrc.indexOf("{saasMode === 'INSTALLER'");
    const authStart = appSrc.indexOf('{/* 0. AUTH ROUTE');
    const verifyStart = appSrc.indexOf('{/* EMAIL VERIFICATION REQUIRED');
    assert.ok(installerStart !== -1 && authStart !== -1 && verifyStart !== -1);

    const preLoginSection = appSrc.slice(installerStart, verifyStart);
    assert.equal(
      preLoginSection.includes('<LoadingWindow'),
      false,
      'INSTALLER, AUTH, and LANDING routes must not show LoadingWindow before login'
    );

    const superAdminSectionStart = appSrc.indexOf('{/* 2. SUPERADMIN CONTROL PANEL (`/admin`) */}');
    const superAdminSectionEnd = appSrc.indexOf('{/* 3. UNKNOWN STORE FALLBACK SCREEN', superAdminSectionStart);
    assert.ok(superAdminSectionStart !== -1 && superAdminSectionEnd !== -1);

    const superAdminBlock = appSrc.slice(superAdminSectionStart, superAdminSectionEnd);
    assert.ok(
      !superAdminBlock.includes('PortalRouteFallback'),
      'SuperAdmin Suspense fallback must not use plain PortalRouteFallback'
    );
    assert.ok(superAdminBlock.includes('<LoadingWindow'), 'SuperAdmin Suspense fallback must render LoadingWindow');
    assert.equal(
      appSrc.includes('telemetry') || appSrc.includes('SuperAdmin Control Plane'),
      false,
      'App.tsx loading messages must stay friendly and free of telemetry/control-plane jargon'
    );
  });

  it('renders route-specific skeletons in SuperAdminControlPanel while keeping header, sidebar, and footer mounted', () => {
    const saSrc = readSrc('src/components/saas/SuperAdminControlPanel.tsx');

    assert.ok(saSrc.includes("from '../common/RouteSkeletons'"));
    assert.ok(saSrc.includes('hasLoadedOnceRef'));
    assert.ok(saSrc.includes('hasLoadedNotificationsOnceRef'));
    assert.ok(saSrc.includes('const [loading, setLoading] = useState(() => isSuperAdmin)'));
    assert.ok(saSrc.includes('const [loadingNotifications, setLoadingNotifications] = useState(() => isSuperAdmin)'));
    assert.ok(saSrc.includes('<AnalyticsOverviewSkeleton />'));
    assert.ok(saSrc.includes('<AnalyticsOverviewSkeleton showFilterBar={true} />'));
    assert.ok(saSrc.includes('<DirectoryCrudSkeleton variant="table" statCount={3} />'));
    assert.ok(saSrc.includes('<DirectoryCrudSkeleton variant="grid" statCount={0} />'));
    assert.ok(saSrc.includes('<FeedLedgerSkeleton />'));
    assert.ok(saSrc.includes('header={superAdminHeader}'));
    assert.ok(saSrc.includes('sidebar={superAdminSidebar}'));
    assert.ok(saSrc.includes('footer={superAdminFooter}'));

    // Verify all SuperAdmin route skeleton variants render cleanly via SSR
    const dashboardSkeletonHtml = renderToStaticMarkup(React.createElement(AnalyticsOverviewSkeleton));
    const reportsSkeletonHtml = renderToStaticMarkup(React.createElement(AnalyticsOverviewSkeleton, { showFilterBar: true }));
    const directorySkeletonHtml = renderToStaticMarkup(React.createElement(DirectoryCrudSkeleton, { variant: 'table', statCount: 3 }));
    const manifestsSkeletonHtml = renderToStaticMarkup(React.createElement(DirectoryCrudSkeleton, { variant: 'grid', statCount: 0 }));
    const notificationsSkeletonHtml = renderToStaticMarkup(React.createElement(FeedLedgerSkeleton));
    const storeDashboardSkeletonHtml = renderToStaticMarkup(React.createElement(RouteSkeleton, { tab: 'dashboard' }));

    assert.equal(dashboardSkeletonHtml, storeDashboardSkeletonHtml);
    assert.ok(reportsSkeletonHtml.includes('aria-label="Loading analytics overview"'));
    assert.ok(directorySkeletonHtml.includes('aria-label="Loading directory workspace"'));
    assert.ok(manifestsSkeletonHtml.includes('aria-label="Loading directory workspace"'));
    assert.ok(notificationsSkeletonHtml.includes('aria-label="Loading activity feed"'));
  });

  it('renders SuperAdminReportsView recent transactions and products without duplicate or undefined React keys', () => {
    const reportsSrc = readSrc('src/components/saas/SuperAdminReportsView.tsx');
    assert.equal(
      /key=\{`[^`]*-\$\{(?:tx|item)\.id\}`\}/.test(reportsSrc),
      false,
      'SuperAdminReportsView must not use bare nullable .id template keys without fallbacks/index'
    );

    const originalConsoleError = console.error;
    const errorMessages: string[] = [];
    console.error = (...args: unknown[]) => {
      errorMessages.push(args.map((a) => String(a)).join(' '));
    };

    try {
      const html = renderToStaticMarkup(
        React.createElement(SuperAdminReportsView, {
          stores: [
            {
              id: 5,
              name: 'Apex Shoes',
              status: 'ACTIVE',
              subscriptionStatus: 'ACTIVE',
              subscriptionPlan: 'YEARLY',
              subscriptionStartDate: '2026-01-01',
              subscriptionEndDate: '2027-01-01',
              logoUrl: '/pwa-192x192.png',
              ownerEmail: 'apex@example.com',
              ownerPhone: '03001234567',
              address: 'Market Road',
              taxId: 'NTN-5',
              currency: 'Rs.',
              onboardingCompleted: true,
              createdAt: '2026-01-01T00:00:00.000Z',
              productCount: 10,
              totalStockUnits: 100,
              salesCount: 2,
              totalSales: 5000,
              staffCount: 3,
            },
            {
              id: 1,
              name: 'Prime Footwear',
              status: 'ACTIVE',
              subscriptionStatus: 'ACTIVE',
              subscriptionPlan: 'YEARLY',
              subscriptionStartDate: '2026-01-01',
              subscriptionEndDate: '2027-01-01',
              logoUrl: '/pwa-192x192.png',
              ownerEmail: 'prime@example.com',
              ownerPhone: '03007654321',
              address: 'Main Boulevard',
              taxId: 'NTN-1',
              currency: 'Rs.',
              onboardingCompleted: true,
              createdAt: '2026-01-01T00:00:00.000Z',
              productCount: 8,
              totalStockUnits: 80,
              salesCount: 2,
              totalSales: 4000,
              staffCount: 2,
            },
          ],
          reportProducts: [],
          reportCategories: [],
          recentTransactions: [
            {
              tenantId: 5,
              storeName: 'Apex Shoes',
              reference: 'INV-5001',
              amount: 2500,
              currency: 'Rs.',
              type: 'Sale',
              date: '2026-11-19T10:00:00.000Z',
              timeString: '10:00 AM',
            },
            {
              tenantId: 5,
              storeName: 'Apex Shoes',
              reference: 'INV-5002',
              amount: 1500,
              currency: 'Rs.',
              type: 'Sale',
              date: '2026-11-19T10:05:00.000Z',
              timeString: '10:05 AM',
            },
            {
              tenantId: 1,
              storeName: 'Prime Footwear',
              reference: 'INV-1001',
              amount: 3000,
              currency: 'Rs.',
              type: 'Sale',
              date: '2026-11-19T10:10:00.000Z',
              timeString: '10:10 AM',
            },
            {
              tenantId: 1,
              storeName: 'Prime Footwear',
              reference: 'RET-1002',
              amount: 900,
              currency: 'Rs.',
              type: 'Return',
              date: '2026-11-19T10:15:00.000Z',
              timeString: '10:15 AM',
            },
          ],
          loading: false,
          onRefresh: () => {},
          onOpenStore: () => {},
        })
      );

      assert.ok(html.includes('INV-5001'));
      assert.ok(html.includes('INV-5002'));
      assert.ok(html.includes('INV-1001'));
      assert.ok(html.includes('RET-1002'));
      assert.equal(
        errorMessages.some((msg) => msg.includes('same key')),
        false,
        `Expected no React duplicate key warnings, got: ${errorMessages.join(' | ')}`
      );
    } finally {
      console.error = originalConsoleError;
    }
  });
});
