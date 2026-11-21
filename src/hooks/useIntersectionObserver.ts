import { useCallback, useEffect, useState } from 'react';

export interface UseIntersectionObserverOptions {
  /** Optional scroll container root; defaults to browser viewport (`null`). */
  root?: Element | Document | null;
  /** Pre-load margin around viewport; defaults to `'150px 0px'`. */
  rootMargin?: string;
  /** Intersection visibility threshold(s); defaults to `0.01`. */
  threshold?: number | number[];
  /** Disconnect after first intersection; defaults to `true`. */
  triggerOnce?: boolean;
  /** Toggle observation dynamically; defaults to `true`. */
  enabled?: boolean;
}

export interface UseIntersectionObserverResult<T extends Element = HTMLElement> {
  /** Attach as `ref={ref}` to the DOM element to observe. */
  ref: (node: T | null) => void;
  /** Whether the observed element currently intersects the viewport/root. */
  isIntersecting: boolean;
  /** Sticky flag that stays `true` once the element has entered view (`triggerOnce`). */
  hasIntersected: boolean;
}

/**
 * Custom IntersectionObserver hook for deferring off-screen image & media loads
 * until their host container nears or enters the visible viewport.
 */
export function useIntersectionObserver<T extends Element = HTMLElement>(
  options: UseIntersectionObserverOptions = {}
): UseIntersectionObserverResult<T> {
  const {
    root = null,
    rootMargin = '150px 0px',
    threshold = 0.01,
    triggerOnce = true,
    enabled = true,
  } = options;

  const supportsObserver = typeof window !== 'undefined' && typeof IntersectionObserver !== 'undefined';

  const [targetNode, setTargetNode] = useState<T | null>(null);
  const [isIntersecting, setIsIntersecting] = useState<boolean>(() => !supportsObserver);
  const [hasIntersected, setHasIntersected] = useState<boolean>(() => !supportsObserver);

  const ref = useCallback((node: T | null) => {
    setTargetNode(node);
  }, []);

  const thresholdKey = Array.isArray(threshold) ? threshold.join(',') : String(threshold);

  useEffect(() => {
    if (!enabled) return;

    if (!supportsObserver) {
      setIsIntersecting(true);
      setHasIntersected(true);
      return;
    }

    if (triggerOnce && hasIntersected) return;
    if (!targetNode) return;

    let disconnected = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting || entry.intersectionRatio > 0;
          setIsIntersecting(visible);
          if (visible) {
            setHasIntersected(true);
            if (triggerOnce && !disconnected) {
              disconnected = true;
              observer.disconnect();
            }
          }
        }
      },
      {
        root,
        rootMargin,
        threshold,
      }
    );

    observer.observe(targetNode);

    return () => {
      disconnected = true;
      observer.disconnect();
    };
  }, [enabled, supportsObserver, targetNode, root, rootMargin, thresholdKey, triggerOnce, hasIntersected]);

  return {
    ref,
    isIntersecting,
    hasIntersected,
  };
}
