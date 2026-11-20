import {
  CURATED_APPEARANCE_PALETTES,
  normalizeHexColor,
  type AccentThemeId,
  type PresetAccentThemeId,
} from './themePalettes.ts';

export type ScreenImageSlot = 'backdrop' | 'login' | 'registration' | 'auth' | 'loading';

export type ScreenImagesMap = Record<ScreenImageSlot, string>;

export interface UnifiedBackdropMeta {
  id: 'backdrop';
  label: string;
  description: string;
}

export const UNIFIED_BACKDROP_META: UnifiedBackdropMeta = {
  id: 'backdrop',
  label: 'Unified Screen Backdrop',
  description: 'Single shared backdrop image applied across Login, Registration, Authentication, Loading, and all portal routes.',
};

export function resolveUnifiedBackdropImage(
  raw: Partial<Record<string, unknown>> | string | null | undefined
): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (!raw || typeof raw !== 'object') {
    return '';
  }
  const candidates = [
    raw.backdrop,
    raw.backdropImage,
    raw.image,
    raw.url,
    raw.login,
    raw.auth,
    raw.registration,
    raw.loading,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

export function buildUnifiedScreenImagesMap(imageUrl: string): ScreenImagesMap {
  const clean = String(imageUrl || '').trim();
  return {
    backdrop: clean,
    login: clean,
    registration: clean,
    auth: clean,
    loading: clean,
  };
}

export const EMPTY_SCREEN_IMAGES: ScreenImagesMap = buildUnifiedScreenImagesMap('');

export interface PredefinedLibraryImage {
  id: string;
  title: string;
  subtitle: string;
  source: 'Unsplash' | 'Pexels' | 'Pinterest' | 'Flickr' | 'Pixabay' | 'Wikimedia';
  colorTag: string;
  colorHex: string;
  matchedPresets: PresetAccentThemeId[];
  matchedCuratedKeys: string[];
  url: string;
}

export function doesLibraryImageMatchTheme(
  item: PredefinedLibraryImage,
  accentTheme: AccentThemeId,
  customAccentHex?: string
): boolean {
  if (accentTheme !== 'custom') {
    return item.matchedPresets.includes(accentTheme);
  }
  const normalizedHex = normalizeHexColor(customAccentHex);
  const matchedCurated = CURATED_APPEARANCE_PALETTES.find(
    (palette) => palette.hex.toUpperCase() === normalizedHex
  );
  if (matchedCurated) {
    return item.matchedCuratedKeys.includes(matchedCurated.key);
  }
  return item.colorHex.toUpperCase() === normalizedHex;
}

/**
 * Curated Predefined Shoe Store Image Library.
 * Stored strictly as verified external hosted HTTPS URLs across multiple image platforms
 * (Unsplash, Pexels, Pinterest, Flickr, Pixabay, Wikimedia) — never bundled into local assets.
 * Every core preset (purple, indigo, cyan, teal, orange, red, burgundy, pink) and curated palette
 * has dedicated color-matched footwear & shoe store backdrops.
 */
export const PREDEFINED_SCREEN_IMAGE_LIBRARY: PredefinedLibraryImage[] = [
  // PURPLE / ELECTRIC VIOLET / MIDNIGHT PLUM
  {
    id: 'purple-luxe-sneakers',
    title: 'Purple Low-Top Sneakers',
    subtitle: 'Royal purple studio footwear shot',
    source: 'Pexels',
    colorTag: 'Purple',
    colorHex: '#9333EA',
    matchedPresets: ['purple'],
    matchedCuratedKeys: ['lavender', 'plum'],
    url: 'https://images.pexels.com/photos/1424537/pexels-photo-1424537.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },
  {
    id: 'purple-neon-display',
    title: 'Illuminated Shoe Display',
    subtitle: 'Violet-lit retail shoe shelf',
    source: 'Unsplash',
    colorTag: 'Purple',
    colorHex: '#7C3AED',
    matchedPresets: ['purple', 'indigo'],
    matchedCuratedKeys: ['lavender', 'plum'],
    url: 'https://images.unsplash.com/photo-1699309325446-3561a7508d3c?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'purple-jordan-edition',
    title: 'Violet Sneaker Showcase',
    subtitle: 'Purple court edition display',
    source: 'Pinterest',
    colorTag: 'Plum',
    colorHex: '#86198F',
    matchedPresets: ['purple'],
    matchedCuratedKeys: ['plum', 'lavender'],
    url: 'https://i.pinimg.com/originals/83/ec/b7/83ecb757f5b5c26901dd2d0d0610aa13.jpg',
  },
  {
    id: 'lavender-glitter-heel',
    title: 'Electric Lilac Footwear',
    subtitle: 'Shimmering violet party shoe',
    source: 'Pexels',
    colorTag: 'Lavender',
    colorHex: '#7C3AED',
    matchedPresets: ['purple', 'pink'],
    matchedCuratedKeys: ['lavender', 'plum'],
    url: 'https://images.pexels.com/photos/27008332/pexels-photo-27008332/free-photo-of-zapatilla-lila-glitter.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },

  // INDIGO / SAPPHIRE BLUE / COBALT SKY
  {
    id: 'indigo-lit-showroom',
    title: 'Cobalt Lit Shoe Wall',
    subtitle: 'Glowing dark indigo shoe shelves',
    source: 'Unsplash',
    colorTag: 'Indigo',
    colorHex: '#4F46E5',
    matchedPresets: ['indigo'],
    matchedCuratedKeys: ['sapphire', 'cobalt'],
    url: 'https://images.unsplash.com/photo-1542755687-a33ff0c970ec?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'sapphire-blue-trainers',
    title: 'Sapphire Blue Trainers',
    subtitle: 'Deep blue athletic shoe backdrop',
    source: 'Unsplash',
    colorTag: 'Sapphire',
    colorHex: '#2563EB',
    matchedPresets: ['indigo'],
    matchedCuratedKeys: ['sapphire', 'cobalt'],
    url: 'https://images.unsplash.com/photo-1616258372736-f5e5d5337d6e?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'blue-store-display',
    title: 'Blue Boutique Shoe Shelf',
    subtitle: 'Retail store sneaker exhibition',
    source: 'Unsplash',
    colorTag: 'Blue',
    colorHex: '#2563EB',
    matchedPresets: ['indigo'],
    matchedCuratedKeys: ['sapphire', 'cobalt'],
    url: 'https://images.unsplash.com/photo-1672840005700-fd8e4159a8df?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'cobalt-nike-duo',
    title: 'Cobalt & White Sneakers',
    subtitle: 'High-contrast blue leather pair',
    source: 'Unsplash',
    colorTag: 'Cobalt',
    colorHex: '#0284C7',
    matchedPresets: ['indigo', 'cyan'],
    matchedCuratedKeys: ['cobalt', 'sapphire'],
    url: 'https://images.unsplash.com/photo-1615450996941-33dc3878a88a?auto=format&fit=crop&w=1600&q=80',
  },

  // CYAN / SKY AQUA
  {
    id: 'cyan-aqua-runner',
    title: 'Electric Aqua Sneakers',
    subtitle: 'Vibrant cyan canvas footwear',
    source: 'Pexels',
    colorTag: 'Cyan',
    colorHex: '#06B6D4',
    matchedPresets: ['cyan'],
    matchedCuratedKeys: ['cobalt'],
    url: 'https://images.pexels.com/photos/19090/pexels-photo.jpg?auto=compress&cs=tinysrgb&w=1600',
  },
  {
    id: 'cyan-sky-sneakers',
    title: 'Sky Cyan Low-Tops',
    subtitle: 'Cool blue-cyan studio sneakers',
    source: 'Pexels',
    colorTag: 'Cyan',
    colorHex: '#0891B2',
    matchedPresets: ['cyan'],
    matchedCuratedKeys: ['cobalt'],
    url: 'https://images.pexels.com/photos/1070360/pexels-photo-1070360.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },
  {
    id: 'cyan-jade-dunks',
    title: 'Clear Jade Cyan Dunks',
    subtitle: 'Ice aqua collector edition',
    source: 'Pinterest',
    colorTag: 'Cyan',
    colorHex: '#06B6D4',
    matchedPresets: ['cyan', 'teal'],
    matchedCuratedKeys: ['mint'],
    url: 'https://i.pinimg.com/originals/c2/0b/71/c20b7103b965eeaf960112797f54e7bf.jpg',
  },

  // TEAL / EMERALD FOREST / ARCTIC MINT
  {
    id: 'teal-geode-dunk',
    title: 'Geode Teal Sneakers',
    subtitle: 'Deep teal & emerald court pair',
    source: 'Pinterest',
    colorTag: 'Teal',
    colorHex: '#0D9488',
    matchedPresets: ['teal'],
    matchedCuratedKeys: ['emerald', 'mint'],
    url: 'https://i.pinimg.com/736x/9c/d6/1e/9cd61ea6810fd753636cb72c3f2a9299.jpg',
  },
  {
    id: 'emerald-forest-nike',
    title: 'Emerald Forest Trainers',
    subtitle: 'Rich green athletic shoe display',
    source: 'Pexels',
    colorTag: 'Emerald',
    colorHex: '#059669',
    matchedPresets: ['teal'],
    matchedCuratedKeys: ['emerald', 'mint'],
    url: 'https://images.pexels.com/photos/1456706/pexels-photo-1456706.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },
  {
    id: 'mint-spruce-sneakers',
    title: 'Arctic Mint Sneakers',
    subtitle: 'Fresh seafoam & spruce low-tops',
    source: 'Pinterest',
    colorTag: 'Mint',
    colorHex: '#10B981',
    matchedPresets: ['teal'],
    matchedCuratedKeys: ['mint', 'emerald'],
    url: 'https://i.pinimg.com/originals/e5/8c/03/e58c03d80ac8c3ccc2cbea806acb929f.jpg',
  },

  // ORANGE / AMBER GOLD / ESPRESSO BRONZE
  {
    id: 'orange-flame-nike',
    title: 'Tangerine Flame Sneakers',
    subtitle: 'Vibrant orange & black athletic pair',
    source: 'Unsplash',
    colorTag: 'Orange',
    colorHex: '#F97316',
    matchedPresets: ['orange'],
    matchedCuratedKeys: ['amber'],
    url: 'https://images.unsplash.com/photo-1592962879424-fab5e296b7d9?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'orange-black-racer',
    title: 'Blaze Orange Runner',
    subtitle: 'Bold sunset orange street shoe',
    source: 'Pexels',
    colorTag: 'Orange',
    colorHex: '#EA580C',
    matchedPresets: ['orange'],
    matchedCuratedKeys: ['amber', 'bronze'],
    url: 'https://images.pexels.com/photos/14337851/pexels-photo-14337851.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },
  {
    id: 'amber-leather-boots',
    title: 'Amber Leather Boots',
    subtitle: 'Warm honey-amber showroom shelf',
    source: 'Pexels',
    colorTag: 'Amber',
    colorHex: '#D97706',
    matchedPresets: ['orange'],
    matchedCuratedKeys: ['amber', 'bronze'],
    url: 'https://images.pexels.com/photos/29090887/pexels-photo-29090887/free-photo-of-close-up-of-leather-boots-in-shoe-store-display.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },
  {
    id: 'bronze-leather-shelf',
    title: 'Espresso Bronze Oxfords',
    subtitle: 'Handcrafted copper-brown dress shoes',
    source: 'Pexels',
    colorTag: 'Bronze',
    colorHex: '#B45309',
    matchedPresets: ['orange'],
    matchedCuratedKeys: ['bronze', 'amber'],
    url: 'https://images.pexels.com/photos/5669253/pexels-photo-5669253.jpeg?auto=compress&cs=tinysrgb&w=1600',
  },

  // RED / CRIMSON RUBY
  {
    id: 'crimson-runner',
    title: 'Performance Red Runner',
    subtitle: 'Dynamic scarlet studio spotlight',
    source: 'Unsplash',
    colorTag: 'Red',
    colorHex: '#EF4444',
    matchedPresets: ['red'],
    matchedCuratedKeys: ['crimson'],
    url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'red-neon-sneaker',
    title: 'Scarlet Neon Sneaker',
    subtitle: 'Glowing crimson sneaker backdrop',
    source: 'Unsplash',
    colorTag: 'Crimson',
    colorHex: '#B91C1C',
    matchedPresets: ['red'],
    matchedCuratedKeys: ['crimson'],
    url: 'https://images.unsplash.com/photo-1579298245158-33e8f568f7d3?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'red-kicks-wall',
    title: 'Red Sneaker Boutique',
    subtitle: 'Crimson illuminated kicks wall',
    source: 'Pinterest',
    colorTag: 'Red',
    colorHex: '#DC2626',
    matchedPresets: ['red'],
    matchedCuratedKeys: ['crimson'],
    url: 'https://i.pinimg.com/originals/70/74/75/70747553c01589f5c594c3bd19edf294.jpg',
  },

  // BURGUNDY / ROSE VELVET
  {
    id: 'burgundy-wine-boots',
    title: 'Burgundy Wine Boots',
    subtitle: 'Deep wine leather luxury footwear',
    source: 'Pinterest',
    colorTag: 'Burgundy',
    colorHex: '#9F1239',
    matchedPresets: ['burgundy'],
    matchedCuratedKeys: ['rose', 'crimson'],
    url: 'https://i.pinimg.com/736x/9e/7f/1e/9e7f1e4fb4e8cc3f2fef566c50544f83.jpg',
  },
  {
    id: 'burgundy-maroon-calf',
    title: 'Deep Maroon Footwear',
    subtitle: 'Rich maroon boutique boots',
    source: 'Pinterest',
    colorTag: 'Burgundy',
    colorHex: '#881337',
    matchedPresets: ['burgundy'],
    matchedCuratedKeys: ['rose', 'plum'],
    url: 'https://i.pinimg.com/originals/60/1c/6a/601c6ae85c4d55c2541b012b578003bb.jpg',
  },
  {
    id: 'rose-velvet-display',
    title: 'Velvet Rose Footwear',
    subtitle: 'Deep crimson-rose studio display',
    source: 'Unsplash',
    colorTag: 'Rose',
    colorHex: '#E11D48',
    matchedPresets: ['burgundy', 'red'],
    matchedCuratedKeys: ['rose', 'crimson'],
    url: 'https://images.unsplash.com/photo-1637228393230-6f7bcfb4a032?auto=format&fit=crop&w=1600&q=80',
  },

  // PINK / CANDY MAGENTA
  {
    id: 'pink-nike-showcase',
    title: 'Candy Pink Sneakers',
    subtitle: 'Pink & crisp white low-top display',
    source: 'Unsplash',
    colorTag: 'Pink',
    colorHex: '#EC4899',
    matchedPresets: ['pink'],
    matchedCuratedKeys: ['rose'],
    url: 'https://images.unsplash.com/photo-1572293276811-1f27592be0a8?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'pink-pastel-street',
    title: 'Magenta Blush Trainers',
    subtitle: 'Vibrant pink athletic footwear',
    source: 'Unsplash',
    colorTag: 'Pink',
    colorHex: '#DB2777',
    matchedPresets: ['pink'],
    matchedCuratedKeys: ['rose'],
    url: 'https://images.unsplash.com/photo-1622920609618-6d06f2b27aea?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'pink-studio-wood',
    title: 'Pastel Pink Showroom',
    subtitle: 'Pink trainers on warm studio deck',
    source: 'Unsplash',
    colorTag: 'Pink',
    colorHex: '#F472B6',
    matchedPresets: ['pink'],
    matchedCuratedKeys: ['rose'],
    url: 'https://images.unsplash.com/photo-1742392787511-8158c243b772?auto=format&fit=crop&w=1600&q=80',
  },

  // CLASSIC SHOWROOM INTERIORS ACROSS PLATFORMS (Flickr, Pixabay, Wikimedia, Unsplash, Pinterest)
  {
    id: 'showroom-wall',
    title: 'Illuminated Sneaker Wall',
    subtitle: 'Modern retail footwear display',
    source: 'Unsplash',
    colorTag: 'Warm Gold',
    colorHex: '#D97706',
    matchedPresets: ['orange'],
    matchedCuratedKeys: ['amber', 'bronze'],
    url: 'https://images.unsplash.com/photo-1556906781-9a412961c28c?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'pin-flagship-retail',
    title: 'Architectural Shoe Lounge',
    subtitle: 'Editorial luxury footwear interior',
    source: 'Pinterest',
    colorTag: 'Warm Slate',
    colorHex: '#4F46E5',
    matchedPresets: ['indigo'],
    matchedCuratedKeys: ['sapphire'],
    url: 'https://i.pinimg.com/originals/c6/d5/ec/c6d5ec4c2207099c474721283362125f.jpg',
  },
  {
    id: 'flickr-sneakers-wall',
    title: 'Wide Sneaker Wall',
    subtitle: 'Panoramic sneaker store display',
    source: 'Flickr',
    colorTag: 'Crimson',
    colorHex: '#EF4444',
    matchedPresets: ['red'],
    matchedCuratedKeys: ['crimson'],
    url: 'https://live.staticflickr.com/4443/38059792331_faba614a5f_b.jpg',
  },
  {
    id: 'pixabay-heel-shelves',
    title: 'Boutique Heels Display',
    subtitle: 'Illuminated women’s shoe shelves',
    source: 'Pixabay',
    colorTag: 'Rose Pink',
    colorHex: '#EC4899',
    matchedPresets: ['pink', 'burgundy'],
    matchedCuratedKeys: ['rose'],
    url: 'https://cdn.pixabay.com/photo/2020/08/09/11/48/shelf-5475323_960_720.jpg',
  },
  {
    id: 'wikimedia-leather-shop',
    title: 'Evening Leather Shoe Shop',
    subtitle: 'Warm illuminated footwear shopfront',
    source: 'Wikimedia',
    colorTag: 'Amber',
    colorHex: '#B45309',
    matchedPresets: ['orange'],
    matchedCuratedKeys: ['amber', 'bronze'],
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e9/HK_SSP_%E6%B7%B1%E6%B0%B4%E5%9F%97_Sham_Shui_Po_night_December_2022_Px3_03_leather_shoe_shop.jpg',
  },
];

export const SCREEN_IMAGES_CACHE_KEY = 'pos_screen_images_cache';

export function validateExternalImageUrl(rawUrl: string): { valid: boolean; url: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: true, url: '' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, url: '', error: 'URL must start with https:// or http://' };
    }
    // Warn if user pasted a Pinterest HTML page link rather than a direct image URL (i.pinimg.com)
    if (
      /pinterest\./i.test(parsed.hostname) &&
      !/pinimg\.com$/i.test(parsed.hostname) &&
      !/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(parsed.pathname)
    ) {
      return {
        valid: false,
        url: '',
        error:
          'This looks like a Pinterest webpage link. Right-click the Pinterest image and choose "Copy image address" (i.pinimg.com/...).',
      };
    }
    return { valid: true, url: parsed.toString() };
  } catch {
    return {
      valid: false,
      url: '',
      error: 'Please enter a valid external image URL (e.g. https://i.pinimg.com/... or https://images.unsplash.com/...).',
    };
  }
}

export async function compressUploadedImageFile(file: File, maxDimension = 1920): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG, WEBP, GIF).');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Selected file is larger than 15 MB. Please choose a smaller image.');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return rawDataUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) {
        resolve(rawDataUrl);
        return;
      }
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const outputMime = file.type === 'image/png' && rawDataUrl.length < 700_000 ? 'image/png' : 'image/jpeg';
      const compressed = canvas.toDataURL(outputMime, 0.84);
      resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export function readCachedBackdropImage(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage?.getItem(SCREEN_IMAGES_CACHE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return resolveUnifiedBackdropImage(parsed);
  } catch {
    return '';
  }
}

export function readCachedScreenImages(): ScreenImagesMap {
  return buildUnifiedScreenImagesMap(readCachedBackdropImage());
}

export function writeCachedScreenImages(images: ScreenImagesMap | string): void {
  if (typeof window === 'undefined') return;
  try {
    const unified = typeof images === 'string' ? images : resolveUnifiedBackdropImage(images);
    window.localStorage?.setItem(SCREEN_IMAGES_CACHE_KEY, JSON.stringify(buildUnifiedScreenImagesMap(unified)));
  } catch {
    // ignore storage quota errors on very large images; DB remains authoritative
  }
}
