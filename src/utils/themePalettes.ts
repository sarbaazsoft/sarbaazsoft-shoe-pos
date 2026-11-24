export type PresetAccentThemeId =
  | 'purple'
  | 'indigo'
  | 'cyan'
  | 'teal'
  | 'orange'
  | 'red'
  | 'burgundy'
  | 'pink';

export type AccentThemeId = PresetAccentThemeId | 'custom';

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
  contrastText: string;
  companionContrastText: string;
  softSurfaceLight: string;
  softSurfaceDark: string;
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

export function getRelativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (!/^[0-9A-F]{6}$/i.test(clean)) return 0.5;
  const channels = [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ].map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function getWcagContrastRatio(hexA: string, hexB: string): number {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const bright = Math.max(lumA, lumB);
  const dark = Math.min(lumA, lumB);
  return (bright + 0.05) / (dark + 0.05);
}

export function getAccessibleTextColor(bgHex: string): string {
  const whiteContrast = getWcagContrastRatio(bgHex, '#FFFFFF');
  const darkContrast = getWcagContrastRatio(bgHex, '#0F172A');
  return whiteContrast >= 3.0 || whiteContrast >= darkContrast ? '#FFFFFF' : '#0F172A';
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
    contrastText: getAccessibleTextColor(p[600]),
    companionContrastText: getAccessibleTextColor(c[600]),
    softSurfaceLight: p[50],
    softSurfaceDark: p[950],
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

export const ACCENT_THEME_PALETTES: Record<PresetAccentThemeId, AccentThemePalette> = {
  purple: buildPalette({
    id: 'purple',
    name: 'Purple',
    companionName: 'Royal Orchid',
    baseHex: '#9333EA',
    companionHex: '#6B21A8',
    primaryRgb: '147, 51, 234',
    companionRgb: '107, 33, 168',
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
      50: '#FAF5FF',
      100: '#F3E8FF',
      200: '#E9D5FF',
      300: '#D8B4FE',
      400: '#C084FC',
      500: '#9333EA',
      600: '#7E22CE',
      700: '#6B21A8',
      800: '#581C87',
      900: '#4C1D95',
      950: '#2E1065',
    },
  }),
  indigo: buildPalette({
    id: 'indigo',
    name: 'Indigo',
    companionName: 'Twilight Cobalt',
    baseHex: '#4F46E5',
    companionHex: '#3730A3',
    primaryRgb: '79, 70, 229',
    companionRgb: '55, 48, 163',
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
      50: '#EEF2FF',
      100: '#E0E7FF',
      200: '#C7D2FE',
      300: '#A5B4FC',
      400: '#818CF8',
      500: '#4F46E5',
      600: '#3730A3',
      700: '#312E81',
      800: '#27246B',
      900: '#1E1B4B',
      950: '#141236',
    },
  }),
  cyan: buildPalette({
    id: 'cyan',
    name: 'Cyan',
    companionName: 'Electric Aqua',
    baseHex: '#06B6D4',
    companionHex: '#0E7490',
    primaryRgb: '6, 182, 212',
    companionRgb: '14, 116, 144',
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
      50: '#ECFEFF',
      100: '#CFFAFE',
      200: '#A5F3FC',
      300: '#67E8F9',
      400: '#22D3EE',
      500: '#0891B2',
      600: '#0E7490',
      700: '#155E75',
      800: '#164E63',
      900: '#0C3E4F',
      950: '#062633',
    },
  }),
  teal: buildPalette({
    id: 'teal',
    name: 'Teal',
    companionName: 'Deep Pine',
    baseHex: '#0D9488',
    companionHex: '#115E59',
    primaryRgb: '13, 148, 136',
    companionRgb: '17, 94, 89',
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
      50: '#F0FDFA',
      100: '#CCFBF1',
      200: '#99F6E4',
      300: '#5EEAD4',
      400: '#2DD4BF',
      500: '#0D9488',
      600: '#0F766E',
      700: '#115E59',
      800: '#134E4A',
      900: '#0B3B38',
      950: '#032221',
    },
  }),
  orange: buildPalette({
    id: 'orange',
    name: 'Orange',
    companionName: 'Tangerine Flame',
    baseHex: '#F97316',
    companionHex: '#C2410C',
    primaryRgb: '249, 115, 22',
    companionRgb: '194, 65, 12',
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
      50: '#FFF7ED',
      100: '#FFEDD5',
      200: '#FED7AA',
      300: '#FDBA74',
      400: '#FB923C',
      500: '#EA580C',
      600: '#C2410C',
      700: '#9A3412',
      800: '#7C2D12',
      900: '#5F210D',
      950: '#330F05',
    },
  }),
  red: buildPalette({
    id: 'red',
    name: 'Red',
    companionName: 'Scarlet Flame',
    baseHex: '#EF4444',
    companionHex: '#B91C1C',
    primaryRgb: '239, 68, 68',
    companionRgb: '185, 28, 28',
    darkSurfaceBg: '#1D0B0E',
    primaryScale: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      200: '#FECACA',
      300: '#FCA5A5',
      400: '#F87171',
      500: '#EF4444',
      600: '#DC2626',
      700: '#B91C1C',
      800: '#991B1B',
      900: '#7F1D1D',
      950: '#450A0A',
    },
    companionScale: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      200: '#FECACA',
      300: '#FCA5A5',
      400: '#F87171',
      500: '#DC2626',
      600: '#B91C1C',
      700: '#991B1B',
      800: '#7F1D1D',
      900: '#631515',
      950: '#380808',
    },
  }),
  burgundy: buildPalette({
    id: 'burgundy',
    name: 'Burgundy',
    companionName: 'Deep Wine',
    baseHex: '#9F1239',
    companionHex: '#6D0D2A',
    primaryRgb: '159, 18, 57',
    companionRgb: '109, 13, 42',
    darkSurfaceBg: '#1A060E',
    primaryScale: {
      50: '#FFF1F2',
      100: '#FFE4E6',
      200: '#FECDD3',
      300: '#FDA4AF',
      400: '#FB7185',
      500: '#E11D48',
      600: '#9F1239',
      700: '#881337',
      800: '#6D0D2A',
      900: '#570921',
      950: '#3B0414',
    },
    companionScale: {
      50: '#FFF1F2',
      100: '#FFE4E6',
      200: '#FECDD3',
      300: '#FDA4AF',
      400: '#FB7185',
      500: '#BE123C',
      600: '#881337',
      700: '#6D0D2A',
      800: '#570921',
      900: '#450619',
      950: '#2E0210',
    },
  }),
  pink: buildPalette({
    id: 'pink',
    name: 'Pink',
    companionName: 'Candy Magenta',
    baseHex: '#EC4899',
    companionHex: '#BE185D',
    primaryRgb: '236, 72, 153',
    companionRgb: '190, 24, 93',
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
      50: '#FDF2F8',
      100: '#FCE7F3',
      200: '#FBCFE8',
      300: '#F9A8D4',
      400: '#F472B6',
      500: '#DB2777',
      600: '#BE185D',
      700: '#9D174D',
      800: '#831843',
      900: '#6B1236',
      950: '#42051E',
    },
  }),
};

