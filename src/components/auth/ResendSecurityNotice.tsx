import React from 'react';
import { Mail, Clock, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

interface ResendSecurityNoticeProps {
  idPrefix: string;
  email?: string;
  helperContext: 'confirmation' | 'reset';
  buttonLabel: string;
  onResend: () => void;
  isResending: boolean;
  isInCooldown: boolean;
  formattedCountdown: string;
  nextAvailableTimeLabel: string | null;
  attemptCount: number;
  disabled?: boolean;
  successMessage?: string | null;
  errorMessage?: string | null;
}

export const ResendSecurityNotice: React.FC<ResendSecurityNoticeProps> = ({
  idPrefix,
  email,
  helperContext,
  buttonLabel,
  onResend,
  isResending,
  isInCooldown,
  formattedCountdown,
  nextAvailableTimeLabel,
  attemptCount,
  disabled = false,
  successMessage,
  errorMessage,
}) => {
  const cleanEmail = email?.trim() || '';
  const emailSubjectNoun =
    helperContext === 'confirmation' ? 'confirmation email' : 'password reset code and link';
  const stageNumber = Math.min(Math.max(attemptCount, 1), 5);

  return (
    <div
      id={`${idPrefix}-resend-panel`}
      className="rounded-2xl border border-purple-200/90 dark:border-purple-800/60 bg-purple-50/70 dark:bg-slate-900/70 p-3.5 sm:p-4 space-y-3 transition-colors"
    >
      {/* 1. Inbox + Spam/Junk Helper Text */}
      <div className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
        <div className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0 border border-purple-200 dark:border-purple-500/30 mt-0.5">
          <Mail className="w-3.5 h-3.5" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            Please check your <strong className="font-bold text-slate-900 dark:text-white">Inbox</strong>
            {cleanEmail ? (
              <>
                {' '}for <strong className="font-semibold text-purple-700 dark:text-purple-300 break-all">{cleanEmail}</strong>
              </>
            ) : null}{' '}
            for your {emailSubjectNoun}.
          </p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            If you don&apos;t see it within a minute, please check your{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">Spam / Junk</strong> folder.
          </p>
        </div>
      </div>

      {/* Inline Success / Error Feedback */}
      {successMessage && (
        <div
          role="status"
          id={`${idPrefix}-resend-success`}
          className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200 text-[11px] sm:text-xs flex items-start gap-2 font-medium"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span className="leading-snug">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          id={`${idPrefix}-resend-error`}
          className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700/60 text-rose-800 dark:text-rose-200 text-[11px] sm:text-xs flex items-start gap-2 font-medium"
        >
          <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span className="leading-snug">{errorMessage}</span>
        </div>
      )}

      {/* 2. Resend Action Button & Progressive Cooldown Countdown */}
      <div className="pt-1 flex flex-col gap-2">
        <button
          id={`${idPrefix}-resend-btn`}
          type="button"
          disabled={disabled || isResending || isInCooldown}
          onClick={onResend}
          className="w-full py-2.5 px-3.5 rounded-xl border border-purple-400/70 dark:border-purple-500/60 bg-white hover:bg-purple-50 dark:bg-purple-500/15 dark:hover:bg-purple-500/25 text-purple-700 dark:text-purple-200 font-bold text-xs shadow-sm hover:shadow-md transition-all active:scale-[0.99] disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isResending ? 'animate-spin' : ''}`} />
          <span>
            {isResending
              ? 'Sending...'
              : isInCooldown
              ? `${buttonLabel} (${formattedCountdown})`
              : buttonLabel}
          </span>
        </button>

        {isInCooldown && (
          <div
            id={`${idPrefix}-cooldown-status`}
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2.5 py-2 rounded-xl bg-white/80 dark:bg-slate-950/60 border border-purple-200/80 dark:border-purple-800/50 text-[11px]"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-300">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Next resend available in{' '}
                <strong id={`${idPrefix}-cooldown-timer`} className="font-mono tabular-nums">
                  {formattedCountdown}
                </strong>
                {nextAvailableTimeLabel ? (
                  <span className="font-normal text-slate-600 dark:text-slate-400">
                    {' '}(at {nextAvailableTimeLabel})
                  </span>
                ) : null}
              </span>
            </span>

            {attemptCount > 0 && (
              <span className="font-mono text-[10px] font-semibold text-slate-500 dark:text-purple-300/70">
                Attempt {stageNumber}/5
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
