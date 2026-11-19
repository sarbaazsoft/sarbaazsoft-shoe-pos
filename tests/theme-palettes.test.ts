import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCENT_THEME_LIST,
  ACCENT_THEME_PALETTES,
  ACCENT_THEME_STORAGE_KEY,
  CUSTOM_ACCENT_HEX_STORAGE_KEY,
  DEFAULT_ACCENT_THEME,
  THEME_MODE_STORAGE_KEY,
  applyAccentThemeToDOM,
  buildCustomAccentPalette,
  getActivePwaThemeColor,
  getStoredAccentTheme,
  isValidAccentTheme,
  normalizeAccentThemeId,
  persistAccentTheme,
  persistCustomAccentHex,
  resolveAccentPalette,
  type AccentThemeId,
  type PresetAccentThemeId,
  type ShadeScale,
} from '../src/utils/themePalettes.ts';
import { resolvePwaBranding } from '../src/utils/pwaBranding.ts';
import { syncPwaMetadataToDocument } from '../src/hooks/usePwaManifest.ts';
import { ThemeProvider } from '../src/context/ThemeContext.tsx';
import { ThemeDropdown } from '../src/components/common/ThemeDropdown.tsx';

const HEX_RE = /^#[0-9A-F]{6}$/i;
const SHADES: Array<keyof ShadeScale> = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

