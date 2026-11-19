export type ScreenImageSlot = 'login' | 'registration' | 'auth' | 'loading';

export type ScreenImagesMap = Record<ScreenImageSlot, string>;

export const EMPTY_SCREEN_IMAGES: ScreenImagesMap = {
  login: '',
  registration: '',
  auth: '',
  loading: '',
};

export interface ScreenSlotMeta {
  id: ScreenImageSlot;
  label: string;
  description: string;
}

export const SCREEN_IMAGE_SLOTS: ScreenSlotMeta[] = [
  {
    id: 'login',
    label: 'Login Screen',
    description: 'Backdrop for store & platform sign-in screens.',
  },
  {
    id: 'registration',
    label: 'Registration',
    description: 'Backdrop for store trial sign-up & onboarding wizard.',
  },
  {
    id: 'auth',
    label: 'Authentication',
    description: 'Backdrop for password reset, verification, and account notice pages.',
  },
  {
    id: 'loading',
    label: 'Loading Screen',
    description: 'Ambient showroom backdrop shown during app & dashboard startup.',
  },
];

export interface PredefinedLibraryImage {
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

/**
 * Curated Predefined Image Library.
 * Stored strictly as external hosted HTTPS URLs — never bundled into local assets.
 */
export const PREDEFINED_SCREEN_IMAGE_LIBRARY: PredefinedLibraryImage[] = [
  {
    id: 'showroom-wall',
    title: 'Illuminated Sneaker Wall',
    subtitle: 'Modern retail footwear display',
    url: 'https://images.unsplash.com/photo-1556906781-9a412961c28c?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'curated-boutique',
    title: 'Curated Boutique Lounge',
    subtitle: 'Warm architectural store interior',
    url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'atelier-rack',
    title: 'Minimalist Flagship Rack',
    subtitle: 'Editorial high-fashion showroom',
    url: 'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'crimson-runner',
    title: 'Performance Runner Studio',
    subtitle: 'Dynamic athletic spotlight',
    url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'monochrome-court',
    title: 'Monochrome Leather Classic',
    subtitle: 'Clean studio footwear close-up',
    url: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1600&q=80',
  },
  {
    id: 'streetwear-shelf',
    title: 'Vibrant Sneaker Shelf',
    subtitle: 'Color-pop urban collection',
    url: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=1600&q=80',
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
    if (/pinterest\./i.test(parsed.hostname) && !/pinimg\.com$/i.test(parsed.hostname) && !/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(parsed.pathname)) {
      return {
        valid: false,
        url: '',
        error: 'This looks like a Pinterest webpage link. Right-click the Pinterest image and choose "Copy image address" (i.pinimg.com/...).',
      };
    }
    return { valid: true, url: parsed.toString() };
  } catch {
    return { valid: false, url: '', error: 'Please enter a valid external image URL (e.g. https://i.pinimg.com/... or https://images.unsplash.com/...).' };
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

export function readCachedScreenImages(): ScreenImagesMap {
  if (typeof window === 'undefined') return { ...EMPTY_SCREEN_IMAGES };
  try {
    const raw = window.localStorage?.getItem(SCREEN_IMAGES_CACHE_KEY);
    if (!raw) return { ...EMPTY_SCREEN_IMAGES };
    const parsed = JSON.parse(raw);
    return {
      login: typeof parsed?.login === 'string' ? parsed.login : '',
      registration: typeof parsed?.registration === 'string' ? parsed.registration : '',
      auth: typeof parsed?.auth === 'string' ? parsed.auth : '',
      loading: typeof parsed?.loading === 'string' ? parsed.loading : '',
    };
  } catch {
    return { ...EMPTY_SCREEN_IMAGES };
  }
}

export function writeCachedScreenImages(images: ScreenImagesMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(SCREEN_IMAGES_CACHE_KEY, JSON.stringify(images));
  } catch {
    // ignore storage quota errors on very large images; DB remains authoritative
  }
}
