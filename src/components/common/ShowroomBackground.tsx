import React, { useEffect, useState } from 'react';
import shoeStoreBg from '../../assets/images/shoe_store_blurred_bg_1790706924465.jpg';
import { useTheme } from '../../context/ThemeContext.tsx';
import type { ScreenImageSlot } from '../../utils/screenImages.ts';

export type BackdropIntensity = 'portal';

interface BackdropIntensityPreset {
  readonly containerBg: string;
  readonly imageClass: string;
  readonly darkScrim: string;
  readonly lightScrim: string;
}

/**
 * Hardcoded, non-overridable unified backdrop preset aligned
 * with the SaasLandingPage CTA showroom card (`bg-[#080A2A]`, `opacity-70 dark / opacity-75 light`,
 * and `from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55` directional scrim + radial highlight).
 */
export const BACKDROP_INTENSITY_PRESETS: Readonly<Record<BackdropIntensity, BackdropIntensityPreset>> =
  Object.freeze({
    portal: Object.freeze({
      containerBg: 'bg-[#080A2A]',
      imageClass: 'opacity-75 dark:opacity-70',
      darkScrim: 'bg-gradient-to-r from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55',
      lightScrim: 'bg-gradient-to-r from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55',
    }),
  });

interface ShowroomBackgroundProps {
  className?: string;
  screen?: ScreenImageSlot;
  intensity?: BackdropIntensity;
  contained?: boolean;
  /**
   * 'sidebar' applies the user's Sidebar Backdrop preference (Showroom + Darkness slider vs Solid White/Dark).
   * 'route' (default) preserves the Showroom Backdrop unconditionally across Auth, Login, Loading, and Portal routes.
   */
  scope?: 'route' | 'sidebar';
}

/**
 * ShowroomBackground
 * Unified showroom backdrop layer shared across Auth, Portal, Loading, Onboarding,
 * and Navigation Sidebars with automatic fallback to the built-in showroom asset.
 */
export const ShowroomBackground: React.FC<ShowroomBackgroundProps> = ({
  className = '',
  screen = 'backdrop',
  intensity = 'portal',
  contained = false,
  scope = 'route',
}) => {
  const { effectiveBackdropImage, theme, backdropStyle, backdropDarkness } = useTheme();
  const customImageUrl = effectiveBackdropImage;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [customImageUrl]);

  const activeImageUrl = customImageUrl && failedUrl !== customImageUrl ? customImageUrl : shoeStoreBg;
  const resolvedIntensity: BackdropIntensity = intensity === 'portal' ? 'portal' : 'portal';
  const preset = BACKDROP_INTENSITY_PRESETS[resolvedIntensity];

  const isSidebarScope = scope === 'sidebar';
  const isSolidBackdrop = isSidebarScope && backdropStyle === 'solid';
  const clampedDarkness = isSidebarScope
    ? 50
    : Math.max(0, Math.min(100, Math.round(backdropDarkness ?? 55)));
  const scrimScaleOpacity = isSidebarScope ? 0.5 : Math.min(1, clampedDarkness / 55);
  const extraDarkVeilOpacity =
    !isSidebarScope && clampedDarkness > 55
      ? Number((((clampedDarkness - 55) / 45) * 0.88).toFixed(3))
      : 0;

  if (isSolidBackdrop) {
    return (
      <div
        id={contained ? undefined : 'showroom-bg-image-layer'}
        data-screen={screen}
        data-unified-backdrop="true"
        data-backdrop-intensity={resolvedIntensity}
        data-backdrop-scope={scope}
        data-backdrop-style="solid"
        data-contained-backdrop={contained ? 'true' : undefined}
        className={`${contained ? 'absolute' : 'fixed'} inset-0 z-0 pointer-events-none overflow-hidden transition-colors duration-300 no-print print:hidden ${
          theme === 'dark' ? 'bg-[#0A0E1A]' : 'bg-white'
        } ${className}`}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      id={contained ? undefined : 'showroom-bg-image-layer'}
      data-screen={screen}
      data-unified-backdrop="true"
      data-backdrop-intensity={resolvedIntensity}
      data-backdrop-scope={scope}
      data-backdrop-style="showroom"
      data-backdrop-darkness={clampedDarkness}
      data-contained-backdrop={contained ? 'true' : undefined}
      className={`${contained ? 'absolute' : 'fixed'} inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-300 no-print print:hidden ${preset.containerBg} ${className}`}
      aria-hidden="true"
    >
      <img
        src={activeImageUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => {
          if (customImageUrl && failedUrl !== customImageUrl) {
            setFailedUrl(customImageUrl);
          }
        }}
        className={`showroom-bg-img w-full h-full object-cover object-center transition-opacity duration-300 select-none ${preset.imageClass}`}
      />
      <div
        className={`showroom-bg-scrim absolute inset-0 transition-opacity duration-300 ${
          theme === 'dark' ? preset.darkScrim : preset.lightScrim
        }`}
        style={{ opacity: scrimScaleOpacity }}
      />
      {extraDarkVeilOpacity > 0 && (
        <div
          className="showroom-bg-darkness-veil absolute inset-0 bg-[#040618] transition-opacity duration-300"
          style={{ opacity: extraDarkVeilOpacity }}
        />
      )}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(var(--primary-rgb,147,51,234),0.14),transparent_60%)]"
        style={{ opacity: Math.max(0.15, 0.6 * (1 - extraDarkVeilOpacity * 0.7)) }}
      />
    </div>
  );
};