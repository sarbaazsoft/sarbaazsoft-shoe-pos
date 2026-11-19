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
  DEFAULT_CUSTOM_ACCENT_HEX,
  GUEST_ACCENT_THEME_STORAGE_KEY,
  GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY,
  GUEST_THEME_MODE_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
  ACCENT_THEME_STORAGE_KEY,
  applyAccentThemeToDOM,
  buildCustomAccentPalette,
  getAccessibleTextColor,
  getStoredGuestThemePreferences,
  getUserThemeCacheKey,
  getWcagContrastRatio,
  isValidHexColor,
  migrateLegacyGuestThemeIfNeeded,
  normalizeHexColor,
  parseUserThemePreference,
  persistActiveHydrationMirror,
  persistGuestThemePreferences,
  serializeUserThemePreference,
} from '../src/utils/themePalettes.ts';
import {
  PREDEFINED_SCREEN_IMAGE_LIBRARY,
  SCREEN_IMAGE_SLOTS,
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

  assert.deepEqual(parseUserThemePreference('dark|custom|#10B981'), {
    themeMode: 'dark',
    accentTheme: 'custom',
    customAccentHex: '#10B981',
  });

  // Legacy values preserved
  assert.deepEqual(
    parseUserThemePreference('violet', { themeMode: 'light', accentTheme: 'purple', customAccentHex: '#2563EB' }),
    { themeMode: 'light', accentTheme: 'purple', customAccentHex: '#2563EB' }
  );
  assert.deepEqual(
    parseUserThemePreference('#1E88E5', { themeMode: 'dark', accentTheme: 'purple', customAccentHex: '#2563EB' }),
    { themeMode: 'dark', accentTheme: 'custom', customAccentHex: '#1E88E5' }
  );
  assert.deepEqual(
    parseUserThemePreference('{"mode":"dark","accent":"cyan"}'),
    { themeMode: 'dark', accentTheme: 'cyan', customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX }
  );
  assert.deepEqual(
    parseUserThemePreference('', { themeMode: 'light', accentTheme: DEFAULT_ACCENT_THEME, customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX }),
    { themeMode: 'light', accentTheme: DEFAULT_ACCENT_THEME, customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX }
  );
});

test('HEX validation, custom shade generation, WCAG contrast calculation, and DOM tokens work cleanly', () => {
  assert.equal(isValidHexColor('#2563EB'), true);
  assert.equal(isValidHexColor('0ea'), true);
  assert.equal(isValidHexColor('#12345'), false);
  assert.equal(normalizeHexColor('0ea'), '#00EEAA');

  assert.equal(CURATED_APPEARANCE_PALETTES.length, 10);
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
  const originalDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      setAttribute: () => {},
      style: { setProperty: (k: string, v: string) => props.set(k, v) },
    },
    querySelector: () => null,
  };

  try {
    applyAccentThemeToDOM('custom', '#FACC15');
    assert.equal(props.get('--primary-contrast'), '#0F172A');
    assert.ok(props.get('--brand-soft-surface-light'));
    assert.ok(props.get('--brand-soft-surface-dark'));
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
    // Guest picks Pink + Dark
    persistGuestThemePreferences({
      themeMode: 'dark',
      accentTheme: 'pink',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
    });
    assert.equal(storage.get(GUEST_THEME_MODE_STORAGE_KEY), 'dark');
    assert.equal(storage.get(GUEST_ACCENT_THEME_STORAGE_KEY), 'pink');

    // User logs in with Teal + Light -> only hydration mirror & user cache update; guest keys remain Pink + Dark
    persistActiveHydrationMirror({
      themeMode: 'light',
      accentTheme: 'teal',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
    });
    storage.set(getUserThemeCacheKey(42), 'light|teal');

    assert.equal(storage.get(THEME_MODE_STORAGE_KEY), 'light');
    assert.equal(storage.get(ACCENT_THEME_STORAGE_KEY), 'teal');
    assert.equal(storage.get(GUEST_THEME_MODE_STORAGE_KEY), 'dark');
    assert.equal(storage.get(GUEST_ACCENT_THEME_STORAGE_KEY), 'pink');

    // User logs out -> restoreGuestThemeOnLogout reads independent guest keys (never user mirror)
    const restoredGuest = getStoredGuestThemePreferences();
    assert.deepEqual(restoredGuest, {
      themeMode: 'dark',
      accentTheme: 'pink',
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
    });

    // Legacy guest migration runs once when GUEST_* keys are absent
    storage.clear();
    storage.set(THEME_MODE_STORAGE_KEY, 'system');
    storage.set(ACCENT_THEME_STORAGE_KEY, 'orange');
    migrateLegacyGuestThemeIfNeeded();
    assert.equal(storage.get(GUEST_THEME_MODE_STORAGE_KEY), 'system');
    assert.equal(storage.get(GUEST_ACCENT_THEME_STORAGE_KEY), 'orange');
    assert.equal(storage.get(GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY), DEFAULT_CUSTOM_ACCENT_HEX);
  } finally {
    if (originalWin === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWin;
  }
});

