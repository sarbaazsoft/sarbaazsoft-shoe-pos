export type AccentThemeId =
  | 'purple'
  | 'red'
  | 'orange'
  | 'emerald'
  | 'cyan'
  | 'teal'
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'fuchsia'
  | 'stone';

export type ShadeScale = {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
};

export interface AccentThemePalette {
  id: AccentThemeId;
  name: string;
  companionName: string;
  baseHex: string;
  companionHex: string;
  primaryRgb: string;
  companionRgb: string;
  darkSurfaceBg: string;
  primaryScale: ShadeScale;
  companionScale: ShadeScale;
  buttonGradient: string;
  buttonGradientHover: string;
  buttonGradientDark: string;
  buttonGradientDarkHover: string;
  cardHeaderGradientDark: string;
  cardHeaderGradientLight: string;
  cardFooterGradientDark: string;
  cardFooterGradientLight: string;
}

function buildPalette(config: {
  id: AccentThemeId;
  name: string;
  companionName: string;
  baseHex: string;
  companionHex: string;
  primaryRgb: string;
  companionRgb: string;
  darkSurfaceBg: string;
  primaryScale: ShadeScale;
  companionScale: ShadeScale;
}): AccentThemePalette {
  const { primaryScale: p, companionScale: c } = config;
  return {
    ...config,
    buttonGradient: `linear-gradient(135deg, ${p[600]} 0%, ${c[600]} 50%, ${p[700]} 100%)`,
    buttonGradientHover: `linear-gradient(135deg, ${p[700]} 0%, ${c[700]} 50%, ${p[800]} 100%)`,
    buttonGradientDark: `linear-gradient(135deg, ${p[600]} 0%, ${c[600]} 100%)`,
    buttonGradientDarkHover: `linear-gradient(135deg, ${p[500]} 0%, ${c[500]} 100%)`,
    cardHeaderGradientDark: `linear-gradient(to right, ${p[900]}, ${c[950]}, #0F172A)`,
    cardHeaderGradientLight: `linear-gradient(to right, ${p[50]}, ${c[50]}, #F8FAFC)`,
    cardFooterGradientDark: `linear-gradient(to right, ${p[950]}, ${c[950]}, #090E1A)`,
    cardFooterGradientLight: `linear-gradient(to right, #F8FAFC, ${p[50]}, ${c[50]})`,
  };
}

