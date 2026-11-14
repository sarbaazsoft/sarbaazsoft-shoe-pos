import { QueryClient } from '@tanstack/react-query';
import {
  getActiveTenantId,
  isAbortError,
  subscribeSessionClear,
  subscribeTenantChange,
} from './api.ts';
import { subscribeDataSync, type DataSyncTopic } from '../utils/dataSyncBus.ts';

function resolveTenantScope(tenantId?: number | null): string {
  const effective = tenantId !== undefined ? tenantId : getActiveTenantId();
  return effective && Number.isFinite(Number(effective)) && Number(effective) > 0
    ? String(Number(effective))
    : 'public';
}

function stableParamsKey(params?: Record<string, unknown> | null): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {};
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    if (val !== undefined && val !== '') {
      sorted[key] = val;
    }
  }
  return sorted;
}

export const queryKeys = {
  saas: {
    all: () => ['saas'] as const,
    resolve: (scope?: string | number | null) =>
      ['saas', 'resolve', String(scope ?? '')] as const,
    publicStats: () => ['saas', 'publicStats'] as const,
    platformOwner: () => ['saas', 'platformOwner'] as const,
  },
  superAdmin: {
    all: () => ['superadmin'] as const,
    overview: () => ['superadmin', 'overview'] as const,
    trials: (params?: { search?: string; status?: string }) =>
      ['superadmin', 'trials', stableParamsKey(params)] as const,
    notifications: () => ['superadmin', 'notifications'] as const,
  },
  settings: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'settings'] as const,
    store: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'settings', 'store'] as const,
    users: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'settings', 'users'] as const,
    subscription: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'settings', 'subscription'] as const,
  },
  products: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'products'] as const,
    list: (
      params?: {
        search?: string;
        category?: string;
        brand?: string;
        lowStock?: boolean;
        lowStockOnly?: boolean;
        limit?: number;
      },
      tenantId?: number | null
    ) =>
      [
        'tenant',
        resolveTenantScope(tenantId),
        'products',
        'list',
        stableParamsKey(params as Record<string, unknown>),
      ] as const,
    catalog: (limit: number = 500, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'products', 'catalog', limit] as const,
  },
  categories: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'categories'] as const,
  },
  customers: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'customers'] as const,
    list: (search?: string, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'customers', 'list', String(search || '').trim()] as const,
    detail: (id: number, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'customers', 'detail', id] as const,
  },
  suppliers: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'suppliers'] as const,
    list: (search?: string, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'suppliers', 'list', String(search || '').trim()] as const,
    ledger: (id: number, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'suppliers', 'ledger', id] as const,
  },
  purchases: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'purchases'] as const,
    list: (search?: string, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'purchases', 'list', String(search || '').trim()] as const,
  },
  purchaseReturns: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'purchaseReturns'] as const,
    list: (search?: string, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'purchaseReturns', 'list', String(search || '').trim()] as const,
  },
  inventory: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'inventory'] as const,
    ledger: (
      params?: { productId?: number; movementType?: string; limit?: number },
      tenantId?: number | null
    ) =>
      [
        'tenant',
        resolveTenantScope(tenantId),
        'inventory',
        'ledger',
        stableParamsKey(params as Record<string, unknown>),
      ] as const,
  },
  sales: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'sales'] as const,
    list: (
      params?: { startDate?: string; endDate?: string; search?: string; limit?: number },
      tenantId?: number | null
    ) =>
      [
        'tenant',
        resolveTenantScope(tenantId),
        'sales',
        'list',
        stableParamsKey(params as Record<string, unknown>),
      ] as const,
  },
  reports: {
    all: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'reports'] as const,
    dashboard: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'reports', 'dashboard'] as const,
    topSelling: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'reports', 'topSelling'] as const,
    profitLoss: (
      params?: { startDate?: string; endDate?: string },
      tenantId?: number | null
    ) =>
      [
        'tenant',
        resolveTenantScope(tenantId),
        'reports',
        'profitLoss',
        stableParamsKey(params as Record<string, unknown>),
      ] as const,
  },
  notifications: {
    allRoot: (tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'notifications'] as const,
    grouped: (limit: number = 10, tenantId?: number | null) =>
      ['tenant', resolveTenantScope(tenantId), 'notifications', 'grouped', limit] as const,
    all: (
      params?: {
        page?: number;
        limit?: number;
        tab?: string;
        category?: string;
        search?: string;
        sortBy?: string;
        sortOrder?: string;
        unreadOnly?: boolean;
      },
      tenantId?: number | null
    ) =>
      [
        'tenant',
        resolveTenantScope(tenantId),
        'notifications',
        'all',
        stableParamsKey(params as Record<string, unknown>),
      ] as const,
  },
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error: any) => {
        if (isAbortError(error)) return false;
        const status = Number(error?.status);
        if (status >= 400 && status < 500) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        return failureCount < 1;
      },
    },
  },
});

