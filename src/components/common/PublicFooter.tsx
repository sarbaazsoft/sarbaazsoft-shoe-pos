import React, { useState } from 'react';
import { APP_VERSION } from '../../version.ts';
import { LicenseAgreementModal } from './LicenseAgreementModal.tsx';

export interface PublicFooterProps {
  storeName?: string;
  subtitle?: string;
}

/**
 * PublicFooter
 * Global footer for public, onboarding, loading, and authentication views.
 * Reflects official SarbaazSoft SaaS provider branding & tenant separation.
 */
export const PublicFooter: React.FC<PublicFooterProps> = () => {
  const currentYear = new Date().getFullYear();
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);

  return (
    <>
      <footer
        id="global-public-footer"
        className="relative z-10 w-full px-4 sm:px-8 py-3 border border-indigo-500/20 bg-white/95 dark:bg-white/10 backdrop-blur-lg text-xs text-slate-800 dark:text-slate-100 transition-colors duration-500 shadow-lg shrink-0 no-print select-none"
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1.5 sm:gap-4 text-center sm:text-left">
          <div className="flex items-center gap-2 justify-center sm:justify-start">
            <strong
              id="sarbaazsoft-credit-text"
              className="font-bold text-slate-900 dark:text-white tracking-wide"
            >
              SarbaazSoft Shoe POS
            </strong>
            <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50">
              {APP_VERSION}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={() => setIsLicenseModalOpen(true)}
              className="hover:text-indigo-600 dark:hover:text-indigo-300 underline-offset-2 hover:underline transition-colors cursor-pointer whitespace-nowrap"
            >
              Software License
            </button>
            <span aria-hidden="true">·</span>
            <span>
              &copy; {currentYear} SarbaazSoft Shoe POS. All rights reserved.
            </span>
          </div>
        </div>
      </footer>

      <LicenseAgreementModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
      />
    </>
  );
};
