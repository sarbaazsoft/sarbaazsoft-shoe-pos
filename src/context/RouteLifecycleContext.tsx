import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { subscribeDataSync, type DataSyncEvent, type DataSyncTopic } from '../utils/dataSyncBus.ts';

export const DEFAULT_MAX_KEEP_ALIVE_TABS = 3;
export const CORE_PINNED_TABS = new Set<string>(['pos', 'dashboard']);

export function normalizeKeepAliveTab(
  tab: string | undefined | null,
  role?: string | null,
  businessType?: string | null
): string {
  const clean = String(tab || '').toLowerCase().trim() || 'dashboard';
  const roleLower = String(role || '').toLowerCase();
  const isCashier = roleLower === 'cashier';
  const isWholesale = String(businessType || '').toUpperCase() === 'WHOLESALE';

  if (isWholesale && (clean === 'returns' || clean === 'exchange')) {
    return 'pos';
  }
  if (isCashier && (clean === 'dashboard' || clean === 'purchases' || !clean)) {
    return 'pos';
  }
  return clean;
}

export interface KeepAliveState {
  /** Stable render order (never reorders existing DOM nodes when reactivating tabs) */
  mountedTabs: string[];
  /** Least-recently-used order (most recent at the end) for bounded memory eviction */
  lruOrder: string[];
}

export function updateKeepAliveState(
  prev: KeepAliveState,
  nextTab: string,
  maxTabs: number = DEFAULT_MAX_KEEP_ALIVE_TABS
): KeepAliveState {
  const cleanNext = String(nextTab || '').trim();
  if (!cleanNext) return prev;

  const nextLru = [...prev.lruOrder.filter((t) => t !== cleanNext), cleanNext];
  const alreadyMounted = prev.mountedTabs.includes(cleanNext);

  if (alreadyMounted) {
    // Only update recency if it actually changed; avoid unnecessary array allocation when unchanged
    const sameOrder =
      prev.lruOrder.length === nextLru.length &&
      prev.lruOrder.every((t, i) => t === nextLru[i]);
    if (sameOrder) return prev;
    return {
      mountedTabs: prev.mountedTabs,
      lruOrder: nextLru,
    };
  }

  let nextMounted = [...prev.mountedTabs, cleanNext];
  let boundedLru = nextLru;

  while (nextMounted.length > Math.max(1, maxTabs)) {
    // Prefer evicting the least recently used non-pinned tab (and never the active tab)
    const evictCandidate =
      boundedLru.find((t) => t !== cleanNext && !CORE_PINNED_TABS.has(t)) ||
      boundedLru.find((t) => t !== cleanNext);

    if (!evictCandidate) break;
    nextMounted = nextMounted.filter((t) => t !== evictCandidate);
    boundedLru = boundedLru.filter((t) => t !== evictCandidate);
  }

  return {
    mountedTabs: nextMounted,
    lruOrder: boundedLru,
  };
}

interface RouteLifecycleContextValue {
  isActive: boolean;
  activationCount: number;
  tabId: string;
}

const RouteLifecycleContext = createContext<RouteLifecycleContextValue>({
  isActive: true,
  activationCount: 1,
  tabId: '',
});

export interface RouteLifecycleProviderProps {
  isActive: boolean;
  tabId: string;
  children: React.ReactNode;
}

export const RouteLifecycleProvider: React.FC<RouteLifecycleProviderProps> = ({
  isActive,
  tabId,
  children,
}) => {
  const [activationCount, setActivationCount] = useState<number>(() => (isActive ? 1 : 0));
  const wasActiveRef = useRef<boolean>(isActive);

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      setActivationCount((c) => c + 1);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  const value = React.useMemo(
    () => ({ isActive, activationCount, tabId }),
    [isActive, activationCount, tabId]
  );

  return (
    <RouteLifecycleContext.Provider value={value}>
      {children}
    </RouteLifecycleContext.Provider>
  );
};

export function useRouteActivity(): RouteLifecycleContextValue {
  return useContext(RouteLifecycleContext);
}

export interface UseDeferredRouteSyncOptions {
  isActive?: boolean;
  topics: DataSyncTopic[];
  onSync: () => void | Promise<void>;
  debounceMs?: number;
  sourceId?: string;
}

/**
 * Synchronizes kept-alive routes across cross-tab mutations without running
 * background network calls while the route is hidden. Pending invalidations
 * coalesce cleanly and execute silently as soon as the route becomes active.
 */
export function useDeferredRouteSync({
  isActive,
  topics,
  onSync,
  debounceMs = 80,
  sourceId,
}: UseDeferredRouteSyncOptions): void {
  const routeActivity = useRouteActivity();
  const effectiveActive = isActive ?? routeActivity.isActive;

  const isActiveRef = useRef(effectiveActive);
  const onSyncRef = useRef(onSync);
  const dirtyRef = useRef(false);
  const wasActiveRef = useRef(effectiveActive);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  isActiveRef.current = effectiveActive;
  onSyncRef.current = onSync;

  const scheduleSync = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!isActiveRef.current) {
        dirtyRef.current = true;
        return;
      }
      dirtyRef.current = false;
      void onSyncRef.current();
    }, debounceMs);
  }, [debounceMs]);

  const topicKey = topics.join('|');

  useEffect(() => {
    const topicList = (topicKey ? topicKey.split('|') : []) as DataSyncTopic[];
    const handleSyncEvent = (event: DataSyncEvent) => {
      if (sourceId && event.detail?.source === sourceId) {
        return;
      }
      if (!isActiveRef.current) {
        dirtyRef.current = true;
        return;
      }
      scheduleSync();
    };

    const unsubscribe = subscribeDataSync(topicList, handleSyncEvent);

    // Also bridge legacy window events that may be dispatched outside dataSyncBus
    const handleWindowInventoryUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (detail?.__fromDataSyncBus) return;
      if (topicList.includes('inventory') || topicList.includes('products')) {
        handleSyncEvent({ topics: ['inventory'], detail, timestamp: Date.now() });
      }
    };

    const handleOfflineSyncComplete = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (detail?.__fromDataSyncBus) return;
      if (
        topicList.includes('sales') ||
        topicList.includes('inventory') ||
        topicList.includes('customers') ||
        topicList.includes('notifications')
      ) {
        handleSyncEvent({
          topics: ['sales', 'inventory', 'customers', 'notifications'],
          detail,
          timestamp: Date.now(),
        });
      }
    };

    window.addEventListener('inventory:updated', handleWindowInventoryUpdated);
    window.addEventListener('pos:offline-sync-complete', handleOfflineSyncComplete);

    return () => {
      unsubscribe();
      window.removeEventListener('inventory:updated', handleWindowInventoryUpdated);
      window.removeEventListener('pos:offline-sync-complete', handleOfflineSyncComplete);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [topicKey, sourceId, scheduleSync]);

  useEffect(() => {
    if (effectiveActive && !wasActiveRef.current && dirtyRef.current) {
      dirtyRef.current = false;
      scheduleSync();
    }
    if (!effectiveActive && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      dirtyRef.current = true;
    }
    wasActiveRef.current = effectiveActive;
  }, [effectiveActive, scheduleSync]);
}
