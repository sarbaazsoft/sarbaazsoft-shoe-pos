import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('Store Header renders brand logo and SarbaazSoft Shoe POS app name alongside mobile menu toggle and quick search', () => {
  const headerSrc = readProjectFile('src/components/common/Header.tsx');

  assert.ok(headerSrc.includes("import { ShoeIcon } from './ShoeIcon.tsx';"), 'Store Header must import ShoeIcon');

  const headerTagIdx = headerSrc.indexOf('<header ');
  assert.ok(headerTagIdx !== -1, 'Store Header <header> element must exist');
  const headerMarkup = headerSrc.slice(headerTagIdx);

  assert.ok(headerMarkup.includes('id="header-brand-home-btn"'), 'Store Header must include brand home trigger');
  assert.ok(headerMarkup.includes('hidden lg:flex items-center gap-2.5 min-w-0 lg:w-[236px]'), 'Store Header brand logo must be hidden on small devices (< lg) and shown on desktop');
  assert.ok(headerMarkup.includes('src="/pwa-192x192.png"'), 'Store Header must render brand logo /pwa-192x192.png');
  assert.ok(headerMarkup.includes('alt="SarbaazSoft Shoe POS Logo"'), 'Store Header brand logo must use descriptive alt text');
  assert.ok(headerMarkup.includes('SarbaazSoft Shoe POS'), 'Store Header must display SarbaazSoft Shoe POS app name');
  assert.ok(headerMarkup.includes('aria-label="Toggle navigation menu"'), 'Store Header must preserve mobile navigation toggle');
  assert.ok(headerMarkup.includes('id="header-mobile-search-trigger"'), 'Store Header must preserve mobile search trigger');
});

test('Store Sidebar displays brand logo alongside dynamic store name with consistent h-[3.6rem] branding header', () => {
  const sidebarSrc = readProjectFile('src/components/common/Sidebar.tsx');

  assert.ok(sidebarSrc.includes("import { ShoeIcon } from './ShoeIcon.tsx';"));
  assert.ok(sidebarSrc.includes('h-[3.6rem] flex items-center shrink-0 transition-colors'));
  assert.ok(
    sidebarSrc.includes("src={companySettings?.logo || '/pwa-192x192.png'}"),
    'Store Sidebar must render brand logo with explicit /pwa-192x192.png fallback'
  );
  assert.ok(
    sidebarSrc.includes('alt={`${storeName} Logo`}'),
    'Store Sidebar brand logo must use dynamic storeName alt attribute'
  );
  assert.ok(sidebarSrc.includes('{storeName}'), 'Store Sidebar must display dynamic storeName alongside logo');
  assert.ok(sidebarSrc.includes('SarbaazSoft Shoe POS'), 'Store Sidebar must include SarbaazSoft Shoe POS app name');
  assert.ok(sidebarSrc.includes('id="sidebar-close-mobile-btn"'), 'Store Sidebar must preserve mobile close button');
  assert.ok(sidebarSrc.includes('id="sidebar-collapse-toggle-btn"'), 'Store Sidebar must preserve desktop collapse button');
  assert.ok(sidebarSrc.includes('z-[60] lg:hidden'), 'Store mobile sidebar drawer must stack above z-40 header');
  assert.ok(sidebarSrc.includes('createPortal(mobileDrawer, document.body)'), 'Store mobile sidebar drawer must portal to document.body');
});

test('Super Admin Header renders brand logo and SarbaazSoft Shoe POS app name alongside menu toggle and search bar', () => {
  const saSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');

  const headerStart = saSrc.indexOf('const superAdminHeader = (');
  const headerEnd = saSrc.indexOf('return (', headerStart);
  assert.ok(headerStart !== -1 && headerEnd !== -1, 'superAdminHeader definition must exist');
  const headerBlock = saSrc.slice(headerStart, headerEnd);

  assert.ok(headerBlock.includes('id="superadmin-header-brand-home-btn"'), 'Super Admin Header must include brand home trigger');
  assert.ok(headerBlock.includes('hidden lg:flex items-center gap-2.5 min-w-0 lg:w-[232px]'), 'Super Admin Header brand logo must be hidden on small devices (< lg) and shown on desktop');
  assert.ok(headerBlock.includes('<ShoeIcon'), 'Super Admin Header must render ShoeIcon brand logo');
  assert.ok(headerBlock.includes('src="/admin/pwa-192x192.png"'), 'Super Admin Header must render /admin/pwa-192x192.png brand logo');
  assert.ok(headerBlock.includes('alt="SarbaazSoft Shoe POS Logo"'), 'Super Admin Header brand logo must use SarbaazSoft Shoe POS alt text');
  assert.ok(headerBlock.includes('SarbaazSoft Shoe POS'), 'Super Admin Header must display SarbaazSoft Shoe POS app name');
  assert.ok(headerBlock.includes('aria-label="Open Navigation Drawer"'), 'Super Admin Header must retain mobile drawer toggle');
  assert.ok(headerBlock.includes('placeholder="Search stores or owners..."'), 'Super Admin Header must retain quick search');
});

test('Super Admin Sidebar displays brand logo alongside "SarbaazSoft Shoe POS" consistently with Store Sidebar', () => {
  const saSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');

  const sidebarStart = saSrc.indexOf('const renderSuperAdminSidebar =');
  const sidebarEnd = saSrc.indexOf('const authLayoutMeta =', sidebarStart);
  assert.ok(sidebarStart !== -1 && sidebarEnd !== -1, 'renderSuperAdminSidebar definition must exist');
  const sidebarBlock = saSrc.slice(sidebarStart, sidebarEnd);

  assert.ok(saSrc.includes("import { ShoeIcon } from '../common/ShoeIcon';"));
  assert.ok(sidebarBlock.includes('h-[3.6rem] flex items-center shrink-0 transition-colors'));
  assert.ok(
    sidebarBlock.includes('src="/admin/pwa-192x192.png"'),
    'Super Admin Sidebar must render brand logo using /admin/pwa-192x192.png'
  );
  assert.ok(
    sidebarBlock.includes('alt="SarbaazSoft Shoe POS Logo"'),
    'Super Admin Sidebar brand logo must use SarbaazSoft Shoe POS alt text'
  );
  assert.ok(
    sidebarBlock.includes('SarbaazSoft Shoe POS'),
    'Super Admin Sidebar must display "SarbaazSoft Shoe POS" alongside the brand logo'
  );
  assert.equal(
    sidebarBlock.includes('POS SaaS C-Panel'),
    false,
    'Super Admin Sidebar should consistently brand as "SarbaazSoft Shoe POS" instead of "POS SaaS C-Panel"'
  );
  assert.ok(
    sidebarBlock.includes('id="superadmin-sidebar-close-mobile-btn"'),
    'Super Admin Sidebar must include touch-friendly mobile close button'
  );

  const drawerStart = saSrc.indexOf('const superAdminSidebar = (');
  const drawerEnd = saSrc.indexOf('const superAdminFooter = (', drawerStart);
  assert.ok(drawerStart !== -1 && drawerEnd !== -1, 'superAdminSidebar definition must exist');
  const drawerBlock = saSrc.slice(drawerStart, drawerEnd);
  assert.ok(drawerBlock.includes('z-[60] lg:hidden'), 'SuperAdmin mobile sidebar drawer must stack above z-40 header');
  assert.ok(drawerBlock.includes('createPortal(mobileDrawer, document.body)'), 'SuperAdmin mobile sidebar drawer must portal to document.body');
});
