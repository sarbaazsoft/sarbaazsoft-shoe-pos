import React from 'react';
import { ShieldOff, Lock, ArrowLeft, Shield, KeyRound, Calendar, Clock } from 'lucide-react';
import type { TenantInfo } from '../../types';
import { isFreeTrial } from '../../utils/subscription';
import { BodyLayoutWrapper } from '../common/BodyLayoutWrapper';
import { ShowroomBackground } from '../common/ShowroomBackground';
import { resolveRouteLayoutMetadata, type RouteLayoutMetadata } from '../../config/routeLayoutMetadata';

interface SuspendedStoreViewProps {
  tenant: TenantInfo | null;
  isExpired?: boolean;
  onGoToLanding: () => void;
  onGoToSuperAdmin: () => void;
  onOpenStoreSettings?: () => void;
  layoutMeta?: Partial<RouteLayoutMetadata>;
}

export const SuspendedStoreView: React.FC<SuspendedStoreViewProps> = ({
  tenant,
  isExpired = false,
  onGoToLanding,
  onGoToSuperAdmin,
  onOpenStoreSettings,
  layoutMeta: layoutMetaOverride,
}) => {
  const storeName = tenant?.name || 'Store';
  const expired =
    isExpired ||
    tenant?.subscriptionStatus === 'EXPIRED' ||
    tenant?.status === 'EXPIRED' ||
    Boolean(tenant?.subscriptionEndDate && new Date(tenant.subscriptionEndDate).getTime() < Date.now());

  const formattedExpiry = tenant?.subscriptionEndDate
    ? new Date(tenant.subscriptionEndDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'N/A';

  const planLabel = isFreeTrial(tenant?.subscriptionPlan)
    ? '30-Day Free Trial'
    : tenant?.subscriptionPlan === '6_MONTHS'
    ? '6 Months'
    : 'Yearly';

  const statusLayoutMeta = resolveRouteLayoutMetadata(
    expired ? 'TENANT_EXPIRED' : 'TENANT_SUSPENDED',
    { overrides: layoutMetaOverride }
  );

  return (
    <BodyLayoutWrapper
      layoutMeta={statusLayoutMeta}
      className="bg-slate-950 text-slate-100"
      mainClassName="relative z-10 p-3.5 sm:p-6"
      backdrop={<ShowroomBackground />}
    >
      <div className="max-w-lg w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-5 sm:p-8 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5 sm:mb-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] sm:text-xs font-mono uppercase">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            {expired ? 'HTTP 403 • Subscription Expired' : 'HTTP 403 • Store Suspended'}
          </span>
          <span className="text-xs font-mono text-slate-400 truncate max-w-full">{storeName}</span>
        </div>

        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mb-4 sm:mb-6">
          {expired ? (
            <Clock className="w-6 h-6 sm:w-7 sm:h-7 text-rose-400" />
          ) : (
            <ShieldOff className="w-6 h-6 sm:w-7 sm:h-7 text-rose-400" />
          )}
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">
          {expired ? 'Subscription Key Expired' : 'Store Suspended'}
        </h1>

        {expired ? (
          <div className="mb-5 sm:mb-6 space-y-3">
            <div className="p-3 sm:p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs sm:text-sm font-semibold">
              Your subscription key has expired. Please contact support to renew.
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              POS &amp; Dashboard access for <span className="font-semibold text-white">{storeName}</span> is restricted until the store subscription key is renewed by platform administration.
            </p>
          </div>
        ) : (
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-5 sm:mb-6">
            Access to <span className="font-semibold text-white">{storeName}</span> has been temporarily suspended. All store checkout terminals and staff sessions for this store are paused.
          </p>
        )}

        {/* Subscription Summary Card */}
        {tenant && (
          <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-3.5 sm:p-4 mb-4 sm:mb-5 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Plan &amp; Expiry Date:
              </span>
              <span className="font-mono text-slate-200">
                {planLabel} • {formattedExpiry}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-slate-400">Subscription Status:</span>
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                {expired ? 'EXPIRED' : tenant.subscriptionStatus || tenant.status}
              </span>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 sm:p-4 text-xs text-slate-400 mb-5 sm:mb-6">
          If you are the store owner or platform administrator, you can renew the subscription key or reactivate this tenant immediately from the <strong className="text-slate-200">SuperAdmin Control Panel</strong>.
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {expired && onOpenStoreSettings && (
            <button
              type="button"
              onClick={onOpenStoreSettings}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              Store Owner: Renew in Settings
            </button>
          )}
          <button
            type="button"
            onClick={onGoToSuperAdmin}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors cursor-pointer"
          >
            <Shield className="w-4 h-4" />
            {expired ? 'Renew Key in SuperAdmin' : 'Reactivate in SuperAdmin'}
          </button>
          <button
            type="button"
            onClick={onGoToLanding}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-slate-600/80 bg-slate-800 hover:bg-slate-700 hover:border-slate-500 text-slate-200 font-semibold text-sm shadow-md shadow-slate-950/30 hover:shadow-lg transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Home
          </button>
        </div>
      </div>
    </BodyLayoutWrapper>
  );
};
