import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ActiveTenantScopeBannerProps {
  id: string;
  variant: 'auth' | 'landing';
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

  const isLanding = variant === 'landing';
  const containerClasses = isLanding
    ? 'bg-purple-950/90 lt:bg-purple-100 border-b border-purple-800/60 lt:border-purple-300 text-purple-200 lt:text-purple-900'
    : 'bg-purple-100/95 dark:bg-purple-950/90 border-b border-purple-300 dark:border-purple-800/60 text-purple-900 dark:text-purple-200';

  const secondaryBtnClasses = isLanding
    ? 'bg-white/10 hover:bg-white/20 lt:bg-white lt:hover:bg-slate-200 text-purple-200 lt:text-purple-900 border border-purple-400/30 lt:border-purple-300'
    : 'bg-white hover:bg-purple-50 dark:bg-white/10 dark:hover:bg-white/20 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-400/30';

  const detailsBorderClasses = isLanding
    ? 'border-purple-800/50 lt:border-purple-300/80'
    : 'border-purple-300/80 dark:border-purple-800/50';

  const hasActions = Boolean((primaryActionLabel && onPrimaryAction) || (clearActionLabel && onClearScope));
  const resolvedLabel = isSuperAdminScope ? 'SuperAdmin Control Panel' : scopeLabel;

  return (
    <div id={id} className={`${containerClasses} py-2 px-4 text-xs select-none`}>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="truncate">
              {isSuperAdminScope ? (
                <>
                  Active System Scope: <strong>SuperAdmin Control Panel</strong> (Tenant #0)
                </>
              ) : (
                <>
                  Active Store Scope: <strong>{resolvedLabel}</strong> (Tenant #{tenantId})
                </>
              )}
            </span>
          </div>

          <button
            id={`${id}-toggle`}
            type="button"
            aria-expanded={isExpanded}
            aria-controls={`${id}-details`}
            onClick={() => setIsExpanded((prev) => !prev)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold text-[11px] transition cursor-pointer shrink-0 ${secondaryBtnClasses}`}
          >
            <span>{isExpanded ? 'Hide Scope Options' : 'Scope Options'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {isExpanded && (
          <div
            id={`${id}-details`}
            className={`mt-2 pt-2 border-t ${detailsBorderClasses} flex flex-wrap items-center justify-between gap-2`}
          >
            <p className="text-[11px] opacity-90">
              {isSuperAdminScope
                ? 'Signed-out system administration links target SuperAdmin Control Panel (Tenant #0).'
                : `Public route links are currently scoped to ${resolvedLabel} (Tenant #${tenantId}).`}
            </p>

            {hasActions && (
              <div className="flex flex-wrap items-center gap-2">
                {primaryActionLabel && onPrimaryAction && (
                  <button
                    type="button"
                    onClick={onPrimaryAction}
                    className="px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] transition cursor-pointer shadow-xs"
                  >
                    {primaryActionLabel}
                  </button>
                )}
                {clearActionLabel && onClearScope && (
                  <button
                    type="button"
                    onClick={onClearScope}
                    title={clearActionTitle}
                    className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition cursor-pointer ${secondaryBtnClasses}`}
                  >
                    {clearActionLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