export const ACCENT_THEME_LIST: AccentThemePalette[] = [
  ACCENT_THEME_PALETTES.purple,
  ACCENT_THEME_PALETTES.indigo,
  ACCENT_THEME_PALETTES.cyan,
  ACCENT_THEME_PALETTES.teal,
  ACCENT_THEME_PALETTES.orange,
  ACCENT_THEME_PALETTES.red,
  ACCENT_THEME_PALETTES.burgundy,
  ACCENT_THEME_PALETTES.pink,
];

export interface CuratedAppearancePalette {
  key: string;
  name: string;
  companionName: string;
  hex: string;
}

export const CURATED_APPEARANCE_PALETTES: CuratedAppearancePalette[] = [
  { key: 'emerald', name: 'Emerald Forest', companionName: 'Jade Canopy', hex: '#059669' },
  { key: 'sapphire', name: 'Sapphire Blue', companionName: 'Oceanic Royal', hex: '#2563EB' },
  { key: 'amber', name: 'Amber Gold', companionName: 'Burnished Honey', hex: '#D97706' },
  { key: 'rose', name: 'Rose Velvet', companionName: 'Berry Silk', hex: '#E11D48' },
  { key: 'lavender', name: 'Electric Violet', companionName: 'Neon Iris', hex: '#7C3AED' },
  { key: 'crimson', name: 'Crimson Ruby', companionName: 'Garnet Spark', hex: '#B91C1C' },
  { key: 'bronze', name: 'Espresso Bronze', companionName: 'Roasted Copper', hex: '#B45309' },
  { key: 'plum', name: 'Midnight Plum', companionName: 'Mulberry Dusk', hex: '#86198F' },
  { key: 'obsidian', name: 'Obsidian Slate', companionName: 'Graphite Mist', hex: '#334155' },
  { key: 'navy', name: 'Midnight Navy', companionName: 'Abyssal Blue', hex: '#1E3A8A' },
  { key: 'olive', name: 'Nordic Olive', companionName: 'Moss Sage', hex: '#3F6212' },
  { key: 'terracotta', name: 'Terracotta Clay', companionName: 'Sienna Rust', hex: '#C2410C' },
  { key: 'taupe', name: 'Warm Taupe', companionName: 'Cashmere Stone', hex: '#57534E' },
  { key: 'mauve', name: 'Velvet Mauve', companionName: 'Dusty Berry', hex: '#9D174D' },
  { key: 'cypress', name: 'Deep Cypress', companionName: 'Pine Shadow', hex: '#115E59' },
  { key: 'noir', name: 'Carbon Noir', companionName: 'Onyx Mist', hex: '#27272A' },
];

export type ThemeModePreference = 'light' | 'dark' | 'system';
export type BackdropStyle = 'showroom' | 'solid';

export interface ThemePreferencesSnapshot {
  themeMode: ThemeModePreference;
  accentTheme: AccentThemeId;
  customAccentHex: string;
  backdropStyle: BackdropStyle;
  backdropDarkness: number;
}

