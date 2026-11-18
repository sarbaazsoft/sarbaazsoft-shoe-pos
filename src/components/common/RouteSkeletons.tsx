import React from 'react';

interface SkeletonBoxProps {
  className?: string;
}

const SkeletonBlock: React.FC<SkeletonBoxProps> = ({ className = '' }) => (
  <div
    className={`animate-pulse rounded-lg bg-slate-200/85 dark:bg-slate-800/80 ${className}`}
  />
);

const SkeletonCardSurface: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`rounded-2xl border border-slate-200/90 dark:border-purple-800/50 bg-white dark:bg-[#0E1628] shadow-xs transition-colors ${className}`}
  >
    {children}
  </div>
);

/**
 * Shared analytics skeleton for DashboardOverview and ReportsDashboard.
 */
export const AnalyticsOverviewSkeleton: React.FC<{ showFilterBar?: boolean }> = ({
  showFilterBar = false,
}) => (
  <div
    className="p-4 sm:p-6 lg:p-7 space-y-6 max-w-7xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-screen transition-colors"
    role="status"
    aria-label="Loading analytics overview"
  >
    {/* Header Bar */}
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-2.5">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="h-7 w-44 rounded-xl" />
          <SkeletonBlock className="h-5 w-24 rounded-full bg-indigo-100/90 dark:bg-indigo-950/70" />
        </div>
        <SkeletonBlock className="h-4 w-72 sm:w-96" />
      </div>
      <div className="flex items-center gap-2.5">
        <SkeletonBlock className="h-9 w-36 rounded-xl" />
        <SkeletonBlock className="h-9 w-9 rounded-xl" />
      </div>
    </div>

    {/* Optional filter strip for Reports */}
    {showFilterBar && (
      <SkeletonCardSurface className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBlock className="h-9 w-28 rounded-xl" />
          <SkeletonBlock className="h-9 w-28 rounded-xl" />
          <SkeletonBlock className="h-9 w-32 rounded-xl" />
          <SkeletonBlock className="h-9 w-24 rounded-xl" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 w-32 rounded-xl" />
          <SkeletonBlock className="h-9 w-28 rounded-xl" />
        </div>
      </SkeletonCardSurface>
    )}

    {/* 4 KPI Summary Cards matching StatCard light/dark theme */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      {[0, 1, 2, 3].map((idx) => (
        <div
          key={idx}
          className="rounded-2xl p-3 sm:p-5 border border-slate-200/90 dark:border-purple-800/60 bg-slate-50 dark:bg-gradient-to-br dark:from-[#0E1628] dark:to-purple-950/30 shadow-xs space-y-2.5 sm:space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <SkeletonBlock className="h-3.5 w-20 sm:w-28" />
            <SkeletonBlock className="h-7 w-7 sm:h-9 sm:w-9 rounded-lg sm:rounded-xl bg-indigo-100/80 dark:bg-purple-900/40 shrink-0" />
          </div>
          <SkeletonBlock className="h-6 sm:h-7 w-24 sm:w-36 rounded-lg" />
          <SkeletonBlock className="h-3 w-20 sm:w-24" />
        </div>
      ))}
    </div>

    {/* Charts Row */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <SkeletonCardSurface className="lg:col-span-2 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <SkeletonBlock className="h-5 w-48" />
            <SkeletonBlock className="h-3 w-64" />
          </div>
          <SkeletonBlock className="h-7 w-24 rounded-lg" />
        </div>
        <div className="h-56 flex items-end gap-3 pt-4 px-2">
          {[42, 68, 54, 82, 61, 90, 74, 58, 79, 85, 65, 88].map((pct, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div
                className="w-full rounded-t-lg animate-pulse bg-indigo-200/70 dark:bg-indigo-900/50"
                style={{ height: `${pct}%` }}
              />
              <SkeletonBlock className="h-2.5 w-full rounded" />
            </div>
          ))}
        </div>
      </SkeletonCardSurface>

      <SkeletonCardSurface className="p-5 space-y-4">
        <SkeletonBlock className="h-5 w-40" />
        <div className="space-y-3.5 pt-1">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="space-y-1.5">
              <div className="flex justify-between">
                <SkeletonBlock className="h-3.5 w-28" />
                <SkeletonBlock className="h-3.5 w-14" />
              </div>
              <SkeletonBlock className="h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonCardSurface>
    </div>

    {/* Recent Table Skeleton */}
    <SkeletonCardSurface className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-5 w-52" />
        <SkeletonBlock className="h-8 w-24 rounded-xl" />
      </div>
      <div className="space-y-2.5">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <SkeletonBlock className="h-9 w-9 rounded-xl shrink-0" />
              <div className="space-y-1.5">
                <SkeletonBlock className="h-3.5 w-36" />
                <SkeletonBlock className="h-3 w-24" />
              </div>
            </div>
            <SkeletonBlock className="h-4 w-20 hidden sm:block" />
            <SkeletonBlock className="h-6 w-20 rounded-full" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
        ))}
      </div>
    </SkeletonCardSurface>
  </div>
);

