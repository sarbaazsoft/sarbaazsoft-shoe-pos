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

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('SuperAdmin & Store Loading UI Alignment', () => {
  it('renders unified LoadingWindow visual card structure without divergent SuperAdmin Shield styling', () => {
    const loadingSrc = readSrc('src/components/common/LoadingWindow.tsx');

    // Unified rounded-2xl ShoeIcon container & live green dot used for both Store and SuperAdmin
    assert.ok(loadingSrc.includes('<ShoeIcon'));
    assert.ok(
      loadingSrc.includes("src={logoSrc || (isSuperAdminView ? '/admin/pwa-192x192.png' : '/pwa-192x192.png')}")
    );
    assert.ok(
      loadingSrc.includes('w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 flex items-center justify-center shadow-lg border border-purple-500/25')
    );

    // Unified indigo Sparkles pill badge & Sparkles spinner center icon
    assert.ok(loadingSrc.includes('bg-indigo-500/15 dark:bg-indigo-900/40 border border-indigo-400/30 text-indigo-700 dark:text-indigo-300'));
    assert.ok(loadingSrc.includes('<Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400 animate-pulse" />'));
    assert.ok(!loadingSrc.includes('<Shield'), 'LoadingWindow should not render divergent Shield icon visuals for SuperAdmin');
  });

  it('uses LoadingWindow as the post-login Suspense fallback for SuperAdminControlPanel in App.tsx', () => {
    const appSrc = readSrc('src/App.tsx');
    const superAdminSectionStart = appSrc.indexOf('{/* 2. SUPERADMIN CONTROL PANEL (`/admin`) */}');
    const superAdminSectionEnd = appSrc.indexOf('{/* 3. UNKNOWN STORE FALLBACK SCREEN', superAdminSectionStart);
    assert.ok(superAdminSectionStart !== -1 && superAdminSectionEnd !== -1);

    const superAdminBlock = appSrc.slice(superAdminSectionStart, superAdminSectionEnd);
    assert.ok(
      !superAdminBlock.includes('PortalRouteFallback'),
      'SuperAdmin Suspense fallback must not use plain PortalRouteFallback'
    );
    assert.ok(superAdminBlock.includes('<LoadingWindow'), 'SuperAdmin Suspense fallback must render LoadingWindow');
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
});