export const ACCENT_THEME_PALETTES: Record<AccentThemeId, AccentThemePalette> = {
  purple: buildPalette({
    id: 'purple',
    name: 'Purple',
    companionName: 'Indigo',
    baseHex: '#9333EA',
    companionHex: '#4F46E5',
    primaryRgb: '147, 51, 234',
    companionRgb: '79, 70, 229',
    darkSurfaceBg: '#120726',
    primaryScale: {
      50: '#FAF5FF',
      100: '#F3E8FF',
      200: '#E9D5FF',
      300: '#D8B4FE',
      400: '#C084FC',
      500: '#A855F7',
      600: '#9333EA',
      700: '#7E22CE',
      800: '#6B21A8',
      900: '#581C87',
      950: '#3B0764',
    },
    companionScale: {
      50: '#EEF2FF',
      100: '#E0E7FF',
      200: '#C7D2FE',
      300: '#A5B4FC',
      400: '#818CF8',
      500: '#6366F1',
      600: '#4F46E5',
      700: '#4338CA',
      800: '#3730A3',
      900: '#312E81',
      950: '#1E1B4B',
    },
  }),
  red: buildPalette({
    id: 'red',
    name: 'Red',
    companionName: 'Crimson Rose',
    baseHex: '#F44336',
    companionHex: '#E11D48',
    primaryRgb: '244, 67, 54',
    companionRgb: '225, 29, 72',
    darkSurfaceBg: '#1D0B0E',
    primaryScale: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      200: '#FECACA',
      300: '#FCA5A5',
      400: '#F87171',
      500: '#F44336',
      600: '#DC2626',
      700: '#B91C1C',
      800: '#991B1B',
      900: '#7F1D1D',
      950: '#450A0A',
    },
    companionScale: {
      50: '#FFF1F2',
      100: '#FFE4E6',
      200: '#FECDD3',
      300: '#FDA4AF',
      400: '#FB7185',
      500: '#F43F5E',
      600: '#E11D48',
      700: '#BE123C',
      800: '#9F1239',
      900: '#881337',
      950: '#4C0519',
    },
  }),
  orange: buildPalette({
    id: 'orange',
    name: 'Orange',
    companionName: 'Warm Amber',
    baseHex: '#F97316',
    companionHex: '#D97706',
    primaryRgb: '249, 115, 22',
    companionRgb: '217, 119, 6',
    darkSurfaceBg: '#1C1007',
    primaryScale: {
      50: '#FFF7ED',
      100: '#FFEDD5',
      200: '#FED7AA',
      300: '#FDBA74',
      400: '#FB923C',
      500: '#F97316',
      600: '#EA580C',
      700: '#C2410C',
      800: '#9A3412',
      900: '#7C2D12',
      950: '#431407',
    },
    companionScale: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      200: '#FDE68A',
      300: '#FCD34D',
      400: '#FBBF24',
      500: '#F59E0B',
      600: '#D97706',
      700: '#B45309',
      800: '#92400E',
      900: '#78350F',
      950: '#451A03',
    },
  }),
  emerald: buildPalette({
    id: 'emerald',
    name: 'Emerald',
    companionName: 'Deep Teal',
    baseHex: '#10B981',
    companionHex: '#0D9488',
    primaryRgb: '16, 185, 129',
    companionRgb: '13, 148, 136',
    darkSurfaceBg: '#061A14',
    primaryScale: {
      50: '#ECFDF5',
      100: '#D1FAE5',
      200: '#A7F3D0',
      300: '#6EE7B7',
      400: '#34D399',
      500: '#10B981',
      600: '#059669',
      700: '#047857',
      800: '#065F46',
      900: '#064E3B',
      950: '#022C22',
    },
    companionScale: {
      50: '#F0FDFA',
      100: '#CCFBF1',
      200: '#99F6E4',
      300: '#5EEAD4',
      400: '#2DD4BF',
      500: '#14B8A6',
      600: '#0D9488',
      700: '#0F766E',
      800: '#115E59',
      900: '#134E4A',
      950: '#042F2E',
    },
  }),
  cyan: buildPalette({
    id: 'cyan',
    name: 'Cyan',
    companionName: 'Electric Sky',
    baseHex: '#06B6D4',
    companionHex: '#0284C7',
    primaryRgb: '6, 182, 212',
    companionRgb: '2, 132, 199',
    darkSurfaceBg: '#061822',
    primaryScale: {
      50: '#ECFEFF',
      100: '#CFFAFE',
      200: '#A5F3FC',
      300: '#67E8F9',
      400: '#22D3EE',
      500: '#06B6D4',
      600: '#0891B2',
      700: '#0E7490',
      800: '#155E75',
      900: '#164E63',
      950: '#083344',
    },
    companionScale: {
      50: '#F0F9FF',
      100: '#E0F2FE',
      200: '#BAE6FD',
      300: '#7DD3FC',
      400: '#38BDF8',
      500: '#0EA5E9',
      600: '#0284C7',
      700: '#0369A1',
      800: '#075985',
      900: '#0C4A6E',
      950: '#082F49',
    },
  }),
  teal: buildPalette({
    id: 'teal',
    name: 'Teal',
    companionName: 'Ocean Cyan',
    baseHex: '#14B8A6',
    companionHex: '#0891B2',
    primaryRgb: '20, 184, 166',
    companionRgb: '8, 145, 178',
    darkSurfaceBg: '#061B1A',
    primaryScale: {
      50: '#F0FDFA',
      100: '#CCFBF1',
      200: '#99F6E4',
      300: '#5EEAD4',
      400: '#2DD4BF',
      500: '#14B8A6',
      600: '#0D9488',
      700: '#0F766E',
      800: '#115E59',
      900: '#134E4A',
      950: '#042F2E',
    },
    companionScale: {
      50: '#ECFEFF',
      100: '#CFFAFE',
      200: '#A5F3FC',
      300: '#67E8F9',
      400: '#22D3EE',
      500: '#06B6D4',
      600: '#0891B2',
      700: '#0E7490',
      800: '#155E75',
      900: '#164E63',
      950: '#083344',
    },
  }),
  indigo: buildPalette({
    id: 'indigo',
    name: 'Indigo',
    companionName: 'Royal Blue',
    baseHex: '#6366F1',
    companionHex: '#2563EB',
    primaryRgb: '99, 102, 241',
    companionRgb: '37, 99, 235',
    darkSurfaceBg: '#0D1128',
    primaryScale: {
      50: '#EEF2FF',
      100: '#E0E7FF',
      200: '#C7D2FE',
      300: '#A5B4FC',
      400: '#818CF8',
      500: '#6366F1',
      600: '#4F46E5',
      700: '#4338CA',
      800: '#3730A3',
      900: '#312E81',
      950: '#1E1B4B',
    },
    companionScale: {
      50: '#EFF6FF',
      100: '#DBEAFE',
      200: '#BFDBFE',
      300: '#93C5FD',
      400: '#60A5FA',
      500: '#3B82F6',
      600: '#2563EB',
      700: '#1D4ED8',
      800: '#1E40AF',
      900: '#1E3A8A',
      950: '#172554',
    },
  }),
  violet: buildPalette({
    id: 'violet',
    name: 'Violet',
    companionName: 'Deep Indigo',
    baseHex: '#8B5CF6',
    companionHex: '#4F46E5',
    primaryRgb: '139, 92, 246',
    companionRgb: '79, 70, 229',
    darkSurfaceBg: '#120B2B',
    primaryScale: {
      50: '#F5F3FF',
      100: '#EDE9FE',
      200: '#DDD6FE',
      300: '#C4B5FD',
      400: '#A78BFA',
      500: '#8B5CF6',
      600: '#7C3AED',
      700: '#6D28D9',
      800: '#5B21B6',
      900: '#4C1D95',
      950: '#2E1065',
    },
    companionScale: {
      50: '#EEF2FF',
      100: '#E0E7FF',
      200: '#C7D2FE',
      300: '#A5B4FC',
      400: '#818CF8',
      500: '#6366F1',
      600: '#4F46E5',
      700: '#4338CA',
      800: '#3730A3',
      900: '#312E81',
      950: '#1E1B4B',
    },
  }),
  pink: buildPalette({
    id: 'pink',
    name: 'Pink',
    companionName: 'Ruby Rose',
    baseHex: '#EC4899',
    companionHex: '#E11D48',
    primaryRgb: '236, 72, 153',
    companionRgb: '225, 29, 72',
    darkSurfaceBg: '#1F0817',
    primaryScale: {
      50: '#FDF2F8',
      100: '#FCE7F3',
      200: '#FBCFE8',
      300: '#F9A8D4',
      400: '#F472B6',
      500: '#EC4899',
      600: '#DB2777',
      700: '#BE185D',
      800: '#9D174D',
      900: '#831843',
      950: '#500724',
    },
    companionScale: {
      50: '#FFF1F2',
      100: '#FFE4E6',
      200: '#FECDD3',
      300: '#FDA4AF',
      400: '#FB7185',
      500: '#F43F5E',
      600: '#E11D48',
      700: '#BE123C',
      800: '#9F1239',
      900: '#881337',
      950: '#4C0519',
    },
  }),
  fuchsia: buildPalette({
    id: 'fuchsia',
    name: 'Fuchsia',
    companionName: 'Royal Purple',
    baseHex: '#D946EF',
    companionHex: '#9333EA',
    primaryRgb: '217, 70, 239',
    companionRgb: '147, 51, 234',
    darkSurfaceBg: '#1B0722',
    primaryScale: {
      50: '#FDF4FF',
      100: '#FAE8FF',
      200: '#F5D0FE',
      300: '#F0ABFC',
      400: '#E879F9',
      500: '#D946EF',
      600: '#C026D3',
      700: '#A21CAF',
      800: '#86198F',
      900: '#701A75',
      950: '#4A044E',
    },
    companionScale: {
      50: '#FAF5FF',
      100: '#F3E8FF',
      200: '#E9D5FF',
      300: '#D8B4FE',
      400: '#C084FC',
      500: '#A855F7',
      600: '#9333EA',
      700: '#7E22CE',
      800: '#6B21A8',
      900: '#581C87',
      950: '#3B0764',
    },
  }),
  stone: buildPalette({
    id: 'stone',
    name: 'Stone',
    companionName: 'Slate Steel',
    baseHex: '#78716C',
    companionHex: '#475569',
    primaryRgb: '120, 113, 108',
    companionRgb: '71, 85, 105',
    darkSurfaceBg: '#141211',
    primaryScale: {
      50: '#FAFAF9',
      100: '#F5F5F4',
      200: '#E7E5E4',
      300: '#D6D3D1',
      400: '#A8A29E',
      500: '#78716C',
      600: '#57534E',
      700: '#44403C',
      800: '#292524',
      900: '#1C1917',
      950: '#0C0A09',
    },
    companionScale: {
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
      950: '#020617',
    },
  }),
};

