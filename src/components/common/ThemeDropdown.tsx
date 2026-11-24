import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Monitor, ChevronDown, Check, Palette, Pipette, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext.tsx';
import { ACCENT_THEME_LIST, buildCustomAccentPalette, type AccentThemeId } from '../../utils/themePalettes.ts';

export interface ThemeDropdownProps {
  id?: string;
  className?: string;
  triggerClassName?: string | ((open: boolean) => string);
  menuClassName?: string;
  dropdownAlign?: 'left' | 'right';
  dropdownDirection?: 'down' | 'up';
  showLabel?: boolean;
  alwaysShowLabel?: boolean;
  fullWidth?: boolean;
  isOpen?: boolean;
  font?: 'courgette' | 'roboto' | 'sans';
  onOpenChange?: (open: boolean) => void;
  onThemeSelect?: (mode: ThemeMode) => void;
  onAccentSelect?: (accent: AccentThemeId) => void;
  onOpenAppearanceSettings?: () => void;
}

/**
 * ThemeDropdown
 * Unified dropdown for appearance preference (Light, Dark, System)
 * and curated brand gradient color themes.
 */
export const ThemeDropdown: React.FC<ThemeDropdownProps> = ({
  id = 'global-theme-dropdown-trigger',
  className = '',
  triggerClassName,
  menuClassName = '',
  dropdownAlign = 'right',
  dropdownDirection = 'down',
  showLabel = true,
  alwaysShowLabel = false,
  fullWidth = false,
  isOpen: controlledIsOpen,
  font,
  onOpenChange,
  onThemeSelect,
  onAccentSelect,
  onOpenAppearanceSettings,
}) => {
  const {
    theme,
    themeMode,
    setThemeMode,
    accentTheme,
    accentPalette,
    customAccentHex,
    setAccentTheme,
    setCustomAccentColor,
  } = useTheme();
  const customPalette = buildCustomAccentPalette(customAccentHex);
  const isCustomSelected = accentTheme === 'custom';
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isCourgette =
    font === 'courgette' ||
    className.includes('font-courgette') ||
    className.includes('font-courgate') ||
    className.includes('theme-dropdown-courgette');
  const courgetteStyle = isCourgette
    ? { fontFamily: "'Courgette', cursive, sans-serif" }
    : undefined;

  const isControlled = typeof controlledIsOpen === 'boolean';
  const open = isControlled ? controlledIsOpen : internalIsOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) {
      setInternalIsOpen(next);
    }
    onOpenChange?.(next);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open, isControlled]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isControlled]);

  const handleSelect = (mode: ThemeMode) => {
    setThemeMode(mode);
    setOpen(false);
    onThemeSelect?.(mode);
  };

  const handleAccentSelect = (nextAccent: AccentThemeId) => {
    setAccentTheme(nextAccent);
    onAccentSelect?.(nextAccent);
  };

  const primaryIconColor =
    theme === 'dark' ? accentPalette.primaryScale[400] : accentPalette.primaryScale[600];

  const renderModeIcon = (mode: ThemeMode, sizeClass: string, isSelected: boolean, forceWhite = false) => {
    const colorStyle = forceWhite
      ? undefined
      : isSelected
      ? { color: primaryIconColor }
      : undefined;

    if (mode === 'light') {
      return (
        <Sun
          className={`${sizeClass} stroke-[2.1] shrink-0 transition-colors`}
          style={colorStyle}
        />
      );
    }
    if (mode === 'dark') {
      return (
        <Moon
          className={`${sizeClass} stroke-[2.1] shrink-0 transition-colors`}
          style={colorStyle}
        />
      );
    }
    return (
      <Monitor
        className={`${sizeClass} stroke-[2.1] shrink-0 transition-colors`}
        style={colorStyle}
      />
    );
  };

  const themeOptions: Array<{ mode: ThemeMode; label: string; hint?: string }> = [
    { mode: 'light', label: 'Light' },
    { mode: 'dark', label: 'Dark' },
    { mode: 'system', label: 'System', hint: theme === 'dark' ? 'Dark' : 'Light' },
  ];

  const isUpward = dropdownDirection === 'up';

  return (
    <div
      ref={dropdownRef}
      style={courgetteStyle}
      className={`relative ${fullWidth ? 'flex w-full' : 'inline-flex'} items-center ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''} ${className}`}
    >
      <button
        id={id}
        type="button"
        onClick={() => setOpen(!open)}
        style={courgetteStyle}
        className={
          triggerClassName
            ? typeof triggerClassName === 'function'
              ? triggerClassName(open)
              : `${triggerClassName} ${open ? 'ring-2 ring-indigo-400/40' : ''}`
            : `h-10 min-w-[40px] sm:min-w-0 sm:h-8.5 flex items-center justify-center sm:justify-start gap-2 px-2.5 sm:px-3 py-1 rounded-lg transition-all duration-200 cursor-pointer border text-xs ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''} ${
                open
                  ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white border-purple-400/50 ring-2 ring-purple-400/50 shadow-md shadow-purple-600/25 dark:shadow-[0_0_16px_rgba(var(--primary-rgb,147,51,234),0.4)]'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 dark:text-purple-200 dark:hover:text-white dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:border-purple-400/40 dark:shadow-[0_0_14px_rgba(var(--primary-rgb,147,51,234),0.2)]'
              }`
        }
        title={`Theme: ${themeMode.charAt(0).toUpperCase() + themeMode.slice(1)} • ${accentPalette.name} (${accentPalette.companionName})`}
        aria-label="Theme selection menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="shrink-0 inline-flex items-center gap-1.5">
          {renderModeIcon(
            themeMode,
            triggerClassName ? 'w-4 h-4' : 'w-4 h-4 sm:w-3.5 sm:h-3.5',
            true,
            open
          )}
          <span
            aria-hidden="true"
            data-testid="theme-primary-dot"
            className={`w-2 h-2 rounded-full shrink-0 ring-1 ${
              open ? 'ring-white/80' : 'ring-black/15 dark:ring-white/30'
            }`}
            style={{ backgroundColor: accentPalette.baseHex }}
          />
        </span>
        {showLabel && (
          <span
            style={courgetteStyle}
            className={`${alwaysShowLabel ? 'inline-block' : 'hidden sm:inline-block'} capitalize ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''} ${
              triggerClassName
                ? ''
                : `text-xs font-semibold ${open ? 'text-white' : 'text-slate-700 dark:text-purple-200'}`
            }`}
          >
            {themeMode}
          </span>
        )}
        <ChevronDown
          className={`${triggerClassName ? 'w-3.5 h-3.5' : 'w-3 h-3'} transition-transform duration-200 ease-out opacity-75 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu (ul) */}
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, scale: 0.95, y: isUpward ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: isUpward ? 6 : -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transformOrigin: `${isUpward ? 'bottom' : 'top'} ${dropdownAlign === 'right' ? 'right' : 'left'}`,
              ...(courgetteStyle || {}),
            }}
            className={`absolute ${
              dropdownAlign === 'right' ? 'right-0 left-auto' : 'left-0 right-auto'
            } ${
              isUpward ? 'bottom-full mb-2' : 'top-full mt-2'
            } ${
              menuClassName || 'w-[min(17.5rem,calc(100vw-2rem))] sm:w-72 max-w-[calc(100vw-2rem)]'
            } max-h-[calc(100dvh-5.5rem)] overflow-y-auto bg-white/95 dark:bg-[var(--brand-dark-surface,#120726)]/95 border border-slate-200/90 dark:border-purple-400/35 rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-[0_14px_34px_rgba(var(--primary-rgb,147,51,234),0.28)] p-2.5 z-50 backdrop-blur-xl list-none space-y-2.5 ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''}`}
            role="menu"
            aria-orientation="vertical"
          >
            {/* Section 1: Three-Theme Segmented Switcher */}
            <li role="none" className="space-y-1.5">
              <div className="px-1 flex items-center justify-between gap-2">
                <span
                  style={courgetteStyle}
                  className={`text-[11px] font-bold text-slate-800 dark:text-purple-100 ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''}`}
                >
                  Appearance
                </span>
                <span
                  style={{
                    ...(courgetteStyle || {}),
                    color: primaryIconColor,
                  }}
                  className={`text-[11px] font-semibold capitalize ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''}`}
                >
                  {themeMode === 'system'
                    ? `System · ${theme === 'dark' ? 'Dark' : 'Light'}`
                    : themeMode}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-white/[0.06] border border-slate-200/70 dark:border-white/10">
                {themeOptions.map((option) => {
                  const isActiveMode = themeMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => handleSelect(option.mode)}
                      style={{
                        ...(courgetteStyle || {}),
                        ...(isActiveMode
                          ? {
                              borderColor: `rgba(${accentPalette.primaryRgb}, 0.45)`,
                            }
                          : undefined),
                      }}
                      className={`min-h-[38px] flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-all cursor-pointer border ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''} ${
                        isActiveMode
                          ? 'bg-white dark:bg-white/[0.12] text-slate-900 dark:text-white font-bold shadow-xs'
                          : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/[0.06] font-medium'
                      }`}
                      role="menuitemradio"
                      aria-checked={isActiveMode}
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        {renderModeIcon(option.mode, 'w-4 h-4', isActiveMode)}
                        {isActiveMode && (
                          <span
                            aria-hidden="true"
                            data-testid="theme-option-primary-dot"
                            className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/15 dark:ring-white/30"
                            style={{ backgroundColor: accentPalette.baseHex }}
                          />
                        )}
                      </span>
                      <span
                        style={courgetteStyle}
                        className={`leading-none ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''}`}
                      >
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </li>

            {/* Section 2: Primary Color Selector */}
            <li
              role="separator"
              className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-1.5"
            >
              <div className="px-1 flex items-center justify-between gap-2">
                <span
                  style={courgetteStyle}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-purple-100 ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''}`}
                >
                  <Palette className="w-3.5 h-3.5 shrink-0" style={{ color: primaryIconColor }} />
                  <span>Primary Color</span>
                </span>
                <span
                  style={{ color: primaryIconColor }}
                  className="text-[11px] font-semibold truncate max-w-[132px]"
                  title={`${accentPalette.name} + ${accentPalette.companionName}`}
                >
                  {accentPalette.name} · {accentPalette.companionName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 max-h-[260px] overflow-y-auto pr-0.5">
                {ACCENT_THEME_LIST.map((palette) => {
                  const isSelected = accentTheme === palette.id;
                  return (
                    <button
                      key={palette.id}
                      id={`theme-color-option-${palette.id}`}
                      type="button"
                      onClick={() => handleAccentSelect(palette.id)}
                      title={`${palette.name} (${palette.baseHex}) + ${palette.companionName}`}
                      role="menuitemradio"
                      aria-checked={isSelected}
                      style={isSelected ? { background: palette.buttonGradient } : undefined}
                      className={`last:odd:col-span-2 w-full flex items-center justify-between gap-2 px-2.5 py-2 sm:py-1.5 rounded-xl text-[11px] transition-all cursor-pointer border ${
                        isSelected
                          ? 'text-white border-white/30 font-bold shadow-sm'
                          : 'bg-slate-50/90 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-slate-200 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          className={`w-4 h-3 rounded-[4px] shrink-0 border shadow-2xs ${
                            isSelected ? 'border-white/70' : 'border-black/10 dark:border-white/20'
                          }`}
                          style={{ background: palette.buttonGradient }}
                        />
                        <span style={courgetteStyle} className="truncate">
                          {palette.name}
                        </span>
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[2.75] shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Custom Primary Color Picker */}
              <div
                id="theme-color-option-custom"
                style={
                  isCustomSelected
                    ? { background: customPalette.buttonGradient, color: '#FFFFFF' }
                    : undefined
                }
                className={`relative w-full flex items-center justify-between gap-2 px-2.5 py-2 sm:py-1.5 rounded-xl text-[11px] transition-all border ${
                  isCustomSelected
                    ? 'text-white border-white/30 font-bold shadow-sm'
                    : 'bg-slate-50/90 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-slate-200 font-medium'
                }`}
              >
                <input
                  id="theme-custom-color-input"
                  type="color"
                  value={customPalette.baseHex}
                  onChange={(e) => {
                    setCustomAccentColor(e.target.value);
                    onAccentSelect?.('custom');
                  }}
                  aria-label="Pick custom primary color"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <span className="flex items-center gap-2 min-w-0 pointer-events-none">
                  <span
                    aria-hidden="true"
                    className={`w-4 h-3 rounded-[4px] shrink-0 border shadow-2xs ${
                      isCustomSelected ? 'border-white/70' : 'border-black/10 dark:border-white/20'
                    }`}
                    style={{ background: customPalette.buttonGradient }}
                  />
                  <Pipette className="w-3 h-3 shrink-0 opacity-80" />
                  <span style={courgetteStyle} className="truncate">
                    Custom Color
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0 pointer-events-none">
                  <span
                    className={`font-mono text-[10px] uppercase ${
                      isCustomSelected ? 'opacity-90' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {customPalette.baseHex}
                  </span>
                  {isCustomSelected && <Check className="w-3.5 h-3.5 stroke-[2.75] shrink-0" />}
                </span>
              </div>
            </li>

            {onOpenAppearanceSettings && (
              <li
                role="none"
                className="pt-2 border-t border-slate-200/80 dark:border-white/10"
              >
                <button
                  id="theme-advanced-appearance-link"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onOpenAppearanceSettings();
                  }}
                  style={courgetteStyle}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 sm:py-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer bg-slate-50/90 hover:bg-slate-100 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] border border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-purple-100 group ${isCourgette ? 'font-courgette font-courgate theme-dropdown-courgette' : ''}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <SlidersHorizontal
                      className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110"
                      style={{ color: primaryIconColor }}
                    />
                    <span className="truncate">Advanced Appearance</span>
                  </span>
                  <ArrowRight
                    className="w-3.5 h-3.5 shrink-0 opacity-70 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
                    style={{ color: primaryIconColor }}
                  />
                </button>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
};
