import React, { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { useIntersectionObserver } from '../../hooks/useIntersectionObserver.ts';

export interface LazyProductImageProps {
  src?: string | null;
  alt: string;
  /** Classes applied to the outer observed wrapper element (sizing, borders, background, rounding). */
  containerClassName?: string;
  /** Classes applied to the underlying `<img>` element once visible & loaded. */
  imgClassName?: string;
  /** Fallback rendered when `src` is empty, unsafe, or fails to load. */
  fallback?: React.ReactNode;
  /** Optional custom skeleton rendered while awaiting viewport entry or image load. */
  placeholder?: React.ReactNode;
  /** IntersectionObserver rootMargin for pre-loading before scroll into view. */
  rootMargin?: string;
  /** IntersectionObserver threshold; defaults to `0.01`. */
  threshold?: number | number[];
  /** Optional scroll root element for nested scrollable panels. */
  root?: Element | Document | null;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  decoding?: 'async' | 'sync' | 'auto';
  title?: string;
  'aria-label'?: string;
}

export function sanitizeProductImageSrc(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed;
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,/i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Viewport-aware lazy product image component powered by `useIntersectionObserver`.
 * Defers network image requests and base64 image decoding until the card/row nears view.
 */
export const LazyProductImage: React.FC<LazyProductImageProps> = ({
  src,
  alt,
  containerClassName = '',
  imgClassName = 'w-full h-full object-cover',
  fallback,
  placeholder,
  rootMargin = '150px 0px',
  threshold = 0.01,
  root = null,
  referrerPolicy,
  decoding = 'async',
  title,
  'aria-label': ariaLabel,
}) => {
  const safeSrc = sanitizeProductImageSrc(src);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [safeSrc]);

  const { ref, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    root,
    rootMargin,
    threshold,
    triggerOnce: true,
    enabled: Boolean(safeSrc) && !hasError,
  });

  const shouldRenderFallback = !safeSrc || hasError;

  if (shouldRenderFallback) {
    return (
      <div
        ref={ref}
        className={containerClassName}
        title={title}
        aria-label={ariaLabel}
      >
        {fallback ?? (
          <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
            <ImageIcon className="w-5 h-5 stroke-[1.6]" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`relative ${containerClassName}`}
      title={title}
      aria-label={ariaLabel}
    >
      {!isLoaded && (
        placeholder ?? (
          <div
            aria-hidden="true"
            className="absolute inset-0 w-full h-full bg-slate-200/75 dark:bg-slate-800/70 animate-pulse flex items-center justify-center rounded-[inherit]"
          >
            <ImageIcon className="w-4 h-4 text-slate-400/80 dark:text-slate-500" />
          </div>
        )
      )}

      {hasIntersected && (
        <img
          src={safeSrc}
          alt={alt}
          loading="lazy"
          decoding={decoding}
          referrerPolicy={referrerPolicy}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          className={`${imgClassName} transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
};
