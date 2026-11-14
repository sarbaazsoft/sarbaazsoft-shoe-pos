import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, getActiveTenantId } from '../services/api.ts';
import { queryKeys } from '../services/queryClient.ts';
import { getQueryStaleTime } from '../utils/cachePolicy.ts';
import type { GroupedNotificationsResponse, AllNotificationsResponse } from '../types.ts';

export function useSaasDirectoryQuery(
  targetTenantId?: number | string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    staleTime?: number;
  }
) {
  const scopeKey =
    targetTenantId ??
    (typeof window !== 'undefined' ? window.location.search : '');

  return useQuery({
    queryKey: queryKeys.saas.resolve(scopeKey),
    queryFn: ({ signal }) => api.saas.resolve(targetTenantId, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? getQueryStaleTime('settings'),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useStoreSettingsQuery(
  tenantId?: number | null,
  options?: { enabled?: boolean; staleTime?: number }
) {
  const effectiveTenantId = tenantId ?? getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.settings.store(effectiveTenantId),
    queryFn: ({ signal }) => api.settings.get({ signal }),
    enabled: options?.enabled ?? Boolean(effectiveTenantId),
    staleTime: options?.staleTime ?? getQueryStaleTime('settings'),
  });
}

export function useGroupedNotificationsQuery(
  limit: number = 10,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    staleTime?: number;
  }
) {
  const tenantId = getActiveTenantId();
  return useQuery<GroupedNotificationsResponse>({
    queryKey: queryKeys.notifications.grouped(limit, tenantId),
    queryFn: ({ signal }) => api.notifications.grouped(limit, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? getQueryStaleTime('realtime'),
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
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
  return useQuery<AllNotificationsResponse>({
    queryKey: queryKeys.notifications.all(params, tenantId),
    queryFn: ({ signal }) => api.notifications.all(params, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: getQueryStaleTime('realtime'),
    placeholderData: keepPreviousData,
  });
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
  options?: { enabled?: boolean; staleTime?: number }
) {
  const tenantId = getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.products.list(params, tenantId),
    queryFn: ({ signal }) => api.products.list(params, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? getQueryStaleTime('default'),
    placeholderData: keepPreviousData,
  });
}

export function useCategoriesQuery(options?: { enabled?: boolean }) {
  const tenantId = getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.categories.all(tenantId),
    queryFn: ({ signal }) => api.categories.getCategories({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: getQueryStaleTime('reference'),
  });
}

export function useCustomersQuery(
  search?: string,
  options?: { enabled?: boolean; staleTime?: number }
) {
  const tenantId = getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.customers.list(search, tenantId),
    queryFn: ({ signal }) => api.customers.list(search || undefined, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? getQueryStaleTime('default'),
    placeholderData: keepPreviousData,
  });
}

export function useSuppliersQuery(
  search?: string,
  options?: { enabled?: boolean; staleTime?: number }
) {
  const tenantId = getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.suppliers.list(search, tenantId),
    queryFn: ({ signal }) => api.suppliers.list(search || undefined, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? getQueryStaleTime('default'),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardReportQuery(options?: { enabled?: boolean }) {
  const tenantId = getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.reports.dashboard(tenantId),
    queryFn: ({ signal }) => api.reports.getDashboard({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: getQueryStaleTime('realtime'),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryLedgerQuery(
  params?: { productId?: number; movementType?: string; limit?: number },
  options?: { enabled?: boolean }
) {
  const tenantId = getActiveTenantId();
  return useQuery({
    queryKey: queryKeys.inventory.ledger(params, tenantId),
    queryFn: ({ signal }) => api.inventory.ledger(params, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: getQueryStaleTime('realtime'),
    placeholderData: keepPreviousData,
  });
}