export function resolveInvalidationKeysForTopics(
  topics: DataSyncTopic[],
  tenantId?: number | null
): readonly (readonly unknown[])[] {
  const prefixes: (readonly unknown[])[] = [];
  const seen = new Set<string>();

  const add = (key: readonly unknown[]) => {
    const serialized = JSON.stringify(key);
    if (!seen.has(serialized)) {
      seen.add(serialized);
      prefixes.push(key);
    }
  };

  for (const topic of topics) {
    switch (topic) {
      case 'products':
        add(queryKeys.products.all(tenantId));
        add(queryKeys.categories.all(tenantId));
        add(queryKeys.reports.all(tenantId));
        break;
      case 'inventory':
        add(queryKeys.products.all(tenantId));
        add(queryKeys.inventory.all(tenantId));
        add(queryKeys.reports.all(tenantId));
        break;
      case 'sales':
        add(queryKeys.sales.all(tenantId));
        add(queryKeys.reports.all(tenantId));
        add(queryKeys.customers.all(tenantId));
        add(queryKeys.inventory.all(tenantId));
        add(queryKeys.products.all(tenantId));
        add(queryKeys.notifications.allRoot(tenantId));
        break;
      case 'returns':
        add(queryKeys.sales.all(tenantId));
        add(queryKeys.reports.all(tenantId));
        add(queryKeys.customers.all(tenantId));
        add(queryKeys.inventory.all(tenantId));
        add(queryKeys.products.all(tenantId));
        add(queryKeys.notifications.allRoot(tenantId));
        break;
      case 'purchases':
        add(queryKeys.purchases.all(tenantId));
        add(queryKeys.purchaseReturns.all(tenantId));
        add(queryKeys.suppliers.all(tenantId));
        add(queryKeys.inventory.all(tenantId));
        add(queryKeys.products.all(tenantId));
        add(queryKeys.reports.all(tenantId));
        add(queryKeys.notifications.allRoot(tenantId));
        break;
      case 'suppliers':
        add(queryKeys.suppliers.all(tenantId));
        add(queryKeys.purchases.all(tenantId));
        break;
      case 'customers':
        add(queryKeys.customers.all(tenantId));
        add(queryKeys.reports.all(tenantId));
        break;
      case 'notifications':
        add(queryKeys.notifications.allRoot(tenantId));
        add(queryKeys.superAdmin.notifications());
        break;
      case 'settings':
        add(queryKeys.settings.all(tenantId));
        add(queryKeys.saas.all());
        break;
    }
  }

  return prefixes;
}

export async function invalidateQueriesForTopics(
  topics: DataSyncTopic[],
  tenantId?: number | null
): Promise<void> {
  const keys = resolveInvalidationKeysForTopics(topics, tenantId);
  await Promise.all(
    keys.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
        refetchType: 'active',
      })
    )
  );
}

export function evictTenantQueries(): void {
  void queryClient.cancelQueries({
    predicate: (query) => query.queryKey[0] === 'tenant',
  });
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] === 'tenant',
  });
}

export function resetAllQueryCache(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}

let isLifecycleRegistered = false;

export function registerQueryCacheLifecycle(): () => void {
  if (isLifecycleRegistered) {
    return () => {};
  }
  isLifecycleRegistered = true;

  const unsubSessionClear = subscribeSessionClear(() => {
    resetAllQueryCache();
  });

  const unsubTenantChange = subscribeTenantChange(() => {
    evictTenantQueries();
  });

  const unsubDataSync = subscribeDataSync('*', (event) => {
    void invalidateQueriesForTopics(event.topics);
  });

  const handleAnnouncement = () => {
    void invalidateQueriesForTopics(['notifications']);
  };

  const handleOfflineSyncComplete = (event: Event) => {
    const customEvent = event as CustomEvent<{ __fromDataSyncBus?: boolean }>;
    if (customEvent.detail?.__fromDataSyncBus) {
      return;
    }
    void invalidateQueriesForTopics(['sales', 'inventory', 'customers', 'notifications']);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('platform:announcement', handleAnnouncement);
    window.addEventListener('pos:offline-sync-complete', handleOfflineSyncComplete);
  }

  return () => {
    isLifecycleRegistered = false;
    unsubSessionClear();
    unsubTenantChange();
    unsubDataSync();
    if (typeof window !== 'undefined') {
      window.removeEventListener('platform:announcement', handleAnnouncement);
      window.removeEventListener('pos:offline-sync-complete', handleOfflineSyncComplete);
    }
  };
}
