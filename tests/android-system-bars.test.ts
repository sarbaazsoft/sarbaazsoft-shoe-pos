import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCENT_THEME_LIST,
  applyAccentThemeToDOM,
  resolveSystemBarContrast,
  updatePwaThemeColorMeta,
} from '../src/utils/themePalettes.ts';
import { buildPwaManifest } from '../src/utils/pwaBranding.ts';

describe('Dynamic Android Navigation & Status Bar Synchronization', () => {
  it('reuses theme-color source and updates all system bar metas, CSS vars, contrast flags, and native bridges immediately', () => {
    const attrs = new Map<string, string>();
    const styles = new Map<string, string>();
    const metaTags = new Map<string, Map<string, string>>();
    const bridgeCalls: Array<{ fn: string; args: unknown[] }> = [];
    const dispatchedEvents: Array<{ type: string; detail: unknown }> = [];

    const makeMeta = (name: string) => {
      const m = new Map<string, string>([['name', name]]);
      metaTags.set(`meta[name="${name}"]`, m);
      return {
        getAttribute: (k: string) => m.get(k) ?? null,
        setAttribute: (k: string, v: string) => {
          m.set(k, v);
        },
      };
    };

    makeMeta('theme-color');
    makeMeta('msapplication-TileColor');
    makeMeta('msapplication-navbutton-color');
    makeMeta('apple-mobile-web-app-status-bar-style');

    const originalDoc = (globalThis as any).document;
    const originalWin = (globalThis as any).window;

    (globalThis as any).document = {
      documentElement: {
        classList: { contains: () => false },
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        style: {
          setProperty: (k: string, v: string) => styles.set(k, v),
        },
      },
      head: {
        appendChild: () => {},
      },
      querySelector: (selector: string) => {
        const m = metaTags.get(selector);
        if (!m) return null;
        return {
          getAttribute: (k: string) => m.get(k) ?? null,
          setAttribute: (k: string, v: string) => {
            m.set(k, v);
          },
        };
      },
    };

    (globalThis as any).window = {
      AndroidNavigationBar: {
        setNavigationBarColor: (...args: unknown[]) =>
          bridgeCalls.push({ fn: 'AndroidNavigationBar.setNavigationBarColor', args }),
      },
      Android: {
        setSystemBarsColor: (...args: unknown[]) =>
          bridgeCalls.push({ fn: 'Android.setSystemBarsColor', args }),
      },
      ReactNativeWebView: {
        postMessage: (msg: string) =>
          bridgeCalls.push({ fn: 'ReactNativeWebView.postMessage', args: [JSON.parse(msg)] }),
      },
      dispatchEvent: (ev: { type: string; detail?: unknown }) => {
        dispatchedEvents.push({ type: ev.type, detail: ev.detail });
        return true;
      },
    };

    try {
      // 1. Dark-ish accent (Teal #0D9488) in Light Mode -> light navigation icons (#FFFFFF)
      const teal = applyAccentThemeToDOM('teal', undefined, 'light');
      assert.equal(teal.baseHex, '#0D9488');
      assert.equal(metaTags.get('meta[name="theme-color"]')?.get('content'), '#0D9488');
      assert.equal(metaTags.get('meta[name="msapplication-navbutton-color"]')?.get('content'), '#0D9488');
      assert.equal(styles.get('--pwa-theme-color'), '#0D9488');
      assert.equal(styles.get('--android-status-bar-color'), '#0D9488');
      assert.equal(styles.get('--android-nav-bar-color'), '#0D9488');
      assert.equal(styles.get('--android-nav-bar-icon-color'), '#FFFFFF');
      assert.equal(attrs.get('data-nav-bar-contrast'), 'light');
      assert.equal(attrs.get('data-android-nav-bar-color'), '#0D9488');

      assert.ok(
        bridgeCalls.some(
          (c) =>
            c.fn === 'Android.setSystemBarsColor' &&
            c.args[0] === '#0D9488' &&
            c.args[1] === '#0D9488' &&
            c.args[2] === false
        ),
        'Android native bridge should receive matching status & navigation colors with light icons'
      );

      // 2. Bright accent (Cyan #06B6D4) -> dark navigation icons (#0F172A) for crisp WCAG contrast
      bridgeCalls.length = 0;
      const cyan = applyAccentThemeToDOM('cyan', undefined, 'light');
      assert.equal(cyan.baseHex, '#06B6D4');
      assert.equal(metaTags.get('meta[name="theme-color"]')?.get('content'), '#06B6D4');
      assert.equal(styles.get('--android-nav-bar-color'), '#06B6D4');
      assert.equal(styles.get('--android-nav-bar-icon-color'), '#0F172A');
      assert.equal(attrs.get('data-nav-bar-contrast'), 'dark');
      assert.equal(
        metaTags.get('meta[name="apple-mobile-web-app-status-bar-style"]')?.get('content'),
        'default'
      );
      assert.ok(
        bridgeCalls.some(
          (c) =>
            c.fn === 'AndroidNavigationBar.setNavigationBarColor' &&
            c.args[0] === '#06B6D4' &&
            c.args[1] === true
        ),
        'Bright accent must signal light-navigation-bar = true (dark icons)'
      );

      // 3. Bright custom hex (#FDE047) in Dark mode updates divider + icon contrast immediately
      applyAccentThemeToDOM('custom', '#FDE047', 'dark');
      assert.equal(metaTags.get('meta[name="theme-color"]')?.get('content'), '#FDE047');
      assert.equal(styles.get('--android-nav-bar-color'), '#FDE047');
      assert.equal(styles.get('--android-nav-bar-icon-color'), '#0F172A');
      assert.equal(styles.get('--android-nav-bar-divider-color'), 'rgba(255, 255, 255, 0.16)');

      // 4. Every preset theme updates dynamically without staying purple
      for (const palette of ACCENT_THEME_LIST) {
        updatePwaThemeColorMeta(palette.baseHex, { resolvedTheme: 'light' });
        assert.equal(metaTags.get('meta[name="theme-color"]')?.get('content'), palette.baseHex);
        assert.equal(styles.get('--android-nav-bar-color'), palette.baseHex);
      }

      assert.ok(
        dispatchedEvents.some((e) => e.type === 'pos:system-bars-changed'),
        'pos:system-bars-changed CustomEvent should be emitted for wrapper listeners'
      );
    } finally {
      if (originalDoc === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = originalDoc;
      if (originalWin === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = originalWin;
    }
  });

  it('computes proper icon contrast polarity for dark vs bright theme colors in both light and dark modes', () => {
    const darkPaletteContrast = resolveSystemBarContrast('#9333EA', 'dark');
    assert.equal(darkPaletteContrast.iconPolarity, 'light');
    assert.equal(darkPaletteContrast.iconColor, '#FFFFFF');
    assert.equal(darkPaletteContrast.isLightBackground, false);
    assert.equal(darkPaletteContrast.dividerColor, 'rgba(255, 255, 255, 0.16)');

    const brightPaletteContrast = resolveSystemBarContrast('#06B6D4', 'light');
    assert.equal(brightPaletteContrast.iconPolarity, 'dark');
    assert.equal(brightPaletteContrast.iconColor, '#0F172A');
    assert.equal(brightPaletteContrast.isLightBackground, true);
    assert.equal(brightPaletteContrast.dividerColor, 'rgba(15, 23, 42, 0.14)');
  });

  it('configures edge-to-edge viewport-fit=cover and dynamic safe-area bottom nav bar in index.html & src/index.css', () => {
    const html = readFileSync('index.html', 'utf8');
    assert.ok(html.includes('viewport-fit=cover'), 'index.html viewport should include viewport-fit=cover');
    assert.ok(
      html.includes('meta name="msapplication-navbutton-color"'),
      'index.html should declare msapplication-navbutton-color'
    );
    assert.ok(html.includes('--android-nav-bar-color'), 'index.html should initialize --android-nav-bar-color');
    assert.ok(html.includes('safe-area-inset-bottom'), 'index.html should bind safe-area-inset-bottom');

    const css = readFileSync('src/index.css', 'utf8');
    assert.ok(css.includes('--android-nav-bar-color'), 'src/index.css should define --android-nav-bar-color');
    assert.ok(css.includes('safe-area-inset-bottom'), 'src/index.css should render safe-area-inset-bottom');
    assert.ok(
      css.includes('html.dark,\nhtml.dark body {\n  background-color: #0a0e1a;\n}'),
      'src/index.css should preserve dark background on html.dark body without white override'
    );

    const dynamicManifest = buildPwaManifest('ADMIN', { themeColor: '#0D9488' });
    assert.equal(dynamicManifest.theme_color, '#0D9488');
  });

  it('implements native Android WebView wrapper with matching JS bridge, SharedPreferences persistence, contrast handling, and zero hardcoded purple', () => {
    const colorsXml = readFileSync('android-wrapper/app/src/main/res/values/colors.xml', 'utf8');
    const nightColorsXml = readFileSync('android-wrapper/app/src/main/res/values-night/colors.xml', 'utf8');
    const themesXml = readFileSync('android-wrapper/app/src/main/res/values/themes.xml', 'utf8');
    const manifestXml = readFileSync('android-wrapper/app/src/main/AndroidManifest.xml', 'utf8');
    const mainActivityKt = readFileSync('android-wrapper/app/src/main/java/com/sarbaazsoft/shoepos/MainActivity.kt', 'utf8');
    const themeManagerKt = readFileSync('android-wrapper/app/src/main/java/com/sarbaazsoft/shoepos/SystemBarThemeManager.kt', 'utf8');
    const proguard = readFileSync('android-wrapper/app/proguard-rules.pro', 'utf8');

    for (const [name, content] of [
      ['colors.xml', colorsXml],
      ['night/colors.xml', nightColorsXml],
      ['themes.xml', themesXml],
      ['AndroidManifest.xml', manifestXml],
      ['MainActivity.kt', mainActivityKt],
      ['SystemBarThemeManager.kt', themeManagerKt],
    ]) {
      assert.equal(
        /#(?:ff)?9333ea/i.test(content),
        false,
        `${name} must not contain hardcoded purple #9333EA`
      );
    }

    assert.ok(manifestXml.includes('.MainActivity'), 'Manifest should launch MainActivity WebView host');
    assert.ok(mainActivityKt.includes('addJavascriptInterface(bridge, "AndroidNavigationBar")'));
    assert.ok(mainActivityKt.includes('addJavascriptInterface(bridge, "Android")'));
    assert.ok(mainActivityKt.includes('fun setSystemBarsColor('));
    assert.ok(mainActivityKt.includes('fun setNavigationBarColor('));
    assert.ok(mainActivityKt.includes('fun updateThemeColor('));
    assert.ok(mainActivityKt.includes('fun syncSystemBarsColor('));
    assert.ok(mainActivityKt.includes('WindowCompat.setDecorFitsSystemWindows(window, false)'));
    assert.ok(mainActivityKt.includes('WindowInsetsCompat.Type.navigationBars()'));
    assert.ok(mainActivityKt.includes('webView.canGoBack()'));

    assert.ok(themeManagerKt.includes('isAppearanceLightStatusBars'));
    assert.ok(themeManagerKt.includes('isAppearanceLightNavigationBars'));
    assert.ok(themeManagerKt.includes('isNavigationBarContrastEnforced = false'));
    assert.ok(themeManagerKt.includes('getSharedPreferences('));
    assert.ok(themeManagerKt.includes('restoreSavedOrDefault()'));

    assert.ok(proguard.includes('@android.webkit.JavascriptInterface'));
  });
});