describe('Multi-Color Brand Gradient Palettes', () => {
  const expectedBaseHexes: Record<PresetAccentThemeId, string> = {
    purple: '#9333EA',
    indigo: '#4F46E5',
    cyan: '#06B6D4',
    teal: '#0D9488',
    orange: '#F97316',
    red: '#EF4444',
    burgundy: '#9F1239',
    pink: '#EC4899',
  };

  it('exposes 8 non-duplicate distinct primary color presets without look-alike or removed clones', () => {
    assert.equal(DEFAULT_ACCENT_THEME, 'purple');
    assert.equal(ACCENT_THEME_LIST.length, 8);

    const ids = ACCENT_THEME_LIST.map((p) => p.id);
    for (const [id, hex] of Object.entries(expectedBaseHexes) as Array<[PresetAccentThemeId, string]>) {
      assert.ok(ids.includes(id), `Expected theme "${id}" in ACCENT_THEME_LIST`);
      assert.equal(ACCENT_THEME_PALETTES[id].baseHex.toUpperCase(), hex);
    }

    // Ensure removed/duplicate clone IDs (bronze, slate, gold, lime, blue, emerald, violet, rose, fuchsia, amber, sky, green, stone) are excluded from the preset picker
    for (const removed of ['bronze', 'slate', 'gold', 'lime', 'blue', 'emerald', 'violet', 'rose', 'fuchsia', 'amber', 'sky', 'green', 'stone']) {
      assert.equal(ids.includes(removed as AccentThemeId), false, `Removed/duplicate preset "${removed}" should not appear in picker`);
    }

    // Ensure every preset has unique baseHex and unique buttonGradient
    const uniqueHexes = new Set(ACCENT_THEME_LIST.map((p) => p.baseHex.toUpperCase()));
    const uniqueGradients = new Set(ACCENT_THEME_LIST.map((p) => p.buttonGradient));
    assert.equal(uniqueHexes.size, ACCENT_THEME_LIST.length);
    assert.equal(uniqueGradients.size, ACCENT_THEME_LIST.length);
  });

  it('defines complete 50..950 shade scales and valid gradient strings for every palette', () => {
    for (const palette of ACCENT_THEME_LIST) {
      assert.match(palette.baseHex, HEX_RE, `${palette.id} baseHex`);
      assert.match(palette.companionHex, HEX_RE, `${palette.id} companionHex`);
      assert.match(palette.darkSurfaceBg, HEX_RE, `${palette.id} darkSurfaceBg`);
      assert.match(palette.primaryRgb, /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/, `${palette.id} primaryRgb`);
      assert.match(palette.companionRgb, /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/, `${palette.id} companionRgb`);

      for (const shade of SHADES) {
        assert.match(palette.primaryScale[shade], HEX_RE, `${palette.id} primaryScale.${shade}`);
        assert.match(palette.companionScale[shade], HEX_RE, `${palette.id} companionScale.${shade}`);
      }

      const gradients = [
        palette.buttonGradient,
        palette.buttonGradientHover,
        palette.buttonGradientDark,
        palette.buttonGradientDarkHover,
        palette.cardHeaderGradientDark,
        palette.cardHeaderGradientLight,
        palette.cardFooterGradientDark,
        palette.cardFooterGradientLight,
      ];
      for (const grad of gradients) {
        assert.ok(grad.startsWith('linear-gradient('), `${palette.id} gradient must start with linear-gradient(`);
        assert.ok(grad.includes('#'), `${palette.id} gradient must include color stops`);
      }

      assert.ok(palette.cardHeaderGradientDark.includes(palette.primaryScale[900]));
      assert.ok(palette.cardHeaderGradientDark.includes(palette.companionScale[950]));
      assert.ok(palette.cardHeaderGradientLight.includes(palette.primaryScale[50]));
      assert.ok(palette.cardHeaderGradientLight.includes(palette.companionScale[50]));
      assert.ok(palette.cardFooterGradientDark.includes(palette.primaryScale[950]));
      assert.ok(palette.cardFooterGradientDark.includes(palette.companionScale[950]));
      assert.ok(palette.cardFooterGradientLight.includes(palette.primaryScale[50]));
      assert.ok(palette.cardFooterGradientLight.includes(palette.companionScale[50]));
    }
  });

  it('validates accent IDs, maps removed legacy aliases smoothly, and builds valid Custom Hex palettes', () => {
    assert.equal(isValidAccentTheme('teal'), true);
    assert.equal(isValidAccentTheme('burgundy'), true);
    assert.equal(isValidAccentTheme('bronze'), false);
    assert.equal(isValidAccentTheme('slate'), false);
    assert.equal(isValidAccentTheme('gold'), false);
    assert.equal(isValidAccentTheme('lime'), false);
    assert.equal(isValidAccentTheme('blue'), false);
    assert.equal(isValidAccentTheme('emerald'), false);
    assert.equal(isValidAccentTheme('custom'), true);
    assert.equal(isValidAccentTheme('unknown-color'), false);
    assert.equal(isValidAccentTheme(null), false);

    assert.equal(normalizeAccentThemeId('violet'), 'purple');
    assert.equal(normalizeAccentThemeId('rose'), 'pink');
    assert.equal(normalizeAccentThemeId('amber'), 'orange');
    assert.equal(normalizeAccentThemeId('gold'), 'orange');
    assert.equal(normalizeAccentThemeId('bronze'), 'orange');
    assert.equal(normalizeAccentThemeId('sky'), 'cyan');
    assert.equal(normalizeAccentThemeId('blue'), 'indigo');
    assert.equal(normalizeAccentThemeId('slate'), 'indigo');
    assert.equal(normalizeAccentThemeId('emerald'), 'teal');
    assert.equal(normalizeAccentThemeId('lime'), 'teal');

    assert.equal(resolveAccentPalette('cyan').id, 'cyan');
    assert.equal(resolveAccentPalette('violet').id, 'purple');
    assert.equal(resolveAccentPalette('gold').id, 'orange');
    assert.equal(resolveAccentPalette('bronze').id, 'orange');
    assert.equal(resolveAccentPalette('slate').id, 'indigo');
    assert.equal(resolveAccentPalette('invalid').id, 'purple');
    assert.equal(resolveAccentPalette(undefined).id, 'purple');

    const custom = buildCustomAccentPalette('#1A73E8');
    assert.equal(custom.id, 'custom');
    assert.equal(custom.baseHex, '#1A73E8');
    assert.equal(custom.primaryRgb, '26, 115, 232');
    for (const shade of SHADES) {
      assert.match(custom.primaryScale[shade], HEX_RE);
      assert.match(custom.companionScale[shade], HEX_RE);
    }
  });

  it('applyAccentThemeToDOM updates root CSS variables, Tailwind scale overrides, and theme-color meta tag', () => {
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const metaAttrs = new Map<string, string>();

    const originalDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        style: {
          setProperty: (k: string, v: string) => props.set(k, v),
        },
      },
      querySelector: (selector: string) =>
        selector === 'meta[name="theme-color"]'
          ? { setAttribute: (k: string, v: string) => metaAttrs.set(k, v) }
          : null,
    };

    try {
      const applied = applyAccentThemeToDOM('teal');
      assert.equal(applied.id, 'teal');
      assert.equal(attrs.get('data-accent-theme'), 'teal');
      assert.equal(props.get('--primary'), applied.primaryScale[600]);
      assert.equal(props.get('--primary-light'), applied.primaryScale[500]);
      assert.equal(props.get('--brand-companion'), applied.companionScale[600]);
      assert.equal(props.get('--color-purple-600'), applied.primaryScale[600]);
      assert.equal(props.get('--color-indigo-600'), applied.companionScale[600]);
      assert.equal(props.get('--color-primary-600'), applied.primaryScale[600]);
      assert.equal(props.get('--brand-btn-gradient'), applied.buttonGradient);
      assert.equal(props.get('--brand-header-gradient-dark'), applied.cardHeaderGradientDark);
      assert.equal(props.get('--brand-footer-gradient-light'), applied.cardFooterGradientLight);
      assert.equal(metaAttrs.get('content'), '#0D9488');

      const appliedCustom = applyAccentThemeToDOM('custom', '#FF5722');
      assert.equal(appliedCustom.id, 'custom');
      assert.equal(attrs.get('data-accent-theme'), 'custom');
      assert.equal(metaAttrs.get('content'), '#FF5722');
    } finally {
      if (originalDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = originalDoc;
      }
    }
  });

  it('persists selected accent theme and custom hex in localStorage and restores or falls back safely', () => {
    const storage = new Map<string, string>();
    const originalWin = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storage.set(k, v);
        },
      },
    };

    try {
      assert.equal(getStoredAccentTheme(), 'purple');

      persistAccentTheme('teal');
      assert.equal(storage.get(ACCENT_THEME_STORAGE_KEY), 'teal');
      assert.equal(getStoredAccentTheme(), 'teal');

      persistCustomAccentHex('#0ea5e9');
      assert.equal(storage.get(CUSTOM_ACCENT_HEX_STORAGE_KEY), '#0EA5E9');

      storage.set(ACCENT_THEME_STORAGE_KEY, 'not-a-theme');
      assert.equal(getStoredAccentTheme(), 'purple');
    } finally {
      if (originalWin === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWin;
      }
    }
  });

  it('syncPwaMetadataToDocument preserves the active dynamic accent theme-color instead of overwriting with static fallback', () => {
    const metaTags = new Map<string, { getAttribute: (k: string) => string | null; setAttribute: (k: string, v: string) => void }>();
    const createdMeta = (attrs: Record<string, string> = {}) => {
      const map = new Map<string, string>(Object.entries(attrs));
      return {
        getAttribute: (k: string) => map.get(k) ?? null,
        setAttribute: (k: string, v: string) => {
          map.set(k, v);
        },
      };
    };

    metaTags.set('meta[name="theme-color"]', createdMeta({ name: 'theme-color', content: '#0D9488' }));
    const manifestLink = createdMeta({ rel: 'manifest', href: '/manifest.webmanifest' });

    const originalDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      documentElement: {
        getAttribute: (k: string) => (k === 'data-accent-theme' ? 'teal' : null),
      },
      head: {
        appendChild: (node: { getAttribute: (k: string) => string | null; setAttribute: (k: string, v: string) => void }) => {
          const name = node.getAttribute('name');
          if (name) {
            metaTags.set(`meta[name="${name}"]`, node);
          }
        },
      },
      createElement: () => createdMeta(),
      querySelector: (sel: string) => {
        if (sel === 'link[rel="manifest"]') return manifestLink;
        return metaTags.get(sel) ?? null;
      },
      querySelectorAll: () => [],
    };

    try {
      assert.equal(getActivePwaThemeColor('#9333EA'), '#0D9488');
      const branding = resolvePwaBranding({ role: 'admin', saasMode: 'tenant' });
      assert.equal(branding.themeColor, '#9333EA');

      syncPwaMetadataToDocument(branding);
      assert.equal(metaTags.get('meta[name="theme-color"]')?.getAttribute('content'), '#0D9488');

      syncPwaMetadataToDocument(branding, { themeColor: '#F97316' });
      assert.equal(metaTags.get('meta[name="theme-color"]')?.getAttribute('content'), '#F97316');
    } finally {
      if (originalDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = originalDoc;
      }
    }
  });

  it('defines all 8 [data-accent-theme] CSS variable blocks and primary scale tokens in src/index.css', () => {
    const cssSource = readFileSync('src/index.css', 'utf8');

    for (const shade of SHADES) {
      assert.ok(cssSource.includes(`--color-primary-${shade}`), `src/index.css @theme missing --color-primary-${shade}`);
    }

    for (const palette of ACCENT_THEME_LIST) {
      const selector = `:root[data-accent-theme="${palette.id}"]`;
      assert.ok(cssSource.includes(selector), `src/index.css missing CSS rule block for ${selector}`);
      assert.ok(cssSource.includes(palette.darkSurfaceBg), `src/index.css missing darkSurfaceBg ${palette.darkSurfaceBg} for ${palette.id}`);
    }
  });

  it('keeps static PWA manifest theme_color at default #9333EA fallback', () => {
    const manifestFiles = [
      'public/manifest.json',
      'public/manifest.webmanifest',
      'public/admin/manifest.json',
      'public/admin/manifest.webmanifest',
    ];
    for (const file of manifestFiles) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { theme_color?: string };
      assert.equal(parsed.theme_color, '#9333EA', `${file} should preserve static theme_color fallback`);
    }
  });

  it('does not leave un-themed hardcoded dark purple card surfaces or bare rgba(147,51,234,...) glows in components', () => {
    const files = [...collectTsFiles('src/components'), 'src/utils/badgeStyles.ts'];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      assert.equal(
        /(?:^|[\s:'"`])dark:bg-\[#120726\]/.test(src),
        false,
        `${file} should use var(--brand-dark-surface) instead of hardcoded dark:bg-[#120726]`
      );
      // Allow rgba(147, 51, 234, ...) only inside Tailwind fallback syntax var(--primary-rgb,147,51,234)
      const cleaned = src.replace(/var\(--primary-rgb,\s*147,\s*51,\s*234\)/g, '');
      assert.equal(
        /rgba\(\s*147\s*,\s*51\s*,\s*234/.test(cleaned),
        false,
        `${file} should use var(--primary-rgb) instead of bare rgba(147,51,234,...)`
      );
    }
  });

  it('wires ThemeDropdown and index.html pre-hydration script to all 8 distinct accent themes + Custom Color picker', () => {
    const dropdownSource = readFileSync('src/components/common/ThemeDropdown.tsx', 'utf8');
    assert.ok(dropdownSource.includes('ACCENT_THEME_LIST'), 'ThemeDropdown should render ACCENT_THEME_LIST');
    assert.ok(dropdownSource.includes('theme-color-option-'), 'ThemeDropdown should expose per-color option IDs');
    assert.ok(dropdownSource.includes('theme-custom-color-input'), 'ThemeDropdown should expose custom color input');

    const htmlSource = readFileSync('index.html', 'utf8');
    assert.ok(htmlSource.includes('pos_accent_theme'), 'index.html should restore pos_accent_theme early');
    assert.ok(htmlSource.includes('pos_custom_accent_hex'), 'index.html should restore pos_custom_accent_hex early');
    for (const hex of Object.values(expectedBaseHexes)) {
      assert.ok(htmlSource.includes(hex), `index.html accent map should include ${hex}`);
    }
  });

  it('renders ThemeDropdown with primary-colored mode icon and primary-color dot next to selected Sun/Moon/System icon across all headers', () => {
    const renderDropdown = (opts: {
      mode: 'light' | 'dark' | 'system';
      accent: AccentThemeId;
      isOpen: boolean;
      systemDark?: boolean;
    }): string => {
      const storage = new Map<string, string>([
        [THEME_MODE_STORAGE_KEY, opts.mode],
        [ACCENT_THEME_STORAGE_KEY, opts.accent],
      ]);
      const originalWin = (globalThis as { window?: unknown }).window;
      const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;

      const mockStorage = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storage.set(k, v);
        },
      };

      (globalThis as { localStorage?: unknown }).localStorage = mockStorage;
      (globalThis as { window?: unknown }).window = {
        localStorage: mockStorage,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({
          matches: Boolean(opts.systemDark),
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      };

      try {
        return renderToStaticMarkup(
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(ThemeDropdown, { isOpen: opts.isOpen })
          )
        );
      } finally {
        if (originalWin === undefined) {
          delete (globalThis as { window?: unknown }).window;
        } else {
          (globalThis as { window?: unknown }).window = originalWin;
        }
        if (originalStorage === undefined) {
          delete (globalThis as { localStorage?: unknown }).localStorage;
        } else {
          (globalThis as { localStorage?: unknown }).localStorage = originalStorage;
        }
      }
    };

    // 1. Closed trigger in Light mode with Teal accent: Sun icon uses teal[600] + primary-color dot
    const lightClosed = renderDropdown({ mode: 'light', accent: 'teal', isOpen: false });
    assert.ok(lightClosed.includes('lucide-sun'), 'Light mode trigger renders Sun icon');
    assert.ok(
      lightClosed.includes(`color:${ACCENT_THEME_PALETTES.teal.primaryScale[600]}`),
      'Light mode trigger Sun icon should be colored with selected primaryScale[600]'
    );
    assert.ok(
      lightClosed.includes('data-testid="theme-primary-dot"'),
      'Closed trigger should render primary-color dot next to selected Sun icon'
    );
    assert.ok(
      lightClosed.includes(`background-color:${ACCENT_THEME_PALETTES.teal.baseHex}`),
      'Primary-color dot should be filled with selected Teal baseHex'
    );

    // 2. Closed trigger in Dark mode with Red accent: Moon icon uses red[400] + primary-color dot
    const darkClosed = renderDropdown({ mode: 'dark', accent: 'red', isOpen: false });
    assert.ok(darkClosed.includes('lucide-moon'), 'Dark mode trigger renders Moon icon');
    assert.ok(
      darkClosed.includes(`color:${ACCENT_THEME_PALETTES.red.primaryScale[400]}`),
      'Dark mode trigger Moon icon should be colored with selected primaryScale[400]'
    );
    assert.ok(
      darkClosed.includes(`background-color:${ACCENT_THEME_PALETTES.red.baseHex}`),
      'Primary-color dot should be filled with selected Red baseHex'
    );

    // 3. Open dropdown in System mode (dark OS) with Cyan accent:
    //    - Trigger shows Monitor icon + primary-color dot
    //    - Only the active System option in the 3-way switcher shows the primary-color dot next to its icon
    //    - Primary Color selector renders all 11 color buttons
    const systemOpen = renderDropdown({
      mode: 'system',
      accent: 'cyan',
      isOpen: true,
      systemDark: true,
    });
    assert.ok(systemOpen.includes('lucide-monitor'), 'System mode renders Monitor icon');
    assert.equal(
      (systemOpen.match(/data-testid="theme-primary-dot"/g) || []).length,
      1,
      'Trigger renders exactly one primary-color dot'
    );
    assert.equal(
      (systemOpen.match(/data-testid="theme-option-primary-dot"/g) || []).length,
      1,
      'Open dropdown renders primary-color dot next to only the selected appearance option'
    );
    assert.ok(
      systemOpen.includes(`background-color:${ACCENT_THEME_PALETTES.cyan.baseHex}`),
      'Primary-color dot should be filled with selected Cyan baseHex'
    );
    assert.ok(systemOpen.includes('Appearance'));
    assert.ok(systemOpen.includes('Primary Color'));
    assert.ok(systemOpen.includes('System · Dark'));
    assert.ok(
      systemOpen.includes(`color:${ACCENT_THEME_PALETTES.cyan.primaryScale[400]}`),
      'Active System Monitor icon in dropdown should use cyan primaryScale[400]'
    );
    assert.ok(
      systemOpen.includes(`background:${ACCENT_THEME_PALETTES.cyan.buttonGradient}`),
      'Selected accent option should render with its full buttonGradient background'
    );
    for (const palette of ACCENT_THEME_LIST) {
      assert.ok(
        systemOpen.includes(`id="theme-color-option-${palette.id}"`),
        `Open dropdown should include option button for ${palette.id}`
      );
    }

    // 4. Verify all headers mount ThemeDropdown (SaaS Landing, Public Auth/Loading, SuperAdmin, Store)
    for (const headerFile of [
      'src/components/saas/Navbar.tsx',
      'src/components/common/PublicHeader.tsx',
      'src/components/saas/SuperAdminControlPanel.tsx',
      'src/components/common/Header.tsx',
    ]) {
      const headerSrc = readFileSync(headerFile, 'utf8');
      assert.ok(headerSrc.includes('<ThemeDropdown'), `${headerFile} must mount ThemeDropdown`);
    }
  });

  it('uses active primary theme CSS variable tokens instead of hardcoded amber/orange in offline alert modals', () => {
    const offlineFiles = [
      'src/components/common/OfflineToastNotification.tsx',
      'src/components/pos/OfflineSyncModal.tsx',
    ];
    for (const file of offlineFiles) {
      const src = readFileSync(file, 'utf8');
      assert.equal(
        /\b(?:amber|orange)-\d{2,3}\b/.test(src),
        false,
        `${file} should not contain hardcoded amber-* or orange-* classes`
      );
      assert.ok(src.includes('bg-primary-500'), `${file} should use bg-primary-500 header bar`);
      assert.ok(src.includes('bg-primary-600'), `${file} should use bg-primary-600 primary CTA`);
      assert.ok(src.includes('text-primary-600'), `${file} should use text-primary-600 in light mode`);
      assert.ok(src.includes('dark:text-primary-400'), `${file} should use dark:text-primary-400 in dark mode`);
    }
  });

  it('applies 2px borders and visible shadows to outline and secondary buttons across landing, public/auth, and panel routes', () => {
    const cssSource = readFileSync('src/index.css', 'utf8');
    assert.ok(cssSource.includes('border-width: 2px;'), 'index.css outline/secondary buttons should use 2px borders');
    assert.equal(
      cssSource.includes('.btn-outline-landing,\n.saas-panel .btn-secondary {\n  background-color: transparent;\n  background-image: none;\n  border-width: 1px;'),
      false,
      '.btn-outline-landing and .saas-panel .btn-secondary must not force 1px borders'
    );
    assert.equal(
      /\.btn-outline-landing,\s*\.saas-panel \.btn-secondary\s*\{[^}]*box-shadow:\s*none;/s.test(cssSource),
      false,
      '.btn-outline-landing and .saas-panel .btn-secondary must not strip box-shadow'
    );

    const landingSrc = readFileSync('src/components/saas/SaasLandingPage.tsx', 'utf8');
    const outlineMatch = landingSrc.match(/const outlineBtn =\s*'([^']+)'/);
    assert.ok(outlineMatch, 'SaasLandingPage should define outlineBtn');
    assert.ok(outlineMatch[1].includes('border-2'), 'SaasLandingPage outlineBtn should use border-2');
    assert.ok(outlineMatch[1].includes('shadow-md'), 'SaasLandingPage outlineBtn should apply shadow-md');
    assert.ok(outlineMatch[1].includes('text-indigo-200') && outlineMatch[1].includes('lt:text-indigo-700'), 'SaasLandingPage outlineBtn font color should match border/bg tint');

    const navbarSrc = readFileSync('src/components/saas/Navbar.tsx', 'utf8');
    assert.ok(
      navbarSrc.includes('border-2 shadow-sm hover:shadow-md') && navbarSrc.includes('text-indigo-200') && navbarSrc.includes('text-indigo-700'),
      'Navbar outline Login buttons should use border-2, shadows, and matching font color'
    );

    const authSrc = readFileSync('src/components/auth/AuthModal.tsx', 'utf8');
    assert.ok(
      authSrc.includes('border-2 border-purple-400/70 shadow-sm hover:shadow-md') && authSrc.includes('text-purple-700 dark:text-purple-200'),
      'AuthModal outline button should use border-2, shadow, and matching font color'
    );

    const verifySrc = readFileSync('src/components/auth/VerifyEmailNoticeView.tsx', 'utf8');
    assert.ok(
      verifySrc.includes('border-2 border-indigo-400 dark:border-indigo-400/70') && verifySrc.includes('text-indigo-700 dark:text-indigo-200'),
      'VerifyEmailNoticeView outline button should use border-2, shadow, and matching font color'
    );

    const suspendedSrc = readFileSync('src/components/saas/SuspendedStoreView.tsx', 'utf8');
    assert.ok(
      suspendedSrc.includes('border-2 border-slate-600/80'),
      'SuspendedStoreView secondary Home button should use border-2 and shadow'
    );
  });

  it('keeps invoice preview solid white with dark text in Light Mode, semi-transparent dark in Dark Mode, and always white paper in print', () => {
    const modalSrc = readFileSync('src/components/pos/InvoicePrintModal.tsx', 'utf8');
    const previewMatches = modalSrc.match(/className="invoice-preview-receipt [^"]+"/g) || [];
    assert.equal(previewMatches.length, 2, 'Both 50mm thermal and A4 preview containers should exist');

    for (const cls of previewMatches) {
      assert.ok(cls.includes('bg-white'), 'Preview container must use solid bg-white in Light Mode');
      assert.ok(
        cls.includes('dark:bg-[#111C30]/80') && cls.includes('dark:backdrop-blur-md'),
        'Preview container must keep semi-transparent glass background in Dark Mode'
      );
      assert.ok(
        cls.includes('dark:border-purple-400/25'),
        'Preview container border should follow dynamic primary theme palette in Dark Mode'
      );
    }

    // Inspect lines inside interactive preview container (between INTERACTIVE PREVIEW and PRINT-ONLY CONTAINER)
    const previewStart = modalSrc.indexOf('INTERACTIVE PREVIEW CONTAINER');
    const printStart = modalSrc.indexOf('PRINT-ONLY CONTAINER');
    assert.ok(previewStart > -1 && printStart > previewStart);
    const previewSection = modalSrc.slice(previewStart, printStart);

    assert.equal(
      /\btext-black\b/.test(previewSection),
      false,
      'Preview section must not contain un-themed text-black classes'
    );
    assert.equal(
      /(?<!dark:)text-white\b/.test(previewSection),
      false,
      'Preview section must not contain bare text-white without dark: prefix'
    );
    assert.ok(
      previewSection.includes('invoice-store-name') &&
        previewSection.includes('invoice-item-article') &&
        previewSection.includes('invoice-item-price') &&
        previewSection.includes('invoice-total-payable'),
      'Preview section should wire invoice dark-mode typography hooks'
    );

    const cssSource = readFileSync('src/index.css', 'utf8');
    assert.ok(
      cssSource.includes('html:not(.dark) .saas-panel .invoice-preview-receipt') &&
        cssSource.includes('background-color: #FFFFFF !important;'),
      'Light Mode CSS must preserve solid white invoice preview background'
    );
    assert.ok(
      cssSource.includes('.dark .invoice-preview-receipt .bg-slate-50') &&
        cssSource.includes('background-color: rgba(30, 41, 59, 0.45) !important;'),
      'Dark Mode CSS must keep semi-transparent inner surfaces inside invoice preview'
    );
    assert.ok(
      cssSource.includes('html.dark .print-only,') &&
        cssSource.includes('html.dark .print-only *,') &&
        cssSource.includes('color: #000000 !important;'),
      '@media print CSS must force solid white paper background and black text even when Dark Mode is active'
    );
  });
});

