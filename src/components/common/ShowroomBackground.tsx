import React, { useEffect, useState } from 'react';
import shoeStoreBg from '../../assets/images/shoe_store_blurred_bg_1790706924465.jpg';
import { useTheme } from '../../context/ThemeContext.tsx';
import type { ScreenImageSlot } from '../../utils/screenImages.ts';

interface ShowroomBackgroundProps {
  className?: string;
  screen?: ScreenImageSlot;
}

/**
 * ShowroomBackground
 * Single unified showroom backdrop layer shared across all routes and screens
 * (login, registration, authentication, loading, onboarding, status pages)
 * with automatic fallback to the built-in showroom asset and adaptive light/dark scrim.
 */
export const ShowroomBackground: React.FC<ShowroomBackgroundProps> = ({
  className = '',
  screen = 'backdrop',
}) => {
  const { effectiveBackdropImage, theme } = useTheme();
  const customImageUrl = effectiveBackdropImage;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [customImageUrl]);

  const activeImageUrl = customImageUrl && failedUrl !== customImageUrl ? customImageUrl : shoeStoreBg;

  return (
    <div
      id="showroom-bg-image-layer"
      data-screen={screen}
      data-unified-backdrop="true"
      className={`fixed inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-300 ${className}`}
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
        className="w-full h-full object-cover object-center opacity-70 transition-opacity duration-300 select-none"
      />
      <div
        className={`absolute inset-0 transition-colors duration-300 ${
          theme === 'dark'
            ? 'bg-gradient-to-b from-[#0A0E1A]/45 via-[#0A0E1A]/25 to-[#0A0E1A]/60'
            : 'bg-gradient-to-b from-slate-200/35 via-transparent to-slate-200/45'
        }`}
      />
    </div>
  );
};