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
  DEFAULT_ACCENT_THEME,
  THEME_MODE_STORAGE_KEY,
  applyAccentThemeToDOM,
  getActivePwaThemeColor,
  getStoredAccentTheme,
  isValidAccentTheme,
  persistAccentTheme,
  resolveAccentPalette,
  type AccentThemeId,
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
  const expectedBaseHexes: Record<AccentThemeId, string> = {
    purple: '#9333EA',
    red: '#F44336',
    orange: '#F97316',
    emerald: '#10B981',
    cyan: '#06B6D4',
    teal: '#14B8A6',
    indigo: '#6366F1',
    violet: '#8B5CF6',
    pink: '#EC4899',
    fuchsia: '#D946EF',
    stone: '#78716C',
  };

  it('exposes the default purple-indigo theme plus all 10 user-requested accent colors', () => {
    assert.equal(DEFAULT_ACCENT_THEME, 'purple');
    assert.equal(ACCENT_THEME_LIST.length, 11);

    const ids = ACCENT_THEME_LIST.map((p) => p.id);
    for (const [id, hex] of Object.entries(expectedBaseHexes) as Array<[AccentThemeId, string]>) {
      assert.ok(ids.includes(id), `Expected theme "${id}" in ACCENT_THEME_LIST`);
      assert.equal(ACCENT_THEME_PALETTES[id].baseHex.toUpperCase(), hex);
    }
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

  it('validates accent IDs and safely falls back to purple for unknown values', () => {
    assert.equal(isValidAccentTheme('emerald'), true);
    assert.equal(isValidAccentTheme('stone'), true);
    assert.equal(isValidAccentTheme('unknown-color'), false);
    assert.equal(isValidAccentTheme(null), false);

    assert.equal(resolveAccentPalette('cyan').id, 'cyan');
    assert.equal(resolveAccentPalette('invalid').id, 'purple');
    assert.equal(resolveAccentPalette(undefined).id, 'purple');
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
      const applied = applyAccentThemeToDOM('emerald');
      assert.equal(applied.id, 'emerald');
      assert.equal(attrs.get('data-accent-theme'), 'emerald');
      assert.equal(props.get('--primary'), '#059669');
      assert.equal(props.get('--primary-light'), '#10B981');
      assert.equal(props.get('--brand-companion'), '#0D9488');
      assert.equal(props.get('--color-purple-600'), '#059669');
      assert.equal(props.get('--color-indigo-600'), '#0D9488');
      assert.equal(props.get('--color-primary-600'), '#059669');
      assert.equal(props.get('--brand-btn-gradient'), applied.buttonGradient);
      assert.equal(props.get('--brand-header-gradient-dark'), applied.cardHeaderGradientDark);
      assert.equal(props.get('--brand-footer-gradient-light'), applied.cardFooterGradientLight);
      assert.equal(metaAttrs.get('content'), '#10B981');
    } finally {
      if (originalDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = originalDoc;
      }
    }
  });

  it('persists selected accent theme in localStorage and restores or falls back safely', () => {
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

    metaTags.set('meta[name="theme-color"]', createdMeta({ name: 'theme-color', content: '#14B8A6' }));
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
      assert.equal(getActivePwaThemeColor('#9333EA'), '#14B8A6');
      const branding = resolvePwaBranding({ role: 'admin', saasMode: 'tenant' });
      assert.equal(branding.themeColor, '#9333EA');

      syncPwaMetadataToDocument(branding);
      assert.equal(metaTags.get('meta[name="theme-color"]')?.getAttribute('content'), '#14B8A6');

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

  it('defines all 11 [data-accent-theme] CSS variable blocks and primary scale tokens in src/index.css', () => {
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

  it('wires ThemeDropdown and index.html pre-hydration script to all 11 accent themes', () => {
    const dropdownSource = readFileSync('src/components/common/ThemeDropdown.tsx', 'utf8');
    assert.ok(dropdownSource.includes('ACCENT_THEME_LIST'), 'ThemeDropdown should render ACCENT_THEME_LIST');
    assert.ok(dropdownSource.includes('theme-color-option-'), 'ThemeDropdown should expose per-color option IDs');

    const htmlSource = readFileSync('index.html', 'utf8');
    assert.ok(htmlSource.includes('pos_accent_theme'), 'index.html should restore pos_accent_theme early');
    for (const hex of Object.values(expectedBaseHexes)) {
      assert.ok(htmlSource.includes(hex), `index.html accent map should include ${hex}`);
    }
  });

  it('renders restyled ThemeDropdown with primary-colored mode icon and no circular primary-color dot', () => {
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

    // 1. Closed trigger in Light mode with Emerald accent: Sun icon uses emerald[600], no rounded-full dot
    const lightClosed = renderDropdown({ mode: 'light', accent: 'emerald', isOpen: false });
    assert.equal(lightClosed.includes('rounded-full'), false, 'Trigger should not render any circular dot');
    assert.ok(lightClosed.includes('lucide-sun'), 'Light mode trigger renders Sun icon');
    assert.ok(
      lightClosed.includes(`color:${ACCENT_THEME_PALETTES.emerald.primaryScale[600]}`),
      'Light mode trigger Sun icon should be colored with selected primaryScale[600]'
    );

    // 2. Closed trigger in Dark mode with Red accent: Moon icon uses red[400]
    const darkClosed = renderDropdown({ mode: 'dark', accent: 'red', isOpen: false });
    assert.equal(darkClosed.includes('rounded-full'), false);
    assert.ok(darkClosed.includes('lucide-moon'), 'Dark mode trigger renders Moon icon');
    assert.ok(
      darkClosed.includes(`color:${ACCENT_THEME_PALETTES.red.primaryScale[400]}`),
      'Dark mode trigger Moon icon should be colored with selected primaryScale[400]'
    );

    // 3. Open dropdown in System mode (dark OS) with Cyan accent:
    //    - 3-way segmented switcher has Light, Dark, System with Monitor icon tinted in cyan[400]
    //    - Primary Color selector renders all 11 color buttons with rectangular swatches and no circular dots
    const systemOpen = renderDropdown({
      mode: 'system',
      accent: 'cyan',
      isOpen: true,
      systemDark: true,
    });
    assert.equal(systemOpen.includes('rounded-full'), false, 'Open dropdown should contain zero circular dots');
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
  });
});

