import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BodyLayoutWrapper } from '../src/components/common/BodyLayoutWrapper.tsx';
import {
  DEFAULT_COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  ROUTE_LAYOUT_METADATA,
  resolveRouteLayoutMetadata,
  type SaasRouteMode,
} from '../src/config/routeLayoutMetadata.ts';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('Route Layout Metadata Configuration', () => {
  it('defines metadata for every SaaS route mode', () => {
    const expectedModes: SaasRouteMode[] = [
      'INSTALLER',
      'LANDING',
      'AUTH',
      'SUPERADMIN',
      'TENANT_ACTIVE',
      'TENANT_SUSPENDED',
      'TENANT_EXPIRED',
      'TENANT_NOT_FOUND',
      'TENANT_ONBOARDING',
      'VERIFY_EMAIL',
    ];

    for (const mode of expectedModes) {
      assert.ok(ROUTE_LAYOUT_METADATA[mode], `Missing metadata for route mode ${mode}`);
    }
  });

  it('resolves Dashboard routes with Header + Sidebar + Main Content + Footer', () => {
    const tenantDash = resolveRouteLayoutMetadata('TENANT_ACTIVE', {
      tab: 'dashboard',
      isAuthenticated: true,
    });
    assert.equal(tenantDash.preset, 'dashboard');
    assert.equal(tenantDash.showHeader, true);
    assert.equal(tenantDash.showSidebar, true);
    assert.equal(tenantDash.showFooter, true);
    assert.equal(tenantDash.centerMain, false);
    assert.equal(tenantDash.sidebarWidth, DEFAULT_SIDEBAR_WIDTH);
    assert.equal(tenantDash.collapsedSidebarWidth, DEFAULT_COLLAPSED_SIDEBAR_WIDTH);

    const superAdminDash = resolveRouteLayoutMetadata('SUPERADMIN', {
      isAuthenticated: true,
    });
    assert.equal(superAdminDash.preset, 'dashboard');
    assert.equal(superAdminDash.showHeader, true);
    assert.equal(superAdminDash.showSidebar, true);
    assert.equal(superAdminDash.showFooter, true);
    assert.equal(superAdminDash.centerMain, false);
  });

  it('resolves SaaS Landing route with Header + Main Content + Footer and NO sidebar', () => {
    const landing = resolveRouteLayoutMetadata('LANDING', { isLoginModalOpen: false });
    assert.equal(landing.preset, 'landing');
    assert.equal(landing.showHeader, true);
    assert.equal(landing.showSidebar, false);
    assert.equal(landing.showFooter, true);
    assert.equal(landing.centerMain, false);
  });

  it('resolves Authentication routes with centered Main Content and NO sidebar', () => {
    const authDirect = resolveRouteLayoutMetadata('AUTH');
    assert.equal(authDirect.preset, 'auth');
    assert.equal(authDirect.showSidebar, false);
    assert.equal(authDirect.centerMain, true);

    const landingAuthModal = resolveRouteLayoutMetadata('LANDING', { isLoginModalOpen: true });
    assert.equal(landingAuthModal.preset, 'auth');
    assert.equal(landingAuthModal.showSidebar, false);
    assert.equal(landingAuthModal.centerMain, true);

    const superAdminAuth = resolveRouteLayoutMetadata('SUPERADMIN', { isAuthenticated: false });
    assert.equal(superAdminAuth.preset, 'auth');
    assert.equal(superAdminAuth.showSidebar, false);
    assert.equal(superAdminAuth.centerMain, true);
  });

  it('supports configurable layout visibility and sidebar width via overrides', () => {
    const custom = resolveRouteLayoutMetadata('TENANT_ACTIVE', {
      overrides: {
        showHeader: false,
        showFooter: false,
        sidebarWidth: 312,
        centerMain: true,
      },
    });
    assert.equal(custom.showHeader, false);
    assert.equal(custom.showSidebar, true);
    assert.equal(custom.showFooter, false);
    assert.equal(custom.sidebarWidth, 312);
    assert.equal(custom.centerMain, true);

    const suspended = resolveRouteLayoutMetadata('TENANT_SUSPENDED');
    assert.equal(suspended.showHeader, false);
    assert.equal(suspended.showSidebar, false);
    assert.equal(suspended.showFooter, false);
    assert.equal(suspended.centerMain, true);

    const onboarding = resolveRouteLayoutMetadata('TENANT_ONBOARDING');
    assert.equal(onboarding.showHeader, true);
    assert.equal(onboarding.showSidebar, false);
    assert.equal(onboarding.showFooter, true);
    assert.equal(onboarding.centerMain, false);
  });
});

