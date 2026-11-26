import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface ActiveTenantScopeBannerProps {
  id: string;
  variant: 'landing' | 'auth';
  isSuperAdminScope: boolean;
  tenantId: number;
  scopeLabel: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  clearActionLabel?: string;
  clearActionTitle?: string;
  onClearScope?: () => void;
}

export const ActiveTenantScopeBanner: React.FC<ActiveTenantScopeBannerProps> = ({
  id,
  variant,
  isSuperAdminScope,
  tenantId,
  scopeLabel,
  primaryActionLabel,
  onPrimaryAction,
  clearActionLabel,
  clearActionTitle,
  onClearScope,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Always reset to collapsed (closed) by default when the active scope changes
  useEffect(() => {
    setIsExpanded(false);
  }, [isSuperAdminScope, tenantId]);

  const isLanding = variant === 'landing';
  const detailsId = `${id}-details`;
  const toggleId = `${id}-toggle`;

  const resolvedScopeLabel = isSuperAdminScope
    ? 'SuperAdmin Control Panel'
    : scopeLabel || `Store #${tenantId}`;

  const reminderText = isSuperAdminScope
    ? isLanding
      ? 'Scoped to SuperAdmin Control Panel. Sign in or clear scope to view all stores.'
      : 'Scoped to SuperAdmin Control Panel. Clear scope to sign in to any store.'
    : isLanding
      ? `Scoped to ${resolvedScopeLabel}. Sign in directly or clear scope to browse all stores.`
      : `Sign-in is locked to ${resolvedScopeLabel}. Clear scope to switch stores.`;

  const bannerContainerClass = isLanding
    ? 'bg-purple-950/90 lt:bg-purple-100 border-b border-purple-800/60 lt:border-purple-300 text-xs select-none'
    : 'relative z-20 bg-purple-100 dark:bg-purple-950/90 border-b border-purple-300 dark:border-purple-800/60 text-xs select-none';

  const summaryRowTextClass = isLanding
    ? 'text-purple-200 lt:text-purple-900'
    : 'text-purple-900 dark:text-purple-200';

  const dotClass = isLanding
    ? 'bg-emerald-400 lt:bg-emerald-500'
    : 'bg-emerald-500 dark:bg-emerald-400';

  const detailsPanelClass = isLanding
    ? 'border-t border-purple-800/50 lt:border-purple-300/70 text-purple-200/90 lt:text-purple-900/90'
    : 'border-t border-purple-300/70 dark:border-purple-800/50 text-purple-900/90 dark:text-purple-200/90';

  const secondaryBtnClass = isLanding
    ? 'px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 lt:bg-white lt:hover:bg-slate-200 text-purple-200 lt:text-purple-900 font-semibold text-[11px] transition cursor-pointer border border-purple-400/30 lt:border-purple-400/60'
    : 'px-2.5 py-1 rounded-md bg-purple-50/90 hover:bg-purple-100 dark:bg-purple-500/15 dark:hover:bg-purple-500/25 text-purple-700 dark:text-purple-200 font-semibold text-[11px] transition cursor-pointer border border-purple-400/70 shadow-sm hover:shadow-md';

  const chevronBadgeClass = isLanding
    ? 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold bg-white/10 lt:bg-white/70 border border-purple-400/25 lt:border-purple-300/80 text-purple-100 lt:text-purple-800'
    : 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold bg-white/70 dark:bg-white/10 border border-purple-300/80 dark:border-purple-400/25 text-purple-800 dark:text-purple-100';

  return (
    <div id={id} className={bannerContainerClass}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4">
        <button
          id={toggleId}
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          className={`w-full py-1.5 sm:py-2 flex items-center justify-between gap-2 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-md font-medium ${summaryRowTextClass}`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className={`flex h-2 w-2 rounded-full ${dotClass} animate-pulse shrink-0`} />
            {isSuperAdminScope ? (
              <span className="truncate">
                Active System Scope: <strong>SuperAdmin Control Panel</strong> (Tenant #0)
              </span>
            ) : (
              <span className="truncate">
                Active Store Scope: <strong>{resolvedScopeLabel}</strong> (Tenant #{tenantId})
              </span>
            )}
          </span>

          <span className={`${chevronBadgeClass} shrink-0`}>
            <span className="hidden sm:inline">{isExpanded ? 'Hide' : 'Details'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </span>
        </button>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              id={detailsId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div
                className={`py-2 flex flex-wrap items-center justify-between gap-2 ${detailsPanelClass}`}
              >
                <p className="text-[11px] sm:text-xs leading-relaxed max-w-3xl">
                  {reminderText}
                </p>

                <div className="flex items-center gap-2 shrink-0">
                  {primaryActionLabel && onPrimaryAction && (
                    <button
                      type="button"
                      onClick={onPrimaryAction}
                      className="px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] transition cursor-pointer shadow-xs"
                    >
                      {primaryActionLabel}
                    </button>
                  )}
                  {onClearScope && (
                    <button
                      type="button"
                      onClick={onClearScope}
                      className={secondaryBtnClass}
                      title={clearActionTitle}
                    >
                      {clearActionLabel || (isSuperAdminScope ? 'Clear Scope' : 'Clear Store Scope')}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
