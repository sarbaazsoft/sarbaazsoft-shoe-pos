import { useState, useEffect } from 'react';

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

/**
 * Returns true when the viewport matches Tailwind's `lg` desktop breakpoint (>= 1024px).
 * Used to keep keyboard shortcut tooltips, placeholders, and helper strings visible on
 * desktop while hiding them on mobile and tablet viewports.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return isDesktop;
}

export default useIsDesktop;
