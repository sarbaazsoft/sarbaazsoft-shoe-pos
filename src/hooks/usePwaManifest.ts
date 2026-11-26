import { useEffect, useMemo } from 'react';
import {
  resolvePwaBranding,
  type PwaBrandingConfig,
  type PwaBrandingInput,
} from '../utils/pwaBranding.ts';
import { applyBrowserFavicon } from '../utils/documentTitle.ts';
import { useTheme } from '../context/ThemeContext.tsx';
import { getActivePwaThemeColor, updatePwaThemeColorMeta } from '../utils/themePalettes.ts';

function upsertMetaTag(
  selector: string,
  attrs: Record<string, string>,
  content: string
): void {
  if (typeof document === 'undefined') return;
  let el = document.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    document.head.appendChild(el);
  }
  if (el.getAttribute('content') !== content) {
    el.setAttribute('content', content);
  }
}

function upsertManifestLink(href: string): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href);
  }
}

/**
 * Synchronizes PWA manifest link, installation shortcut meta tags (application-name,
 * apple-mobile-web-app-title), dynamic theme-color, apple-touch-icons, and browser favicon
 * with the active role branding config without altering document.title or overwriting
 * the user's selected primary color theme.
 */
export function syncPwaMetadataToDocument(
  branding: PwaBrandingConfig,
  options?: { themeColor?: string; resolvedTheme?: 'light' | 'dark' }
): void {
  if (typeof document === 'undefined') return;

  upsertMetaTag(
    'meta[name="apple-mobile-web-app-title"]',
    { name: 'apple-mobile-web-app-title' },
    branding.appleMobileWebAppTitle
  );
  upsertMetaTag(
    'meta[name="application-name"]',
    { name: 'application-name' },
    branding.applicationName
  );
  updatePwaThemeColorMeta(
    options?.themeColor || getActivePwaThemeColor(branding.themeColor),
    options?.resolvedTheme ? { resolvedTheme: options.resolvedTheme } : undefined
  );

  upsertManifestLink(branding.manifestUrl);

  const touchIcons = document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (touchIcons.length === 0) {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = branding.appleTouchIcon;
    document.head.appendChild(link);
  } else {
    touchIcons.forEach((link) => {
      const sizes = link.getAttribute('sizes');
      let targetHref = branding.appleTouchIcon;
      if (sizes === '192x192') {
        targetHref = `${branding.iconPrefix}/pwa-192x192.png`;
      } else if (sizes === '512x512') {
        targetHref = `${branding.iconPrefix}/pwa-512x512.png`;
      }
      if (link.getAttribute('href') !== targetHref) {
        link.setAttribute('href', targetHref);
      }
    });
  }

  applyBrowserFavicon(branding.faviconPath);
}

/**
 * React hook that keeps PWA meta tags (including dynamic theme-color) and <link rel="manifest">
 * strictly synchronized with the user's active role, SuperAdmin view state, and primary theme color.
 */
export function usePwaManifest(input: PwaBrandingInput): PwaBrandingConfig {
  const { pwaThemeColor, theme } = useTheme();
  const branding = useMemo(
    () =>
      resolvePwaBranding({
        role: input.role,
        saasMode: input.saasMode,
        isSuperAdmin: input.isSuperAdmin,
        pathname: input.pathname,
      }),
    [input.role, input.saasMode, input.isSuperAdmin, input.pathname]
  );

  useEffect(() => {
    syncPwaMetadataToDocument(branding, { themeColor: pwaThemeColor, resolvedTheme: theme });
  }, [branding, pwaThemeColor, theme]);

  return branding;
}