/**
 * Reusable CRUD Directory skeleton for Inventory (grid), Purchases, Suppliers, Customers (table).
 */
export const DirectoryCrudSkeleton: React.FC<{
  variant?: 'grid' | 'table';
  statCount?: number;
}> = ({ variant = 'table', statCount = 3 }) => (
  <div
    className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-7xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-screen transition-colors"
    role="status"
    aria-label="Loading directory workspace"
  >
    {/* Title & Primary Action */}
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-52 rounded-xl" />
        <SkeletonBlock className="h-4 w-72" />
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <SkeletonBlock className="h-10 w-28 rounded-xl" />
        <SkeletonBlock className="h-10 w-36 rounded-xl bg-purple-200/80 dark:bg-purple-900/50" />
      </div>
    </div>

    {/* Summary Strip */}
    {statCount > 0 && (
      <div className={`grid grid-cols-2 gap-2.5 sm:gap-4 ${statCount >= 4 ? 'lg:grid-cols-4' : statCount === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
        {Array.from({ length: statCount }).map((_, idx) => (
          <SkeletonCardSurface key={idx} className="p-3 sm:p-4 flex items-center justify-between gap-2">
            <div className="space-y-2 min-w-0">
              <SkeletonBlock className="h-3 w-20 sm:w-24" />
              <SkeletonBlock className="h-5 sm:h-6 w-20 sm:w-28" />
            </div>
            <SkeletonBlock className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl bg-indigo-100/80 dark:bg-purple-900/40 shrink-0" />
          </SkeletonCardSurface>
        ))}
      </div>
    )}

    {/* Search & Filter Toolbar */}
    <SkeletonCardSurface className="p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <SkeletonBlock className="h-10 flex-1 rounded-xl" />
      <div className="flex items-center gap-2">
        <SkeletonBlock className="h-10 w-32 rounded-xl" />
        <SkeletonBlock className="h-10 w-28 rounded-xl" />
      </div>
    </SkeletonCardSurface>

    {/* Body: Cards Grid (Inventory) or Dense Table (Customers / Suppliers / Purchases) */}
    {variant === 'grid' ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, idx) => (
          <SkeletonCardSurface key={idx} className="p-4 space-y-3.5">
            <div className="flex items-start gap-3">
              <SkeletonBlock className="h-14 w-14 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2 min-w-0">
                <SkeletonBlock className="h-4 w-4/5" />
                <SkeletonBlock className="h-3 w-1/2" />
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <SkeletonBlock className="h-11 rounded-xl" />
              <SkeletonBlock className="h-11 rounded-xl" />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <SkeletonBlock className="h-4 w-20" />
              <div className="flex gap-1.5">
                <SkeletonBlock className="h-8 w-8 rounded-lg" />
                <SkeletonBlock className="h-8 w-8 rounded-lg" />
              </div>
            </div>
          </SkeletonCardSurface>
        ))}
      </div>
    ) : (
      <SkeletonCardSurface className="overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50/90 dark:bg-[#131B2E] border-b border-slate-200/80 dark:border-purple-900/40 flex items-center justify-between gap-4">
          <SkeletonBlock className="h-3.5 w-28" />
          <SkeletonBlock className="h-3.5 w-24 hidden sm:block" />
          <SkeletonBlock className="h-3.5 w-20 hidden md:block" />
          <SkeletonBlock className="h-3.5 w-24" />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {Array.from({ length: 7 }).map((_, row) => (
            <div key={row} className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <SkeletonBlock className="h-10 w-10 rounded-xl shrink-0" />
                <div className="space-y-1.5 flex-1 max-w-xs">
                  <SkeletonBlock className="h-4 w-3/4" />
                  <SkeletonBlock className="h-3 w-1/2" />
                </div>
              </div>
              <SkeletonBlock className="h-4 w-24 hidden sm:block" />
              <SkeletonBlock className="h-6 w-20 rounded-full hidden md:block" />
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-8 w-8 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonCardSurface>
    )}
  </div>
);

/**
 * Reusable Ledger / Timeline Feed skeleton for StockLedgerView and NotificationsView.
 */
export const FeedLedgerSkeleton: React.FC = () => (
  <div
    className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-6xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-screen transition-colors"
    role="status"
    aria-label="Loading activity feed"
  >
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-48 rounded-xl" />
        <SkeletonBlock className="h-4 w-80" />
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBlock className="h-9 w-28 rounded-xl" />
        <SkeletonBlock className="h-9 w-9 rounded-xl" />
      </div>
    </div>

    <SkeletonCardSurface className="p-3.5 flex flex-wrap items-center gap-3">
      <SkeletonBlock className="h-10 flex-1 min-w-52 rounded-xl" />
      <SkeletonBlock className="h-10 w-40 rounded-xl" />
      <SkeletonBlock className="h-10 w-32 rounded-xl" />
    </SkeletonCardSurface>

    <SkeletonCardSurface className="divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden">
      {Array.from({ length: 8 }).map((_, idx) => (
        <div key={idx} className="p-4 sm:px-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            <SkeletonBlock className="h-9 w-9 rounded-xl shrink-0" />
            <div className="space-y-1.5 flex-1 max-w-md">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-4 w-16 rounded-full" />
              </div>
              <SkeletonBlock className="h-3 w-56" />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <SkeletonBlock className="h-5 w-16 rounded-full" />
            <SkeletonBlock className="h-4 w-20 hidden sm:block" />
          </div>
        </div>
      ))}
    </SkeletonCardSurface>
  </div>
);

/**
 * Split two-column checkout skeleton dedicated to POS Terminal.
 */
export const SplitPosSkeleton: React.FC = () => (
  <div
    className="p-3 sm:p-5 lg:p-6 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-screen transition-colors select-none"
    role="status"
    aria-label="Loading POS terminal"
  >
    {/* Left: Scanner, Catalog & Cart Lines */}
    <div className="lg:col-span-8 space-y-4">
      <SkeletonCardSurface className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SkeletonBlock className="h-11 flex-1 min-w-56 rounded-xl" />
          <SkeletonBlock className="h-11 w-36 rounded-xl" />
        </div>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((chip) => (
            <SkeletonBlock key={chip} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </SkeletonCardSurface>

      <SkeletonCardSurface className="p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/80">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-5 w-24" />
        </div>
        {[0, 1, 2, 3, 4].map((line) => (
          <div
            key={line}
            className="p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#131B2E]/60 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-11 w-11 rounded-xl shrink-0" />
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-44" />
                <SkeletonBlock className="h-3 w-28" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-8 w-24 rounded-lg" />
              <SkeletonBlock className="h-5 w-20" />
            </div>
          </div>
        ))}
      </SkeletonCardSurface>
    </div>

    {/* Right: Customer, Totals & Payment Pad */}
    <div className="lg:col-span-4 space-y-4">
      <SkeletonCardSurface className="p-5 space-y-4">
        <SkeletonBlock className="h-10 w-full rounded-xl" />
        <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <div className="flex justify-between">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-4 w-20" />
          </div>
          <div className="flex justify-between">
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="h-4 w-16" />
          </div>
          <div className="flex justify-between pt-2">
            <SkeletonBlock className="h-6 w-28" />
            <SkeletonBlock className="h-7 w-28" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((pm) => (
            <SkeletonBlock key={pm} className="h-10 rounded-xl" />
          ))}
        </div>
        <SkeletonBlock className="h-12 w-full rounded-xl bg-purple-200/80 dark:bg-purple-900/50" />
      </SkeletonCardSurface>
    </div>
  </div>
);

/**
 * Reusable focused workspace skeleton for Returns, Settings, and Sammi Assistant.
 */
export const FocusedUtilitySkeleton: React.FC<{ variant?: 'returns' | 'settings' | 'assistant' }> = ({
  variant = 'settings',
}) => (
  <div
    className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-6xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-screen transition-colors"
    role="status"
    aria-label="Loading workspace section"
  >
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-48 rounded-xl" />
        <SkeletonBlock className="h-4 w-72" />
      </div>
      <SkeletonBlock className="h-9 w-28 rounded-xl" />
    </div>

    {variant === 'settings' && (
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((t) => (
          <SkeletonBlock key={t} className="h-9 w-28 rounded-xl" />
        ))}
      </div>
    )}

    <SkeletonCardSurface className="p-5 sm:p-6 space-y-5">
      {variant === 'assistant' ? (
        <div className="space-y-4">
          {[0, 1, 2].map((msg) => (
            <div
              key={msg}
              className={`flex ${msg % 2 === 1 ? 'justify-end' : 'justify-start'}`}
            >
              <SkeletonBlock
                className={`h-16 rounded-2xl ${
                  msg % 2 === 1 ? 'w-2/3 sm:w-1/2 bg-purple-200/70 dark:bg-purple-900/40' : 'w-4/5 sm:w-2/3'
                }`}
              />
            </div>
          ))}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex gap-3">
            <SkeletonBlock className="h-12 flex-1 rounded-xl" />
            <SkeletonBlock className="h-12 w-24 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3, 4, 5].map((field) => (
            <div key={field} className="space-y-2">
              <SkeletonBlock className="h-3.5 w-32" />
              <SkeletonBlock className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      )}
    </SkeletonCardSurface>
  </div>
);

export const RouteSkeleton: React.FC<{ tab: string }> = ({ tab }) => {
  const clean = String(tab || '').toLowerCase().trim();
  switch (clean) {
    case 'dashboard':
      return <AnalyticsOverviewSkeleton />;
    case 'reports':
      return <AnalyticsOverviewSkeleton showFilterBar={true} />;
    case 'pos':
      return <SplitPosSkeleton />;
    case 'inventory':
      return <DirectoryCrudSkeleton variant="grid" statCount={4} />;
    case 'purchases':
      return <DirectoryCrudSkeleton variant="table" statCount={3} />;
    case 'suppliers':
    case 'customers':
      return <DirectoryCrudSkeleton variant="table" statCount={3} />;
    case 'ledger':
    case 'notifications':
      return <FeedLedgerSkeleton />;
    case 'returns':
      return <FocusedUtilitySkeleton variant="returns" />;
    case 'assistant':
      return <FocusedUtilitySkeleton variant="assistant" />;
    case 'settings':
    default:
      return <FocusedUtilitySkeleton variant="settings" />;
  }
};
