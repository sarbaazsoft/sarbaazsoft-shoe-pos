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
}

/**
 * ShowroomBackground
 * Single unified showroom backdrop layer shared across Auth, Portal, Loading, Onboarding,
 * and Navigation Sidebars with automatic fallback to the built-in showroom asset.
 */
export const ShowroomBackground: React.FC<ShowroomBackgroundProps> = ({
  className = '',
  screen = 'backdrop',
  intensity = 'portal',
  contained = false,
}) => {
  const { effectiveBackdropImage, theme } = useTheme();
  const customImageUrl = effectiveBackdropImage;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [customImageUrl]);

  const activeImageUrl = customImageUrl && failedUrl !== customImageUrl ? customImageUrl : shoeStoreBg;
  const resolvedIntensity: BackdropIntensity = intensity === 'portal' ? 'portal' : 'portal';
  const preset = BACKDROP_INTENSITY_PRESETS[resolvedIntensity];

  return (
    <div
      id={contained ? undefined : 'showroom-bg-image-layer'}
      data-screen={screen}
      data-unified-backdrop="true"
      data-backdrop-intensity={resolvedIntensity}
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
        className={`showroom-bg-scrim absolute inset-0 transition-colors duration-300 ${
          theme === 'dark' ? preset.darkScrim : preset.lightScrim
        }`}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(var(--primary-rgb,147,51,234),0.14),transparent_60%)] opacity-60" />
    </div>
  );
};