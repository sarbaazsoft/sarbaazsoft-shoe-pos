import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  ACCENT_THEME_LIST,
  CURATED_APPEARANCE_PALETTES,
  DEFAULT_ACCENT_THEME,
  DEFAULT_BACKDROP_DARKNESS,
  DEFAULT_BACKDROP_STYLE,
  DEFAULT_CUSTOM_ACCENT_HEX,
  GUEST_ACCENT_THEME_STORAGE_KEY,
  GUEST_BACKDROP_DARKNESS_STORAGE_KEY,
  GUEST_BACKDROP_STYLE_STORAGE_KEY,
  GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY,
  GUEST_THEME_MODE_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  ACCENT_THEME_STORAGE_KEY,
  BACKDROP_DARKNESS_STORAGE_KEY,
  BACKDROP_STYLE_STORAGE_KEY,
  applyAccentThemeToDOM,
  applyBackdropThemeToDOM,
  buildCustomAccentPalette,
  getAccessibleTextColor,
  getStoredGuestThemePreferences,
  getUserThemeCacheKey,
  getWcagContrastRatio,
  isValidHexColor,
  migrateLegacyGuestThemeIfNeeded,
  normalizeBackdropDarkness,
  normalizeBackdropStyle,
  normalizeHexColor,
  parseUserThemePreference,
  persistActiveHydrationMirror,
  persistGuestThemePreferences,
  serializeUserThemePreference,
} from '../src/utils/themePalettes.ts';
import {
  PREDEFINED_SCREEN_IMAGE_LIBRARY,
  UNIFIED_BACKDROP_META,
  buildUnifiedScreenImagesMap,
  doesLibraryImageMatchTheme,
  resolveUnifiedBackdropImage,
  validateExternalImageUrl,
} from '../src/utils/screenImages.ts';
import { pgClient } from '../src/db/index.ts';
import { ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import authRoutes from '../src/server/routes/authRoutes.ts';
import settingsRoutes from '../src/server/routes/settingsRoutes.ts';
import {
  ensureAppSettingsSchema,
  getScreenImageSettings,
  updateScreenImageSettings,
} from '../src/server/services/appSettingsService.ts';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

async function startTestServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/settings', settingsRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('serializeUserThemePreference & parseUserThemePreference handle structured, JSON, and legacy formats safely', () => {
  assert.equal(
    serializeUserThemePreference({ themeMode: 'dark', accentTheme: 'teal', customAccentHex: '#2563EB' }),
    'dark|teal'
  );
  assert.equal(
    serializeUserThemePreference({ themeMode: 'system', accentTheme: 'custom', customAccentHex: '#0ea' }),
    'system|custom|#00EEAA'
  );
  assert.equal(
    serializeUserThemePreference({
      themeMode: 'light',
      accentTheme: 'purple',
      customAccentHex: '#2563EB',
      backdropStyle: 'solid',
      backdropDarkness: 55,
    }),
    'light|purple|solid|55'
  );
  assert.equal(
    serializeUserThemePreference({
      themeMode: 'dark',
      accentTheme: 'custom',
      customAccentHex: '#10b981',
      backdropStyle: 'showroom',
      backdropDarkness: 85,
    }),
    'dark|custom|#10B981|showroom|85'
  );

  assert.deepEqual(parseUserThemePreference('dark|custom|#10B981'), {
    themeMode: 'dark',
    accentTheme: 'custom',
    customAccentHex: '#10B981',
    backdropStyle: DEFAULT_BACKDROP_STYLE,
    backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
  });

  assert.deepEqual(parseUserThemePreference('light|purple|solid|55'), {
    themeMode: 'light',
    accentTheme: 'purple',
    customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
    backdropStyle: 'solid',
    backdropDarkness: 55,
  });

  assert.deepEqual(parseUserThemePreference('dark|custom|#10B981|showroom|85'), {
    themeMode: 'dark',
    accentTheme: 'custom',
    customAccentHex: '#10B981',
    backdropStyle: 'showroom',
    backdropDarkness: 85,
  });

  // Clamping & fallback for backdrop normalization
  assert.equal(normalizeBackdropDarkness(-5), 0);
  assert.equal(normalizeBackdropDarkness(150), 100);
  assert.equal(normalizeBackdropDarkness('abc', 55), 55);
  assert.equal(normalizeBackdropStyle('SOLID'), 'solid');
  assert.equal(normalizeBackdropStyle('unknown', 'showroom'), 'showroom');

  // Legacy values preserved
  assert.deepEqual(
    parseUserThemePreference('violet', { themeMode: 'light', accentTheme: 'purple', customAccentHex: '#2563EB' }),
    {
      themeMode: 'light',
      accentTheme: 'purple',
      customAccentHex: '#2563EB',
      backdropStyle: DEFAULT_BACKDROP_STYLE,
      backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
    }
  );
  assert.deepEqual(
    parseUserThemePreference('#1E88E5', { themeMode: 'dark', accentTheme: 'purple', customAccentHex: '#2563EB' }),
    {
      themeMode: 'dark',
      accentTheme: 'custom',
      customAccentHex: '#1E88E5',
      backdropStyle: DEFAULT_BACKDROP_STYLE,
      backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
    }
  );
  assert.deepEqual(
    parseUserThemePreference('{"mode":"dark","accent":"cyan","backdropStyle":"solid","backdropDarkness":20}'),
    {
      themeMode: 'dark',
      accentTheme: 'cyan',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: 'solid',
      backdropDarkness: 20,
    }
  );
  assert.deepEqual(
    parseUserThemePreference('', { themeMode: 'light', accentTheme: DEFAULT_ACCENT_THEME, customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX }),
    {
      themeMode: 'light',
      accentTheme: DEFAULT_ACCENT_THEME,
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: DEFAULT_BACKDROP_STYLE,
      backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
    }
  );
});

