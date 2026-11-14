import fs from 'node:fs';
import path from 'node:path';

const SERVICE_WORKER_RE = /(?:^|[\\/])(?:sw|sw-background-sync|firebase-messaging-sw|workbox-[^\\/]+)\.js$/i;
const BINARY_INSTALLER_RE = /\.(?:apk|aab|exe|msix|msixbundle|appx|appxbundle|cer)$/i;
const HASHED_ASSET_DIR_RE = /(?:^|[\\/])assets[\\/](?:js|css|fonts|media)[\\/]/i;
const CONTENT_HASHED_FILENAME_RE =
  /[-_.][a-zA-Z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i;
const MUTABLE_STATIC_ASSET_RE =
  /\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|eot|css|js|mjs)$/i;

export function isServiceWorkerScript(filePath: string): boolean {
  return SERVICE_WORKER_RE.test(filePath);
}

export function isBinaryInstallerAsset(filePath: string): boolean {
  return BINARY_INSTALLER_RE.test(filePath);
}

export function isContentHashedAsset(filePath: string): boolean {
  if (!filePath || isBinaryInstallerAsset(filePath) || isServiceWorkerScript(filePath)) {
    return false;
  }
  const normalized = filePath.split('?')[0];
  return HASHED_ASSET_DIR_RE.test(normalized) || CONTENT_HASHED_FILENAME_RE.test(normalized);
}

export function resolveApiCacheHeaders(
  reqPath: string,
  isProduction: boolean
): Record<string, string> {
  const cleanPath = reqPath.split('?')[0].toLowerCase();

  if (cleanPath === '/notifications/stream') {
    return {
      'Cache-Control': 'no-cache, no-transform',
    };
  }

  if (!isProduction) {
    return {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    };
  }

  return {
    'Cache-Control': 'private, no-cache, must-revalidate',
    Vary: 'X-Tenant-Id, X-Auth-Token, Authorization',
  };
}

export function resolveStaticCacheHeaders(
  filePath: string,
  isProduction: boolean = true
): Record<string, string> {
  const normalized = filePath.split('?')[0];
  const lower = normalized.toLowerCase();

  if (isServiceWorkerScript(normalized)) {
    return {
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };
  }

  if (lower.endsWith('version.json')) {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    };
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    };
  }

  if (lower.endsWith('.webmanifest') || lower.endsWith('manifest.json')) {
    return {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': isProduction
        ? 'no-cache, must-revalidate'
        : 'no-cache, no-store, must-revalidate',
    };
  }

  if (lower.endsWith('assetlinks.json')) {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': isProduction ? 'public, max-age=3600' : 'no-cache, must-revalidate',
    };
  }

  if (isBinaryInstallerAsset(normalized)) {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache, must-revalidate',
    };
    if (lower.endsWith('.apk')) {
      headers['Content-Type'] = 'application/vnd.android.package-archive';
      headers['Content-Disposition'] = 'attachment; filename="SarbaazSoft-POS.apk"';
    } else if (lower.endsWith('.exe')) {
      headers['Content-Type'] = 'application/vnd.microsoft.portable-executable';
      headers['Content-Disposition'] = 'attachment; filename="SarbaazSoft-POS-Desktop-Setup.exe"';
    } else if (lower.endsWith('.msixbundle')) {
      headers['Content-Type'] = 'application/msixbundle';
    } else if (lower.endsWith('.msix')) {
      headers['Content-Type'] = 'application/msix';
    } else if (lower.endsWith('.appxbundle')) {
      headers['Content-Type'] = 'application/appxbundle';
    } else if (lower.endsWith('.appx')) {
      headers['Content-Type'] = 'application/appx';
    }
    return headers;
  }

  // During development, ensure instant code/asset updates without browser disk caching
  if (!isProduction) {
    return {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    };
  }

  if (isContentHashedAsset(normalized)) {
    return {
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
  }

  if (MUTABLE_STATIC_ASSET_RE.test(normalized)) {
    return {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    };
  }

  return {
    'Cache-Control': 'public, max-age=300, must-revalidate',
  };
}

export function resolveServiceWorkerFilePath(
  rootDir: string,
  filename: string,
  isProduction: boolean
): string | null {
  const safeName = path.basename(filename);
  const distCandidate = path.join(rootDir, 'dist', safeName);
  const publicCandidate = path.join(rootDir, 'public', safeName);
  const candidates = isProduction
    ? [distCandidate, publicCandidate]
    : [publicCandidate, distCandidate];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
