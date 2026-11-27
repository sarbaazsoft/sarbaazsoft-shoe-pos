import React, { useEffect } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, ShieldAlert, X } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  sectionLabels: string[];
  isSaving: boolean;
  saveError: string | null;
  onSaveChanges: () => void;
  onDiscardChanges: () => void;
  onStay: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  sectionLabels,
  isSaving,
  saveError,
  onSaveChanges,
  onDiscardChanges,
  onStay,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        e.preventDefault();
        e.stopPropagation();
        onStay();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, isSaving, onStay]);

  if (!isOpen) return null;

  const sectionText =
    sectionLabels.length > 0 ? sectionLabels.join(', ') : 'Settings';

  return (
    <div
      id="unsaved-changes-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) {
          onStay();
        }
      }}
    >
      <div
        className="w-full max-w-sm sm:max-w-md lg:max-w-lg my-auto rounded-2xl bg-white dark:bg-[#131B2E] border border-slate-200 dark:border-purple-800/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-50 dark:bg-gradient-to-r dark:from-purple-900 dark:via-indigo-950 dark:to-slate-900 border-b border-slate-200 dark:border-purple-800/80 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="unsaved-changes-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight"
              >
                Unsaved Changes in {sectionText}
              </h3>
              <p className="text-xs text-slate-500 dark:text-purple-200/80 mt-0.5">
                You have modified settings that have not been saved yet.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onStay}
            disabled={isSaving}
            aria-label="Stay on current tab"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:text-purple-300 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Would you like to save your changes in{' '}
            <strong className="text-slate-900 dark:text-white">{sectionText}</strong> before
            leaving, discard them to restore the last saved configuration, or stay here to continue
            editing?
          </p>

          {saveError && (
            <div
              role="alert"
              data-testid="unsaved-changes-error"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-200 flex items-start gap-2.5 font-medium"
            >
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-[#0D1426] border-t border-slate-200 dark:border-purple-900/50 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
          <button
            id="unsaved-changes-stay-btn"
            type="button"
            onClick={onStay}
            disabled={isSaving}
            className="w-full sm:w-auto px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            Stay
          </button>

          <button
            id="unsaved-changes-discard-btn"
            type="button"
            onClick={onDiscardChanges}
            disabled={isSaving}
            className="w-full sm:w-auto px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-200 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Discard Changes</span>
          </button>

          <button
            id="unsaved-changes-save-btn"
            type="button"
            onClick={onSaveChanges}
            disabled={isSaving}
            className="btn-primary w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