export const THEME_MODE_STORAGE_KEY = 'pos_theme';
export const ACCENT_THEME_STORAGE_KEY = 'pos_accent_theme';
export const CUSTOM_ACCENT_HEX_STORAGE_KEY = 'pos_custom_accent_hex';
export const BACKDROP_STYLE_STORAGE_KEY = 'pos_backdrop_style';
export const BACKDROP_DARKNESS_STORAGE_KEY = 'pos_backdrop_darkness';

export const GUEST_THEME_MODE_STORAGE_KEY = 'pos_guest_theme';
export const GUEST_ACCENT_THEME_STORAGE_KEY = 'pos_guest_accent_theme';
export const GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY = 'pos_guest_custom_accent_hex';
export const GUEST_BACKDROP_STYLE_STORAGE_KEY = 'pos_guest_backdrop_style';
export const GUEST_BACKDROP_DARKNESS_STORAGE_KEY = 'pos_guest_backdrop_darkness';

export const DEFAULT_THEME_MODE: ThemeModePreference = 'system';
export const DEFAULT_ACCENT_THEME: AccentThemeId = 'purple';
export const DEFAULT_CUSTOM_ACCENT_HEX = '#2563EB';
export const DEFAULT_BACKDROP_STYLE: BackdropStyle = 'solid';
export const DEFAULT_BACKDROP_DARKNESS = 55;

export function getUserThemeCacheKey(userId: number | string): string {
  return `pos_user_theme_cache_${String(userId).trim()}`;
}

const LEGACY_ACCENT_ALIASES: Record<string, PresetAccentThemeId> = {
  violet: 'purple',
  fuchsia: 'pink',
  rose: 'pink',
  amber: 'orange',
  gold: 'orange',
  bronze: 'orange',
  sky: 'cyan',
  blue: 'indigo',
  emerald: 'teal',
  green: 'teal',
  lime: 'teal',
  slate: 'indigo',
  stone: 'indigo',
};

const HEX_COLOR_RE = /^#[0-9A-F]{6}$/i;
const SHORT_HEX_COLOR_RE = /^#[0-9A-F]{3}$/i;

export function isValidHexColor(hex?: string | null): boolean {
  if (typeof hex !== 'string') return false;
  const trimmed = hex.trim();
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_COLOR_RE.test(normalized) || SHORT_HEX_COLOR_RE.test(normalized);
}

export function normalizeHexColor(hex?: string | null, fallback = DEFAULT_CUSTOM_ACCENT_HEX): string {
  if (typeof hex !== 'string') return fallback;
  const trimmed = hex.trim();
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (HEX_COLOR_RE.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (SHORT_HEX_COLOR_RE.test(normalized)) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex).slice(1);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rn = 0;
  let gn = 0;
  let bn = 0;

  if (hue < 60) [rn, gn, bn] = [c, x, 0];
  else if (hue < 120) [rn, gn, bn] = [x, c, 0];
  else if (hue < 180) [rn, gn, bn] = [0, c, x];
  else if (hue < 240) [rn, gn, bn] = [0, x, c];
  else if (hue < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];

  const toHex = (val: number) =>
    Math.round((val + m) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  return `#${toHex(rn)}${toHex(gn)}${toHex(bn)}`;
}

function generateScaleFromHsl(hue: number, sat: number, baseLightness: number, exactHex?: string): ShadeScale {
  const clamped600 = Math.min(48, Math.max(24, baseLightness));
  const clamped500 = Math.min(60, Math.max(36, clamped600 + 8));
  return {
    50: hslToHex(hue, Math.min(sat, 95), 97),
    100: hslToHex(hue, Math.min(sat, 92), 93),
    200: hslToHex(hue, Math.min(sat, 88), 86),
    300: hslToHex(hue, Math.min(sat, 86), 76),
    400: hslToHex(hue, sat, 64),
    500: exactHex || hslToHex(hue, sat, clamped500),
    600: hslToHex(hue, sat, clamped600),
    700: hslToHex(hue, Math.min(100, sat + 4), Math.max(18, clamped600 - 8)),
    800: hslToHex(hue, Math.min(100, sat + 5), Math.max(14, clamped600 - 15)),
    900: hslToHex(hue, Math.min(100, sat + 6), Math.max(10, clamped600 - 21)),
    950: hslToHex(hue, Math.min(100, sat + 8), 8),
  };
}

export function buildCustomAccentPalette(rawHex?: string | null): AccentThemePalette {
  const baseHex = normalizeHexColor(rawHex, DEFAULT_CUSTOM_ACCENT_HEX);
  const [r, g, b] = hexToRgbTuple(baseHex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const companionHue = (h + 24) % 360;
  const companionSat = Math.max(12, Math.min(92, s));
  const primaryScale = generateScaleFromHsl(h, s, l, baseHex);
  const companionScale = generateScaleFromHsl(companionHue, companionSat, Math.max(24, l - 6));
  const companionHex = companionScale[600];
  const [cr, cg, cb] = hexToRgbTuple(companionHex);

  return buildPalette({
    id: 'custom',
    name: 'Custom',
    companionName: baseHex,
    baseHex,
    companionHex,
    primaryRgb: `${r}, ${g}, ${b}`,
    companionRgb: `${cr}, ${cg}, ${cb}`,
    darkSurfaceBg: hslToHex(h, Math.min(s, 55), 8),
    primaryScale,
    companionScale,
  });
}

export function isValidAccentTheme(value: unknown): value is AccentThemeId {
  return typeof value === 'string' && (value === 'custom' || value in ACCENT_THEME_PALETTES);
}

export function normalizeAccentThemeId(value: unknown): AccentThemeId | null {
  if (typeof value !== 'string') return null;
  if (isValidAccentTheme(value)) return value;
  if (value in LEGACY_ACCENT_ALIASES) return LEGACY_ACCENT_ALIASES[value];
  return null;
}

export function getStoredCustomAccentHex(): string {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_ACCENT_HEX;
  try {
    return normalizeHexColor(
      window.localStorage?.getItem(CUSTOM_ACCENT_HEX_STORAGE_KEY),
      DEFAULT_CUSTOM_ACCENT_HEX
    );
  } catch {
    return DEFAULT_CUSTOM_ACCENT_HEX;
  }
}

export function persistCustomAccentHex(hex: string): string {
  const valid = normalizeHexColor(hex, DEFAULT_CUSTOM_ACCENT_HEX);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(CUSTOM_ACCENT_HEX_STORAGE_KEY, valid);
    } catch {
      // ignore storage quota errors
    }
  }
  return valid;
}

