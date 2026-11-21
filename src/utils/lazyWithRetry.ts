import React from 'react';
import { canTriggerSafeReload } from './swUpdate.ts';

let lazyRetryGeneration = 0;

export function getLazyRetryGeneration(): number {
  return lazyRetryGeneration;
}

export function bumpLazyRetryGeneration(): number {
  lazyRetryGeneration += 1;
  return lazyRetryGeneration;
}

export function isDynamicImportError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name || ''} ${error.message || ''}`
      : typeof error === 'string'
      ? error
      : String(error || '');
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('importing a module script failed') ||
    lower.includes('loading chunk') ||
    lower.includes('chunkloaderror') ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed')
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDevEnvironment(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } })?.env?.DEV);
  } catch {
    return false;
  }
}

export async function retryDynamicImport<T>(
  loader: () => Promise<T>,
  devFallbackPath?: string,
  maxRetries: number = 2
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0 && isDevEnvironment() && devFallbackPath) {
        const separator = devFallbackPath.includes('?') ? '&' : '?';
        const bustedUrl = `${devFallbackPath}${separator}retry=${Date.now()}-${attempt}`;
        return (await import(/* @vite-ignore */ bustedUrl)) as T;
      }
      return await loader();
    } catch (err) {
      lastError = err;
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline || !isDynamicImportError(err) || attempt >= maxRetries) {
        break;
      }
      await waitMs(250 * (attempt + 1));
    }
  }

  // In production, if a hashed chunk is missing after a new deployment while online,
  // perform a single guarded reload so index.html resolves the latest chunk manifest.
  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.onLine !== false &&
    !isDevEnvironment() &&
    isDynamicImportError(lastError) &&
    canTriggerSafeReload('__pos_chunk_reload_at')
  ) {
    window.location.reload();
    return new Promise<T>(() => {});
  }

  throw lastError;
}

export function lazyWithRetry<P extends object, TModule = any>(
  loader: () => Promise<TModule>,
  pickDefault: (mod: TModule) => React.ComponentType<P>,
  devFallbackPath?: string
): React.FC<P> {
  let activeGeneration = lazyRetryGeneration;
  let LazyComponent = React.lazy(() =>
    retryDynamicImport(loader, devFallbackPath).then((mod) => ({
      default: pickDefault(mod),
    }))
  );

  const RetryableLazyWrapper: React.FC<P> = (props) => {
    if (activeGeneration !== lazyRetryGeneration) {
      activeGeneration = lazyRetryGeneration;
      LazyComponent = React.lazy(() =>
        retryDynamicImport(loader, devFallbackPath).then((mod) => ({
          default: pickDefault(mod),
        }))
      );
    }
    return React.createElement(LazyComponent, props);
  };

  return RetryableLazyWrapper;
}
