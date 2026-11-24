import React from 'react';
import {
  Mail,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react';
import type { PasswordResetController, PasswordResetRoleScope } from '../../hooks/usePasswordReset.ts';
import { PasswordStrengthIndicator } from '../common/PasswordStrengthIndicator.tsx';
import { PasswordRequirementsTooltip } from '../common/PasswordRequirementsTooltip.tsx';
import { ResendSecurityNotice } from './ResendSecurityNotice.tsx';

interface PasswordResetFlowProps {
  idPrefix: string;
  controller: PasswordResetController;
  roleScope?: PasswordResetRoleScope;
  onBackToLogin: () => void;
}

export const PasswordResetFlow: React.FC<PasswordResetFlowProps> = ({
  idPrefix,
  controller,
  roleScope = 'ALL',
  onBackToLogin,
}) => {
  const {
    step,
    setStep,
    email,
    trimmedEmail,
    updateEmail,
    isEmailValid,
    showEmailError,
    setEmailTouched,
    code,
    setCode,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showNewPassword,
    setShowNewPassword,
    showConfirmPassword,
    setShowConfirmPassword,
    pasteBlocked,
    setPasteBlocked,
    triggerPasteBlockedNotice,
    isSubmitting,
    isResending,
    errorMessage,
    setErrorMessage,
    infoMessage,
    resendSuccess,
    resendError,
    cooldown,
    requestCode,
    verifyCode,
    confirmReset,
    resendCode,
  } = controller;

  const isSuperAdminScope = roleScope === 'SUPERADMIN';
  const emailLabel = isSuperAdminScope ? 'SuperAdmin Email Address' : 'Registered Email Address';
  const emailPlaceholder = isSuperAdminScope ? 'Enter SuperAdmin email' : 'admin@shoepos.com';
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;
  const passwordsMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const stepHeader =
    step === 'request'
      ? {
          title: isSuperAdminScope
            ? 'Reset SuperAdmin Password'
            : 'Forgot Password — Verification Code',
          subtitle: isSuperAdminScope
            ? 'Enter your SuperAdmin email address to receive a 6-digit verification code.'
            : 'Enter your Store Owner or Cashier email address to receive a 6-digit verification code.',
        }
      : step === 'verify'
      ? {
          title: 'Enter 6-Digit Verification Code',
          subtitle: 'Enter the 6-digit code sent to your email address to verify your identity.',
        }
      : {
          title: isSuperAdminScope ? 'Set New SuperAdmin Password' : 'Create New Password',
          subtitle: 'Your 6-digit code is verified. Enter and confirm your new password below.',
        };

  return (
    <div id={`${idPrefix}-password-reset-flow`} className="space-y-4">
      {/* Dynamic Header */}
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
          {stepHeader.title}
        </h3>
        <p className="text-xs text-slate-500 dark:text-purple-200/70 mt-0.5 leading-relaxed">
          {stepHeader.subtitle}
        </p>
      </div>

      {/* Inline Step Alerts */}
      {errorMessage && (
        <div
          role="alert"
          id={`${idPrefix}-reset-error-alert`}
          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span className="leading-relaxed font-medium">{errorMessage}</span>
        </div>
      )}

      {infoMessage && (
        <div
          role="status"
          id={`${idPrefix}-reset-info-alert`}
          className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span className="leading-relaxed font-medium">{infoMessage}</span>
        </div>
      )}

      {/* STEP 1: REQUEST 6-DIGIT CODE */}
      {step === 'request' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor={`${idPrefix}-forgot-email-input`}
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              {emailLabel}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-purple-600 dark:text-purple-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id={`${idPrefix}-forgot-email-input`}
                type="email"
                required
                aria-invalid={showEmailError}
                aria-describedby={`${idPrefix}-forgot-email-validation-msg`}
                placeholder={emailPlaceholder}
                value={email}
                onBlur={() => setEmailTouched(true)}
                onChange={(e) => updateEmail(e.target.value)}
                className={`app-input email-focus-pulse w-full bg-slate-50 dark:bg-slate-900/80 border focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 rounded-xl text-xs sm:text-sm font-medium py-2.5 pl-[2.125rem] pr-9 transition outline-none ${
                  showEmailError
                    ? 'border-rose-400 dark:border-rose-500/80 focus:border-rose-500'
                    : isEmailValid
                    ? 'border-emerald-400 dark:border-emerald-500/70 focus:border-emerald-500'
                    : 'border-slate-200 dark:border-purple-800/60 focus:border-purple-600 dark:focus:border-purple-400'
                }`}
              />
              {trimmedEmail.length > 0 && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  {isEmailValid ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-500" />
                  )}
                </div>
              )}
            </div>

            <div id={`${idPrefix}-forgot-email-validation-msg`} className="mt-1.5 min-h-[18px]">
              {showEmailError ? (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Enter a valid email address format (e.g., {emailPlaceholder}).</span>
                </p>
              ) : isEmailValid ? (
                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Email format verified — ready to send 6-digit code.</span>
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 dark:text-purple-300/60">
                  A valid email format is required to request a 6-digit verification code.
                </p>
              )}
            </div>
          </div>

          {cooldown.isInCooldown && (
            <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 text-[11px] font-medium text-purple-800 dark:text-purple-200 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
              <span>
                Next reset code available in{' '}
                <strong className="font-mono tabular-nums">{cooldown.formattedCountdown}</strong>
                {cooldown.nextAvailableTimeLabel ? ` (at ${cooldown.nextAvailableTimeLabel})` : ''}.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5 sm:gap-3 pt-1">
            <button
              type="button"
              onClick={onBackToLogin}
              className="flex-1 py-2.5 px-4 rounded-xl bg-white hover:bg-purple-50/80 text-purple-700 hover:text-purple-800 border border-purple-200/90 shadow-xs hover:border-purple-300 dark:bg-slate-900/80 dark:hover:bg-purple-900/40 dark:border-purple-800/60 dark:text-purple-200 text-xs font-bold transition cursor-pointer"
            >
              Back to Sign In
            </button>
            <button
              id={`${idPrefix}-send-reset-code-btn`}
              type="submit"
              disabled={isSubmitting || !isEmailValid || cooldown.isInCooldown}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 dark:from-purple-600 dark:to-indigo-600 dark:hover:from-purple-500 dark:hover:to-indigo-500 text-white border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
            >
              {isSubmitting
                ? 'Sending Code...'
                : cooldown.isInCooldown
                ? `Wait ${cooldown.formattedCountdown}`
                : 'Send 6-Digit Code'}
            </button>
          </div>
        </form>
      )}

      {/* STEP 2: ENTER & VERIFY 6-DIGIT CODE */}
      {step === 'verify' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-purple-800/50 text-xs">
            <div className="min-w-0">
              <span className="text-slate-500 dark:text-slate-400">Account: </span>
              <strong className="text-slate-900 dark:text-white break-all">{trimmedEmail}</strong>
            </div>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStep('request');
              }}
              className="shrink-0 text-[11px] font-bold text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200 hover:underline cursor-pointer"
            >
              Change
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode();
            }}
            className="space-y-4"
          >
            <div>
              <label
                htmlFor={`${idPrefix}-reset-code-input`}
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                6-Digit Verification Code
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-purple-600 dark:text-purple-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id={`${idPrefix}-reset-code-input`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Enter 6-digit code"
                  className="app-input w-full bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-purple-800/60 focus:bg-white dark:focus:bg-slate-900 focus:border-purple-600 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 text-slate-900 dark:text-white font-mono text-center tracking-[0.35em] text-sm sm:text-base font-bold rounded-xl py-2.5 pl-9 pr-4 outline-none transition"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Enter the 6-digit numeric code sent to your email. Codes expire after 15 minutes.
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 sm:gap-3 pt-1">
              <button
                type="button"
                onClick={onBackToLogin}
                className="flex-1 py-2.5 px-4 rounded-xl bg-white hover:bg-purple-50/80 text-purple-700 hover:text-purple-800 border border-purple-200/90 shadow-xs hover:border-purple-300 dark:bg-slate-900/80 dark:hover:bg-purple-900/40 dark:border-purple-800/60 dark:text-purple-200 text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
              <button
                id={`${idPrefix}-verify-reset-code-btn`}
                type="submit"
                disabled={isSubmitting || code.length !== 6}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 dark:from-purple-600 dark:to-indigo-600 dark:hover:from-purple-500 dark:hover:to-indigo-500 text-white border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? 'Verifying Code...' : 'Verify 6-Digit Code'}
              </button>
            </div>
          </form>

          <ResendSecurityNotice
            idPrefix={`${idPrefix}-password-reset`}
            email={trimmedEmail}
            helperContext="reset"
            buttonLabel="Resend Reset Code"
            onResend={() => void resendCode()}
            isResending={isResending}
            isInCooldown={cooldown.isInCooldown}
            formattedCountdown={cooldown.formattedCountdown}
            nextAvailableTimeLabel={cooldown.nextAvailableTimeLabel}
            attemptCount={cooldown.attemptCount}
            disabled={isSubmitting || !isEmailValid}
            successMessage={resendSuccess}
            errorMessage={resendError}
          />
        </div>
      )}

      {/* STEP 3: SET NEW PASSWORD AFTER 6-DIGIT VERIFICATION */}
      {step === 'confirm' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirmReset();
          }}
          className="space-y-4"
        >
          <div className="px-3 py-2 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="truncate">6-digit code verified for {trimmedEmail}</span>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label
                htmlFor={`${idPrefix}-new-password-input`}
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                New Password
              </label>
              <PasswordRequirementsTooltip minChars={6} password={newPassword} />
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-purple-600 dark:text-purple-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id={`${idPrefix}-new-password-input`}
                type={showNewPassword ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="Enter new password"
                value={newPassword}
                onPaste={(e) => {
                  e.preventDefault();
                  triggerPasteBlockedNotice();
                }}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (pasteBlocked) setPasteBlocked(false);
                  if (errorMessage) setErrorMessage(null);
                }}
                className="app-input w-full bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-purple-800/60 focus:bg-white dark:focus:bg-slate-900 focus:border-purple-600 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 rounded-xl text-xs sm:text-sm font-sans py-2.5 pl-[2.125rem] pr-12 transition outline-none"
              />
              <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="p-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200 transition cursor-pointer"
                  title={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {pasteBlocked && (
              <div className="mt-1.5 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 text-[11px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>Pasting is disabled for security verification. Please type your password manually.</span>
              </div>
            )}

            {newPassword.length > 0 && (
              <PasswordStrengthIndicator password={newPassword} minChars={6} showChecklist={true} />
            )}
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-confirm-password-input`}
              className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Confirm New Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-purple-600 dark:text-purple-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id={`${idPrefix}-confirm-password-input`}
                type={showConfirmPassword ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onPaste={(e) => {
                  e.preventDefault();
                  triggerPasteBlockedNotice();
                }}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (pasteBlocked) setPasteBlocked(false);
                  if (errorMessage) setErrorMessage(null);
                }}
                className={`app-input w-full bg-slate-50 dark:bg-slate-900/80 border focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 rounded-xl text-xs sm:text-sm font-sans py-2.5 pl-[2.125rem] pr-12 transition outline-none ${
                  passwordsMismatch
                    ? 'border-rose-400 dark:border-rose-500/80 focus:border-rose-500'
                    : passwordsMatch
                    ? 'border-emerald-400 dark:border-emerald-500/70 focus:border-emerald-500'
                    : 'border-slate-200 dark:border-purple-800/60 focus:border-purple-600 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20'
                }`}
              />
              <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="p-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200 transition cursor-pointer"
                  title={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {passwordsMismatch && (
              <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                Passwords do not match yet.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2.5 sm:gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStep('verify');
              }}
              className="flex-1 py-2.5 px-4 rounded-xl bg-white hover:bg-purple-50/80 text-purple-700 hover:text-purple-800 border border-purple-200/90 shadow-xs hover:border-purple-300 dark:bg-slate-900/80 dark:hover:bg-purple-900/40 dark:border-purple-800/60 dark:text-purple-200 text-xs font-bold transition cursor-pointer"
            >
              Back
            </button>
            <button
              id={`${idPrefix}-confirm-password-reset-btn`}
              type="submit"
              disabled={isSubmitting || newPassword.length < 6 || passwordsMismatch}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 dark:from-purple-600 dark:to-indigo-600 dark:hover:from-purple-500 dark:hover:to-indigo-500 text-white border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? 'Updating Password...' : 'Save New Password'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
