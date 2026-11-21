import React, { Component, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import {
  DEFAULT_MAX_KEEP_ALIVE_TABS,
  KeepAliveState,
  RouteLifecycleProvider,
  normalizeKeepAliveTab,
  updateKeepAliveState,
} from '../../context/RouteLifecycleContext.tsx';
import { RouteSkeleton } from './RouteSkeletons.tsx';
import { bumpLazyRetryGeneration } from '../../utils/lazyWithRetry.ts';

interface TabErrorBoundaryProps {
  tabId: string;
  children: React.ReactNode;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  isOffline: boolean;
  retryNonce: number;
}

class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  private handleOnline = () => {
    if (this.state.hasError) {
      bumpLazyRetryGeneration();
      this.setState((prev) => ({
        hasError: false,
        isOffline: false,
        retryNonce: prev.retryNonce + 1,
      }));
    }
  };

  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
      retryNonce: 0,
    };
  }

  static getDerivedStateFromError(): Partial<TabErrorBoundaryState> {
    return {
      hasError: true,
      isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
    };
  }

  componentDidMount() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
    }
  }

  componentWillUnmount() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
  }

  componentDidUpdate(prevProps: TabErrorBoundaryProps) {
    if (prevProps.tabId !== this.props.tabId && this.state.hasError) {
      bumpLazyRetryGeneration();
      this.setState((prev) => ({
        hasError: false,
        isOffline: false,
        retryNonce: prev.retryNonce + 1,
      }));
    }
  }

  private handleRetry = () => {
    bumpLazyRetryGeneration();
    this.setState((prev) => ({
      hasError: false,
      isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
      retryNonce: prev.retryNonce + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-md mx-auto my-12 rounded-2xl bg-white dark:bg-[#0E1628] border border-slate-200 dark:border-slate-800 shadow-sm text-center space-y-3">
          <div className="w-11 h-11 mx-auto rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <WifiOff className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {this.state.isOffline ? 'Module Unavailable Offline' : 'Could Not Open This Section'}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {this.state.isOffline
              ? 'This tab has not been opened in the current session yet. Your POS terminal and queued offline transactions continue working normally.'
              : 'A temporary connection interruption prevented loading this tab.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:opacity-95 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryNonce}>{this.props.children}</React.Fragment>;
  }
}

export interface KeepAliveRouteHostProps {
  currentTab: string;
  userRole?: string | null;
  businessType?: string | null;
  scopeKey: string;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
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
    const isElementScrollable = Boolean(
      scroller && scroller.scrollHeight > scroller.clientHeight + 2
    );

    if (prevTab !== activeTab) {
      if (isElementScrollable && scroller) {
        scrollPositionsRef.current[prevTab] = scroller.scrollTop;
      } else if (typeof window !== 'undefined') {
        scrollPositionsRef.current[prevTab] = window.scrollY || 0;
      }
      prevActiveTabRef.current = activeTab;

      const targetScroll = scrollPositionsRef.current[activeTab] ?? 0;
      const rafId = requestAnimationFrame(() => {
        const activeScroller = scrollContainerRef.current;
        if (
          activeScroller &&
          activeScroller.scrollHeight > activeScroller.clientHeight + 2
        ) {
          activeScroller.scrollTop = targetScroll;
        } else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
          window.scrollTo({ top: targetScroll, behavior: 'auto' });
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
              <TabErrorBoundary tabId={tab}>
                <Suspense fallback={<RouteSkeleton tab={tab} />}>
                  {renderTab(tab)}
                </Suspense>
              </TabErrorBoundary>
            </RouteLifecycleProvider>
          </div>
        );
      })}
    </>
  );
};
