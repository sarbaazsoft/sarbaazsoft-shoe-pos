import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, ArrowLeft } from 'lucide-react';
import { api } from '../../services/api.ts';
import { PublicLayout } from '../common/PublicLayout.tsx';
import type { RouteLayoutMetadata } from '../../config/routeLayoutMetadata.ts';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.ts';
import { getStandardDocumentTitle } from '../../utils/documentTitle.ts';
import { useResendCooldown } from '../../hooks/useResendCooldown.ts';
import { ResendSecurityNotice } from './ResendSecurityNotice.tsx';
import { LicenseAgreementModal } from '../common/LicenseAgreementModal.tsx';

interface VerifyEmailNoticeViewProps {
  initialEmail?: string;
  initialToken?: string;
  initialTenantId?: number | null;
  storeName?: string;
  onNavigateLogin?: (email?: string, sessionData?: any) => void;
  onNavigateHome?: () => void;
  layoutMeta?: Partial<RouteLayoutMetadata>;
}

export const VerifyEmailNoticeView: React.FC<VerifyEmailNoticeViewProps> = ({
  initialEmail = '',
  initialToken = '',
  initialTenantId = null,
  storeName = 'SarbaazSoft Shoe POS',
  onNavigateLogin,
  onNavigateHome,
  layoutMeta,
}) => {
  useDocumentTitle(
    () => getStandardDocumentTitle({ saasMode: 'VERIFY_EMAIL', storeName }),
    [storeName]
  );

  const [email] = useState(() => {
    if (initialEmail) return initialEmail;
    try {
      const urlEmail = new URLSearchParams(window.location.search).get('email');
      if (urlEmail) return urlEmail;
      return localStorage.getItem('pos_pending_verification_email') || '';
    } catch {
      return '';
    }
  });

  const [tokenInput, setTokenInput] = useState(() => {
    if (initialToken) return initialToken;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('code') || params.get('token') || params.get('verificationToken') || '';
    } catch {
      return '';
    }
  });

  const [tenantId] = useState<number | null>(() => {
    if (initialTenantId) return initialTenantId;
    try {
      const urlTenant = new URLSearchParams(window.location.search).get('tenantId');
      if (urlTenant) return Number(urlTenant);
      const cached = localStorage.getItem('pos_pending_verification_tenant_id');
      return cached ? Number(cached) : null;
    } catch {
      return null;
    }
  });

  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [successData, setSuccessData] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);

  const verificationCooldown = useResendCooldown({
    flow: 'email_verification',
    email,
    enabled: !verificationSuccess,
  });

  // Auto-verify if code/token is present in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('code') || params.get('token') || params.get('verificationToken');
    if (tokenFromUrl && !verificationSuccess && !isVerifying) {
      handleVerify(tokenFromUrl);
    }
  }, []);

  const handleVerify = async (tokenToUse?: string) => {
    const rawToken = (tokenToUse || tokenInput).trim();
    if (!rawToken) {
      setErrorMessage('Please enter the 6-digit confirmation code received in your email.');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const res = await api.auth.verifyEmail(rawToken, email.trim() || undefined);
      verificationCooldown.clearCooldown();
      setVerificationSuccess(true);
      setSuccessData(res);
      try {
        localStorage.removeItem('pos_pending_verification_email');
        localStorage.removeItem('pos_pending_verification_tenant_id');
      } catch {}
    } catch (err: any) {
      setErrorMessage(err?.message || 'Invalid or expired verification code. Please request a new confirmation email.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) {
      setResendError('Please enter your email address to receive a new confirmation code.');
      return;
    }
    if (verificationCooldown.isInCooldown) return;

    setIsResending(true);
    setErrorMessage(null);
    setResendError(null);
    setResendStatus(null);
    setTokenInput('');
    try {
      const res = await api.auth.resendVerification(targetEmail, tenantId || undefined);
      setResendStatus(
        res.message ||
          `A fresh 6-digit confirmation code has been sent to ${targetEmail}. Please check your Inbox or Spam/Junk folder and enter the code below.`
      );
      if (res.cooldown) {
        verificationCooldown.applyServerCooldown(res.cooldown);
      }
    } catch (err: any) {
      if (err?.status === 429 || typeof err?.remainingSeconds === 'number') {
        verificationCooldown.applyServerCooldown(err);
      }
      setResendError(
        err?.message || 'Failed to resend confirmation email. Please check the email address or try again later.'
      );
    } finally {
      setIsResending(false);
    }
  };

  return (
    <PublicLayout
      storeName={storeName}
      badgeText="Email Verification"
      badgeVariant="connecting"
      subtitle="Complete email confirmation to activate your store"
      dbText="Account Safeguard Active"
      layoutMeta={layoutMeta}
    >
      <div className="w-full max-w-lg bg-white/95 dark:bg-[#11162B]/95 backdrop-blur-xl border border-slate-200/80 dark:border-purple-800/50 rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-2xl transition-all duration-200 mx-auto">
        {verificationSuccess ? (
          <div className="text-center space-y-4 sm:space-y-5 animate-in fade-in duration-300">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Account Verified!
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {successData?.message || 'Your email has been confirmed and your 30-day free trial has been successfully activated.'}
              </p>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 text-left space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Next Step
              </span>
              <p className="text-xs text-slate-700 dark:text-slate-200">
                You can now log in using your registered credentials to access your store's dashboard and point of sale.
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => onNavigateLogin?.(email, successData)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white font-bold text-sm shadow-lg shadow-purple-600/30 hover:opacity-95 transition-all cursor-pointer"
              >
                {successData?.user?.onboardingCompleted === false
                  ? 'Continue to Store Setup'
                  : 'Sign In to Dashboard'} <ArrowRight className="w-4 h-4" />
              </button>
              {onNavigateHome && (
                <button
                  type="button"
                  onClick={onNavigateHome}
                  className="px-4 py-3 rounded-xl border border-indigo-400 dark:border-indigo-400/70 bg-indigo-50/75 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 font-semibold text-xs shadow-sm hover:shadow-md hover:bg-indigo-100 dark:hover:bg-indigo-500/25 hover:text-indigo-800 dark:hover:text-white transition-all cursor-pointer"
                >
                  Home
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 border border-purple-500/20">
                <Mail className="w-6 h-6 stroke-[2]" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  Verify Your Email
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Email verification is required before dashboard access is granted.
                </p>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Verification Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerify();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  6-Digit Confirmation Code
                </label>
                <div className="relative">
                  <input
                    id="email-verification-code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit code"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-slate-900 dark:text-white text-center text-base sm:text-lg font-mono font-bold tracking-[0.35em] placeholder:tracking-normal placeholder:font-sans placeholder:font-normal placeholder:text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isVerifying || tokenInput.trim().length < 5}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 text-white font-bold text-xs shadow-md shadow-purple-600/25 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isVerifying ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Verifying Code...
                  </>
                ) : (
                  <>
                    Activate Store &amp; Continue <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Inbox/Spam helper text, Resend Confirmation Email button, & Progressive Cooldown */}
            <ResendSecurityNotice
              idPrefix="email-verification"
              email={email}
              helperContext="confirmation"
              buttonLabel="Resend Confirmation Email"
              onResend={handleResend}
              isResending={isResending}
              isInCooldown={verificationCooldown.isInCooldown}
              formattedCountdown={verificationCooldown.formattedCountdown}
              nextAvailableTimeLabel={verificationCooldown.nextAvailableTimeLabel}
              attemptCount={verificationCooldown.attemptCount}
              successMessage={resendStatus}
              errorMessage={resendError}
            />

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => onNavigateLogin?.(email)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
              </button>
              <button
                type="button"
                onClick={() => setIsLicenseModalOpen(true)}
                className="text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2 font-medium cursor-pointer"
              >
                Free Trial License
              </button>
            </div>
          </div>
        )}
      </div>
      <LicenseAgreementModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
        initialLicenseType="free_trial"
        allowSwitch={true}
      />
    </PublicLayout>
  );
};
