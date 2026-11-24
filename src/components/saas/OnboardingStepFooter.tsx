import React from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2 } from 'lucide-react';

export interface OnboardingStepFooterProps {
  leftLabel?: string;
  onLeftClick?: () => void;
  showLeftArrow?: boolean;
  nextLabel?: React.ReactNode;
  onNextClick?: () => void;
  saving: boolean;
  isFinalStep?: boolean;
}

export const OnboardingStepFooter: React.FC<OnboardingStepFooterProps> = ({
  leftLabel,
  onLeftClick,
  showLeftArrow = true,
  nextLabel,
  onNextClick,
  saving,
  isFinalStep = false,
}) => (
  <div
    data-onboarding-footer
    className="flex flex-col gap-2.5 pt-3.5 sm:pt-4 border-t border-slate-200/80 dark:border-purple-900/40 sm:flex-row sm:items-center sm:justify-between sm:gap-2.5"
  >
    {!isFinalStep && nextLabel && onNextClick ? (
      <>
        <button
          type="button"
          onClick={onNextClick}
          className="btn-primary order-1 sm:order-3 w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-transparent inline-flex items-center justify-center gap-1.5 min-h-10 px-4 sm:px-5 py-2.5 text-xs font-bold leading-tight text-center shadow-sm cursor-pointer"
        >
          <span>{nextLabel}</span>
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
        </button>

        <div className="order-2 sm:contents flex items-center justify-between gap-2 w-full">
          {leftLabel && onLeftClick && (
            <button
              type="button"
              onClick={onLeftClick}
              className="btn-secondary sm:order-1 rounded-xl inline-flex items-center justify-center gap-1.5 min-h-10 px-3.5 sm:px-4 py-2 text-xs font-bold leading-none whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
            >
              {showLeftArrow && <ArrowLeft className="w-3.5 h-3.5 shrink-0" />}
              <span>{leftLabel}</span>
            </button>
          )}

          <button
            type="submit"
            disabled={saving}
            className="btn-secondary sm:order-2 sm:ml-auto rounded-xl inline-flex items-center justify-center gap-1.5 min-h-10 px-3.5 sm:px-4 py-2 text-xs font-bold leading-none whitespace-nowrap shrink-0 cursor-pointer shadow-2xs disabled:opacity-50"
            title="Save and launch store portal directly"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{saving ? 'Saving...' : 'Save & Launch'}</span>
          </button>
        </div>
      </>
    ) : (
      <>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary order-1 sm:order-2 w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-transparent inline-flex items-center justify-center gap-1.5 min-h-10 px-4 sm:px-6 py-2.5 text-xs font-bold leading-tight text-center shadow-md cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Finalizing Store Setup...</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 stroke-[2.5] shrink-0" />
              <span>Complete Store Setup &amp; Unlock Owner Portal</span>
            </>
          )}
        </button>

        <div className="order-2 sm:order-1 flex items-center justify-start w-full sm:w-auto">
          <button
            type="button"
            onClick={onLeftClick}
            className="btn-secondary rounded-xl inline-flex items-center justify-center gap-1.5 min-h-10 px-3.5 sm:px-4 py-2 text-xs font-bold leading-none whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
          >
            {showLeftArrow && <ArrowLeft className="w-3.5 h-3.5 shrink-0" />}
            <span>{leftLabel}</span>
          </button>
        </div>
      </>
    )}
  </div>
);
