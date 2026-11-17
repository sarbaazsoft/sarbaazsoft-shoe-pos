import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCENT_THEME_LIST,
  ACCENT_THEME_PALETTES,
  DEFAULT_ACCENT_THEME,
  applyAccentThemeToDOM,
  isValidAccentTheme,
  resolveAccentPalette,
  type AccentThemeId,
  type ShadeScale,
} from '../src/utils/themePalettes.ts';

const HEX_RE = /^#[0-9A-F]{6}$/i;
const SHADES: Array<keyof ShadeScale> = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

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

      // Ensure light & dark header/footer gradients reference both primary and companion stops
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
});
