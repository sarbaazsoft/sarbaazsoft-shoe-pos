import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, FileText, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.tsx';
import { SOFTWARE_LICENSE_AGREEMENT } from '../../data/licenseAgreements.ts';

interface LicenseAgreementModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'light' | 'dark';
  onAccept?: () => void;
  acceptLabel?: string;
}

export const LicenseAgreementModal: React.FC<LicenseAgreementModalProps> = ({
  isOpen,
  onClose,
  theme: propTheme,
  onAccept,
  acceptLabel = 'Accept License',
}) => {
  const globalTheme = useTheme();
  const isDark = (propTheme ?? globalTheme?.theme ?? 'light') === 'dark';

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const doc = SOFTWARE_LICENSE_AGREEMENT;

  const modalMarkup = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="software-license-agreement-modal"
          data-motion-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          id="software-license-agreement-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="license-agreement-modal-title"
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 backdrop-blur-xs px-2 py-2.5 sm:px-3 sm:py-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            data-motion-modal="true"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`relative w-full max-w-2xl rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[90dvh] ${
              isDark
                ? 'bg-[#0F1629] border-indigo-500/30 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
        {/* Header */}
        <div
          className={`px-4 sm:px-5 py-3.5 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDark
              ? 'bg-[#131B33] border-indigo-500/25'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                isDark
                  ? 'bg-indigo-500/15 border-indigo-400/30 text-indigo-300'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-600'
              }`}
            >
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="license-agreement-modal-title"
                className={`text-sm sm:text-base font-bold tracking-tight ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {doc.title}
              </h2>
              <p
                className={`text-[11px] truncate ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {doc.licensor}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close license agreement"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
              isDark
                ? 'text-slate-400 hover:text-white hover:bg-white/10'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/70'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Legal Document Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3.5 text-xs leading-relaxed">
          {/* Metadata strip */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl border ${
              isDark
                ? 'bg-[#0A0F1F] border-slate-800 text-slate-300'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <div>
              <span
                className={`block text-[10.5px] font-semibold ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Software Product
              </span>
              <span className="font-semibold">{doc.productName}</span>
            </div>
            <div>
              <span
                className={`block text-[10.5px] font-semibold ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Licensor / Provider
              </span>
              <span className="font-semibold">{doc.licensor}</span>
            </div>
          </div>

          {/* Concise License Sections */}
          <div className="space-y-3">
            {doc.sections.map((section) => (
              <section
                key={section.number}
                className={`pb-3 border-b last:border-b-0 ${
                  isDark ? 'border-slate-800/80' : 'border-slate-200/80'
                }`}
              >
                <h3
                  className={`text-xs sm:text-[13px] font-bold mb-1 ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {section.number}. {section.title}
                </h3>

                <ul
                  className={`space-y-1 list-disc pl-4.5 ${
                    isDark ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  {section.bullets.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Summary Acceptance Box */}
          <div
            className={`p-3 rounded-xl border ${
              isDark
                ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-100'
                : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold text-xs mb-1.5">
              <ShieldCheck
                className={`w-3.5 h-3.5 shrink-0 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`}
              />
              <span>Acceptance Summary</span>
            </div>
            <ul className="space-y-1 text-[11.5px]">
              {doc.acceptanceChecklist.map((item, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                      isDark ? 'text-emerald-400' : 'text-emerald-600'
                    }`}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p
              className={`mt-2 pt-2 border-t text-[11px] ${
                isDark
                  ? 'border-emerald-500/20 text-slate-400'
                  : 'border-emerald-200 text-slate-600'
              }`}
            >
              {doc.footerNote}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`px-4 sm:px-5 py-3 border-t flex flex-wrap items-center justify-end gap-2 shrink-0 ${
            isDark
              ? 'bg-[#0B1020] border-slate-800'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className={
              onAccept
                ? `px-4 py-2 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    isDark
                      ? 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`
                : 'px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm transition cursor-pointer'
            }
          >
            Close
          </button>
          {onAccept && (
            <button
              type="button"
              onClick={onAccept}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm transition cursor-pointer inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{acceptLabel}</span>
            </button>
          )}
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalMarkup, document.body);
  }

  return modalMarkup;
};
