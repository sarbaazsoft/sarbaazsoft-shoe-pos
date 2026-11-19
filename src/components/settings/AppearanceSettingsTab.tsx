import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Pipette,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext.tsx';
import {
  ACCENT_THEME_LIST,
  CURATED_APPEARANCE_PALETTES,
  DEFAULT_ACCENT_THEME,
  getWcagContrastRatio,
  isValidHexColor,
  normalizeHexColor,
  resolveAccentPalette,
} from '../../utils/themePalettes.ts';
import {
  PREDEFINED_SCREEN_IMAGE_LIBRARY,
  SCREEN_IMAGE_SLOTS,
  type ScreenImageSlot,
  compressUploadedImageFile,
  validateExternalImageUrl,
} from '../../utils/screenImages.ts';
import defaultShowroomBg from '../../assets/images/shoe_store_blurred_bg_1790706924465.jpg';

interface AppearanceSettingsTabProps {
  currentUser: any;
}

const SHADE_PREVIEW_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export const AppearanceSettingsTab: React.FC<AppearanceSettingsTabProps> = ({ currentUser }) => {
  const {
    theme,
    themeMode,
    accentTheme,
    accentPalette,
    customAccentHex,
    isAuthenticatedSession,
    isPreviewActive,
    hasUnsavedColorPreview,
    hasUnsavedImagePreview,
    isSavingAppearance,
    appearanceSaveError,
    clearAppearanceSaveError,
    updatePreview,
    cancelPreview,
    applyAndSaveAppearance,
    resetAppearanceToDefault,
    effectiveScreenImages,
    updateScreenImagesPreview,
  } = useTheme();

  const userRole = String(currentUser?.role || '').toUpperCase();
  const canManageScreenImages = userRole === 'SUPERADMIN' || userRole === 'ADMIN';

  const [hexDraft, setHexDraft] = useState<string>(customAccentHex);
  const [hexError, setHexError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [localErrorMsg, setLocalErrorMsg] = useState<string | null>(null);

  // Screen image customization local controls
  const [selectedScreenSlot, setSelectedScreenSlot] = useState<ScreenImageSlot>('login');
  const [externalUrlInput, setExternalUrlInput] = useState<string>('');
  const [externalUrlError, setExternalUrlError] = useState<string | null>(null);
  const [previewImgLoadFailed, setPreviewImgLoadFailed] = useState<boolean>(false);
  const [isCompressingUpload, setIsCompressingUpload] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync hex text field when effective customAccentHex changes externally
  useEffect(() => {
    setHexDraft(customAccentHex);
    setHexError(null);
  }, [customAccentHex]);

  // Keep URL input synced to currently selected screen slot (only when URL is non-data URI)
  const activeSlotValue = effectiveScreenImages[selectedScreenSlot] || '';
  useEffect(() => {
    setPreviewImgLoadFailed(false);
    setExternalUrlError(null);
    if (activeSlotValue && !activeSlotValue.startsWith('data:')) {
      setExternalUrlInput(activeSlotValue);
    } else {
      setExternalUrlInput('');
    }
  }, [selectedScreenSlot, activeSlotValue]);

  const handleModePreview = (mode: ThemeMode) => {
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    updatePreview({ themeMode: mode });
  };

  const handlePresetPreview = (presetId: (typeof ACCENT_THEME_LIST)[number]['id']) => {
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    updatePreview({ accentTheme: presetId });
  };

  const handleCuratedHexPreview = (hex: string) => {
    const normalized = normalizeHexColor(hex);
    setHexDraft(normalized);
    setHexError(null);
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    updatePreview({ accentTheme: 'custom', customAccentHex: normalized });
  };

  const handleHexDraftChange = (value: string) => {
    setHexDraft(value);
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    const candidate = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    if (!value.trim()) {
      setHexError('Enter a 3- or 6-digit HEX code (e.g. #2563EB).');
      return;
    }
    if (isValidHexColor(candidate)) {
      const normalized = normalizeHexColor(candidate);
      setHexError(null);
      updatePreview({ accentTheme: 'custom', customAccentHex: normalized });
    } else {
      setHexError('Use a valid HEX format such as #2563EB or #0EA.');
    }
  };

  const handleApplyAndSave = async () => {
    if (hexError) {
      setLocalErrorMsg('Fix the invalid HEX color before saving.');
      return;
    }
    setLocalErrorMsg(null);
    setSaveSuccessMsg(null);
    try {
      await applyAndSaveAppearance({ canSaveScreenImages: canManageScreenImages });
      setSaveSuccessMsg(
        isAuthenticatedSession
          ? 'Appearance & screen customization saved to your account.'
          : 'Appearance saved to browser guest storage.'
      );
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (err: any) {
      setLocalErrorMsg(err?.message || 'Failed to save changes.');
    }
  };

  const handleCancel = () => {
    setHexError(null);
    setLocalErrorMsg(null);
    setExternalUrlError(null);
    setSaveSuccessMsg(null);
    cancelPreview();
  };

  const handleResetDefault = () => {
    setHexError(null);
    setLocalErrorMsg(null);
    setSaveSuccessMsg(null);
    clearAppearanceSaveError();
    void resetAppearanceToDefault({ persistImmediately: false });
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canManageScreenImages) return;

    setIsCompressingUpload(true);
    setExternalUrlError(null);
    setLocalErrorMsg(null);
    setSaveSuccessMsg(null);
    try {
      const dataUrl = await compressUploadedImageFile(file);
      updateScreenImagesPreview({ [selectedScreenSlot]: dataUrl });
    } catch (err: any) {
      setExternalUrlError(err?.message || 'Could not process the uploaded image file.');
    } finally {
      setIsCompressingUpload(false);
    }
  };

  const handleApplyExternalUrl = () => {
    if (!canManageScreenImages) return;
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    const result = validateExternalImageUrl(externalUrlInput);
    if (!result.valid) {
      setExternalUrlError(result.error || 'Invalid image URL.');
      return;
    }
    setExternalUrlError(null);
    setPreviewImgLoadFailed(false);
    updateScreenImagesPreview({ [selectedScreenSlot]: result.url });
  };

  const handleSelectLibraryImage = (url: string) => {
    if (!canManageScreenImages) return;
    setExternalUrlError(null);
    setPreviewImgLoadFailed(false);
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    updateScreenImagesPreview({ [selectedScreenSlot]: url });
  };

  const handleClearSlotImage = () => {
    if (!canManageScreenImages) return;
    setExternalUrlError(null);
    setPreviewImgLoadFailed(false);
    setSaveSuccessMsg(null);
    setExternalUrlInput('');
    updateScreenImagesPreview({ [selectedScreenSlot]: '' });
  };

  const contrastRatio = getWcagContrastRatio(accentPalette.primaryScale[600], accentPalette.contrastText);
  const contrastBadge = contrastRatio >= 7 ? 'AAA' : contrastRatio >= 4.5 ? 'AA' : 'Large AA';
  const activeScreenMeta = SCREEN_IMAGE_SLOTS.find((s) => s.id === selectedScreenSlot) || SCREEN_IMAGE_SLOTS[0];
  const resolvedPreviewImg =
    activeSlotValue && !previewImgLoadFailed ? activeSlotValue : defaultShowroomBg;

  const isCustomOrCuratedActive = accentTheme === 'custom';
  const activeHexUpper = normalizeHexColor(accentPalette.baseHex);

  return (
    <div id="appearance-settings-panel" className="space-y-6 animate-in fade-in duration-200">
      {/* Live Preview Sticky Action Bar */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 transition-all duration-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm ${
          isPreviewActive
            ? 'bg-purple-50/90 dark:bg-purple-950/35 border-purple-400/70 dark:border-purple-500/50 ring-2 ring-purple-500/20'
            : 'bg-white dark:bg-[#131B2E] border-slate-200 dark:border-purple-800/60'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
            style={{
              background: accentPalette.buttonGradient,
              color: accentPalette.contrastText,
            }}
          >
            {isPreviewActive ? <Eye className="w-5 h-5" /> : <Palette className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                {isPreviewActive ? 'Live Preview Active (Unsaved)' : 'Appearance & Color Studio'}
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                {isAuthenticatedSession ? 'Account Database Sync' : 'Guest Browser Storage'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {isPreviewActive
                ? 'Changes are previewing live across buttons, navigation, tables, modals, and cards. Click Apply & Save to commit or Cancel to revert.'
                : 'Customize Light/Dark/System mode, curated or custom HEX palettes, and authentication/loading screen backdrops.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            id="appearance-reset-default-btn"
            type="button"
            onClick={handleResetDefault}
            disabled={isSavingAppearance}
            className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Default</span>
          </button>

          {isPreviewActive && (
            <button
              id="appearance-cancel-preview-btn"
              type="button"
              onClick={handleCancel}
              disabled={isSavingAppearance}
              className="h-10 px-3.5 rounded-xl border border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel Preview</span>
            </button>
          )}

          <button
            id="appearance-apply-save-btn"
            type="button"
            onClick={handleApplyAndSave}
            disabled={!isPreviewActive || isSavingAppearance || Boolean(hexError)}
            className="btn-primary h-10 px-4 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45"
          >
            {isSavingAppearance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isSavingAppearance ? 'Saving...' : 'Apply & Save'}</span>
          </button>
        </div>
      </div>

      {/* Feedback Alerts */}
      {saveSuccessMsg && (
        <div
          role="status"
          className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center gap-2.5 text-xs font-semibold"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {(appearanceSaveError || localErrorMsg) && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3 text-xs font-semibold"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{localErrorMsg || appearanceSaveError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLocalErrorMsg(null);
              clearAppearanceSaveError();
            }}
            className="p-1 rounded-lg hover:bg-rose-500/15 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SECTION 1: THEME MODE + CORE PRESETS & CURATED PALETTES */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Theme Mode + Core Presets */}
        <div className="xl:col-span-7 bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-6">
          {/* Mode Selector */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Display Mode</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Switch between crisp daylight, low-glare dark mode, or OS-automatic mode.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Active: {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { id: 'light', label: 'Light', hint: 'Crisp studio', icon: Sun },
                  { id: 'dark', label: 'Dark', hint: 'Deep navy', icon: Moon },
                  { id: 'system', label: 'System', hint: 'Auto match', icon: Monitor },
                ] as const
              ).map(({ id, label, hint, icon: Icon }) => {
                const selected = themeMode === id;
                return (
                  <button
                    key={id}
                    id={`appearance-mode-${id}`}
                    type="button"
                    onClick={() => handleModePreview(id)}
                    aria-pressed={selected}
                    className={`min-h-[68px] p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      selected
                        ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 ring-2 ring-purple-500/25 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 hover:border-purple-400/60'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <Icon
                        className={`w-4 h-4 ${
                          selected ? 'text-purple-600 dark:text-purple-300' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      />
                      {selected && (
                        <span className="w-4 h-4 rounded-full bg-purple-600 text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2">
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{label}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Core Presets (8) */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Core Theme Presets</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hand-tuned multi-shade gradients synchronized with the quick header switcher.
                </p>
              </div>
              {accentTheme !== 'custom' && (
                <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-300">
                  {accentPalette.name}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {ACCENT_THEME_LIST.map((palette) => {
                const selected = accentTheme === palette.id;
                return (
                  <button
                    key={palette.id}
                    id={`appearance-preset-${palette.id}`}
                    type="button"
                    onClick={() => handlePresetPreview(palette.id)}
                    aria-pressed={selected}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      selected
                        ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 ring-2 ring-purple-500/25 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900/40'
                    }`}
                  >
                    <span
                      className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center shadow-xs border border-black/10"
                      style={{ background: palette.buttonGradient, color: palette.contrastText }}
                    >
                      {selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{palette.name}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono">
                        {palette.baseHex}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Curated Extended Palettes */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Curated Designer Palettes</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Additional curated retail &amp; studio color palettes with auto-computed gradients.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {CURATED_APPEARANCE_PALETTES.map((item) => {
                const selected = isCustomOrCuratedActive && activeHexUpper === item.hex.toUpperCase();
                const preview = resolveAccentPalette('custom', item.hex);
                return (
                  <button
                    key={item.key}
                    id={`appearance-curated-${item.key}`}
                    type="button"
                    onClick={() => handleCuratedHexPreview(item.hex)}
                    aria-pressed={selected}
                    title={`${item.name} (${item.hex})`}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2 ${
                      selected
                        ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 ring-2 ring-purple-500/25'
                        : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span
                      className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center border border-black/10"
                      style={{ background: preview.buttonGradient, color: preview.contrastText }}
                    >
                      {selected && <Check className="w-3 h-3 stroke-[3]" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate">
                        {item.name}
                      </div>
                      <div className="text-[9px] font-mono text-slate-500 dark:text-slate-400">{item.hex}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Custom HEX Color Studio + Generated Scale + Live Component Preview */}
        <div className="xl:col-span-5 space-y-5">
          {/* Custom HEX Picker */}
          <div className="bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Pipette className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span>Unlimited Custom HEX Color</span>
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pick any brand HEX color to auto-generate shades, gradients &amp; accessible contrast.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                WCAG {contrastBadge} · {contrastRatio.toFixed(1)}:1
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label
                htmlFor="appearance-custom-color-picker"
                className="relative w-12 h-11 rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 cursor-pointer shrink-0 shadow-xs"
                style={{ backgroundColor: accentPalette.baseHex }}
                title="Open visual color picker"
              >
                <input
                  id="appearance-custom-color-picker"
                  type="color"
                  value={normalizeHexColor(customAccentHex)}
                  onChange={(e) => handleCuratedHexPreview(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  aria-label="Visual custom color picker"
                />
              </label>

              <div className="flex-1 min-w-0">
                <input
                  id="appearance-custom-hex-input"
                  type="text"
                  value={hexDraft}
                  onChange={(e) => handleHexDraftChange(e.target.value)}
                  placeholder="#2563EB"
                  maxLength={9}
                  aria-label="Custom HEX color code"
                  className="w-full h-11 px-3 rounded-xl font-mono text-sm font-semibold bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="button"
                onClick={() => handleCuratedHexPreview(hexDraft)}
                disabled={!isValidHexColor(hexDraft)}
                className="btn-primary h-11 px-3.5 rounded-xl text-xs font-bold shrink-0 cursor-pointer disabled:opacity-40"
              >
                Preview
              </button>
            </div>

            {hexError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{hexError}</p>
            )}

            {/* Auto-Generated 50-950 Shade Scale */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                <span>Generated Shade Scale (50 → 950)</span>
                <span className="font-mono">{accentPalette.baseHex} → {accentPalette.companionHex}</span>
              </div>
              <div className="grid grid-cols-11 gap-1 rounded-xl overflow-hidden p-1 bg-slate-100 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800">
                {SHADE_PREVIEW_STEPS.map((shade) => (
                  <div
                    key={shade}
                    className="h-7 rounded-md flex items-end justify-center pb-0.5 text-[8px] font-mono font-bold"
                    style={{
                      backgroundColor: accentPalette.primaryScale[shade],
                      color: shade >= 500 ? '#FFFFFF' : '#0F172A',
                    }}
                    title={`${shade}: ${accentPalette.primaryScale[shade]}`}
                  >
                    {shade}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live UI Component Preview Card */}
          <div className="bg-white dark:bg-[#131B2E] p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                <span>Live UI Component Preview</span>
              </span>
              <span className="badge badge-primary">Active Theme</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-primary btn-sm cursor-default">
                  Primary Action
                </button>
                <button type="button" className="btn btn-secondary btn-sm cursor-default">
                  Secondary
                </button>
                <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-200 border border-purple-200 dark:border-purple-700/50">
                  Tag / Badge
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <input
                  type="text"
                  readOnly
                  value="Focused input preview"
                  aria-label="Preview input"
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border text-slate-800 dark:text-slate-100 text-xs"
                />
                <div
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between"
                  style={{
                    background: accentPalette.buttonGradient,
                    color: accentPalette.contrastText,
                  }}
                >
                  <span>Gradient Bar</span>
                  <span className="font-mono text-[10px]">OK</span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900/80">
                <div className="px-3 py-1.5 text-[11px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 border-b border-slate-200 dark:border-slate-800 flex justify-between">
                  <span>Sample POS Ledger Row</span>
                  <span>Rs. 14,500</span>
                </div>
                <div className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                  <span>Notification Toast / Table Cell</span>
                  <span className="text-purple-600 dark:text-purple-300 font-bold">Live Sync</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: AUTHENTICATION & LOADING SCREEN IMAGES */}
      <div className="bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/20 border border-purple-100 dark:border-purple-400/30 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Authentication &amp; Loading Screen Images
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Customize separate backdrop images for Login, Registration, Authentication, and Loading screens.
              </p>
            </div>
          </div>

          {!canManageScreenImages && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 text-xs font-semibold">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Admin permission required to edit screen images</span>
            </span>
          )}
        </div>

        {/* Screen Selector Tabs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {SCREEN_IMAGE_SLOTS.map((slot) => {
            const isSelected = selectedScreenSlot === slot.id;
            const hasCustomImg = Boolean(effectiveScreenImages[slot.id]);
            return (
              <button
                key={slot.id}
                id={`screen-image-slot-${slot.id}`}
                type="button"
                onClick={() => setSelectedScreenSlot(slot.id)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isSelected
                    ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 ring-2 ring-purple-500/25 shadow-xs'
                    : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">{slot.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      hasCustomImg
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {hasCustomImg ? 'Custom' : 'Default'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{slot.description}</p>
              </button>
            );
          })}
        </div>

        {/* Live Screen Backdrop Preview + 3 Input Methods */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Preview Frame */}
          <div className="lg:col-span-5 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
              <span>Preview: {activeScreenMeta.label}</span>
              {activeSlotValue && canManageScreenImages && (
                <button
                  id="screen-image-restore-default-btn"
                  type="button"
                  onClick={handleClearSlotImage}
                  className="text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Restore Default</span>
                </button>
              )}
            </div>

            <div className="relative aspect-video w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 shadow-md">
              <img
                src={resolvedPreviewImg}
                alt={`${activeScreenMeta.label} background preview`}
                referrerPolicy="no-referrer"
                onLoad={() => setPreviewImgLoadFailed(false)}
                onError={() => {
                  if (activeSlotValue) setPreviewImgLoadFailed(true);
                }}
                className="w-full h-full object-cover object-center opacity-85"
              />
              <div
                className={`absolute inset-0 ${
                  theme === 'dark'
                    ? 'bg-gradient-to-b from-[#0A0E1A]/50 via-[#0A0E1A]/30 to-[#0A0E1A]/70'
                    : 'bg-gradient-to-b from-slate-200/35 via-transparent to-slate-200/45'
                }`}
              />
              {/* Simulated Auth Card Overlay to inspect readability */}
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="w-44 rounded-xl bg-white/95 dark:bg-[#131B2E]/95 border border-white/60 dark:border-purple-700/60 shadow-lg p-3 text-center backdrop-blur-md">
                  <div
                    className="h-1.5 w-14 mx-auto rounded-full mb-2"
                    style={{ background: accentPalette.buttonGradient }}
                  />
                  <div className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                    {activeScreenMeta.label}
                  </div>
                  <div className="mt-2 h-6 rounded-md text-[10px] font-bold flex items-center justify-center" style={{ background: accentPalette.buttonGradient, color: accentPalette.contrastText }}>
                    Continue
                  </div>
                </div>
              </div>
            </div>

            {previewImgLoadFailed && activeSlotValue && (
              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                Could not load that image URL directly in the browser (the fallback image is shown above). Verify the direct image address or try another host.
              </p>
            )}
            {hasUnsavedImagePreview && (
              <p className="text-xs text-purple-600 dark:text-purple-300 font-semibold">
                Unsaved screen image change queued — click &ldquo;Apply &amp; Save&rdquo; above to publish.
              </p>
            )}
          </div>

          {/* 3 Input Sources */}
          <div className="lg:col-span-7 space-y-4">
            {/* Option 1: Local Upload */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span>1. Upload from Device</span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    JPG, PNG, WEBP, or GIF — automatically optimized for fast screen loading.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    id="screen-image-file-input"
                    type="file"
                    accept="image/*"
                    onChange={handleUploadFile}
                    disabled={!canManageScreenImages || isCompressingUpload}
                    className="hidden"
                  />
                  <button
                    id="screen-image-upload-btn"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canManageScreenImages || isCompressingUpload}
                    className="h-9 px-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-purple-400 inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  >
                    {isCompressingUpload ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>{activeSlotValue ? 'Replace Image' : 'Upload Image'}</span>
                  </button>
                  {activeSlotValue && canManageScreenImages && (
                    <button
                      type="button"
                      onClick={handleClearSlotImage}
                      className="h-9 px-2.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Option 2: External Image URL */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-2">
              <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                <span>2. External Image URL (Pinterest / Unsplash / CDN)</span>
              </h5>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="screen-image-url-input"
                  type="url"
                  value={externalUrlInput}
                  onChange={(e) => {
                    setExternalUrlInput(e.target.value);
                    setExternalUrlError(null);
                  }}
                  disabled={!canManageScreenImages}
                  placeholder="https://i.pinimg.com/... or https://images.unsplash.com/..."
                  className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
                <button
                  id="screen-image-apply-url-btn"
                  type="button"
                  onClick={handleApplyExternalUrl}
                  disabled={!canManageScreenImages}
                  className="h-9 px-3.5 rounded-lg btn-primary text-xs font-bold shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Use URL
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                For Pinterest, right-click the photo and select <strong>Copy image address</strong> (<code className="font-mono">i.pinimg.com</code>) so it loads directly.
              </p>
              {externalUrlError && (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{externalUrlError}</p>
              )}
            </div>

            {/* Option 3: Predefined URL-Only Library */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>3. Curated Predefined Library</span>
                </h5>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  Direct External URLs
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {PREDEFINED_SCREEN_IMAGE_LIBRARY.map((item) => {
                  const isChosen = activeSlotValue === item.url;
                  return (
                    <button
                      key={item.id}
                      id={`screen-library-${item.id}`}
                      type="button"
                      disabled={!canManageScreenImages}
                      onClick={() => handleSelectLibraryImage(item.url)}
                      className={`group relative rounded-xl overflow-hidden border text-left transition-all cursor-pointer disabled:opacity-50 ${
                        isChosen
                          ? 'border-purple-500 ring-2 ring-purple-500/35'
                          : 'border-slate-200 dark:border-slate-700 hover:border-purple-400'
                      }`}
                    >
                      <div className="aspect-video w-full bg-slate-900 overflow-hidden">
                        <img
                          src={item.url}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900">
                        <div className="text-[11px] font-bold text-slate-900 dark:text-white truncate flex items-center justify-between gap-1">
                          <span className="truncate">{item.title}</span>
                          {isChosen && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