export const ACCENT_THEME_LIST: AccentThemePalette[] = [
  ACCENT_THEME_PALETTES.purple,
  ACCENT_THEME_PALETTES.red,
  ACCENT_THEME_PALETTES.orange,
  ACCENT_THEME_PALETTES.emerald,
  ACCENT_THEME_PALETTES.cyan,
  ACCENT_THEME_PALETTES.teal,
  ACCENT_THEME_PALETTES.indigo,
  ACCENT_THEME_PALETTES.violet,
  ACCENT_THEME_PALETTES.pink,
  ACCENT_THEME_PALETTES.fuchsia,
  ACCENT_THEME_PALETTES.stone,
];

export const THEME_MODE_STORAGE_KEY = 'pos_theme';
export const ACCENT_THEME_STORAGE_KEY = 'pos_accent_theme';
export const DEFAULT_ACCENT_THEME: AccentThemeId = 'purple';

export function isValidAccentTheme(value: unknown): value is AccentThemeId {
  return typeof value === 'string' && value in ACCENT_THEME_PALETTES;
}

export function resolveAccentPalette(accentId?: string | null): AccentThemePalette {
  if (isValidAccentTheme(accentId)) {
    return ACCENT_THEME_PALETTES[accentId];
  }
  return ACCENT_THEME_PALETTES[DEFAULT_ACCENT_THEME];
}