export function resolveAccentPalette(
  accentId?: string | null,
  customHex?: string | null
): AccentThemePalette {
  const normalized = normalizeAccentThemeId(accentId);
  if (normalized === 'custom') {
    return buildCustomAccentPalette(customHex ?? getStoredCustomAccentHex());
  }
  if (normalized && normalized in ACCENT_THEME_PALETTES) {
    return ACCENT_THEME_PALETTES[normalized];
  }
  return ACCENT_THEME_PALETTES[DEFAULT_ACCENT_THEME as PresetAccentThemeId];
}

export function getStoredAccentThemeOrNull(): AccentThemeId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage?.getItem(ACCENT_THEME_STORAGE_KEY);
    return normalizeAccentThemeId(stored);
  } catch {
    return null;
  }
}

export function getStoredAccentTheme(): AccentThemeId {
  return getStoredAccentThemeOrNull() ?? DEFAULT_ACCENT_THEME;
}

export function persistAccentTheme(accentId: AccentThemeId): AccentThemeId {
  const valid = normalizeAccentThemeId(accentId) ?? DEFAULT_ACCENT_THEME;
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
  fallback: string = ACCENT_THEME_PALETTES[DEFAULT_ACCENT_THEME as PresetAccentThemeId].baseHex
): string {
  if (
    typeof document !== 'undefined' &&
    document.documentElement &&
    typeof document.documentElement.getAttribute === 'function'
  ) {
    const attrAccent = normalizeAccentThemeId(document.documentElement.getAttribute('data-accent-theme'));
    if (attrAccent === 'custom') {
      return getStoredCustomAccentHex();
    }
    if (attrAccent && attrAccent in ACCENT_THEME_PALETTES) {
      return ACCENT_THEME_PALETTES[attrAccent].baseHex;
    }
  }
  const storedAccent = getStoredAccentThemeOrNull();
  if (storedAccent === 'custom') {
    return getStoredCustomAccentHex();
  }
  if (storedAccent && storedAccent in ACCENT_THEME_PALETTES) {
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
export function applyAccentThemeToDOM(
  accentId: AccentThemeId,
  customHex?: string | null
): AccentThemePalette {
  const palette = resolveAccentPalette(accentId, customHex);
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
  root.style.setProperty('--primary-contrast', palette.contrastText);
  root.style.setProperty('--companion-contrast', palette.companionContrastText);
  root.style.setProperty('--brand-soft-surface-light', palette.softSurfaceLight);
  root.style.setProperty('--brand-soft-surface-dark', palette.softSurfaceDark);

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
  root.style.setProperty('--color-primary-contrast', palette.contrastText);

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

export function normalizeThemeMode(value: unknown, fallback: ThemeModePreference = DEFAULT_THEME_MODE): ThemeModePreference {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().toLowerCase();
  if (clean === 'light' || clean === 'dark' || clean === 'system') return clean;
  return fallback;
}

export function normalizeBackdropStyle(
  value: unknown,
  fallback: BackdropStyle = DEFAULT_BACKDROP_STYLE
): BackdropStyle {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().toLowerCase();
  if (clean === 'showroom' || clean === 'solid') return clean;
  return fallback;
}

export function normalizeBackdropDarkness(
  value: unknown,
  fallback: number = DEFAULT_BACKDROP_DARKNESS
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? Math.max(0, Math.min(100, Math.round(fallback)))
      : DEFAULT_BACKDROP_DARKNESS;
  if (value === null || value === undefined || value === '') return safeFallback;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num)) return safeFallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function applyBackdropThemeToDOM(
  backdropStyle: BackdropStyle,
  backdropDarkness: number
): void {
  if (typeof document === 'undefined') return;
  const style = normalizeBackdropStyle(backdropStyle, DEFAULT_BACKDROP_STYLE);
  const darkness = normalizeBackdropDarkness(backdropDarkness, DEFAULT_BACKDROP_DARKNESS);
  const root = document.documentElement;
  root.setAttribute('data-backdrop-style', style);
  root.style.setProperty('--backdrop-darkness', String(darkness));
  root.style.setProperty('--backdrop-darkness-alpha', (darkness / 100).toFixed(2));
  if (document.body && typeof document.body.setAttribute === 'function') {
    document.body.setAttribute('data-backdrop-style', style);
  }
}

/**
 * Serializes theme mode + accent palette + custom hex + backdrop preference into a compact string
 * suitable for `users.theme_color` database column.
 * Default backdrop values (`solid` + `55`) omit extra tokens to preserve canonical strings.
 */
export function serializeUserThemePreference(prefs: Partial<ThemePreferencesSnapshot>): string {
  const mode = normalizeThemeMode(prefs.themeMode, DEFAULT_THEME_MODE);
  const accent = normalizeAccentThemeId(prefs.accentTheme) ?? DEFAULT_ACCENT_THEME;
  const hex = normalizeHexColor(prefs.customAccentHex, DEFAULT_CUSTOM_ACCENT_HEX);
  const backdropStyle = normalizeBackdropStyle(prefs.backdropStyle, DEFAULT_BACKDROP_STYLE);
  const backdropDarkness = normalizeBackdropDarkness(prefs.backdropDarkness, DEFAULT_BACKDROP_DARKNESS);
  const base = accent === 'custom' ? `${mode}|custom|${hex}` : `${mode}|${accent}`;
  if (backdropStyle === DEFAULT_BACKDROP_STYLE && backdropDarkness === DEFAULT_BACKDROP_DARKNESS) {
    return base;
  }
  return `${base}|${backdropStyle}|${backdropDarkness}`;
}

/**
 * Parses `users.theme_color` value supporting structured `"mode|accent|hex|backdropStyle|darkness"`, JSON,
 * and legacy plain values like `"purple"`, `"violet"`, or `"#1E88E5"`.
 */
export function parseUserThemePreference(
  raw: unknown,
  fallback?: Partial<ThemePreferencesSnapshot>
): ThemePreferencesSnapshot {
  const baseMode = normalizeThemeMode(fallback?.themeMode, DEFAULT_THEME_MODE);
  const baseAccent = normalizeAccentThemeId(fallback?.accentTheme) ?? DEFAULT_ACCENT_THEME;
  const baseHex = normalizeHexColor(fallback?.customAccentHex, DEFAULT_CUSTOM_ACCENT_HEX);
  const baseBackdropStyle = normalizeBackdropStyle(fallback?.backdropStyle, DEFAULT_BACKDROP_STYLE);
  const baseBackdropDarkness = normalizeBackdropDarkness(fallback?.backdropDarkness, DEFAULT_BACKDROP_DARKNESS);

  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      themeMode: baseMode,
      accentTheme: baseAccent,
      customAccentHex: baseHex,
      backdropStyle: baseBackdropStyle,
      backdropDarkness: baseBackdropDarkness,
    };
  }

  const trimmed = raw.trim();

  // JSON format
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const parsedAccent = normalizeAccentThemeId(parsed.accentTheme ?? parsed.accent ?? parsed.color);
      const parsedHex = isValidHexColor(parsed.customAccentHex ?? parsed.hex)
        ? normalizeHexColor(parsed.customAccentHex ?? parsed.hex, baseHex)
        : baseHex;
      return {
        themeMode: normalizeThemeMode(parsed.themeMode ?? parsed.mode, baseMode),
        accentTheme: parsedAccent ?? (isValidHexColor(parsed.hex) ? 'custom' : baseAccent),
        customAccentHex: parsedHex,
        backdropStyle: normalizeBackdropStyle(parsed.backdropStyle ?? parsed.backdrop_style, baseBackdropStyle),
        backdropDarkness: normalizeBackdropDarkness(
          parsed.backdropDarkness ?? parsed.backdrop_darkness,
          baseBackdropDarkness
        ),
      };
    } catch {
      // fall through
    }
  }

  // Pipe-delimited format: "mode|accent[|hex][|backdropStyle|darkness]"
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map((s) => s.trim());
    const [rawMode, rawAccent] = parts;
    const accent = normalizeAccentThemeId(rawAccent);
    const hasHexSlot = accent === 'custom' || isValidHexColor(parts[2]);
    const rawHex = hasHexSlot ? parts[2] : undefined;
    const hex = isValidHexColor(rawHex) ? normalizeHexColor(rawHex, baseHex) : baseHex;
    const backdropStartIndex = hasHexSlot ? 3 : 2;
    const backdropStyle = normalizeBackdropStyle(parts[backdropStartIndex], baseBackdropStyle);
    const backdropDarkness = normalizeBackdropDarkness(parts[backdropStartIndex + 1], baseBackdropDarkness);
    return {
      themeMode: normalizeThemeMode(rawMode, baseMode),
      accentTheme: accent ?? (isValidHexColor(rawHex) ? 'custom' : baseAccent),
      customAccentHex: hex,
      backdropStyle,
      backdropDarkness,
    };
  }

  // Legacy raw HEX string (e.g. "#2563EB")
  if (isValidHexColor(trimmed)) {
    return {
      themeMode: baseMode,
      accentTheme: 'custom',
      customAccentHex: normalizeHexColor(trimmed, baseHex),
      backdropStyle: baseBackdropStyle,
      backdropDarkness: baseBackdropDarkness,
    };
  }

  // Legacy preset or alias string (e.g. "purple", "violet", "teal")
  const legacyAccent = normalizeAccentThemeId(trimmed.toLowerCase());
  if (legacyAccent) {
    return {
      themeMode: baseMode,
      accentTheme: legacyAccent,
      customAccentHex: baseHex,
      backdropStyle: baseBackdropStyle,
      backdropDarkness: baseBackdropDarkness,
    };
  }

  return {
    themeMode: baseMode,
    accentTheme: baseAccent,
    customAccentHex: baseHex,
    backdropStyle: baseBackdropStyle,
    backdropDarkness: baseBackdropDarkness,
  };
}

