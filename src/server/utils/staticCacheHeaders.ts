import fs from 'node:fs';
import path from 'node:path';

const SERVICE_WORKER_RE = /(?:^|[\\/])(?:sw|sw-background-sync|firebase-messaging-sw|workbox-[^\\/]+)\.js$/i;
const BINARY_INSTALLER_RE = /\.(?:apk|aab|exe|msix|msixbundle|appx|appxbundle|cer)$/i;
const HASHED_ASSET_DIR_RE = /(?:^|[\\/])assets[\\/](?:js|css|fonts|media)[\\/]/i;
const CONTENT_HASHED_FILENAME_RE =
  /[-_.][a-zA-Z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i;

const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
};

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
  _reqPath: string,
  _isProduction: boolean = true
): Record<string, string> {
  return { ...NO_STORE_HEADERS };
}

export function resolveStaticCacheHeaders(
  filePath: string,
  _isProduction: boolean = true
): Record<string, string> {
  const normalized = filePath.split('?')[0];
  const lower = normalized.toLowerCase();

  if (isServiceWorkerScript(normalized)) {
    return {
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Service-Worker-Allowed': '/',
      ...NO_STORE_HEADERS,
    };
  }

  if (lower.endsWith('version.json')) {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE_HEADERS,
    };
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return { ...NO_STORE_HEADERS };
  }

  if (lower.endsWith('.webmanifest') || lower.endsWith('manifest.json')) {
    return {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      ...NO_STORE_HEADERS,
    };
  }

  if (lower.endsWith('assetlinks.json')) {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE_HEADERS,
    };
  }

  if (isBinaryInstallerAsset(normalized)) {
    const headers: Record<string, string> = { ...NO_STORE_HEADERS };
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

  return { ...NO_STORE_HEADERS };
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