test('HEX validation, custom shade generation, WCAG contrast calculation, and DOM tokens work cleanly', () => {
  assert.equal(isValidHexColor('#2563EB'), true);
  assert.equal(isValidHexColor('0ea'), true);
  assert.equal(isValidHexColor('#12345'), false);
  assert.equal(normalizeHexColor('0ea'), '#00EEAA');

  assert.equal(CURATED_APPEARANCE_PALETTES.length, 16);
  const curatedKeys = CURATED_APPEARANCE_PALETTES.map((p) => p.key);
  assert.equal(curatedKeys.includes('cobalt'), false, 'Cobalt Sky should be removed from curated palettes');
  assert.equal(curatedKeys.includes('mint'), false, 'Arctic Mint should be removed from curated palettes');
  for (const curated of CURATED_APPEARANCE_PALETTES) {
    assert.equal(isValidHexColor(curated.hex), true);
  }

  // Accessible contrast automatically picks dark ink on light yellow and white ink on indigo
  assert.equal(getAccessibleTextColor('#FACC15'), '#0F172A');
  assert.equal(getAccessibleTextColor('#4F46E5'), '#FFFFFF');
  assert.ok(getWcagContrastRatio('#FACC15', '#0F172A') >= 10);

  const brightCustom = buildCustomAccentPalette('#FACC15');
  assert.equal(brightCustom.contrastText, '#0F172A');

  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  const originalDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      style: { setProperty: (k: string, v: string) => props.set(k, v) },
    },
    body: {
      setAttribute: (k: string, v: string) => attrs.set(`body:${k}`, v),
    },
    querySelector: () => null,
  };

  try {
    applyAccentThemeToDOM('custom', '#FACC15');
    assert.equal(props.get('--primary-contrast'), '#0F172A');
    assert.ok(props.get('--brand-soft-surface-light'));
    assert.ok(props.get('--brand-soft-surface-dark'));

    applyBackdropThemeToDOM('solid', 85);
    assert.equal(attrs.get('data-backdrop-style'), 'solid');
    assert.equal(props.get('--backdrop-darkness'), '85');
    assert.equal(props.get('--backdrop-darkness-alpha'), '0.85');

    applyBackdropThemeToDOM('showroom', 30);
    assert.equal(attrs.get('data-backdrop-style'), 'showroom');
    assert.equal(props.get('--backdrop-darkness'), '30');
    assert.equal(props.get('--backdrop-darkness-alpha'), '0.30');
  } finally {
    if (originalDoc === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = originalDoc;
  }
});

test('Guest localStorage stays completely isolated from authenticated user hydration mirrors across login/logout', () => {
  const storage = new Map<string, string>();
  const originalWin = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
  };

  try {
    // Guest picks Pink + Dark + Solid backdrop with 80% darkness
    persistGuestThemePreferences({
      themeMode: 'dark',
      accentTheme: 'pink',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: 'solid',
      backdropDarkness: 80,
    });
    assert.equal(storage.get(GUEST_THEME_MODE_STORAGE_KEY), 'dark');
    assert.equal(storage.get(GUEST_ACCENT_THEME_STORAGE_KEY), 'pink');
    assert.equal(storage.get(GUEST_BACKDROP_STYLE_STORAGE_KEY), 'solid');
    assert.equal(storage.get(GUEST_BACKDROP_DARKNESS_STORAGE_KEY), '80');

    // User logs in with Teal + Light + Showroom 30% -> only hydration mirror & user cache update; guest keys stay intact
    persistActiveHydrationMirror({
      themeMode: 'light',
      accentTheme: 'teal',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: 'showroom',
      backdropDarkness: 30,
    });
    storage.set(getUserThemeCacheKey(42), 'light|teal|showroom|30');

    assert.equal(storage.get(THEME_MODE_STORAGE_KEY), 'light');
    assert.equal(storage.get(ACCENT_THEME_STORAGE_KEY), 'teal');
    assert.equal(storage.get(BACKDROP_STYLE_STORAGE_KEY), 'showroom');
    assert.equal(storage.get(BACKDROP_DARKNESS_STORAGE_KEY), '30');
    assert.equal(storage.get(GUEST_THEME_MODE_STORAGE_KEY), 'dark');
    assert.equal(storage.get(GUEST_ACCENT_THEME_STORAGE_KEY), 'pink');
    assert.equal(storage.get(GUEST_BACKDROP_STYLE_STORAGE_KEY), 'solid');
    assert.equal(storage.get(GUEST_BACKDROP_DARKNESS_STORAGE_KEY), '80');

    // User logs out -> restoreGuestThemeOnLogout reads independent guest keys (never user mirror)
    const restoredGuest = getStoredGuestThemePreferences();
    assert.deepEqual(restoredGuest, {
      themeMode: 'dark',
      accentTheme: 'pink',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: 'solid',
      backdropDarkness: 80,
    });

    // Legacy guest migration runs once when GUEST_* keys are absent
    storage.clear();
    storage.set(THEME_MODE_STORAGE_KEY, 'system');
    storage.set(ACCENT_THEME_STORAGE_KEY, 'orange');
    storage.set(BACKDROP_STYLE_STORAGE_KEY, 'solid');
    storage.set(BACKDROP_DARKNESS_STORAGE_KEY, '90');
    migrateLegacyGuestThemeIfNeeded();
    assert.equal(storage.get(GUEST_THEME_MODE_STORAGE_KEY), 'system');
    assert.equal(storage.get(GUEST_ACCENT_THEME_STORAGE_KEY), 'orange');
    assert.equal(storage.get(GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY), DEFAULT_CUSTOM_ACCENT_HEX);
    assert.equal(storage.get(GUEST_BACKDROP_STYLE_STORAGE_KEY), 'solid');
    assert.equal(storage.get(GUEST_BACKDROP_DARKNESS_STORAGE_KEY), '90');
  } finally {
    if (originalWin === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWin;
  }
});