test('Predefined screen image library uses external URLs only and external URL validator catches bad inputs & Pinterest HTML links', () => {
  assert.deepEqual(
    SCREEN_IMAGE_SLOTS.map((s) => s.id),
    ['login', 'registration', 'auth', 'loading']
  );

  assert.ok(PREDEFINED_SCREEN_IMAGE_LIBRARY.length >= 4);
  for (const item of PREDEFINED_SCREEN_IMAGE_LIBRARY) {
    assert.ok(item.url.startsWith('https://'), `Library image "${item.id}" must be an external https:// URL`);
    assert.equal(item.url.startsWith('data:'), false, 'Library images must never be inline data URIs');
    assert.equal(item.url.includes('localhost'), false, 'Library images must not reference local bundles');
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

    // 3. User 2 saves custom hex dark theme -> persisted to DB & visible via /api/auth/me without affecting User 3
    const save2Res = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({ themeColor: 'dark|custom|#10B981' }),
    });
    assert.equal(save2Res.status, 200);
    const save2Body = (await save2Res.json()) as { success: boolean; themeColor: string };
    assert.equal(save2Body.success, true);
    assert.equal(save2Body.themeColor, 'dark|custom|#10B981');

    const me2Res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin2}` },
    });
    assert.equal(me2Res.status, 200);
    const me2Body = (await me2Res.json()) as { user: { themeColor: string } };
    assert.equal(me2Body.user.themeColor, 'dark|custom|#10B981');

    // User 3 saves completely different preset independently
    const save3Res = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin3}`,
      },
      body: JSON.stringify({ themeColor: 'light|orange' }),
    });
    assert.equal(save3Res.status, 200);

    // Cashier saves personal color preference cleanly (200)
    const saveCashierRes = await fetch(`${baseUrl}/api/auth/theme`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCashier}`,
      },
      body: JSON.stringify({ themeColor: 'system|cyan' }),
    });
    assert.equal(saveCashierRes.status, 200);

    // Verify User 2 stayed dark|custom|#10B981 while User 3 is light|orange
    const me2AfterRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin2}` },
    });
    const me2AfterBody = (await me2AfterRes.json()) as { user: { themeColor: string } };
    assert.equal(me2AfterBody.user.themeColor, 'dark|custom|#10B981');

    const me3AfterRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tokenAdmin3}` },
    });
    const me3AfterBody = (await me3AfterRes.json()) as { user: { themeColor: string } };
    assert.equal(me3AfterBody.user.themeColor, 'light|orange');

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

    // 7. Screen images: ADMIN saves distinct URL + data URI + reset across individual screens
    const validSampleDataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const saveImgRes = await fetch(`${baseUrl}/api/settings/screen-images`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin2}`,
      },
      body: JSON.stringify({
        login: PREDEFINED_SCREEN_IMAGE_LIBRARY[0].url,
        registration: validSampleDataUri,
        auth: 'https://i.pinimg.com/originals/test/sample.jpg',
        loading: '',
      }),
    });
    assert.equal(saveImgRes.status, 200);
    const saveImgBody = (await saveImgRes.json()) as { screenImages: Record<string, string> };
    assert.equal(saveImgBody.screenImages.login, PREDEFINED_SCREEN_IMAGE_LIBRARY[0].url);
    assert.equal(saveImgBody.screenImages.registration, validSampleDataUri);
    assert.equal(saveImgBody.screenImages.auth, 'https://i.pinimg.com/originals/test/sample.jpg');
    assert.equal(saveImgBody.screenImages.loading, '');

    const refetchImgRes = await fetch(`${baseUrl}/api/settings/screen-images`);
    const refetchImgBody = (await refetchImgRes.json()) as { screenImages: Record<string, string> };
    assert.equal(refetchImgBody.screenImages.login, PREDEFINED_SCREEN_IMAGE_LIBRARY[0].url);
    assert.equal(refetchImgBody.screenImages.registration, validSampleDataUri);
  } finally {
    await pgClient.query('DELETE FROM users WHERE email LIKE $1', ['cashier-theme-%@balochshoes.com']);
    await pgClient.query('UPDATE users SET theme_color = $1 WHERE id = 2', [
      user2Before.rows[0]?.theme_color || '',
    ]);
    await pgClient.query('UPDATE users SET theme_color = $1 WHERE id = 3', [
      user3Before.rows[0]?.theme_color || '',
    ]);
    await updateScreenImageSettings(initialScreenImages, 'SUPERADMIN');
    await close();
  }
});

