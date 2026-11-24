import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.tsx';
import {
  LICENSE_AGREEMENTS,
  type LicenseAgreementType,
} from '../../data/licenseAgreements.ts';

interface LicenseAgreementModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLicenseType?: LicenseAgreementType;
  allowSwitch?: boolean;
  theme?: 'light' | 'dark';
  onAccept?: (acceptedType: LicenseAgreementType) => void;
  acceptLabel?: string;
}

export const LicenseAgreementModal: React.FC<LicenseAgreementModalProps> = ({
  isOpen,
  onClose,
  initialLicenseType = 'free_trial',
  allowSwitch = true,
  theme: propTheme,
  onAccept,
  acceptLabel = 'I Accept License',
}) => {
  const globalTheme = useTheme();
  const isDark = (propTheme ?? globalTheme?.theme ?? 'light') === 'dark';

  const [activeType, setActiveType] = useState<LicenseAgreementType>(initialLicenseType);

  useEffect(() => {
    if (isOpen) {
      setActiveType(initialLicenseType);
    }
  }, [isOpen, initialLicenseType]);

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

  if (!isOpen) return null;

  const doc = LICENSE_AGREEMENTS[activeType];

  const modalMarkup = (
    <div
      id="software-license-agreement-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-agreement-modal-title"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 backdrop-blur-xs px-2 py-3 sm:px-3.5 sm:py-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative w-full max-w-3xl rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[90dvh] ${
          isDark
            ? 'bg-[#0F1629] border-indigo-500/30 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`px-4 sm:px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${
            isDark
              ? 'bg-[#131B33] border-indigo-500/25'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
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
              <div
                className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                <span>{doc.licensor}</span>
                <span aria-hidden="true">·</span>
                <span>{doc.badgeText}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{doc.planScope}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            {allowSwitch && (
              <div
                className={`inline-flex items-center p-1 rounded-lg border ${
                  isDark
                    ? 'bg-[#090D1B] border-slate-800'
                    : 'bg-slate-100 border-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveType('free_trial')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeType === 'free_trial'
                      ? isDark
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Free Trial
                </button>
                <button
                  type="button"
                  onClick={() => setActiveType('premium')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeType === 'premium'
                      ? isDark
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                      : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Premium
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close license agreement"
              className={`p-2 rounded-lg transition-colors cursor-pointer ${
                isDark
                  ? 'text-slate-400 hover:text-white hover:bg-white/10'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Legal Document Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5 text-xs sm:text-[13px] leading-relaxed">
          {/* Metadata strip */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border ${
              isDark
                ? 'bg-[#0A0F1F] border-slate-800 text-slate-300'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <div>
              <span
                className={`block text-[11px] font-semibold ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Software Product
              </span>
              <span className="font-semibold">{doc.productName}</span>
            </div>
            <div>
              <span
                className={`block text-[11px] font-semibold ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Licensor / Provider
              </span>
              <span className="font-semibold">{doc.licensor}</span>
            </div>
            <div>
              <span
                className={`block text-[11px] font-semibold ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                Covered Tier
              </span>
              <span className="font-semibold">{doc.planScope}</span>
            </div>
          </div>

          {/* Mandatory Promotional Pricing Highlight Notice */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              isDark
                ? 'bg-amber-950/35 border-amber-500/35 text-amber-100'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            <AlertCircle
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                isDark ? 'text-amber-400' : 'text-amber-600'
              }`}
            />
            <div>
              <div className="font-bold text-xs mb-1">
                Introductory Promotional Pricing Notice
              </div>
              <p className={isDark ? 'text-amber-200/90 text-xs' : 'text-amber-900 text-xs'}>
                {doc.promotionalNotice}
              </p>
            </div>
          </div>

          {/* Legal Sections */}
          <div className="space-y-5">
            {doc.sections.map((section) => (
              <section
                key={`${doc.id}-${section.number}`}
                className={`pb-4 border-b last:border-b-0 ${
                  isDark ? 'border-slate-800/80' : 'border-slate-200/80'
                } ${
                  section.highlighted
                    ? isDark
                      ? 'p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30'
                      : 'p-4 rounded-xl bg-indigo-50/60 border border-indigo-200'
                    : ''
                }`}
              >
                <h3
                  className={`text-sm font-bold mb-2 ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {section.number}. {section.title}
                </h3>

                {section.paragraphs && (
                  <div className="space-y-2">
                    {section.paragraphs.map((p, idx) => (
                      <p
                        key={idx}
                        className={isDark ? 'text-slate-300' : 'text-slate-700'}
                      >
                        {p}
                      </p>
                    ))}
                  </div>
                )}

                {section.bullets && (
                  <ul
                    className={`mt-2 space-y-1.5 list-disc pl-5 ${
                      isDark ? 'text-slate-300' : 'text-slate-700'
                    }`}
                  >
                    {section.bullets.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                )}

                {section.subsections && (
                  <div className="mt-3 space-y-3">
                    {section.subsections.map((sub, subIdx) => (
                      <div key={subIdx}>
                        {sub.heading && (
                          <h4
                            className={`text-xs font-bold mb-1 ${
                              isDark ? 'text-slate-200' : 'text-slate-800'
                            }`}
                          >
                            {sub.heading}
                          </h4>
                        )}
                        {sub.paragraphs?.map((sp, pIdx) => (
                          <p
                            key={pIdx}
                            className={isDark ? 'text-slate-300' : 'text-slate-700'}
                          >
                            {sp}
                          </p>
                        ))}
                        {sub.bullets && (
                          <ul
                            className={`mt-1 space-y-1.5 list-disc pl-5 ${
                              isDark ? 'text-slate-300' : 'text-slate-700'
                            }`}
                          >
                            {sub.bullets.map((sb, bIdx) => (
                              <li key={bIdx}>{sb}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Acceptance Statement */}
          <div
            className={`p-4 rounded-xl border ${
              isDark
                ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-100'
                : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-xs mb-2">
              <ShieldCheck
                className={`w-4 h-4 shrink-0 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`}
              />
              <span>Acceptance Statement</span>
            </div>
            <ul className="space-y-1.5 text-xs">
              {doc.acceptanceChecklist.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
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
              className={`mt-3 pt-2.5 border-t text-[11px] ${
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
          className={`px-4 sm:px-6 py-3.5 border-t flex flex-wrap items-center justify-end gap-2.5 shrink-0 ${
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
                ? `px-4 py-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                    isDark
                      ? 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`
                : 'px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm transition cursor-pointer'
            }
          >
            Close
          </button>
          {onAccept && (
            <button
              type="button"
              onClick={() => onAccept(activeType)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold shadow-sm transition cursor-pointer inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{acceptLabel}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalMarkup, document.body);
  }

  return modalMarkup;
};