test('Unified backdrop library uses external URLs only, resolves legacy keys, and validates external URLs safely', () => {
  assert.equal(UNIFIED_BACKDROP_META.id, 'backdrop');
  assert.equal(
    resolveUnifiedBackdropImage({ auth: 'https://images.unsplash.com/photo-1.jpg' }),
    'https://images.unsplash.com/photo-1.jpg'
  );
  assert.deepEqual(buildUnifiedScreenImagesMap('https://images.unsplash.com/photo-1.jpg'), {
    backdrop: 'https://images.unsplash.com/photo-1.jpg',
    login: 'https://images.unsplash.com/photo-1.jpg',
    registration: 'https://images.unsplash.com/photo-1.jpg',
    auth: 'https://images.unsplash.com/photo-1.jpg',
    loading: 'https://images.unsplash.com/photo-1.jpg',
  });

  assert.ok(PREDEFINED_SCREEN_IMAGE_LIBRARY.length >= 12, 'Library should include an expanded catalog of shoe store backdrops');
  const sources = new Set<string>();
  for (const item of PREDEFINED_SCREEN_IMAGE_LIBRARY) {
    assert.ok(item.url.startsWith('https://'), `Library image "${item.id}" must be an external https:// URL`);
    assert.equal(item.url.startsWith('data:'), false, 'Library images must never be inline data URIs');
    assert.equal(item.url.includes('localhost'), false, 'Library images must not reference local bundles');
    assert.ok(item.source && item.source.trim().length > 0, `Library image "${item.id}" must specify its platform source`);
    sources.add(item.source);
  }
  assert.ok(sources.size >= 4, `Library should span at least 4 image platforms (found: ${Array.from(sources).join(', ')})`);
  assert.ok(sources.has('Unsplash'), 'Library should include Unsplash backdrops');
  assert.ok(sources.has('Pinterest'), 'Library should include Pinterest backdrops');
  assert.ok(sources.has('Pexels'), 'Library should include Pexels backdrops');

  // Every core theme preset must have at least 1 color-matched backdrop
  for (const preset of ACCENT_THEME_LIST) {
    const matches = PREDEFINED_SCREEN_IMAGE_LIBRARY.filter((item) =>
      doesLibraryImageMatchTheme(item, preset.id)
    );
    assert.ok(
      matches.length >= 1,
      `Preset theme "${preset.id}" must have at least one color-matched backdrop image`
    );
  }

  // Every curated designer palette must also have at least 1 color-matched backdrop
  for (const curated of CURATED_APPEARANCE_PALETTES) {
    const matches = PREDEFINED_SCREEN_IMAGE_LIBRARY.filter((item) =>
      doesLibraryImageMatchTheme(item, 'custom', curated.hex)
    );
    assert.ok(
      matches.length >= 1,
      `Curated palette "${curated.key}" (${curated.hex}) must have at least one color-matched backdrop image`
    );
  }

  const pinWebLink = validateExternalImageUrl('https://www.pinterest.com/pin/123456789/');
  assert.equal(pinWebLink.valid, false);
  assert.match(pinWebLink.error || '', /Pinterest|pinimg/i);

  const pinDirectCdn = validateExternalImageUrl('https://i.pinimg.com/originals/ab/cd/ef/sample.jpg');
  assert.equal(pinDirectCdn.valid, true);

  const badJsProtocol = validateExternalImageUrl('javascript:alert(1)');
  assert.equal(badJsProtocol.valid, false);

  const clearedSlot = validateExternalImageUrl('   ');
  assert.equal(clearedSlot.valid, true);
  assert.equal(clearedSlot.url, '');
});

