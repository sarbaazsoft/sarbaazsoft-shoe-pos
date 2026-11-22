import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Contrast,
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
  Shield,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext.tsx';
import {
  ACCENT_THEME_LIST,
  CURATED_APPEARANCE_PALETTES,
  getWcagContrastRatio,
  isValidHexColor,
  normalizeBackdropDarkness,
  normalizeHexColor,
  resolveAccentPalette,
  type BackdropStyle,
  type PresetAccentThemeId,
} from '../../utils/themePalettes.ts';
import {
  PREDEFINED_SCREEN_IMAGE_LIBRARY,
  UNIFIED_BACKDROP_META,
  compressUploadedImageFile,
  doesLibraryImageMatchTheme,
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
    backdropStyle,
    backdropDarkness,
    isAuthenticatedSession,
    isPreviewActive,
    hasUnsavedImagePreview,
    isSavingAppearance,
    appearanceSaveError,
    clearAppearanceSaveError,
    updatePreview,
    cancelPreview,
    applyAndSaveAppearance,
    applyAndSaveToAllStaff,
    resetAppearanceToDefault,
    effectiveBackdropImage,
    updateBackdropImagePreview,
  } = useTheme();

  const userRole = String(currentUser?.role || '').toUpperCase();
  const canManageScreenImages = userRole === 'SUPERADMIN' || userRole === 'ADMIN';
  const canApplyToAllStaff = userRole === 'SUPERADMIN' || userRole === 'ADMIN';

  const [hexDraft, setHexDraft] = useState<string>(customAccentHex);
  const [hexError, setHexError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [localErrorMsg, setLocalErrorMsg] = useState<string | null>(null);
  const [isApplyingToAllStaff, setIsApplyingToAllStaff] = useState<boolean>(false);

  // Unified backdrop image local controls (Admin / SuperAdmin only)
  const [externalUrlInput, setExternalUrlInput] = useState<string>('');
  const [externalUrlError, setExternalUrlError] = useState<string | null>(null);
  const [previewImgLoadFailed, setPreviewImgLoadFailed] = useState<boolean>(false);
  const [isCompressingUpload, setIsCompressingUpload] = useState<boolean>(false);
  const [libraryColorFilter, setLibraryColorFilter] = useState<'all' | 'active' | PresetAccentThemeId>('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync hex text field when effective customAccentHex changes externally
  useEffect(() => {
    setHexDraft(customAccentHex);
    setHexError(null);
  }, [customAccentHex]);

  // Keep URL input synced to unified backdrop image (only when URL is non-data URI)
  useEffect(() => {
    setPreviewImgLoadFailed(false);
    setExternalUrlError(null);
    if (effectiveBackdropImage && !effectiveBackdropImage.startsWith('data:')) {
      setExternalUrlInput(effectiveBackdropImage);
    } else {
      setExternalUrlInput('');
    }
  }, [effectiveBackdropImage]);

  const handleModePreview = (mode: ThemeMode) => {
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    updatePreview({ themeMode: mode });
  };

  const handleBackdropStylePreview = (style: BackdropStyle) => {
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    updatePreview({ backdropStyle: style });
  };

  const handleBackdropDarknessPreview = (darkness: number) => {
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    clearAppearanceSaveError();
    updatePreview({
      backdropDarkness: normalizeBackdropDarkness(darkness),
    });
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

  const handleApplyToAllStaff = async () => {
    if (!canApplyToAllStaff) return;
    if (hexError) {
      setLocalErrorMsg('Fix the invalid HEX color before applying to staff.');
      return;
    }
    setIsApplyingToAllStaff(true);
    setLocalErrorMsg(null);
    setSaveSuccessMsg(null);
    clearAppearanceSaveError();
    try {
      const result = await applyAndSaveToAllStaff({ canSaveScreenImages: canManageScreenImages });
      setSaveSuccessMsg(
        result?.message || 'Theme & color preferences applied to all store staff accounts.'
      );
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (err: any) {
      setLocalErrorMsg(err?.message || 'Failed to apply settings to staff.');
    } finally {
      setIsApplyingToAllStaff(false);
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
      updateBackdropImagePreview(dataUrl);
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
    updateBackdropImagePreview(result.url);
  };

  const handleSelectLibraryImage = (url: string) => {
    if (!canManageScreenImages) return;
    setExternalUrlError(null);
    setPreviewImgLoadFailed(false);
    setSaveSuccessMsg(null);
    setLocalErrorMsg(null);
    updateBackdropImagePreview(url);
  };

  const handleClearBackdropImage = () => {
    if (!canManageScreenImages) return;
    setExternalUrlError(null);
    setPreviewImgLoadFailed(false);
    setSaveSuccessMsg(null);
    setExternalUrlInput('');
    updateBackdropImagePreview('');
  };

  const contrastRatio = getWcagContrastRatio(accentPalette.primaryScale[600], accentPalette.contrastText);
  const contrastBadge = contrastRatio >= 7 ? 'AAA' : contrastRatio >= 4.5 ? 'AA' : 'Large AA';
  const resolvedPreviewImg =
    effectiveBackdropImage && !previewImgLoadFailed ? effectiveBackdropImage : defaultShowroomBg;

  const isCustomOrCuratedActive = accentTheme === 'custom';
  const activeHexUpper = normalizeHexColor(accentPalette.baseHex);

  const activeThemeMatchingLibrary = PREDEFINED_SCREEN_IMAGE_LIBRARY.filter((item) =>
    doesLibraryImageMatchTheme(item, accentTheme, customAccentHex)
  );
  const filteredLibraryImages = (() => {
    if (libraryColorFilter === 'active') {
      return activeThemeMatchingLibrary.length > 0 ? activeThemeMatchingLibrary : PREDEFINED_SCREEN_IMAGE_LIBRARY;
    }
    if (libraryColorFilter !== 'all') {
      return PREDEFINED_SCREEN_IMAGE_LIBRARY.filter((item) =>
        item.matchedPresets.includes(libraryColorFilter)
      );
    }
    // In 'all' view, keep active color-matched backdrops right at the top for quick pairing
    if (activeThemeMatchingLibrary.length === 0) return PREDEFINED_SCREEN_IMAGE_LIBRARY;
    const matchedIds = new Set(activeThemeMatchingLibrary.map((i) => i.id));
    return [
      ...activeThemeMatchingLibrary,
      ...PREDEFINED_SCREEN_IMAGE_LIBRARY.filter((item) => !matchedIds.has(item.id)),
    ];
  })();

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
                : canManageScreenImages
                ? 'Customize Light/Dark/System mode, sidebar backdrop style (fixed 50% showroom or solid), auth/loading backdrop opacity, and brand palettes.'
                : 'Customize Light/Dark/System mode, sidebar showroom/solid backdrop, auth/loading backdrop opacity, and brand palettes.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
          <button
            id="appearance-reset-default-btn"
            type="button"
            onClick={handleResetDefault}
            disabled={isSavingAppearance || isApplyingToAllStaff}
            className="w-full sm:w-auto justify-center min-h-[40px] px-3 sm:px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>Reset Default</span>
          </button>

          {isPreviewActive && (
            <button
              id="appearance-cancel-preview-btn"
              type="button"
              onClick={handleCancel}
              disabled={isSavingAppearance || isApplyingToAllStaff}
              className="w-full sm:w-auto justify-center min-h-[40px] px-3 sm:px-3.5 rounded-xl border border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5 shrink-0" />
              <span>Cancel Preview</span>
            </button>
          )}

          {canApplyToAllStaff && (
            <button
              id="appearance-apply-all-staff-btn"
              type="button"
              onClick={handleApplyToAllStaff}
              disabled={isSavingAppearance || isApplyingToAllStaff || Boolean(hexError)}
              title="Overwrite all store staff color and theme preferences with your active selection"
              aria-label="Apply theme and color settings to all staff"
              className="w-full sm:w-auto justify-center min-h-[40px] px-3 sm:px-3.5 rounded-xl border border-purple-300 dark:border-purple-700/70 bg-purple-50/90 dark:bg-purple-950/40 text-purple-700 dark:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-900/55 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer disabled:opacity-45"
            >
              {isApplyingToAllStaff ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Users className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{isApplyingToAllStaff ? 'Applying...' : 'Apply to Staff'}</span>
            </button>
          )}

          <button
            id="appearance-apply-save-btn"
            type="button"
            onClick={handleApplyAndSave}
            disabled={!isPreviewActive || isSavingAppearance || isApplyingToAllStaff || Boolean(hexError)}
            className={`btn-primary w-full sm:w-auto justify-center min-h-[40px] px-4 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-45 ${
              (canApplyToAllStaff && !isPreviewActive) || (!canApplyToAllStaff && isPreviewActive)
                ? 'col-span-2 sm:col-span-1'
                : ''
            }`}
          >
            {isSavingAppearance && !isApplyingToAllStaff ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Save className="w-4 h-4 shrink-0" />
            )}
            <span>{isSavingAppearance && !isApplyingToAllStaff ? 'Saving...' : 'Apply & Save'}</span>
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

          {/* Sidebar Backdrop Style (Available to Owner, Cashier & SuperAdmin — Fixed 50% Showroom vs Solid, No Slider) */}
          <div id="appearance-backdrop-style-section" className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Sidebar Backdrop Style</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Applies exclusively to the navigation sidebar: fixed 50% balanced showroom opacity or solid color (White in Light · Dark in Dark).
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {backdropStyle === 'solid'
                  ? `Sidebar: Solid · ${theme === 'dark' ? '#0A0E1A' : 'White'}`
                  : 'Sidebar: Showroom · 50%'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                id="appearance-backdrop-solid"
                type="button"
                onClick={() => handleBackdropStylePreview('solid')}
                aria-pressed={backdropStyle === 'solid'}
                className={`min-h-[68px] p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                  backdropStyle === 'solid'
                    ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 ring-2 ring-purple-500/25 shadow-xs'
                    : 'border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 hover:border-purple-400/60'
                }`}
              >
                <div
                  className={`w-11 h-11 rounded-lg border shrink-0 flex items-center justify-center ${
                    theme === 'dark'
                      ? 'bg-[#0A0E1A] border-slate-700 text-slate-300'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <Contrast className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Solid Sidebar
                    </span>
                    {backdropStyle === 'solid' && (
                      <span className="w-4 h-4 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    Default · White in Light · Dark in Dark
                  </div>
                </div>
              </button>

              <button
                id="appearance-backdrop-showroom"
                type="button"
                onClick={() => handleBackdropStylePreview('showroom')}
                aria-pressed={backdropStyle === 'showroom'}
                className={`min-h-[68px] p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                  backdropStyle === 'showroom'
                    ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 ring-2 ring-purple-500/25 shadow-xs'
                    : 'border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 hover:border-purple-400/60'
                }`}
              >
                <div className="relative w-11 h-11 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 bg-[#080A2A] shrink-0">
                  <img
                    src={resolvedPreviewImg}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover opacity-85"
                  />
                  <div className="absolute inset-0 bg-[#080A2A]/50" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Showroom Sidebar
                    </span>
                    {backdropStyle === 'showroom' && (
                      <span className="w-4 h-4 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    Balanced 50% opacity (unchangeable)
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Auth, Login & Loading Routes Backdrop Opacity Slider (Exclusively for non-sidebar routes) */}
          <div id="appearance-route-backdrop-opacity-section" className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Auth, Loading &amp; Portal Backdrop Opacity</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Adjust showroom backdrop darkness/opacity on Login, Auth, Loading, and portal screens. Sidebars remain locked at 50%.
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Routes: {backdropDarkness}%
              </span>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-900/50 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="appearance-backdrop-darkness-slider"
                  className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span>Auth &amp; Loading Backdrop Darkness</span>
                </label>
                <div className="flex items-center gap-1.5">
                  {[
                    { label: 'Bright', value: 20 },
                    { label: 'Balanced', value: 55 },
                    { label: 'Deep', value: 85 },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => handleBackdropDarknessPreview(preset.value)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                        backdropDarkness === preset.value
                          ? 'border-purple-500 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <span
                    id="appearance-backdrop-darkness-value"
                    className="min-w-[44px] text-center text-[11px] font-mono font-bold tabular-nums px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    {backdropDarkness}%
                  </span>
                </div>
              </div>

              <input
                id="appearance-backdrop-darkness-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={backdropDarkness}
                onChange={(e) => handleBackdropDarknessPreview(Number(e.target.value))}
                aria-label="Auth and loading route backdrop darkness percentage"
                className="w-full h-2 rounded-lg accent-purple-600 cursor-pointer"
              />

              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>0% (Vivid Photo)</span>
                <span>55% (Default)</span>
                <span>100% (Ultra Dark)</span>
              </div>
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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

      {/* SECTION 2: UNIFIED ROUTE & SCREEN BACKDROP IMAGE (Admin / SuperAdmin only — hidden for Cashiers) */}
      {canManageScreenImages && (
        <div
          id="unified-backdrop-settings-card"
          className="bg-white dark:bg-[#131B2E] p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/20 border border-purple-100 dark:border-purple-400/30 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                  {UNIFIED_BACKDROP_META.label}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {UNIFIED_BACKDROP_META.description}
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/60 text-purple-700 dark:text-purple-200 text-[11px] font-semibold shrink-0">
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>{effectiveBackdropImage ? 'Custom Portal & Sidebar Backdrop' : 'Default Showroom Backdrop'}</span>
            </span>
          </div>

          {/* Live Unified Backdrop Preview + 3 Input Methods */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Preview Frame */}
            <div className="lg:col-span-5 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                <span>Preview: Auth, Login &amp; Loading Routes</span>
                {effectiveBackdropImage && (
                  <button
                    id="screen-image-restore-default-btn"
                    type="button"
                    onClick={handleClearBackdropImage}
                    className="text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Restore Default</span>
                  </button>
                )}
              </div>

              <div className="relative aspect-video w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-[#080A2A] shadow-md">
                <img
                  src={resolvedPreviewImg}
                  alt="Unified screen backdrop preview"
                  referrerPolicy="no-referrer"
                  onLoad={() => setPreviewImgLoadFailed(false)}
                  onError={() => {
                    if (effectiveBackdropImage) setPreviewImgLoadFailed(true);
                  }}
                  className="w-full h-full object-cover object-center opacity-75 dark:opacity-70"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-r from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55"
                  style={{ opacity: Math.min(1, backdropDarkness / 55) }}
                />
                {backdropDarkness > 55 && (
                  <div
                    className="absolute inset-0 bg-[#040618]"
                    style={{ opacity: Number((((backdropDarkness - 55) / 45) * 0.88).toFixed(3)) }}
                  />
                )}
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(var(--primary-rgb,147,51,234),0.14),transparent_60%)] opacity-60" />
                {/* Simulated Portal Card Overlay to inspect readability */}
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div className="w-48 rounded-xl bg-white/95 dark:bg-[#131B2E]/95 border border-white/60 dark:border-purple-700/60 shadow-lg p-3 text-center backdrop-blur-md">
                    <div
                      className="h-1.5 w-14 mx-auto rounded-full mb-2"
                      style={{ background: accentPalette.buttonGradient }}
                    />
                    <div className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                      Login, Auth &amp; Loading
                    </div>
                    <div
                      className="mt-2 h-6 rounded-md text-[10px] font-bold flex items-center justify-center"
                      style={{ background: accentPalette.buttonGradient, color: accentPalette.contrastText }}
                    >
                      Continue
                    </div>
                  </div>
                </div>
              </div>

              {previewImgLoadFailed && effectiveBackdropImage && (
                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                  Could not load that image URL directly in the browser (the fallback image is shown above). Verify the direct image address or try another host.
                </p>
              )}
              {hasUnsavedImagePreview && (
                <p className="text-xs text-purple-600 dark:text-purple-300 font-semibold">
                  Unsaved backdrop image change queued — click &ldquo;Apply &amp; Save&rdquo; above to publish to all screens.
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
                      JPG, PNG, WEBP, or GIF — automatically optimized for fast loading across all routes.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      id="screen-image-file-input"
                      type="file"
                      accept="image/*"
                      onChange={handleUploadFile}
                      disabled={isCompressingUpload}
                      className="hidden"
                    />
                    <button
                      id="screen-image-upload-btn"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isCompressingUpload}
                      className="h-9 px-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-purple-400 inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                    >
                      {isCompressingUpload ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>{effectiveBackdropImage ? 'Replace Image' : 'Upload Image'}</span>
                    </button>
                    {effectiveBackdropImage && (
                      <button
                        type="button"
                        onClick={handleClearBackdropImage}
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
                    placeholder="https://i.pinimg.com/... or https://images.unsplash.com/..."
                    className="flex-1 h-9 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    id="screen-image-apply-url-btn"
                    type="button"
                    onClick={handleApplyExternalUrl}
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

              {/* Option 3: Predefined URL-Only Shoe Store Library (Scrollable + Color-Matched) */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span>3. Curated Predefined Backdrop Library</span>
                  </h5>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {filteredLibraryImages.length} / {PREDEFINED_SCREEN_IMAGE_LIBRARY.length} Backdrops • Scrollable
                  </span>
                </div>

                {/* Preset Color Filter Bar */}
                <div
                  id="screen-library-color-filters"
                  className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
                >
                  <button
                    type="button"
                    onClick={() => setLibraryColorFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border whitespace-nowrap transition cursor-pointer shrink-0 ${
                      libraryColorFilter === 'all'
                        ? 'border-purple-500 bg-purple-100/80 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                    }`}
                  >
                    All ({PREDEFINED_SCREEN_IMAGE_LIBRARY.length})
                  </button>

                  {activeThemeMatchingLibrary.length > 0 && (
                    <button
                      id="screen-library-filter-active"
                      type="button"
                      onClick={() => setLibraryColorFilter('active')}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border whitespace-nowrap inline-flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                        libraryColorFilter === 'active'
                          ? 'border-purple-500 bg-purple-100/80 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/15"
                        style={{ backgroundColor: accentPalette.baseHex }}
                      />
                      <span>Matches Active ({activeThemeMatchingLibrary.length})</span>
                    </button>
                  )}

                  {ACCENT_THEME_LIST.map((preset) => {
                    const isSelectedFilter = libraryColorFilter === preset.id;
                    return (
                      <button
                        key={preset.id}
                        id={`screen-library-filter-${preset.id}`}
                        type="button"
                        onClick={() => setLibraryColorFilter(preset.id as PresetAccentThemeId)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border whitespace-nowrap inline-flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                          isSelectedFilter
                            ? 'border-purple-500 bg-purple-100/80 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/15"
                          style={{ backgroundColor: preset.baseHex }}
                        />
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div
                  id="screen-library-scroll-container"
                  className="max-h-[320px] sm:max-h-[360px] overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 gap-2.5"
                >
                  {filteredLibraryImages.map((item) => {
                    const isChosen = effectiveBackdropImage === item.url;
                    const matchesCurrentTheme = doesLibraryImageMatchTheme(
                      item,
                      accentTheme,
                      customAccentHex
                    );
                    return (
                      <button
                        key={item.id}
                        id={`screen-library-${item.id}`}
                        type="button"
                        onClick={() => handleSelectLibraryImage(item.url)}
                        className={`group relative rounded-xl overflow-hidden border text-left transition-all cursor-pointer shrink-0 ${
                          isChosen
                            ? 'border-purple-500 ring-2 ring-purple-500/40'
                            : matchesCurrentTheme
                            ? 'border-purple-400/80 dark:border-purple-500/70'
                            : 'border-slate-200 dark:border-slate-700 hover:border-purple-400'
                        }`}
                      >
                        <div className="relative aspect-video w-full bg-slate-900 overflow-hidden">
                          <img
                            src={item.url}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[9px] font-semibold text-white inline-flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 border border-white/40"
                              style={{ backgroundColor: item.colorHex }}
                            />
                            <span>{item.colorTag}</span>
                          </span>
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur-xs text-[9px] font-semibold text-white">
                            {item.source}
                          </span>
                          {matchesCurrentTheme && (
                            <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-purple-600/90 text-[8px] font-bold uppercase tracking-wider text-white">
                              Theme Match
                            </span>
                          )}
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
      )}
    </div>
  );
};
