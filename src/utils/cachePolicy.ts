export const IS_CACHING_PAUSED = true;

export type CacheEnvironment = 'development' | 'production';
export type QueryCacheTier = 'default' | 'realtime' | 'standard' | 'settings' | 'reference';

const PRODUCTION_STALE_TIMES_MS: Record<QueryCacheTier, number> = {
  realtime: 15_000,
  standard: 25_000,
  default: 30_000,
  settings: 60_000,
  reference: 5 * 60_000,
};

export function resolveCacheEnvironment(isProdOverride?: boolean): CacheEnvironment {
  if (IS_CACHING_PAUSED) {
    return 'development';
  }

  if (typeof isProdOverride === 'boolean') {
    return isProdOverride ? 'production' : 'development';
  }

  try {
    const metaEnv = (import.meta as unknown as {
      env?: { PROD?: boolean; DEV?: boolean; MODE?: string };
    })?.env;
    if (metaEnv) {
      if (typeof metaEnv.PROD === 'boolean') {
        return metaEnv.PROD ? 'production' : 'development';
      }
      if (metaEnv.MODE) {
        return metaEnv.MODE === 'production' ? 'production' : 'development';
      }
      if (typeof metaEnv.DEV === 'boolean') {
        return metaEnv.DEV ? 'development' : 'production';
      }
    }
  } catch {
    // Fallback to process.env outside Vite runtime
  }

  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'production' ? 'production' : 'development';
  }

  return 'development';
}

export function isProductionCachingEnabled(isProdOverride?: boolean): boolean {
  if (IS_CACHING_PAUSED) {
    return false;
  }
  return resolveCacheEnvironment(isProdOverride) === 'production';
}

export function getQueryStaleTime(
  tier: QueryCacheTier = 'default',
  isProdOverride?: boolean
): number {
  if (IS_CACHING_PAUSED || !isProductionCachingEnabled(isProdOverride)) {
    return 0;
  }
  return PRODUCTION_STALE_TIMES_MS[tier];
}

export function resolveQueryClientDefaultOptions(isProdOverride?: boolean): {
  staleTime: number;
  gcTime: number;
  refetchOnWindowFocus: boolean;
  refetchOnMount: boolean;
  refetchOnReconnect: boolean;
} {
  if (IS_CACHING_PAUSED) {
    return {
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
    };
  }

  const isProd = isProductionCachingEnabled(isProdOverride);
  if (!isProd) {
    return {
      staleTime: 0,
      gcTime: 2 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
    };
  }

  return {
    staleTime: PRODUCTION_STALE_TIMES_MS.default,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: true,
  };
}