test('API integration: /api/auth/theme & /api/settings/screen-images enforce user isolation, RBAC, and DB persistence', async () => {
  await ensureSaasControlPlane();
  await ensureAppSettingsSchema();

  const initialScreenImages = await getScreenImageSettings();
  const { baseUrl, close } = await startTestServer();

  // Save initial user theme colors so test leaves DB clean
  const user2Before = await pgClient.query<{ theme_color: string }>('SELECT theme_color FROM users WHERE id = 2');
  const user3Before = await pgClient.query<{ theme_color: string }>('SELECT theme_color FROM users WHERE id = 3');

  try {
    const tokenAdmin2 = generateToken({
      id: 2,
      tenantId: 1,
      email: 'admin@balochshoes.com',
      name: 'Store Owner',
      role: 'ADMIN',
      status: 'APPROVED',
    });
    const tokenAdmin3 = generateToken({
      id: 3,
      tenantId: 2,
      email: 'owner@stepupfootwear.com',
      name: 'StepUp Owner',
      role: 'ADMIN',
      status: 'APPROVED',
    });
    const cashierEmail = `cashier-theme-${Date.now()}@balochshoes.com`;
    const cashierInsert = await pgClient.query<{ id: number }>(
      `INSERT INTO users (tenant_id, name, email, phone, password_hash, role, status) VALUES ($1, $2, $3, $4, $5, 'CASHIER', 'APPROVED') RETURNING id`,
      [1, 'Front Desk Cashier', cashierEmail, '+923000000999', 'test-hash']
    );
    const cashierId = Number(cashierInsert.rows[0].id);

    const tokenCashier = generateToken({
      id: cashierId,
      tenantId: 1,
      email: cashierEmail,
      name: 'Front Desk Cashier',
      role: 'CASHIER',
      status: 'APPROVED',
    });

    // 1. Unauthenticated theme update returns 401
    const unauthRes = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeColor: 'dark|teal' }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Invalid theme string rejected with 400
    const badThemeRes = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ themeColor: 'dark|teal\n<script>' }),
    });
    assert.equal(badThemeRes.status, 400);

    // 3. User 2 (Store Owner) saves custom hex dark theme with showroom darkness 85% -> persisted to DB & visible via /api/auth/me without affecting User 3
    const save2Res = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ themeColor: 'dark|custom|#10B981|showroom|85' }),
    });
    assert.equal(save2Res.status, 200);
    const save2Body = (await save2Res.json()) as { success: boolean; themeColor: string };
    assert.equal(save2Body.success, true);
    assert.equal(save2Body.themeColor, 'dark|custom|#10B981|showroom|85');

    const me2Res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin2}` },
    });
    assert.equal(me2Res.status, 200);
    const me2Body = (await me2Res.json()) as { user: { themeColor: string } };
    assert.equal(me2Body.user.themeColor, 'dark|custom|#10B981|showroom|85');

    // User 3 (Tenant 2 Owner) saves solid backdrop preset independently
    const save3Res = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin3}`,
      },
      body: JSON.stringify({ themeColor: 'light|orange|solid|55' }),
    });
    assert.equal(save3Res.status, 200);

    // Cashier saves personal solid color preference cleanly (200)
    const saveCashierRes = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCashier}`,
      },
      body: JSON.stringify({ themeColor: 'light|cyan|solid|55' }),
    });
    assert.equal(saveCashierRes.status, 200);
    const meCashierOwnRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenCashier}` },
    });
    const meCashierOwnBody = (await meCashierOwnRes.json()) as { user: { themeColor: string } };
    assert.equal(meCashierOwnBody.user.themeColor, 'light|cyan|solid|55');

    // SuperAdmin saves personal showroom darkness cleanly (200) if present
    const superAdminRow = await pgClient.query<{ id: number; tenant_id: number; email: string; name: string; theme_color: string }>(
      `SELECT id, tenant_id, email, name, theme_color FROM users WHERE role = 'SUPERADMIN' LIMIT 1`
    );
    if (superAdminRow.rows[0]) {
      const sa = superAdminRow.rows[0];
      const tokenSa = generateToken({
        id: Number(sa.id),
        tenantId: Number(sa.tenant_id || 1),
        email: sa.email,
        name: sa.name,
        role: 'SUPERADMIN',
        status: 'APPROVED',
      });
      try {
        const saveSaRes = await fetch(`${baseUrl}/api/auth/theme`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenSa}`,
          },
          body: JSON.stringify({ themeColor: 'dark|purple|showroom|90' }),
        });
        assert.equal(saveSaRes.status, 200);
        const meSaRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${tokenSa}` },
        });
        const meSaBody = (await meSaRes.json()) as { user: { themeColor: string } };
        assert.equal(meSaBody.user.themeColor, 'dark|purple|showroom|90');
      } finally {
        await pgClient.query('UPDATE users SET theme_color = $1 WHERE id = $2', [sa.theme_color || '', sa.id]);
      }
    }

    // Verify User 2 stayed dark|custom|#10B981|showroom|85 while User 3 is light|orange|solid|55
    const me2AfterRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin2}` },
    });
    const me2AfterBody = (await me2AfterRes.json()) as { user: { themeColor: string } };
    assert.equal(me2AfterBody.user.themeColor, 'dark|custom|#10B981|showroom|85');

    const me3AfterRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin3}` },
    });
    const me3AfterBody = (await me3AfterRes.json()) as { user: { themeColor: string } };
    assert.equal(me3AfterBody.user.themeColor, 'light|orange|solid|55');

    // 3b. Apply to Staff: CASHIER receives 403 Forbidden
    const cashierBulkRes = await fetch(`${baseUrl}/api/auth/theme/staff`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCashier}`,
      },
      body: JSON.stringify({ themeColor: 'dark|emerald' }),
    });
    assert.equal(cashierBulkRes.status, 403);

    // 3c. Apply to Staff: ADMIN overwrites all staff in their own store (Tenant 1) without affecting Tenant 2
    const bulkStaffRes = await fetch(`${baseUrl}/api/auth/theme/staff`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ themeColor: 'dark|custom|#E11D48' }),
    });
    assert.equal(bulkStaffRes.status, 200);
    const bulkStaffBody = (await bulkStaffRes.json()) as {
      success: boolean;
      themeColor: string;
      updatedCount: number;
    };
    assert.equal(bulkStaffBody.success, true);
    assert.equal(bulkStaffBody.themeColor, 'dark|custom|#E11D48');
    assert.ok(bulkStaffBody.updatedCount >= 2, 'Should update both owner and cashier in Tenant 1');

    // Verify Cashier in Tenant 1 was overwritten (from light|cyan|solid|55 -> dark|custom|#E11D48)
    const meCashierAfterBulk = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenCashier}` },
    });
    const meCashierBody = (await meCashierAfterBulk.json()) as { user: { themeColor: string } };
    assert.equal(meCashierBody.user.themeColor, 'dark|custom|#E11D48');

    // Verify Admin in Tenant 2 remained completely isolated (still light|orange|solid|55)
    const me3AfterBulk = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin3}` },
    });
    const me3AfterBulkBody = (await me3AfterBulk.json()) as { user: { themeColor: string } };
    assert.equal(me3AfterBulkBody.user.themeColor, 'light|orange|solid|55');

    // 4. Screen images: public GET works without auth
    const publicImgRes = await fetch(`${baseUrl}/api/settings/screen-images`);
    assert.equal(publicImgRes.status, 200);

    // 5. Screen images: CASHIER receives 403 Forbidden
    const cashierImgRes = await fetch(`${baseUrl}/api/settings/screen-images`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCashier}`,
      },
      body: JSON.stringify({ login: PREDEFINED_SCREEN_IMAGE_LIBRARY[0].url }),
    });
    assert.equal(cashierImgRes.status, 403);

    // 6. Screen images: invalid protocol rejected with 400
    const badImgRes = await fetch(`${baseUrl}/api/settings/screen-images`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ login: 'javascript:alert(1)' }),
    });
    assert.equal(badImgRes.status, 400);

    // 7. Backdrop image: ADMIN saves one unified URL/data URI applied identically across all routes
    const unifiedUrl = PREDEFINED_SCREEN_IMAGE_LIBRARY[0].url;
    const saveImgRes = await fetch(`${baseUrl}/api/settings/screen-images`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ backdropImage: unifiedUrl }),
    });
    assert.equal(saveImgRes.status, 200);
    const saveImgBody = (await saveImgRes.json()) as {
      backdropImage: string;
      screenImages: Record<string, string>;
    };
    assert.equal(saveImgBody.backdropImage, unifiedUrl);
    assert.equal(saveImgBody.screenImages.backdrop, unifiedUrl);
    assert.equal(saveImgBody.screenImages.login, unifiedUrl);
    assert.equal(saveImgBody.screenImages.registration, unifiedUrl);
    assert.equal(saveImgBody.screenImages.auth, unifiedUrl);
    assert.equal(saveImgBody.screenImages.loading, unifiedUrl);

    // Uploaded data URI also synchronizes cleanly across all routes
    const validSampleDataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const saveDataRes = await fetch(`${baseUrl}/api/settings/screen-images`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ backdropImage: validSampleDataUri }),
    });
    assert.equal(saveDataRes.status, 200);

    const refetchImgRes = await fetch(`${baseUrl}/api/settings/screen-images`);
    const refetchImgBody = (await refetchImgRes.json()) as {
      backdropImage: string;
      screenImages: Record<string, string>;
    };
    assert.equal(refetchImgBody.backdropImage, validSampleDataUri);
    assert.equal(refetchImgBody.screenImages.backdrop, validSampleDataUri);
    assert.equal(refetchImgBody.screenImages.login, validSampleDataUri);
    assert.equal(refetchImgBody.screenImages.registration, validSampleDataUri);
    assert.equal(refetchImgBody.screenImages.auth, validSampleDataUri);
    assert.equal(refetchImgBody.screenImages.loading, validSampleDataUri);

    // Clearing unified backdrop resets all routes back to empty
    const clearImgRes = await fetch(`${baseUrl}/api/settings/screen-images`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ backdropImage: '' }),
    });
    assert.equal(clearImgRes.status, 200);
    const clearImgBody = (await clearImgRes.json()) as {
      backdropImage: string;
      screenImages: Record<string, string>;
    };
    assert.equal(clearImgBody.backdropImage, '');
    assert.equal(clearImgBody.screenImages.login, '');
    assert.equal(clearImgBody.screenImages.loading, '');
  } finally {
    await pgClient.query('DELETE FROM users WHERE email LIKE $1', ['cashier-theme-%@balochshoes.com']);
    await pgClient.query('UPDATE users SET theme_color = $1 WHERE id = 2', [
      user2Before.rows[0]?.theme_color || '',
    ]);
    await pgClient.query('UPDATE users SET theme_color = $1 WHERE id = 3', [
      user3Before.rows[0]?.theme_color || '',
    ]);
    await updateScreenImageSettings(initialScreenImages.backdrop, 'SUPERADMIN');
    await close();
  }
});