export function migrateLegacyGuestThemeIfNeeded(): void {
  if (typeof window === 'undefined') return;
  try {
    const hasGuestMode = window.localStorage?.getItem(GUEST_THEME_MODE_STORAGE_KEY) !== null;
    const hasGuestAccent = window.localStorage?.getItem(GUEST_ACCENT_THEME_STORAGE_KEY) !== null;
    if (hasGuestMode || hasGuestAccent) return;

    const legacyMode = window.localStorage?.getItem(THEME_MODE_STORAGE_KEY);
    const legacyAccent = window.localStorage?.getItem(ACCENT_THEME_STORAGE_KEY);
    const legacyHex = window.localStorage?.getItem(CUSTOM_ACCENT_HEX_STORAGE_KEY);
    const legacyBackdropStyle = window.localStorage?.getItem(BACKDROP_STYLE_STORAGE_KEY);
    const legacyBackdropDarkness = window.localStorage?.getItem(BACKDROP_DARKNESS_STORAGE_KEY);

    if (legacyMode || legacyAccent || legacyHex || legacyBackdropStyle || legacyBackdropDarkness) {
      window.localStorage?.setItem(
        GUEST_THEME_MODE_STORAGE_KEY,
        normalizeThemeMode(legacyMode, 'light')
      );
      window.localStorage?.setItem(
        GUEST_ACCENT_THEME_STORAGE_KEY,
        normalizeAccentThemeId(legacyAccent) ?? DEFAULT_ACCENT_THEME
      );
      window.localStorage?.setItem(
        GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY,
        normalizeHexColor(legacyHex, DEFAULT_CUSTOM_ACCENT_HEX)
      );
      window.localStorage?.setItem(
        GUEST_BACKDROP_STYLE_STORAGE_KEY,
        normalizeBackdropStyle(legacyBackdropStyle, DEFAULT_BACKDROP_STYLE)
      );
      window.localStorage?.setItem(
        GUEST_BACKDROP_DARKNESS_STORAGE_KEY,
        String(normalizeBackdropDarkness(legacyBackdropDarkness, DEFAULT_BACKDROP_DARKNESS))
      );
    }
  } catch {
    // ignore storage errors
  }
}

