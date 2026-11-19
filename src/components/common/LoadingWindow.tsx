import React from 'react';
import { Sparkles } from 'lucide-react';
import { ShowroomBackground } from './ShowroomBackground.tsx';
import { PublicHeader } from './PublicHeader.tsx';
import { PublicFooter } from './PublicFooter.tsx';
import { BodyLayoutWrapper } from './BodyLayoutWrapper.tsx';
import { ShoeIcon } from './ShoeIcon.tsx';

export interface LoadingWindowProps {
  storeName?: string;
  statusMessage?: string;
  subtitle?: string;
  isAdmin?: boolean;
  logoSrc?: string | null;
  activeTab?: string;
}

const TECHNICAL_TERM_RE =
  /\b(laravel|node\.?js|express|react|vite|typescript|postgresql|postgres|sql|multi-tenant|control plane|dual-engine|telemetry|protocols?|offline sales cache|database scoped|tenant scoped|tenant registry|tenant directory|security controls?|synchronizing|initializing)\b/i;

function resolveFriendlyStatus(
  rawMessage: string | undefined,
  fallbackMessage: string
): string {
  const clean = String(rawMessage || '').trim();
  if (!clean || TECHNICAL_TERM_RE.test(clean)) {
    return fallbackMessage;
  }
  return clean;
}

/**
 * LoadingWindow
 *
 * Minimal, compact post-login loading view rendered against the Showroom Background.
 * Visually unified across Store and Super Admin workspaces.
 */
export const LoadingWindow: React.FC<LoadingWindowProps> = ({
  storeName,
  statusMessage,
  isAdmin = false,
  logoSrc,
}) => {
  const isSuperAdminView =
    isAdmin ||
    Boolean(
      storeName &&
        (storeName.toLowerCase().includes('c-panel') ||
          storeName.toLowerCase().includes('superadmin') ||
          storeName.toLowerCase().includes('super admin') ||
          storeName.toLowerCase().includes('pos admin'))
    );

  const effectiveTitle = isSuperAdminView
    ? storeName || 'Super Admin'
    : storeName || 'Store';

  const friendlyDefault = isSuperAdminView
    ? 'Opening your dashboard...'
    : 'Opening your store...';

  const effectiveStatus = resolveFriendlyStatus(statusMessage, friendlyDefault);

  return (
    <BodyLayoutWrapper
      id="showroom-loading-viewport"
      role="status"
      aria-live="polite"
      showHeader={true}
      showSidebar={false}
      showFooter={true}
      centerMain={true}
      backdrop={<ShowroomBackground screen="loading" />}
      header={
        <PublicHeader
          storeName={effectiveTitle}
          subtitle={isSuperAdminView ? 'Super Admin' : 'Store Portal'}
          dbText="Online"
          isSuperAdmin={isSuperAdminView}
          logoSrc={logoSrc}
        />
      }
      footer={<PublicFooter storeName={effectiveTitle} />}
      className="min-h-dvh bg-slate-200 dark:bg-[#0A0E1A] text-slate-900 dark:text-slate-100 font-sans selection:bg-purple-600 selection:text-white transition-colors duration-200"
      mainClassName="relative z-10 px-4 py-6 sm:px-6"
    >
      <div className="w-full max-w-xs sm:max-w-sm mx-auto bg-white/95 dark:bg-[#131B2E]/95 backdrop-blur-2xl rounded-2xl p-6 sm:p-7 shadow-xl border border-white/50 dark:border-purple-800/70 text-center relative overflow-hidden transition-all duration-300">
        {/* Subtle Top Accent Bar */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600" />

        {/* Unified Brand Icon */}
        <div className="relative mb-3.5 flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-900 flex items-center justify-center shadow-lg border border-purple-500/25 overflow-hidden">
            <ShoeIcon
              src={logoSrc || (isSuperAdminView ? '/admin/pwa-192x192.png' : '/pwa-192x192.png')}
              alt={`${effectiveTitle} Logo`}
              className="w-full h-full object-cover rounded-2xl"
            />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
          {effectiveTitle}
        </h2>

        {/* Subtle Loader */}
        <div className="relative w-9 h-9 mx-auto my-4 flex items-center justify-center" aria-hidden="true">
          <div className="absolute inset-0 rounded-full border-2 border-purple-500/20 dark:border-purple-400/20" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-600 border-r-indigo-600 animate-spin" />
          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-pulse" />
        </div>

        {/* Short Friendly Message */}
        <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300">
          {effectiveStatus}
        </p>
      </div>
    </BodyLayoutWrapper>
  );
};
