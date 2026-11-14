import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DEFAULT_MAX_KEEP_ALIVE_TABS,
  KeepAliveState,
  RouteLifecycleProvider,
  normalizeKeepAliveTab,
  updateKeepAliveState,
} from '../../context/RouteLifecycleContext.tsx';
import { RouteSkeleton } from './RouteSkeletons.tsx';

export interface KeepAliveRouteHostProps {
  currentTab: string;
  userRole?: string | null;
  businessType?: string | null;
  scopeKey: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  maxMountedTabs?: number;
  renderTab: (tab: string) => React.ReactNode;
}

export const KeepAliveRouteHost: React.FC<KeepAliveRouteHostProps> = ({
  currentTab,
  userRole,
  businessType,
  scopeKey,
  scrollContainerRef,
  maxMountedTabs = DEFAULT_MAX_KEEP_ALIVE_TABS,
  renderTab,
}) => {
  const activeTab = normalizeKeepAliveTab(currentTab, userRole, businessType);

  const [cacheState, setCacheState] = useState<KeepAliveState>(() => ({
    mountedTabs: [activeTab],
    lruOrder: [activeTab],
  }));

  const prevScopeKeyRef = useRef<string>(scopeKey);
  const prevActiveTabRef = useRef<string>(activeTab);
  const scrollPositionsRef = useRef<Record<string, number>>({});

  // Reset visited cache and saved scroll offsets cleanly whenever tenant/user/role/business scope changes
  useEffect(() => {
    if (prevScopeKeyRef.current !== scopeKey) {
      prevScopeKeyRef.current = scopeKey;
      scrollPositionsRef.current = {};
      prevActiveTabRef.current = activeTab;
      setCacheState({
        mountedTabs: [activeTab],
        lruOrder: [activeTab],
      });
    }
  }, [scopeKey, activeTab]);

  // Update LRU + mounted tabs when activeTab changes
  useEffect(() => {
    setCacheState((prev) => updateKeepAliveState(prev, activeTab, maxMountedTabs));
  }, [activeTab, maxMountedTabs]);

  // Remove scroll offsets for evicted tabs
  useEffect(() => {
    const mountedSet = new Set(cacheState.mountedTabs);
    for (const tabKey of Object.keys(scrollPositionsRef.current)) {
      if (!mountedSet.has(tabKey)) {
        delete scrollPositionsRef.current[tabKey];
      }
    }
  }, [cacheState.mountedTabs]);

  // Save previous tab scroll position and restore next tab scroll position smoothly
  useLayoutEffect(() => {
    const scroller = scrollContainerRef.current;
    const prevTab = prevActiveTabRef.current;

    if (prevTab !== activeTab) {
      if (scroller) {
        scrollPositionsRef.current[prevTab] = scroller.scrollTop;
      }
      prevActiveTabRef.current = activeTab;

      const targetScroll = scrollPositionsRef.current[activeTab] ?? 0;
      const rafId = requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = targetScroll;
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
    return undefined;
  }, [activeTab, scrollContainerRef]);

  return (
    <>
      {cacheState.mountedTabs.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <div
            key={`${scopeKey}:${tab}`}
            data-keepalive-tab={tab}
            aria-hidden={!isActive}
            className={isActive ? 'w-full' : 'hidden'}
          >
            <RouteLifecycleProvider isActive={isActive} tabId={tab}>
              <Suspense fallback={<RouteSkeleton tab={tab} />}>
                {renderTab(tab)}
              </Suspense>
            </RouteLifecycleProvider>
          </div>
        );
      })}
    </>
  );
};
