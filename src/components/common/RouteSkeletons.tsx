import React from 'react';
import { Loader2 } from 'lucide-react';

interface SkeletonBoxProps {
  className?: string;
}

export const SkeletonBlock: React.FC<SkeletonBoxProps> = ({ className = '' }) => (
  <div
    className={`animate-pulse rounded-lg bg-slate-200/85 dark:bg-slate-800/80 ${className}`}
  />
);

export const SkeletonCardSurface: React.FC<{ children: React.ReactNode; className?: string }> = ({
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
    className="p-4 sm:p-6 lg:p-7 space-y-6 max-w-7xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-dvh transition-colors"
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
    className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-7xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-dvh transition-colors"
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
    className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-6xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-dvh transition-colors"
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
    className="p-3 sm:p-5 lg:p-6 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-dvh transition-colors select-none"
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
    className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-6xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-dvh transition-colors"
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

export interface CenteredLoadingSpinnerProps {
  label?: string;
  variant?: 'card' | 'inline' | 'modal';
  minHeightClass?: string;
  className?: string;
}

/**
 * Theme-aware centered spinner loader for simpler tabs, inline tables, and lazy modals.
 */
export const CenteredLoadingSpinner: React.FC<CenteredLoadingSpinnerProps> = ({
  label = 'Loading...',
  variant = 'card',
  minHeightClass,
  className = '',
}) => {
  if (variant === 'modal') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-950/75 backdrop-blur-xs"
      >
        <div
          className={`w-full max-w-xs sm:max-w-sm md:max-w-md my-auto min-h-[240px] bg-white dark:bg-[#131B2E] rounded-2xl border border-slate-200 dark:border-purple-800/70 shadow-2xl flex flex-col items-center justify-center gap-3 p-6 sm:p-8 transition-colors ${className}`}
        >
          <Loader2
            className="w-7 h-7 animate-spin text-purple-600 dark:text-purple-400"
            aria-hidden="true"
          />
          <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
            {label}
          </p>
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={`flex flex-col items-center justify-center gap-2.5 py-10 text-center ${minHeightClass || ''} ${className}`}
      >
        <Loader2
          className="w-6 h-6 animate-spin text-purple-600 dark:text-purple-400"
          aria-hidden="true"
        />
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto bg-white dark:bg-[#131B2E] rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm flex flex-col items-center justify-center gap-3 p-6 sm:p-8 transition-colors ${
        minHeightClass || 'min-h-[260px]'
      } ${className}`}
    >
      <Loader2
        className="w-7 h-7 animate-spin text-purple-600 dark:text-purple-400"
        aria-hidden="true"
      />
      <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
        {label}
      </p>
    </div>
  );
};

export type SettingsTabSkeletonVariant =
  | 'appearance'
  | 'printers'
  | 'backup'
  | 'notifications_prefs'
  | 'integrations';

/**
 * Layout-matching, theme-aware skeleton loaders for content-heavy lazy tabs in SettingsView.
 */
export const SettingsTabSkeleton: React.FC<{ tab: SettingsTabSkeletonVariant }> = ({
  tab,
}) => {
  if (tab === 'appearance') {
    return (
      <div
        className="space-y-5 select-none"
        role="status"
        aria-live="polite"
        aria-label="Loading appearance settings"
      >
        {/* Top Action Bar */}
        <div className="bg-white dark:bg-[#131B2E] p-3.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="w-10 h-10 rounded-xl shrink-0 bg-purple-100/80 dark:bg-purple-900/40" />
            <div className="space-y-1.5">
              <SkeletonBlock className="h-4 w-44" />
              <SkeletonBlock className="h-3 w-64 sm:w-80" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <SkeletonBlock className="h-10 w-full sm:w-24 rounded-xl" />
            <SkeletonBlock className="h-10 w-full sm:w-32 rounded-xl" />
            <SkeletonBlock className="h-10 col-span-2 sm:col-span-1 sm:w-28 rounded-xl bg-purple-200/80 dark:bg-purple-900/50" />
          </div>
        </div>

        {/* 12-Col Theme Controls + Live Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-6 transition-colors">
            {/* Display Mode */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <SkeletonBlock className="h-4 w-28" />
                  <SkeletonBlock className="h-3 w-64" />
                </div>
                <SkeletonBlock className="h-5 w-20 rounded-md" />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[0, 1, 2].map((i) => (
                  <SkeletonBlock key={i} className="h-[68px] rounded-xl" />
                ))}
              </div>
            </div>

            {/* Sidebar Backdrop Style */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-72" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <SkeletonBlock className="h-[68px] rounded-xl" />
                <SkeletonBlock className="h-[68px] rounded-xl" />
              </div>
            </div>

            {/* Auth Opacity Slider */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
              <SkeletonBlock className="h-4 w-56" />
              <SkeletonBlock className="h-24 w-full rounded-xl" />
            </div>

            {/* Core Presets */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
              <SkeletonBlock className="h-4 w-36" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <SkeletonBlock key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            </div>
          </div>

          <div className="xl:col-span-5 space-y-5">
            <div className="bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-4 transition-colors">
              <div className="flex items-center justify-between">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </div>
              <SkeletonBlock className="h-56 w-full rounded-2xl" />
              <SkeletonBlock className="h-10 w-full rounded-xl" />
            </div>
            <div className="bg-white dark:bg-[#131B2E] p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-3 transition-colors">
              <SkeletonBlock className="h-4 w-36" />
              <div className="grid grid-cols-2 gap-2">
                <SkeletonBlock className="h-10 rounded-xl" />
                <SkeletonBlock className="h-10 rounded-xl" />
              </div>
            </div>
          </div>
        </div>

        {/* Backdrop Image Studio Card */}
        <div className="bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-5 transition-colors">
          <div className="space-y-1.5">
            <SkeletonBlock className="h-4 w-48" />
            <SkeletonBlock className="h-3 w-72" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <SkeletonBlock className="lg:col-span-5 aspect-video w-full rounded-2xl" />
            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <SkeletonBlock key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'printers') {
    return (
      <div
        className="space-y-4 sm:space-y-6 select-none"
        role="status"
        aria-live="polite"
        aria-label="Loading printer settings"
      >
        {/* Hardware Banner */}
        <div className="rounded-2xl p-3.5 sm:p-5 border border-slate-200 dark:border-purple-800/80 bg-slate-50 dark:bg-slate-900/50 space-y-4 transition-colors">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <SkeletonBlock className="w-12 h-12 rounded-xl shrink-0 bg-purple-100/80 dark:bg-purple-900/40" />
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-56 sm:w-72" />
                <SkeletonBlock className="h-3 w-48 sm:w-64" />
              </div>
            </div>
            <SkeletonBlock className="h-7 w-36 rounded-full" />
          </div>
          <div className="pt-4 border-t border-slate-200 dark:border-purple-900/40 grid grid-cols-1 md:grid-cols-2 gap-3">
            <SkeletonBlock className="h-20 rounded-xl" />
            <SkeletonBlock className="h-20 rounded-xl" />
          </div>
        </div>

        {/* 2-Column Receipt & Barcode Printer Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {[0, 1].map((card) => (
            <div
              key={card}
              className="bg-white dark:bg-[#131B2E] rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-xs overflow-hidden transition-colors"
            >
              <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-purple-800/80 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="w-10 h-10 rounded-xl shrink-0" />
                  <div className="space-y-1.5">
                    <SkeletonBlock className="h-4 w-44" />
                    <SkeletonBlock className="h-3 w-36" />
                  </div>
                </div>
                <SkeletonBlock className="h-6 w-20 rounded-full" />
              </div>
              <div className="p-4 sm:p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <SkeletonBlock className="h-16 rounded-xl" />
                  <SkeletonBlock className="h-16 rounded-xl" />
                </div>
                <div className="space-y-2.5">
                  <SkeletonBlock className="h-3.5 w-32" />
                  <SkeletonBlock className="h-10 w-full rounded-xl" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SkeletonBlock className="h-10 rounded-xl" />
                  <SkeletonBlock className="h-10 rounded-xl" />
                </div>
                <div className="pt-2 flex items-center justify-between gap-3">
                  <SkeletonBlock className="h-10 w-36 rounded-xl" />
                  <SkeletonBlock className="h-10 w-32 rounded-xl bg-purple-200/80 dark:bg-purple-900/50" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'backup') {
    return (
      <div
        className="bg-white dark:bg-[#131B2E] p-3.5 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-5 sm:space-y-6 select-none transition-colors"
        role="status"
        aria-live="polite"
        aria-label="Loading backup settings"
      >
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 sm:pb-5">
          <div className="flex items-center gap-3.5">
            <SkeletonBlock className="w-11 h-11 rounded-xl shrink-0 bg-blue-100/80 dark:bg-blue-900/40" />
            <div className="space-y-1.5">
              <SkeletonBlock className="h-5 w-56 sm:w-72" />
              <SkeletonBlock className="h-3 w-64 sm:w-96" />
            </div>
          </div>
          <SkeletonBlock className="h-9 w-36 rounded-xl" />
        </div>

        {/* 4 Metric KPI Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5 lg:gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0E1628] space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-7 w-7 rounded-lg" />
              </div>
              <SkeletonBlock className="h-6 w-24" />
              <SkeletonBlock className="h-3 w-28" />
            </div>
          ))}
        </div>

        {/* 2-Column Export & Restore Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {[0, 1].map((col) => (
            <div
              key={col}
              className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 bg-white dark:bg-[#131B2E] space-y-4 min-h-[280px] flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="w-10 h-10 rounded-xl shrink-0" />
                  <div className="space-y-1.5">
                    <SkeletonBlock className="h-4 w-44" />
                    <SkeletonBlock className="h-3 w-56" />
                  </div>
                </div>
                <SkeletonBlock className="h-28 w-full rounded-2xl" />
                <div className="grid grid-cols-2 gap-2">
                  <SkeletonBlock className="h-4 w-full" />
                  <SkeletonBlock className="h-4 w-full" />
                </div>
              </div>
              <SkeletonBlock className="h-11 w-full rounded-xl bg-purple-200/80 dark:bg-purple-900/50" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'notifications_prefs') {
    return (
      <div
        className="bg-white dark:bg-[#131B2E] p-3.5 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-6 select-none transition-colors"
        role="status"
        aria-live="polite"
        aria-label="Loading notification preferences"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-purple-900/40">
          <div className="flex items-start gap-3.5">
            <SkeletonBlock className="w-11 h-11 rounded-2xl shrink-0 bg-purple-100/80 dark:bg-purple-900/40" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-5 w-48" />
                <SkeletonBlock className="h-5 w-24 rounded-full" />
              </div>
              <SkeletonBlock className="h-3 w-72 sm:w-96" />
            </div>
          </div>
          <SkeletonBlock className="h-9 w-36 rounded-xl" />
        </div>

        {/* Section 1: 3 Preset Cards */}
        <div className="space-y-3">
          <SkeletonBlock className="h-3.5 w-40" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>

        {/* Section 2: 2 Delivery Channels */}
        <div className="space-y-3">
          <SkeletonBlock className="h-3.5 w-36" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SkeletonBlock className="h-20 rounded-xl" />
            <SkeletonBlock className="h-20 rounded-xl" />
          </div>
        </div>

        {/* Section 3: Event Toggle Rows */}
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((row) => (
            <SkeletonBlock key={row} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // 'integrations' (embedded FCM settings form inside App Config)
  return (
    <div
      className="space-y-5 select-none"
      role="status"
      aria-live="polite"
      aria-label="Loading integration settings"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        <SkeletonBlock className="h-4 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3, 4, 5].map((field) => (
            <div key={field} className="space-y-2">
              <SkeletonBlock className="h-3.5 w-36" />
              <SkeletonBlock className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <SkeletonBlock className="h-10 w-36 rounded-xl bg-purple-200/80 dark:bg-purple-900/50" />
      </div>
    </div>
  );
};
