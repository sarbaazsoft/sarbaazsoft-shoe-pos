import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

registerHooks({
  load(url, context, nextLoad) {
    if (/\.(png|jpe?g|webp|gif|svg|css)$/i.test(url)) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${JSON.stringify(url)};`,
      };
    }
    return nextLoad(url, context);
  },
});

import { pgClient } from '../src/db/index.ts';
import { ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import authRoutes from '../src/server/routes/authRoutes.ts';
import tenantSaasRoutes from '../src/server/routes/tenantSaasRoutes.ts';
import {
  api,
  getActiveTenantId,
  setActiveTenantId,
  setAuthSession,
  clearAllSessionState,
} from '../src/services/api.ts';

const { ThemeProvider } = await import('../src/context/ThemeContext.tsx');
const { AuthModal } = await import('../src/components/auth/AuthModal.tsx');
const { SaasLandingPage } = await import('../src/components/saas/SaasLandingPage.tsx');

const ROOT = process.cwd();

function createMockStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

function makeJwt(payload: Record<string, unknown>, expOffsetSeconds = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
    })
  ).toString('base64url');
  return `${header}.${body}.signature`;
}

async function withBrowserEnv<T>(
  initial: { pathname?: string; search?: string; fetchMock?: typeof fetch },
  fn: (ctx: {
    localStorage: ReturnType<typeof createMockStorage>;
    sessionStorage: ReturnType<typeof createMockStorage>;
    setLocation: (pathname: string, search?: string) => void;
  }) => Promise<T> | T
): Promise<T> {
  const localStorageMock = createMockStorage();
  const sessionStorageMock = createMockStorage();
  const locationObj = {
    pathname: initial.pathname ?? '/',
    search: initial.search ?? '',
    hash: '',
    origin: 'http://localhost:3000',
  };

  const origWindow = (globalThis as { window?: unknown }).window;
  const origLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const origSessionStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  const origFetch = globalThis.fetch;

  (globalThis as { window?: unknown }).window = {
    location: locationObj,
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
  (globalThis as { localStorage?: unknown }).localStorage = localStorageMock;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = sessionStorageMock;
  if (initial.fetchMock) {
    globalThis.fetch = initial.fetchMock;
  }

  try {
    return await fn({
      localStorage: localStorageMock,
      sessionStorage: sessionStorageMock,
      setLocation: (pathname: string, search = '') => {
        locationObj.pathname = pathname;
        locationObj.search = search;
      },
    });
  } finally {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = origWindow;
    }
    if (origLocalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage = origLocalStorage;
    }
    if (origSessionStorage === undefined) {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    } else {
      (globalThis as { sessionStorage?: unknown }).sessionStorage = origSessionStorage;
    }
  }
}

test('Backend /api/saas/resolve & /api/auth enforce SuperAdmin tenantId=0 and store tenantId>=1', async () => {
  await ensureSaasControlPlane();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api', tenantSaasRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Directory tenant IDs always start from 1; ?tenantId=0 resolves to system landing
    const resolveZeroRes = await fetch(`${baseUrl}/api/saas/resolve?tenantId=0`);
    assert.equal(resolveZeroRes.status, 200);
    const resolveZeroBody = (await resolveZeroRes.json()) as {
      resolution: { mode: string; tenant: unknown };
      availableTenants: Array<{ id: number; name: string }>;
    };
    assert.equal(resolveZeroBody.resolution.mode, 'LANDING');
    assert.equal(resolveZeroBody.resolution.tenant, null);
    assert.ok(Array.isArray(resolveZeroBody.availableTenants));
    for (const t of resolveZeroBody.availableTenants) {
      assert.ok(Number(t.id) >= 1, `Expected all store tenant IDs >= 1, got ${t.id}`);
    }

    // 2. Locate a seeded SuperAdmin and seeded store user (reset/set temporary known password? No, read hash or test with temp user if needed)
    const saRes = await pgClient.query<{ id: number; email: string; role: string }>(
      `SELECT id, email, role FROM users WHERE UPPER(role::text) = 'SUPERADMIN' ORDER BY id ASC LIMIT 1`
    );
    assert.ok(saRes.rows.length > 0, 'Expected at least one SUPERADMIN user in DB');
    const saRow = saRes.rows[0];

    const saToken = generateToken({
      id: saRow.id,
      tenantId: 0,
      name: 'SuperAdmin Test',
      email: saRow.email,
      role: 'SUPERADMIN',
      status: 'APPROVED',
    });

    // Even if stale X-Tenant-Id: 1 header is present, /api/auth/me returns tenantId: 0 for SUPERADMIN
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${saToken}`,
        'X-Tenant-Id': '1',
      },
    });
    assert.equal(meRes.status, 200);
    const meBody = (await meRes.json()) as { user: { tenantId: number; role: string } };
    assert.equal(String(meBody.user.role).toUpperCase(), 'SUPERADMIN');
    assert.equal(meBody.user.tenantId, 0);

    // 3. Verify POST /api/auth/login for SuperAdmin (seeded) + Store Owner (temporary user cleaned up afterwards)
    const tempPassword = 'TempScopeCheck!2026';
    const tempHash = await bcrypt.hash(tempPassword, 6);
    const tempOwnerEmail = `temp-owner-${Date.now()}@example.com`;
    const targetStoreId = resolveZeroBody.availableTenants[0]?.id || 1;

    const insertedOwner = await pgClient.query<{ id: number }>(
      `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status, active)
       VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED', true)
       RETURNING id`,
      [targetStoreId, 'Temp Store Owner', tempOwnerEmail, '', tempHash, '']
    );

    try {
      // Unscoped login (tenantId: null) even with stale X-Tenant-Id: 1 header must authenticate SuperAdmin as tenantId = 0
      const saLoginUnscoped = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': String(targetStoreId),
        },
        body: JSON.stringify({
          email: saRow.email,
          password: 'admin123',
          tenantId: null,
        }),
      });
      const saLoginUnscopedBody = (await saLoginUnscoped.json()) as { token: string; user: { tenantId: number; role: string }; error?: string };
      assert.equal(saLoginUnscoped.status, 200, `Unexpected status ${saLoginUnscoped.status}: ${JSON.stringify(saLoginUnscopedBody)}`);
      assert.equal(saLoginUnscopedBody.user.role, 'SUPERADMIN');
      assert.equal(saLoginUnscopedBody.user.tenantId, 0);
      const decodedUnscoped = jwt.decode(saLoginUnscopedBody.token) as { tenantId: number };
      assert.equal(decodedUnscoped.tenantId, 0);

      // Even if SuperAdmin submits login from /auth?tenantId=1, returned user & JWT tenantId MUST be 0 (never 1)
      const saLoginFromStoreAuth = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': String(targetStoreId),
        },
        body: JSON.stringify({
          email: saRow.email,
          password: 'admin123',
          tenantId: targetStoreId,
        }),
      });
      assert.equal(saLoginFromStoreAuth.status, 200);
      const saLoginFromStoreBody = (await saLoginFromStoreAuth.json()) as { token: string; user: { tenantId: number } };
      assert.equal(saLoginFromStoreBody.user.tenantId, 0);
      const decodedStoreAuth = jwt.decode(saLoginFromStoreBody.token) as { tenantId: number };
      assert.equal(decodedStoreAuth.tenantId, 0);

      // Store Owner login strictly yields store tenantId >= 1
      const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: tempOwnerEmail,
          password: tempPassword,
          tenantId: targetStoreId,
        }),
      });
      assert.equal(ownerLogin.status, 200);
      const ownerLoginBody = (await ownerLogin.json()) as { user: { tenantId: number; role: string } };
      assert.equal(ownerLoginBody.user.role, 'ADMIN');
      assert.equal(ownerLoginBody.user.tenantId, targetStoreId);
      assert.ok(ownerLoginBody.user.tenantId >= 1);
    } finally {
      await pgClient.query('DELETE FROM users WHERE id = $1', [insertedOwner.rows[0].id]);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Frontend api.ts prevents stale tenantId leakage on / and /auth across SuperAdmin, Store Users, and Logout', async () => {
  const capturedRequests: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawHeaders = (init?.headers || {}) as Record<string, string>;
    capturedRequests.push({
      url: String(input),
      headers: rawHeaders,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify({ ok: true, availableTenants: [], resolution: { mode: 'LANDING', tenant: null } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await withBrowserEnv({ pathname: '/', search: '', fetchMock }, async ({ localStorage, sessionStorage, setLocation }) => {
    // 1. Stale active tenant in storage with NO valid token on / and /auth -> must return null
    localStorage.setItem('shoe_pos_active_tenant_id', '1');
    localStorage.setItem('pos_unauth_scoped_tenant_id', '1');
    assert.equal(getActiveTenantId(), null);

    setLocation('/auth', '');
    assert.equal(getActiveTenantId(), null);

    // 2. ?tenantId=0 on / or /auth must never resolve to store 1
    setLocation('/auth', '?tenantId=0');
    assert.equal(getActiveTenantId(), null);
    setLocation('/', '?tenantId=0');
    assert.equal(getActiveTenantId(), null);

    // 3. Expired Store 1 JWT token on / or /auth must return null
    const expiredStoreToken = makeJwt({ id: 10, tenantId: 1, role: 'ADMIN' }, -120);
    localStorage.setItem('pos_auth_token', expiredStoreToken);
    localStorage.setItem('pos_current_user', JSON.stringify({ id: 10, tenantId: 1, role: 'ADMIN' }));
    setLocation('/auth', '');
    assert.equal(getActiveTenantId(), null);

    // 4. Valid Store 2 Owner session -> active tenant is 2 -> transition to SuperAdmin clears stale scope
    const store2Token = makeJwt({ id: 22, tenantId: 2, role: 'ADMIN' }, 3600);
    setAuthSession(store2Token, { id: 22, tenantId: 2, role: 'ADMIN' });
    setLocation('/dashboard', '');
    assert.equal(getActiveTenantId(), 2);

    // Logout clears all auth + unauth tenant scope
    clearAllSessionState();
    assert.equal(localStorage.getItem('shoe_pos_active_tenant_id'), null);
    assert.equal(localStorage.getItem('pos_unauth_scoped_tenant_id'), null);
    assert.equal(sessionStorage.getItem('pos_unauth_scoped_tenant_id'), null);

    // 5. SuperAdmin session on /, /auth, /admin returns null even with stale ?tenantId=1 or localStorage
    const saToken = makeJwt({ id: 1, tenantId: 0, role: 'SUPERADMIN' }, 3600);
    localStorage.setItem('shoe_pos_active_tenant_id', '1');
    localStorage.setItem('pos_unauth_scoped_tenant_id', '1');
    setAuthSession(saToken, { id: 1, tenantId: 0, role: 'SUPERADMIN' });
    assert.equal(localStorage.getItem('shoe_pos_active_tenant_id'), null);
    assert.equal(localStorage.getItem('pos_unauth_scoped_tenant_id'), null);

    // Even if URL still has ?tenantId=1 on public / or /auth while SuperAdmin is authenticated:
    setLocation('/auth', '?tenantId=1');
    assert.equal(getActiveTenantId(), null);
    setLocation('/', '?tenantId=1');
    assert.equal(getActiveTenantId(), null);

    // 6. Calling api.saas.resolve(null) or api.saas.resolve(0) when URL has ?tenantId=1 does not leak ?tenantId=1 or X-Tenant-Id
    capturedRequests.length = 0;
    await api.saas.resolve(null);
    await api.saas.resolve(0);
    for (const req of capturedRequests) {
      assert.equal(req.url.includes('tenantId=1'), false, `Unexpected tenantId=1 in ${req.url}`);
      assert.equal(req.headers['X-Tenant-Id'], undefined, `Unexpected X-Tenant-Id header in ${req.url}`);
    }

    // 7. SuperAdmin password reset / unscoped login omits X-Tenant-Id even if inspecting store 2 in /admin
    setLocation('/dashboard', '');
    setActiveTenantId(2);
    capturedRequests.length = 0;
    await api.auth.login({ email: 'sa@example.com', password: 'secret', tenantId: null });
    await api.auth.requestPasswordResetCode({ email: 'sa@example.com', roleScope: 'SUPERADMIN', tenantId: null });
    await api.auth.verifyPasswordResetCode({ email: 'sa@example.com', code: '123456', roleScope: 'SUPERADMIN', tenantId: null });
    await api.auth.confirmPasswordReset({
      email: 'sa@example.com',
      code: '123456',
      newPassword: 'NewPassword123!',
      roleScope: 'SUPERADMIN',
      tenantId: null,
    });
    for (const req of capturedRequests) {
      assert.equal(req.headers['X-Tenant-Id'], undefined, `Expected no X-Tenant-Id on ${req.url}`);
    }
  });
});

test('Public SSR views & routing guards handle tenantId=null (unscoped), tenantId=0 (SuperAdmin), and tenantId>=1 (Store)', async () => {
  // 1. AuthModal on unscoped /auth (tenantId = null) even if stale pos_unauth_scoped_tenant_id exists in storage -> NO scope banner, NO personalized title, YES Store Directory header link, YES Free Trial link
  await withBrowserEnv({ pathname: '/auth', search: '' }, ({ localStorage, sessionStorage }) => {
    localStorage.setItem('pos_unauth_scoped_tenant_id', '1');
    sessionStorage.setItem('pos_unauth_scoped_tenant_id', '1');

    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthModal, {
          onSuccess: () => {},
          onBack: () => {},
          companySettings: { name: 'SarbaazSoft Shoe POS', logo: '/pwa-192x192.png' },
        })
      )
    );
    assert.equal(html.includes('id="auth-tenant-scope-banner"'), false);
    assert.equal(html.includes('id="auth-store-name"'), false);
    assert.equal(html.includes('Tenant #1'), false);
    assert.equal(html.includes('/admin/pwa-192x192.png'), false);
    assert.equal(html.includes('id="public-header-action-btn"'), true);
    assert.equal(html.includes('Store Directory'), true);
    assert.equal(html.includes('id="auth-register-free-trial-link"'), true);
    assert.equal(html.includes('id="auth-sign-in-different-store-link"'), false);
  });

  // 2. AuthModal with ?tenantId=0 treats 0 as SuperAdmin scope: collapsed banner by default, hides Store Directory header button & Free Trial link, shows Sign in with different store
  await withBrowserEnv({ pathname: '/auth', search: '?tenantId=0' }, () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthModal, {
          onSuccess: () => {},
          onBack: () => {},
          companySettings: { tenant_id: 0, name: 'SuperAdmin Control Panel', logo: '/admin/pwa-192x192.png' },
        })
      )
    );
    assert.equal(html.includes('id="auth-tenant-scope-banner"'), true);
    assert.equal(html.includes('id="auth-tenant-scope-banner-toggle"'), true);
    assert.equal(html.includes('aria-expanded="false"'), true);
    assert.equal(html.includes('id="auth-tenant-scope-banner-details"'), false);
    assert.equal(html.includes('Tenant #0'), true);
    assert.equal(html.includes('Tenant #1'), false);
    assert.equal(html.includes('id="auth-store-name"'), true);
    assert.equal(html.includes('SuperAdmin Control Panel'), true);
    assert.equal(html.includes('SarbaazSoft AdminPOS'), true);
    assert.equal(html.includes('/admin/pwa-192x192.png'), true);
    assert.equal(html.includes('id="public-header-action-btn"'), false);
    assert.equal(html.includes('id="auth-register-free-trial-link"'), false);
    assert.equal(html.includes('id="auth-sign-in-different-store-link"'), true);
    assert.equal(html.includes('Sign in with different store'), true);
  });

  // 2b. AuthModal with ?tenantId=1 (store scope): collapsed banner by default, hides Store Directory header button & Free Trial link, shows Sign in with different store
  await withBrowserEnv({ pathname: '/auth', search: '?tenantId=1' }, () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthModal, {
          onSuccess: () => {},
          onBack: () => {},
          companySettings: { tenant_id: 1, name: 'Test Store 1', logo: '/pwa-192x192.png' },
        })
      )
    );
    assert.equal(html.includes('id="auth-tenant-scope-banner"'), true);
    assert.equal(html.includes('id="auth-tenant-scope-banner-toggle"'), true);
    assert.equal(html.includes('aria-expanded="false"'), true);
    assert.equal(html.includes('id="auth-tenant-scope-banner-details"'), false);
    assert.equal(html.includes('Tenant #1'), true);
    assert.equal(html.includes('id="public-header-action-btn"'), false);
    assert.equal(html.includes('id="auth-register-free-trial-link"'), false);
    assert.equal(html.includes('id="auth-sign-in-different-store-link"'), true);
    assert.equal(html.includes('Sign in with different store'), true);
  });

  // 3. SaasLandingPage with unauthTenantId='' shows NO banner, while unauthTenantId='0' or '1' shows collapsed banner by default
  await withBrowserEnv({ pathname: '/', search: '' }, () => {
    const unscopedHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SaasLandingPage, {
          availableTenants: [{ id: 1, name: 'Test Store 1' } as any],
          unauthTenantId: '',
          onGlobalLogin: () => {},
          onOpenSuperAdmin: () => {},
        })
      )
    );
    assert.equal(unscopedHtml.includes('id="unauth-tenant-scope-banner"'), false);
  });

  await withBrowserEnv({ pathname: '/', search: '?tenantId=0' }, () => {
    const adminScopedHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SaasLandingPage, {
          availableTenants: [{ id: 1, name: 'Test Store 1' } as any],
          unauthTenantId: '0',
          onGlobalLogin: () => {},
          onOpenSuperAdmin: () => {},
        })
      )
    );
    assert.equal(adminScopedHtml.includes('id="unauth-tenant-scope-banner"'), true);
    assert.equal(adminScopedHtml.includes('id="unauth-tenant-scope-banner-toggle"'), true);
    assert.equal(adminScopedHtml.includes('aria-expanded="false"'), true);
    assert.equal(adminScopedHtml.includes('id="unauth-tenant-scope-banner-details"'), false);
    assert.equal(adminScopedHtml.includes('SuperAdmin Control Panel'), true);
    assert.equal(adminScopedHtml.includes('Tenant #0'), true);
    assert.equal(adminScopedHtml.includes('Tenant #1'), false);
  });

  await withBrowserEnv({ pathname: '/', search: '?tenantId=1' }, () => {
    const storeScopedHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SaasLandingPage, {
          availableTenants: [{ id: 1, name: 'Test Store 1' } as any],
          unauthTenantId: '1',
          onGlobalLogin: () => {},
          onOpenSuperAdmin: () => {},
        })
      )
    );
    assert.equal(storeScopedHtml.includes('id="unauth-tenant-scope-banner"'), true);
    assert.equal(storeScopedHtml.includes('id="unauth-tenant-scope-banner-toggle"'), true);
    assert.equal(storeScopedHtml.includes('aria-expanded="false"'), true);
    assert.equal(storeScopedHtml.includes('id="unauth-tenant-scope-banner-details"'), false);
    assert.equal(storeScopedHtml.includes('Test Store 1'), true);
    assert.equal(storeScopedHtml.includes('Tenant #1'), true);
  });

  // 4. Static invariants on public route logic in App.tsx, AuthModal.tsx, PublicHeader.tsx
  const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
  const authModalSrc = fs.readFileSync(path.join(ROOT, 'src/components/auth/AuthModal.tsx'), 'utf8');
  const publicHeaderSrc = fs.readFileSync(path.join(ROOT, 'src/components/common/PublicHeader.tsx'), 'utf8');

  assert.equal(
    appSrc.includes("availableTenants[0]?.id ? Number(availableTenants[0].id) : null"),
    false,
    'App.tsx must never default unscoped /auth or logout redirect to availableTenants[0]'
  );
  assert.equal(
    appSrc.includes("window.history.replaceState({}, '', '/auth?tenantId=0')"),
    true,
    'App.tsx must redirect SuperAdmin logout to /auth?tenantId=0'
  );
  const detectFnStart = appSrc.indexOf('function detectInitialRouteFromLocation()');
  const appFnStart = appSrc.indexOf('export default function App()');
  assert.ok(detectFnStart !== -1 && appFnStart > detectFnStart);
  const detectFnBody = appSrc.slice(detectFnStart, appFnStart);
  assert.equal(
    detectFnBody.includes('getStoredUnauthTenantId'),
    false,
    'detectInitialRouteFromLocation must not auto-resurrect stale pos_unauth_scoped_tenant_id'
  );
  assert.equal(
    authModalSrc.includes("sessionStorage.getItem('pos_unauth_scoped_tenant_id')") ||
      authModalSrc.includes("localStorage.getItem('pos_unauth_scoped_tenant_id')"),
    false,
    'AuthModal must not read stale pos_unauth_scoped_tenant_id from storage'
  );
  assert.equal(
    publicHeaderSrc.includes('pos_unauth_scoped_tenant_id'),
    false,
    'PublicHeader must not resurrect pos_unauth_scoped_tenant_id'
  );
});