export function getStoredGuestThemePreferences(): ThemePreferencesSnapshot {
  if (typeof window === 'undefined') {
    return {
      themeMode: 'light',
      accentTheme: DEFAULT_ACCENT_THEME,
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: DEFAULT_BACKDROP_STYLE,
      backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
    };
  }
  try {
    const guestModeRaw = window.localStorage?.getItem(GUEST_THEME_MODE_STORAGE_KEY);
    const guestAccentRaw = window.localStorage?.getItem(GUEST_ACCENT_THEME_STORAGE_KEY);
    const guestHexRaw = window.localStorage?.getItem(GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY);
    const guestBackdropStyleRaw = window.localStorage?.getItem(GUEST_BACKDROP_STYLE_STORAGE_KEY);
    const guestBackdropDarknessRaw = window.localStorage?.getItem(GUEST_BACKDROP_DARKNESS_STORAGE_KEY);

    const mode = normalizeThemeMode(guestModeRaw, 'light');
    const accent = normalizeAccentThemeId(guestAccentRaw) ?? DEFAULT_ACCENT_THEME;
    const hex = normalizeHexColor(guestHexRaw, DEFAULT_CUSTOM_ACCENT_HEX);
    const backdropStyle = normalizeBackdropStyle(guestBackdropStyleRaw, DEFAULT_BACKDROP_STYLE);
    const backdropDarkness = normalizeBackdropDarkness(
      guestBackdropDarknessRaw,
      DEFAULT_BACKDROP_DARKNESS
    );

    return {
      themeMode: mode,
      accentTheme: accent,
      customAccentHex: hex,
      backdropStyle,
      backdropDarkness,
    };
  } catch {
    return {
      themeMode: 'light',
      accentTheme: DEFAULT_ACCENT_THEME,
      customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
      backdropStyle: DEFAULT_BACKDROP_STYLE,
      backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
    };
  }
}