describe('BodyLayoutWrapper Component Structure & Props', () => {
  it('renders Flexbox Header -> Body (Sidebar + Main flex-1) -> Footer with min-h-[100dvh]', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        BodyLayoutWrapper,
        {
          layoutMeta: resolveRouteLayoutMetadata('TENANT_ACTIVE'),
          sidebarWidth: 280,
          header: React.createElement('header', null, 'Top Header'),
          sidebar: React.createElement('aside', null, 'Left Sidebar'),
          footer: React.createElement('footer', null, 'Bottom Footer'),
        },
        React.createElement('div', null, 'Main Workspace')
      )
    );

    assert.ok(html.includes('min-h-[100dvh]'), 'Wrapper must use min-h-[100dvh]');
    assert.ok(html.includes('flex-col'), 'Outer wrapper must be vertical flex column');
    assert.ok(html.includes('overflow-x-clip'), 'Outer wrapper must use overflow-x-clip so sticky children work');
    assert.ok(html.includes('data-layout-section="header"'), 'Header section must render');
    assert.ok(html.includes('data-layout-section="body"'), 'Middle body section must render');
    assert.ok(html.includes('data-layout-section="sidebar"'), 'Sidebar section must render');
    assert.ok(html.includes('data-layout-section="main"'), 'Main content section must render');
    assert.ok(html.includes('data-layout-section="footer"'), 'Footer section must render');
    assert.ok(html.includes('flex-1 min-w-0 flex flex-col'), 'Main element must use flex-1');
    assert.ok(html.includes('--layout-sidebar-width:280px'), 'Configurable sidebarWidth CSS variable should be set');
    assert.ok(html.includes('width:280px'), 'Configurable sidebarWidth should size sidebar container');

    const bodySectionMatch = html.match(/<div data-layout-section="body"[^>]*>/);
    assert.ok(bodySectionMatch, 'Expected body section container tag');
    assert.equal(
      bodySectionMatch[0].includes('z-10'),
      false,
      'Body section must not create a z-10 stacking context that traps drawers/modals underneath the z-40 header'
    );

    const headerIdx = html.indexOf('data-layout-section="header"');
    const bodyIdx = html.indexOf('data-layout-section="body"');
    const sidebarIdx = html.indexOf('data-layout-section="sidebar"');
    const mainIdx = html.indexOf('data-layout-section="main"');
    const footerIdx = html.indexOf('data-layout-section="footer"');
    assert.ok(headerIdx < bodyIdx && bodyIdx < sidebarIdx && sidebarIdx < mainIdx && mainIdx < footerIdx);
  });

  it('supports CSS length sidebarWidth and sidebarSelfSized mode', () => {
    const cssWidthHtml = renderToStaticMarkup(
      React.createElement(
        BodyLayoutWrapper,
        {
          showSidebar: true,
          sidebarWidth: '19rem',
          sidebar: React.createElement('aside', null, 'Nav'),
        },
        React.createElement('p', null, 'Body')
      )
    );
    assert.ok(cssWidthHtml.includes('width:19rem'));

    const selfSizedHtml = renderToStaticMarkup(
      React.createElement(
        BodyLayoutWrapper,
        {
          showSidebar: true,
          sidebarSelfSized: true,
          sidebar: React.createElement('aside', null, 'Responsive Sidebar'),
        },
        React.createElement('p', null, 'Body')
      )
    );
    const sidebarSectionMatch = selfSizedHtml.match(/<div data-layout-section="sidebar"[^>]*>/);
    assert.ok(sidebarSectionMatch, 'Expected sidebar container tag');
    assert.ok(!sidebarSectionMatch[0].includes('hidden lg:flex'), 'Self-sized sidebar wrapper must not hide mobile drawer');
    assert.ok(!sidebarSectionMatch[0].includes('style='), 'Self-sized sidebar wrapper delegates width to Sidebar');
  });

  it('respects route metadata visibility flags and centers main when centerMain is true', () => {
    const authHtml = renderToStaticMarkup(
      React.createElement(
        BodyLayoutWrapper,
        {
          layoutMeta: {
            ...resolveRouteLayoutMetadata('AUTH'),
            showHeader: false,
            showFooter: false,
          },
          header: React.createElement('header', null, 'Should Not Render Header'),
          sidebar: React.createElement('aside', null, 'Should Not Render Sidebar'),
          footer: React.createElement('footer', null, 'Should Not Render Footer'),
        },
        React.createElement('form', null, 'Sign In Card')
      )
    );

    assert.ok(!authHtml.includes('Should Not Render Header'));
    assert.ok(!authHtml.includes('Should Not Render Sidebar'));
    assert.ok(!authHtml.includes('Should Not Render Footer'));
    assert.ok(authHtml.includes('data-has-header="false"'));
    assert.ok(authHtml.includes('data-has-sidebar="false"'));
    assert.ok(authHtml.includes('data-has-footer="false"'));
    assert.ok(authHtml.includes('data-center-main="true"'));
    assert.ok(authHtml.includes('items-center justify-center'));
    assert.ok(authHtml.includes('Sign In Card'));
  });
});