export function getStoredAccentThemeOrNull(): AccentThemeId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage?.getItem(ACCENT_THEME_STORAGE_KEY);
    return isValidAccentTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getStoredAccentTheme(): AccentThemeId {
  return getStoredAccentThemeOrNull() ?? DEFAULT_ACCENT_THEME;
}

export function persistAccentTheme(accentId: AccentThemeId): AccentThemeId {
  const valid = isValidAccentTheme(accentId) ? accentId : DEFAULT_ACCENT_THEME;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(ACCENT_THEME_STORAGE_KEY, valid);
    } catch {
      // ignore storage quota or restricted context errors
    }
  }
  return valid;
}

/**
 * Dynamically updates <meta name="theme-color"> (creating it if absent) so the
 * PWA/browser chrome reflects the active primary color theme, while keeping
 * static web app manifests untouched as a fallback.
 */
export function updatePwaThemeColorMeta(colorHex: string): void {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;

  let metaThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!metaThemeColor && document.head && typeof document.createElement === 'function') {
    metaThemeColor = document.createElement('meta');
    metaThemeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(metaThemeColor);
  }
  if (metaThemeColor && metaThemeColor.getAttribute?.('content') !== colorHex) {
    metaThemeColor.setAttribute('content', colorHex);
  }

  const tileMeta = document.querySelector<HTMLMetaElement>('meta[name="msapplication-TileColor"]');
  if (tileMeta && tileMeta.getAttribute?.('content') !== colorHex) {
    tileMeta.setAttribute('content', colorHex);
  }
}

export function getActivePwaThemeColor(
  fallback: string = ACCENT_THEME_PALETTES[DEFAULT_ACCENT_THEME].baseHex
): string {
  if (
    typeof document !== 'undefined' &&
    document.documentElement &&
    typeof document.documentElement.getAttribute === 'function'
  ) {
    const attrAccent = document.documentElement.getAttribute('data-accent-theme');
    if (isValidAccentTheme(attrAccent)) {
      return ACCENT_THEME_PALETTES[attrAccent].baseHex;
    }
  }
  const storedAccent = getStoredAccentThemeOrNull();
  if (storedAccent) {
    return ACCENT_THEME_PALETTES[storedAccent].baseHex;
  }
  return fallback;
}

