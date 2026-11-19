import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  api,
  getActiveTenantId,
  isAbortError,
  subscribeApiMutation,
  subscribeSessionClear,
  subscribeTenantChange,
} from '../services/api.ts';
import { subscribeDataSync, type DataSyncTopic } from '../utils/dataSyncBus.ts';
import type { AllNotificationsResponse, GroupedNotificationsResponse } from '../types.ts';

export interface MutationSyncPlan {
  topics: DataSyncTopic[];
  refreshSuperAdmin: boolean;
  refreshSaas: boolean;
}

export function resolveMutationSyncPlan(endpoint: string): MutationSyncPlan {
  const pathOnly = endpoint.split('?')[0].toLowerCase();

  if (pathOnly.startsWith('/superadmin') || pathOnly.startsWith('/saas') || pathOnly.startsWith('/install')) {
    return {
      topics: pathOnly.includes('/notifications') ? ['notifications'] : [],
      refreshSuperAdmin: true,
      refreshSaas: true,
    };
  }
  if (pathOnly.startsWith('/backup/restore') || pathOnly.startsWith('/backup/import-sql')) {
    return {
      topics: [
        'products',
        'inventory',
        'sales',
        'returns',
        'purchases',
        'suppliers',
        'customers',
        'notifications',
        'settings',
      ],
      refreshSuperAdmin: false,
      refreshSaas: true,
    };
  }
  if (pathOnly.startsWith('/pos/')) {
    return {
      topics: ['sales', 'inventory', 'customers', 'notifications'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/returns')) {
    return {
      topics: ['returns', 'sales', 'inventory', 'customers', 'notifications'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/purchase-returns') || pathOnly.startsWith('/purchases')) {
    return {
      topics: ['purchases', 'inventory', 'suppliers', 'notifications'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/products') || pathOnly.startsWith('/categories')) {
    return {
      topics: ['products', 'inventory'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/inventory')) {
    return {
      topics: ['inventory', 'products'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/suppliers')) {
    return {
      topics: ['suppliers', 'purchases'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/customers')) {
    return {
      topics: ['customers'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (pathOnly.startsWith('/notifications')) {
    return {
      topics: ['notifications'],
      refreshSuperAdmin: false,
      refreshSaas: false,
    };
  }
  if (
    pathOnly.startsWith('/settings') ||
    pathOnly.startsWith('/tenants/onboarding') ||
    pathOnly.startsWith('/auth/profile')
  ) {
    return {
      topics: ['settings'],
      refreshSuperAdmin: false,
      refreshSaas: true,
    };
  }

  return {
    topics: [],
    refreshSuperAdmin: false,
    refreshSaas: false,
  };
}

function stableParamsString(params?: Record<string, unknown> | null): string {
  if (!params || typeof params !== 'object') return '';
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    if (val !== undefined && val !== '') {
      sorted[key] = val;
    }
  }
  return JSON.stringify(sorted);
}

export interface LiveFetchOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
  syncTopics?: DataSyncTopic[];
  refreshOnSaasMutation?: boolean;
  clearOnTenantChange?: boolean;
  scopeKey?: string;
}

export interface LiveFetchResult<T> {
  data: T | undefined;
  setData: Dispatch<SetStateAction<T | undefined>>;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<T | undefined>;
}

/**
 * Direct uncached live API data hook.
 * Never stores data in a shared cache, staleTime, or gcTime bucket;
 * always fetches fresh from the network and aborts stale in-flight requests.
 */
export function useLiveFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  depsKey: string,
  options?: LiveFetchOptions
): LiveFetchResult<T> {
  const enabled = options?.enabled ?? true;
  const refetchInterval = options?.refetchInterval ?? false;
  const clearOnTenantChange = options?.clearOnTenantChange ?? true;
  const syncTopicsKey = (options?.syncTopics || []).join('|');
  const refreshOnSaasMutation = options?.refreshOnSaasMutation ?? false;
  const scopeKey = options?.scopeKey ?? '';

  const [data, setData] = useState<T | undefined>(undefined);
  const [isPending, setIsPending] = useState<boolean>(enabled);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [error, setError] = useState<unknown>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const executeFetch = useCallback(async (): Promise<T | undefined> => {
    if (!mountedRef.current) return undefined;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const seq = ++requestSeqRef.current;

    setIsFetching(true);
    setError(null);

    try {
      const result = await fetcherRef.current(controller.signal);
      if (!mountedRef.current || controller.signal.aborted || seq !== requestSeqRef.current) {
        return undefined;
      }
      setData(result);
      setIsPending(false);
      setIsFetching(false);
      return result;
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        if (mountedRef.current && seq === requestSeqRef.current) {
          setIsFetching(false);
        }
        return undefined;
      }
      if (mountedRef.current && seq === requestSeqRef.current) {
        setError(err);
        setIsPending(false);
        setIsFetching(false);
      }
      return undefined;
    }
  }, []);

  // Fetch directly whenever enabled, depsKey, or scopeKey changes
  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort();
      setIsFetching(false);
      return;
    }
    void executeFetch();
  }, [enabled, depsKey, scopeKey, executeFetch]);

  // Clear stale local state on tenant change or session logout
  useEffect(() => {
    const unsubSession = subscribeSessionClear(() => {
      abortControllerRef.current?.abort();
      setData(undefined);
      setError(null);
      setIsFetching(false);
      setIsPending(enabledRef.current);
    });

    const unsubTenant = subscribeTenantChange(() => {
      if (clearOnTenantChange) {
        abortControllerRef.current?.abort();
        setData(undefined);
        setError(null);
      }
      if (enabledRef.current) {
        void executeFetch();
      }
    });

    return () => {
      unsubSession();
      unsubTenant();
    };
  }, [clearOnTenantChange, executeFetch]);

  // Auto-refresh active views when relevant mutations or dataSyncBus events happen
  useEffect(() => {
    const watchedTopics = new Set<DataSyncTopic>(
      syncTopicsKey ? (syncTopicsKey.split('|') as DataSyncTopic[]) : []
    );

    const shouldRefreshForTopics = (topics: DataSyncTopic[]) => {
      if (watchedTopics.size === 0) return false;
      return topics.some((t) => watchedTopics.has(t));
    };

    const unsubDataSync = subscribeDataSync('*', (event) => {
      if (enabledRef.current && shouldRefreshForTopics(event.topics)) {
        void executeFetch();
      }
    });

    const unsubMutation = subscribeApiMutation((endpoint) => {
      if (!enabledRef.current) return;
      const plan = resolveMutationSyncPlan(endpoint);
      if (
        shouldRefreshForTopics(plan.topics) ||
        (refreshOnSaasMutation && (plan.refreshSaas || plan.refreshSuperAdmin))
      ) {
        void executeFetch();
      }
    });

    const handleAnnouncement = () => {
      if (enabledRef.current && watchedTopics.has('notifications')) {
        void executeFetch();
      }
    };

    const handleOfflineSyncComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ __fromDataSyncBus?: boolean }>;
      if (customEvent.detail?.__fromDataSyncBus) return;
      if (
        enabledRef.current &&
        shouldRefreshForTopics(['sales', 'inventory', 'customers', 'notifications'])
      ) {
        void executeFetch();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('platform:announcement', handleAnnouncement);
      window.addEventListener('pos:offline-sync-complete', handleOfflineSyncComplete);
    }

    return () => {
      unsubDataSync();
      unsubMutation();
      if (typeof window !== 'undefined') {
        window.removeEventListener('platform:announcement', handleAnnouncement);
        window.removeEventListener('pos:offline-sync-complete', handleOfflineSyncComplete);
      }
    };
  }, [syncTopicsKey, refreshOnSaasMutation, executeFetch]);

  // Optional live polling interval while enabled and page visible
  useEffect(() => {
    if (!enabled || !refetchInterval || refetchInterval <= 0) {
      return;
    }
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (enabledRef.current) {
        void executeFetch();
      }
    }, refetchInterval);
    return () => clearInterval(timer);
  }, [enabled, refetchInterval, executeFetch]);

  return {
    data,
    setData,
    isPending,
    isFetching,
    isError: Boolean(error),
    error,
    refetch: executeFetch,
  };
}

export function useSaasDirectoryQuery(
  targetTenantId?: number | string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  }
) {
  const scopeKey = String(
    targetTenantId ?? (typeof window !== 'undefined' ? window.location.search : '')
  );

  return useLiveFetch(
    (signal) => api.saas.resolve(targetTenantId, { signal }),
    `saas:${scopeKey}`,
    {
      enabled: options?.enabled ?? true,
      refetchInterval: options?.refetchInterval ?? false,
      syncTopics: ['settings'],
      refreshOnSaasMutation: true,
      clearOnTenantChange: false,
      scopeKey,
    }
  );
}


export function useGroupedNotificationsQuery(
  limit: number = 10,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  }
) {
  const tenantId = getActiveTenantId();
  return useLiveFetch<GroupedNotificationsResponse>(
    (signal) => api.notifications.grouped(limit, { signal }),
    `notifications:grouped:${limit}`,
    {
      enabled: options?.enabled ?? true,
      refetchInterval: options?.refetchInterval ?? false,
      syncTopics: ['notifications', 'sales', 'returns', 'purchases'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useAllNotificationsQuery(
  params: {
    page?: number;
    limit?: number;
    tab?: string;
    category?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
    unreadOnly?: boolean;
  },
  options?: { enabled?: boolean }
) {
  const tenantId = getActiveTenantId();
  const paramsKey = stableParamsString(params as Record<string, unknown>);
  return useLiveFetch<AllNotificationsResponse>(
    (signal) => api.notifications.all(params, { signal }),
    `notifications:all:${paramsKey}`,
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['notifications', 'sales', 'returns', 'purchases'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useProductsQuery(
  params?: {
    search?: string;
    category?: string;
    brand?: string;
    lowStock?: boolean;
    lowStockOnly?: boolean;
    limit?: number;
  },
  options?: { enabled?: boolean }
) {
  const tenantId = getActiveTenantId();
  const paramsKey = stableParamsString(params as Record<string, unknown>);
  return useLiveFetch(
    (signal) => api.products.list(params, { signal }),
    `products:${paramsKey}`,
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['products', 'inventory', 'sales', 'returns', 'purchases'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useCategoriesQuery(options?: { enabled?: boolean }) {
  const tenantId = getActiveTenantId();
  return useLiveFetch(
    (signal) => api.categories.getCategories({ signal }),
    'categories:all',
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['products'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useCustomersQuery(
  search?: string,
  options?: { enabled?: boolean }
) {
  const tenantId = getActiveTenantId();
  return useLiveFetch(
    (signal) => api.customers.list(search || undefined, { signal }),
    `customers:${String(search || '').trim()}`,
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['customers', 'sales', 'returns'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useSuppliersQuery(
  search?: string,
  options?: { enabled?: boolean }
) {
  const tenantId = getActiveTenantId();
  return useLiveFetch(
    (signal) => api.suppliers.list(search || undefined, { signal }),
    `suppliers:${String(search || '').trim()}`,
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['suppliers', 'purchases'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useDashboardReportQuery(options?: { enabled?: boolean }) {
  const tenantId = getActiveTenantId();
  return useLiveFetch(
    (signal) => api.reports.getDashboard({ signal }),
    'reports:dashboard',
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['products', 'inventory', 'sales', 'returns', 'purchases', 'customers'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}

export function useInventoryLedgerQuery(
  params?: { productId?: number; movementType?: string; limit?: number },
  options?: { enabled?: boolean }
) {
  const tenantId = getActiveTenantId();
  const paramsKey = stableParamsString(params as Record<string, unknown>);
  return useLiveFetch(
    (signal) => api.inventory.ledger(params, { signal }),
    `inventory:ledger:${paramsKey}`,
    {
      enabled: options?.enabled ?? true,
      syncTopics: ['products', 'inventory', 'sales', 'returns', 'purchases'],
      scopeKey: String(tenantId ?? 'public'),
    }
  );
}