test('Frontend architecture wires SettingsView, live preview/cancel/save, race-guard epoch, and all screen slots', () => {
  const settingsSrc = readProjectFile('src/components/settings/SettingsView.tsx');
  assert.ok(settingsSrc.includes("import { AppearanceSettingsTab } from './AppearanceSettingsTab.tsx'"));
  assert.ok(settingsSrc.includes('id="settings-tab-appearance"'));
  assert.ok(settingsSrc.includes("activeTab === 'appearance'"));
  assert.ok(settingsSrc.includes('<AppearanceSettingsTab currentUser={currentUser} />'));

  const appearanceTabSrc = readProjectFile('src/components/settings/AppearanceSettingsTab.tsx');
  assert.ok(appearanceTabSrc.includes('id="appearance-apply-save-btn"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-cancel-preview-btn"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-reset-default-btn"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-custom-color-picker"'));
  assert.ok(appearanceTabSrc.includes('id="appearance-custom-hex-input"'));
  assert.ok(appearanceTabSrc.includes('id="screen-image-file-input"'));
  assert.ok(appearanceTabSrc.includes('id="screen-image-url-input"'));
  assert.ok(appearanceTabSrc.includes('PREDEFINED_SCREEN_IMAGE_LIBRARY'));

  const themeContextSrc = readProjectFile('src/context/ThemeContext.tsx');
  assert.ok(themeContextSrc.includes('requestEpochRef'));
  assert.ok(themeContextSrc.includes('syncUserThemeFromAuth'));
  assert.ok(themeContextSrc.includes('restoreGuestThemeOnLogout'));
  assert.ok(themeContextSrc.includes('updatePreview'));
  assert.ok(themeContextSrc.includes('cancelPreview'));
  assert.ok(themeContextSrc.includes('applyAndSaveAppearance'));

  const appSrc = readProjectFile('src/App.tsx');
  assert.ok(appSrc.includes('syncUserThemeFromAuth('));
  assert.ok(appSrc.includes('restoreGuestThemeOnLogout()'));

  // Screen slots mapped across Login, Registration, Auth, and Loading screens
  assert.ok(readProjectFile('src/components/common/LoadingWindow.tsx').includes('screen="loading"'));
  assert.ok(readProjectFile('src/components/auth/AuthModal.tsx').includes("tab === 'login' ? 'login' : 'auth'"));
  assert.ok(readProjectFile('src/components/saas/TenantOnboardingWizard.tsx').includes('screen="registration"'));
  assert.ok(readProjectFile('src/components/saas/FreeTrialOnboardingModal.tsx').includes('screen="registration"'));
  assert.ok(readProjectFile('src/components/saas/SuperAdminControlPanel.tsx').includes('screen="login"'));
  assert.ok(readProjectFile('src/components/common/ShowroomBackground.tsx').includes('referrerPolicy="no-referrer"'));

  // 8 core presets still preserved intact
  assert.equal(ACCENT_THEME_LIST.length, 8);
});