describe('Global Route Integration with BodyLayoutWrapper', () => {
  it('routes App.tsx, SaaS pages, Auth, Onboarding, and SuperAdmin through BodyLayoutWrapper & routeLayoutMetadata', () => {
    const appSrc = readSrc('src/App.tsx');
    assert.ok(appSrc.includes('BodyLayoutWrapper'), 'App.tsx must import and use BodyLayoutWrapper');
    assert.ok(appSrc.includes('resolveRouteLayoutMetadata'), 'App.tsx must use resolveRouteLayoutMetadata');
    assert.ok(appSrc.includes('embeddedInBodyLayout={true}'), 'App.tsx Sidebar must use embeddedInBodyLayout={true}');

    const landingSrc = readSrc('src/components/saas/SaasLandingPage.tsx');
    assert.ok(landingSrc.includes('BodyLayoutWrapper'));
    assert.ok(landingSrc.includes("resolveRouteLayoutMetadata('LANDING'"));

    const authSrc = readSrc('src/components/auth/AuthModal.tsx');
    assert.ok(authSrc.includes('BodyLayoutWrapper'));
    assert.ok(authSrc.includes("resolveRouteLayoutMetadata('AUTH'"));

    const superAdminSrc = readSrc('src/components/saas/SuperAdminControlPanel.tsx');
    assert.ok(superAdminSrc.includes('BodyLayoutWrapper'));
    assert.ok(superAdminSrc.includes("resolveRouteLayoutMetadata('SUPERADMIN'"));

    const onboardingSrc = readSrc('src/components/saas/TenantOnboardingWizard.tsx');
    assert.ok(onboardingSrc.includes('BodyLayoutWrapper'));
    assert.ok(onboardingSrc.includes("resolveRouteLayoutMetadata('TENANT_ONBOARDING'"));

    const publicLayoutSrc = readSrc('src/components/common/PublicLayout.tsx');
    assert.ok(publicLayoutSrc.includes('BodyLayoutWrapper'));

    const loadingSrc = readSrc('src/components/common/LoadingWindow.tsx');
    assert.ok(loadingSrc.includes('BodyLayoutWrapper'));

    const suspendedSrc = readSrc('src/components/saas/SuspendedStoreView.tsx');
    assert.ok(suspendedSrc.includes('BodyLayoutWrapper'));

    const notFoundSrc = readSrc('src/components/saas/UnknownStore404View.tsx');
    assert.ok(notFoundSrc.includes('BodyLayoutWrapper'));
  });

  it('pins Auth header to top without external alert siblings and routes email confirmation to AUTH cleanly', () => {
    const appSrc = readSrc('src/App.tsx');
    const authSrc = readSrc('src/components/auth/AuthModal.tsx');
    const publicHeaderSrc = readSrc('src/components/common/PublicHeader.tsx');

    // tenantIdNotice must be passed into AuthModal, never rendered above AuthModal outside BodyLayoutWrapper
    const showAuthBlockMatch = appSrc.match(/\{showAuthModal && \(([\s\S]*?)<AuthModal/);
    assert.ok(showAuthBlockMatch, 'Expected showAuthModal block in App.tsx');
    assert.equal(
      showAuthBlockMatch[1].includes('role="alert"'),
      false,
      'Must not render alert banner outside AuthModal BodyLayoutWrapper (it pushes PublicHeader down)'
    );
    assert.ok(appSrc.includes('tenantNotice={tenantIdNotice || null}'), 'App.tsx should pass tenantNotice into AuthModal');
    assert.ok(authSrc.includes('{tenantNotice && ('), 'AuthModal should render tenantNotice inside BodyLayoutWrapper main');

    // Verify email -> login redirect routes to AUTH with scroll reset
    const verifyBlockMatch = appSrc.match(/saasMode === 'VERIFY_EMAIL'[\s\S]*?<VerifyEmailNoticeView([\s\S]*?)\/>/);
    assert.ok(verifyBlockMatch, 'Expected VerifyEmailNoticeView block in App.tsx');
    assert.ok(verifyBlockMatch[1].includes("setSaasMode('AUTH')"), 'VerifyEmailNoticeView onNavigateLogin should route unauthenticated users to AUTH');
    assert.ok(verifyBlockMatch[1].includes('setIsLoginModalOpen(true)'), 'VerifyEmailNoticeView onNavigateLogin should open auth view');
    assert.ok(verifyBlockMatch[1].includes('window.scrollTo'), 'VerifyEmailNoticeView redirect should reset scroll to top');

    // PublicHeader sits directly inside BodyLayoutWrapper sticky header slot without nested sticky wrapper
    assert.ok(publicHeaderSrc.includes('id="global-public-header"'));
    assert.equal(
      publicHeaderSrc.includes('sticky top-0'),
      false,
      'PublicHeader should rely on BodyLayoutWrapper data-layout-section="header" sticky container without nested sticky'
    );
  });

  it('applies 2rem margin around the Auth route login card without horizontal overflow', () => {
    const authSrc = readSrc('src/components/auth/AuthModal.tsx');
    assert.ok(
      authSrc.includes('className="w-[calc(100%-4rem)] max-w-md m-8"'),
      'AuthModal login card wrapper should apply 2rem (m-8) margin and calc(100%-4rem) width'
    );
  });
});