export const LAST_AUTH_USER_ID_STORAGE_KEY = 'pos_last_auth_user_id';
export const LOGGED_OUT_THEME_OVERRIDE_STORAGE_KEY = 'pos_theme_logged_out_override';

export function getLastAuthUserId(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(LAST_AUTH_USER_ID_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function setLastAuthUserId(userId: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (userId !== null && Number.isSafeInteger(Number(userId)) && Number(userId) > 0) {
      window.localStorage?.setItem(LAST_AUTH_USER_ID_STORAGE_KEY, String(Number(userId)));
    } else {
      window.localStorage?.removeItem(LAST_AUTH_USER_ID_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getLoggedOutThemeOverride(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(LOGGED_OUT_THEME_OVERRIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLoggedOutThemeOverride(flag: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (flag) {
      window.localStorage?.setItem(LOGGED_OUT_THEME_OVERRIDE_STORAGE_KEY, '1');
    } else {
      window.localStorage?.removeItem(LOGGED_OUT_THEME_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getStoredActiveThemePreferences(): ThemePreferencesSnapshot {
  const fallback: ThemePreferencesSnapshot = {
    themeMode: 'light',
    accentTheme: DEFAULT_ACCENT_THEME,
    customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
    backdropStyle: DEFAULT_BACKDROP_STYLE,
    backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const modeRaw =
      window.localStorage?.getItem(THEME_MODE_STORAGE_KEY) ??
      window.localStorage?.getItem(GUEST_THEME_MODE_STORAGE_KEY);
    const accentRaw =
      window.localStorage?.getItem(ACCENT_THEME_STORAGE_KEY) ??
      window.localStorage?.getItem(GUEST_ACCENT_THEME_STORAGE_KEY);
    const hexRaw =
      window.localStorage?.getItem(CUSTOM_ACCENT_HEX_STORAGE_KEY) ??
      window.localStorage?.getItem(GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY);
    const backdropStyleRaw =
      window.localStorage?.getItem(BACKDROP_STYLE_STORAGE_KEY) ??
      window.localStorage?.getItem(GUEST_BACKDROP_STYLE_STORAGE_KEY);
    const backdropDarknessRaw =
      window.localStorage?.getItem(BACKDROP_DARKNESS_STORAGE_KEY) ??
      window.localStorage?.getItem(GUEST_BACKDROP_DARKNESS_STORAGE_KEY);

    return {
      themeMode: normalizeThemeMode(modeRaw, 'light'),
      accentTheme: normalizeAccentThemeId(accentRaw) ?? DEFAULT_ACCENT_THEME,
      customAccentHex: normalizeHexColor(hexRaw, DEFAULT_CUSTOM_ACCENT_HEX),
      backdropStyle: normalizeBackdropStyle(backdropStyleRaw, DEFAULT_BACKDROP_STYLE),
      backdropDarkness: normalizeBackdropDarkness(backdropDarknessRaw, DEFAULT_BACKDROP_DARKNESS),
    };
  } catch {
    return fallback;
  }
}

export function persistGuestThemePreferences(prefs: ThemePreferencesSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const mode = normalizeThemeMode(prefs.themeMode, 'light');
    const accent = normalizeAccentThemeId(prefs.accentTheme) ?? DEFAULT_ACCENT_THEME;
    const hex = normalizeHexColor(prefs.customAccentHex, DEFAULT_CUSTOM_ACCENT_HEX);
    const backdropStyle = normalizeBackdropStyle(prefs.backdropStyle, DEFAULT_BACKDROP_STYLE);
    const backdropDarkness = normalizeBackdropDarkness(prefs.backdropDarkness, DEFAULT_BACKDROP_DARKNESS);
    window.localStorage?.setItem(GUEST_THEME_MODE_STORAGE_KEY, mode);
    window.localStorage?.setItem(GUEST_ACCENT_THEME_STORAGE_KEY, accent);
    window.localStorage?.setItem(GUEST_CUSTOM_ACCENT_HEX_STORAGE_KEY, hex);
    window.localStorage?.setItem(GUEST_BACKDROP_STYLE_STORAGE_KEY, backdropStyle);
    window.localStorage?.setItem(GUEST_BACKDROP_DARKNESS_STORAGE_KEY, String(backdropDarkness));
    // Keep pre-hydration & active independent keys in sync without flash
    window.localStorage?.setItem(THEME_MODE_STORAGE_KEY, mode);
    window.localStorage?.setItem(ACCENT_THEME_STORAGE_KEY, accent);
    window.localStorage?.setItem(CUSTOM_ACCENT_HEX_STORAGE_KEY, hex);
    window.localStorage?.setItem(BACKDROP_STYLE_STORAGE_KEY, backdropStyle);
    window.localStorage?.setItem(BACKDROP_DARKNESS_STORAGE_KEY, String(backdropDarkness));
  } catch {
    // ignore storage errors
  }
}

export function persistIndependentThemePreferences(prefs: ThemePreferencesSnapshot): void {
  persistGuestThemePreferences(prefs);
}

export function persistActiveHydrationMirror(prefs: ThemePreferencesSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const mode = normalizeThemeMode(prefs.themeMode, 'light');
    const accent = normalizeAccentThemeId(prefs.accentTheme) ?? DEFAULT_ACCENT_THEME;
    const hex = normalizeHexColor(prefs.customAccentHex, DEFAULT_CUSTOM_ACCENT_HEX);
    const backdropStyle = normalizeBackdropStyle(prefs.backdropStyle, DEFAULT_BACKDROP_STYLE);
    const backdropDarkness = normalizeBackdropDarkness(prefs.backdropDarkness, DEFAULT_BACKDROP_DARKNESS);
    window.localStorage?.setItem(THEME_MODE_STORAGE_KEY, mode);
    window.localStorage?.setItem(ACCENT_THEME_STORAGE_KEY, accent);
    window.localStorage?.setItem(CUSTOM_ACCENT_HEX_STORAGE_KEY, hex);
    window.localStorage?.setItem(BACKDROP_STYLE_STORAGE_KEY, backdropStyle);
    window.localStorage?.setItem(BACKDROP_DARKNESS_STORAGE_KEY, String(backdropDarkness));
  } catch {
    // ignore storage errors
  }
}

export interface ResolveAuthThemeTransitionInput {
  user: { id?: unknown; themeColor?: unknown; theme_color?: unknown } | null;
  currentCommitted: ThemePreferencesSnapshot;
  lastAuthUserId: number | null;
  loggedOutOverride: boolean;
  readUserCache: (userId: number) => string | null;
  defaultSnapshot?: ThemePreferencesSnapshot;
}

export interface ResolveAuthThemeTransitionOutput {
  activeUserId: number | null;
  nextPrefs: ThemePreferencesSnapshot;
  nextLastAuthUserId: number | null;
  nextLoggedOutOverride: boolean;
  shouldPersistUserCache: boolean;
  shouldSyncCurrentToDb: boolean;
}

export function resolveAuthThemeTransition({
  user,
  currentCommitted,
  lastAuthUserId,
  loggedOutOverride,
  readUserCache,
  defaultSnapshot,
}: ResolveAuthThemeTransitionInput): ResolveAuthThemeTransitionOutput {
  const fallback: ThemePreferencesSnapshot = defaultSnapshot ?? {
    themeMode: 'light',
    accentTheme: DEFAULT_ACCENT_THEME,
    customAccentHex: DEFAULT_CUSTOM_ACCENT_HEX,
    backdropStyle: DEFAULT_BACKDROP_STYLE,
    backdropDarkness: DEFAULT_BACKDROP_DARKNESS,
  };

  if (!user || !user.id) {
    return {
      activeUserId: null,
      nextPrefs: currentCommitted,
      nextLastAuthUserId: lastAuthUserId,
      nextLoggedOutOverride: loggedOutOverride,
      shouldPersistUserCache: false,
      shouldSyncCurrentToDb: false,
    };
  }

  const uid = Number(user.id);
  const dbRaw = user.themeColor ?? user.theme_color;
  const hasDbTheme = typeof dbRaw === 'string' && dbRaw.trim().length > 0;
  const cachedRaw = readUserCache(uid);
  const hasCachedTheme = typeof cachedRaw === 'string' && cachedRaw.trim().length > 0;
  const isDifferentUser = lastAuthUserId !== null && lastAuthUserId !== uid;
  const isSameUser = lastAuthUserId !== null && lastAuthUserId === uid;

  if (isSameUser && loggedOutOverride) {
    return {
      activeUserId: uid,
      nextPrefs: currentCommitted,
      nextLastAuthUserId: uid,
      nextLoggedOutOverride: false,
      shouldPersistUserCache: true,
      shouldSyncCurrentToDb: true,
    };
  }

  if (hasDbTheme) {
    return {
      activeUserId: uid,
      nextPrefs: parseUserThemePreference(dbRaw, fallback),
      nextLastAuthUserId: uid,
      nextLoggedOutOverride: false,
      shouldPersistUserCache: true,
      shouldSyncCurrentToDb: false,
    };
  }

  if (hasCachedTheme) {
    return {
      activeUserId: uid,
      nextPrefs: parseUserThemePreference(cachedRaw, fallback),
      nextLastAuthUserId: uid,
      nextLoggedOutOverride: false,
      shouldPersistUserCache: true,
      shouldSyncCurrentToDb: false,
    };
  }

  if (isDifferentUser) {
    const chosen = loggedOutOverride ? currentCommitted : { ...fallback };
    return {
      activeUserId: uid,
      nextPrefs: chosen,
      nextLastAuthUserId: uid,
      nextLoggedOutOverride: false,
      shouldPersistUserCache: loggedOutOverride,
      shouldSyncCurrentToDb: false,
    };
  }

  return {
    activeUserId: uid,
    nextPrefs: currentCommitted,
    nextLastAuthUserId: uid,
    nextLoggedOutOverride: false,
    shouldPersistUserCache: true,
    shouldSyncCurrentToDb: false,
  };
}