test('Frontend architecture wires SettingsView, unified backdrop across all routes, and removes backdrop section for Cashiers', () => {
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  assert.ok(settingsSrc.includes("import('./AppearanceSettingsTab.tsx')"));
  assert.ok(settingsSrc.includes('id="settings-tab-notifications"'));
  assert.ok(settingsSrc.includes('id="settings-tab-appearance"'));
  assert.ok(settingsSrc.includes('id="settings-tab-backup"'));
  assert.ok(settingsSrc.includes('id="settings-tab-printers"'));
  assert.ok(
    settingsSrc.indexOf('id="settings-tab-notifications"') < settingsSrc.indexOf('id="settings-tab-appearance"') &&
      settingsSrc.indexOf('id="settings-tab-appearance"') < settingsSrc.indexOf('id="settings-tab-backup"'),
    'Appearance & Colors tab should sit directly next to Notifications'
  );
  assert.ok(
    settingsSrc.indexOf('id="settings-tab-appearance"') < settingsSrc.indexOf('id="settings-tab-printers"'),
    'Hardware & Printers tab should be placed last after Appearance & Colors'
  );
  assert.ok(settingsSrc.includes("activeTab === 'appearance'"));
  assert.ok(settingsSrc.includes('<AppearanceSettingsTab currentUser={currentUser} />'));

  const appearanceTabSrc = readProjectFile('src/components/settings/AppearanceSettingsTab.tsx');
  assert.ok(appearanceTabSrc.includes('id="appearance-apply-save-btn"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-apply-all-staff-btn"'));
  assert.ok(appearanceTabSrc.includes('Apply to Staff'));
  assert.ok(appearanceTabSrc.includes('canApplyToAllStaff'));
  assert.ok(appearanceTabSrc.includes('grid grid-cols-2 sm:flex sm:flex-wrap'));
  assert.ok(appearanceTabSrc.includes('id="appearance-cancel-preview-btn"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-reset-default-btn"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-custom-color-picker"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-custom-hex-input"'));
  assert.ok(appearanceTabSrc.includes('id="screen-image-file-input"'));
  assert.ok(appearanceTabSrc.includes('id="screen-image-url-input"'));
  assert.ok(appearanceTabSrc.includes('PREDEFINED_SCREEN_IMAGE_LIBRARY'));
  assert.ok(appearanceTabSrc.includes('id="screen-library-scroll-container"'));
  assert.ok(appearanceTabSrc.includes('id="screen-library-color-filters"'));
  assert.ok(appearanceTabSrc.includes('doesLibraryImageMatchTheme'));
  assert.ok(appearanceTabSrc.includes('overflow-y-auto'));
  assert.ok(appearanceTabSrc.includes('max-h-[320px]'));
  assert.ok(appearanceTabSrc.includes('{item.source}'));
  assert.ok(appearanceTabSrc.includes('{item.colorTag}'));
  assert.ok(appearanceTabSrc.includes('Theme Match'));

  // Unified single backdrop editor: no 4-slot tabs, and completely hidden when !canManageScreenImages (Cashier)
  // Sidebar Backdrop Style (Fixed 50% Showroom vs Solid — no slider) + Auth/Loading Backdrop Opacity slider
  // Both live outside canManageScreenImages so Owner, Cashier, and SuperAdmin can all configure them
  assert.equal(appearanceTabSrc.includes('screen-image-slot-'), false);
  assert.equal(appearanceTabSrc.includes('Admin permission required to edit screen images'), false);
  assert.ok(appearanceTabSrc.includes('id="appearance-backdrop-style-section"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-backdrop-showroom"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-backdrop-solid"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-route-backdrop-opacity-section"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-backdrop-darkness-slider"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-backdrop-darkness-value"'));
  assert.ok(appearanceTabSrc.includes('White in Light'));
  assert.ok(appearanceTabSrc.includes('{canManageScreenImages && ('));
  assert.ok(appearanceTabSrc.includes('id="unified-backdrop-settings-card"'));
  assert.ok(
    appearanceTabSrc.indexOf('id="appearance-backdrop-style-section"') <
      appearanceTabSrc.indexOf('id="appearance-route-backdrop-opacity-section"') &&
      appearanceTabSrc.indexOf('id="appearance-route-backdrop-opacity-section"') <
        appearanceTabSrc.indexOf('{canManageScreenImages && ('),
    'Sidebar Backdrop Style & Auth/Loading Opacity sections must remain available to Cashiers as well as Owners and SuperAdmins'
  );
  assert.ok(
    appearanceTabSrc.indexOf('id="appearance-backdrop-style-section"') <
      appearanceTabSrc.indexOf('id="appearance-backdrop-darkness-slider"') &&
      appearanceTabSrc.indexOf('id="appearance-route-backdrop-opacity-section"') <
        appearanceTabSrc.indexOf('id="appearance-backdrop-darkness-slider"'),
    'Opacity slider must live inside the Auth/Loading section, not inside the Sidebar Backdrop Style section'
  );

  const themeContextSrc = readProjectFile('src/context/ThemeContext.tsx');
  assert.ok(themeContextSrc.includes('requestEpochRef'));
  assert.ok(themeContextSrc.includes('syncUserThemeFromAuth'));
  assert.ok(themeContextSrc.includes('restoreGuestThemeOnLogout'));
  assert.ok(themeContextSrc.includes('updatePreview'));
  assert.ok(themeContextSrc.includes('cancelPreview'));
  assert.ok(themeContextSrc.includes('applyAndSaveAppearance'));
  assert.ok(themeContextSrc.includes('applyAndSaveToAllStaff'));
  assert.ok(themeContextSrc.includes('effectiveBackdropImage'));
  assert.ok(themeContextSrc.includes('updateBackdropImagePreview'));
  assert.ok(themeContextSrc.includes('backdropStyle'));
  assert.ok(themeContextSrc.includes('backdropDarkness'));
  assert.ok(themeContextSrc.includes('setBackdropStyle'));
  assert.ok(themeContextSrc.includes('setBackdropDarkness'));

  const appSrc = readProjectFile('src/App.tsx');
  assert.ok(appSrc.includes('syncUserThemeFromAuth('));
  assert.ok(appSrc.includes('restoreGuestThemeOnLogout()'));

  // All routes share unified <ShowroomBackground /> with no per-screen image slots
  for (const routeFile of [
    'src/components/common/LoadingWindow.tsx',
    'src/components/common/PublicLayout.tsx',
    'src/components/auth/AuthModal.tsx',
    'src/components/saas/TenantOnboardingWizard.tsx',
    'src/components/saas/FreeTrialOnboardingModal.tsx',
    'src/components/saas/SuperAdminControlPanel.tsx',
    'src/components/saas/SuspendedStoreView.tsx',
    'src/components/saas/UnknownStore404View.tsx',
  ]) {
    const routeSrc = readProjectFile(routeFile);
    assert.ok(routeSrc.includes('<ShowroomBackground'), `${routeFile} should render unified <ShowroomBackground`);
    assert.equal(routeSrc.includes('screen="loading"'), false, `${routeFile} must not use separate loading slot`);
    assert.equal(routeSrc.includes('screen="registration"'), false, `${routeFile} must not use separate registration slot`);
    assert.equal(routeSrc.includes('screen="login"'), false, `${routeFile} must not use separate login slot`);
  }

  assert.ok(readProjectFile('src/components/saas/SaasLandingPage.tsx').includes('effectiveBackdropImage'));
  const showroomBgSrc = readProjectFile('src/components/common/ShowroomBackground.tsx');
  assert.ok(showroomBgSrc.includes('BACKDROP_INTENSITY_PRESETS'));
  assert.ok(showroomBgSrc.includes('Object.freeze'));
  assert.ok(showroomBgSrc.includes('data-backdrop-intensity={resolvedIntensity}'));
  assert.ok(showroomBgSrc.includes('no-print print:hidden'));
  assert.ok(showroomBgSrc.includes('referrerPolicy="no-referrer"'));
  assert.ok(showroomBgSrc.includes('effectiveBackdropImage'));
  assert.ok(showroomBgSrc.includes("containerBg: 'bg-[#080A2A]'"));
  assert.ok(showroomBgSrc.includes("imageClass: 'opacity-75 dark:opacity-70'"));
  assert.ok(showroomBgSrc.includes('from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55'));
  assert.ok(showroomBgSrc.includes("scope = 'route'"));
  assert.ok(showroomBgSrc.includes("const isSidebarScope = scope === 'sidebar';"));
  assert.ok(showroomBgSrc.includes("const isSolidBackdrop = isSidebarScope && backdropStyle === 'solid';"));
  assert.ok(showroomBgSrc.includes('? 50'));
  assert.ok(showroomBgSrc.includes('const scrimScaleOpacity = isSidebarScope ? 0.5 : Math.min(1, clampedDarkness / 55);'));
  assert.ok(showroomBgSrc.includes('!isSidebarScope && clampedDarkness > 55'));
  assert.ok(showroomBgSrc.includes("theme === 'dark' ? 'bg-[#0A0E1A]' : 'bg-white'"));
  assert.ok(showroomBgSrc.includes('showroom-bg-darkness-veil'));
  assert.ok(appearanceTabSrc.includes('Sidebar Backdrop Style'));
  assert.ok(appearanceTabSrc.includes('Auth, Loading &amp; Portal Backdrop Opacity'));
  assert.ok(appearanceTabSrc.includes('Preview: Auth, Login &amp; Loading Routes'));
  assert.ok(appearanceTabSrc.includes('bg-[#080A2A]'));
  assert.ok(appearanceTabSrc.includes('opacity-75 dark:opacity-70'));
  assert.ok(appearanceTabSrc.includes('from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55'));
  assert.equal(appSrc.includes('intensity="workspace"'), false, 'Tenant workspace routes must use solid background instead of showroom backdrop');
  assert.equal(appSrc.includes('scope="sidebar"'), false, 'Non-sidebar loading backdrop in App must not apply sidebar solid/opacity overrides');
  assert.ok(appSrc.includes('className="saas-panel bg-[#F8FAFC] dark:bg-[#0A0E1A] text-slate-900 dark:text-slate-100 transition-colors"'));
  assert.ok(appSrc.includes('mainClassName="bg-[#F8FAFC] dark:bg-[#0A0E1A] transition-colors"'));
  for (const nonSidebarFile of [
    'src/components/common/LoadingWindow.tsx',
    'src/components/common/PublicLayout.tsx',
    'src/components/auth/AuthModal.tsx',
    'src/components/saas/TenantOnboardingWizard.tsx',
    'src/components/saas/FreeTrialOnboardingModal.tsx',
    'src/components/saas/SuspendedStoreView.tsx',
    'src/components/saas/UnknownStore404View.tsx',
  ]) {
    assert.equal(
      readProjectFile(nonSidebarFile).includes('scope="sidebar"'),
      false,
      `${nonSidebarFile} must always retain Showroom Backdrop and never use sidebar-only backdrop preferences`
    );
  }
  const sidebarSrc = readProjectFile('src/components/common/Sidebar.tsx');
  assert.ok(sidebarSrc.includes('<ShowroomBackground contained={true} intensity="portal" scope="sidebar" />'));
  assert.ok(sidebarSrc.includes('sidebar-showroom-shell'));
  assert.ok(sidebarSrc.includes('bg-[#080A2A]'));
  assert.ok(sidebarSrc.includes("backdropStyle === 'solid'"));
  assert.ok(sidebarSrc.includes('bg-white text-slate-900'));
  assert.ok(sidebarSrc.includes('bg-[#0A0E1A] text-slate-100'));
  assert.ok(sidebarSrc.includes('const navGlassAlpha = 0.5;'));
  assert.equal(sidebarSrc.includes('backdropDarkness'), false, 'Sidebar showroom opacity must stay locked at 50% and never depend on backdropDarkness');
  const superAdminSrc = readProjectFile('src/components/saas/SuperAdminControlPanel.tsx');
  assert.equal(superAdminSrc.includes('intensity="workspace"'), false, 'SuperAdmin workspace routes must use solid background instead of showroom backdrop');
  assert.ok(superAdminSrc.includes('mainClassName="bg-[#F8FAFC] dark:bg-[#0A0E1A] transition-colors"'));
  assert.ok(superAdminSrc.includes('<ShowroomBackground contained={true} intensity="portal" scope="sidebar" />'));
  assert.ok(superAdminSrc.includes('sidebar-showroom-shell'));
  assert.ok(superAdminSrc.includes('bg-[#080A2A]'));
  assert.ok(superAdminSrc.includes("backdropStyle === 'solid'"));
  assert.ok(superAdminSrc.includes('bg-white text-slate-900'));
  assert.ok(superAdminSrc.includes('bg-[#0A0E1A] text-slate-100'));
  assert.ok(superAdminSrc.includes('const navGlassAlpha = 0.5;'));
  assert.equal(superAdminSrc.includes('backdropDarkness'), false, 'SuperAdmin sidebar showroom opacity must stay locked at 50% and never depend on backdropDarkness');
  const indexCssSrc = readProjectFile('src/index.css');
  assert.ok(indexCssSrc.includes('.sidebar-showroom-shell .showroom-bg-img'));
  assert.ok(indexCssSrc.includes('opacity: 0.95 !important;'));
  assert.equal(
    indexCssSrc.includes('html[data-backdrop-style="solid"]'),
    false,
    'Solid sidebar mode must not override main workspace .saas-panel styles'
  );
  assert.equal(
    readProjectFile('src/components/saas/FreeTrialOnboardingModal.tsx').includes('sidebar-showroom-shell'),
    false,
    'Non-sidebar modals must not apply sidebar-only showroom opacity'
  );
  const skeletonsSrc = readProjectFile('src/components/common/RouteSkeletons.tsx');
  assert.ok(skeletonsSrc.includes('bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-dvh'));

  // 8 core presets still preserved intact
  assert.equal(ACCENT_THEME_LIST.length, 8);
});