const SHADE_KEYS: Array<keyof ShadeScale> = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * Applies the selected accent palette dynamically to `:root` so both custom CSS variables
 * and Tailwind v4 utility classes (primary-*, from-purple-*, via-indigo-*, bg-purple-*, text-purple-*, etc.)
 * adapt seamlessly in real time across buttons, card headers, footers, inputs, and PWA theme-color.
 */
export function applyAccentThemeToDOM(accentId: AccentThemeId): AccentThemePalette {
  const palette = resolveAccentPalette(accentId);
  if (typeof document === 'undefined') return palette;

  const root = document.documentElement;
  const p = palette.primaryScale;
  const c = palette.companionScale;

  root.setAttribute('data-accent-theme', palette.id);
  if (document.body && typeof document.body.setAttribute === 'function') {
    document.body.setAttribute('data-accent-theme', palette.id);
  }

  // Semantic brand tokens
  root.style.setProperty('--primary', p[600]);
  root.style.setProperty('--primary-rgb', palette.primaryRgb);
  root.style.setProperty('--primary-hover', p[700]);
  root.style.setProperty('--primary-light', p[500]);
  root.style.setProperty('--primary-400', p[400]);
  root.style.setProperty('--primary-dark', p[800]);
  root.style.setProperty('--primary-subtle', p[50]);
  root.style.setProperty('--primary-border', p[200]);
  root.style.setProperty('--primary-ring', `rgba(${palette.primaryRgb}, 0.25)`);

  // Semantic Tailwind @theme primary tokens
  root.style.setProperty('--color-primary', p[600]);
  root.style.setProperty('--color-primary-rgb', palette.primaryRgb);
  root.style.setProperty('--color-primary-hover', p[700]);
  root.style.setProperty('--color-primary-light', p[500]);
  root.style.setProperty('--color-primary-400', p[400]);
  root.style.setProperty('--color-primary-dark', p[800]);
  root.style.setProperty('--color-primary-subtle', p[50]);
  root.style.setProperty('--color-primary-border', p[200]);
  root.style.setProperty('--color-primary-ring', `rgba(${palette.primaryRgb}, 0.25)`);

  // Companion & surface tokens
  root.style.setProperty('--brand-companion', c[600]);
  root.style.setProperty('--brand-companion-rgb', palette.companionRgb);
  root.style.setProperty('--brand-companion-light', c[500]);
  root.style.setProperty('--brand-companion-hover', c[700]);
  root.style.setProperty('--brand-companion-dark', c[950]);
  root.style.setProperty('--brand-dark-surface', palette.darkSurfaceBg);
  root.style.setProperty('--color-brand-companion', c[600]);

  // Ready-to-use gradient pairs for buttons, card headers, and footers
  root.style.setProperty('--brand-btn-gradient', palette.buttonGradient);
  root.style.setProperty('--brand-btn-gradient-hover', palette.buttonGradientHover);
  root.style.setProperty('--brand-btn-gradient-dark', palette.buttonGradientDark);
  root.style.setProperty('--brand-btn-gradient-dark-hover', palette.buttonGradientDarkHover);
  root.style.setProperty('--brand-header-gradient-dark', palette.cardHeaderGradientDark);
  root.style.setProperty('--brand-header-gradient-light', palette.cardHeaderGradientLight);
  root.style.setProperty('--brand-footer-gradient-dark', palette.cardFooterGradientDark);
  root.style.setProperty('--brand-footer-gradient-light', palette.cardFooterGradientLight);

  // Full primary & companion CSS variable scales + Tailwind v4 purple & indigo scale overrides
  for (const shade of SHADE_KEYS) {
    root.style.setProperty(`--primary-${shade}`, p[shade]);
    root.style.setProperty(`--companion-${shade}`, c[shade]);
    root.style.setProperty(`--color-primary-${shade}`, p[shade]);
    root.style.setProperty(`--color-purple-${shade}`, p[shade]);
    root.style.setProperty(`--color-indigo-${shade}`, c[shade]);
  }

  // Dynamically update PWA/browser theme-color meta tag
  updatePwaThemeColorMeta(palette.baseHex);

  return palette;
}
