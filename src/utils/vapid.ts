/**
 * Isomorphic Web Push VAPID public key (P-256 uncompressed EC point) helpers.
 * Zero Node-only imports so it runs identically in browsers, Service Workers, and Node.
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function decodeBase64UrlToBytes(input: string): Uint8Array | null {
  if (!input || typeof input !== 'string') return null;
  const clean = input.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!clean || /[^A-Za-z0-9+/=]/.test(clean)) return null;

  const withoutPadding = clean.replace(/=+$/, '');
  const padLen = (4 - (withoutPadding.length % 4)) % 4;
  if (padLen === 3) return null;
  const padded = withoutPadding + '='.repeat(padLen);

  const cleanLen = withoutPadding.length;
  const outLen = Math.floor((cleanLen * 3) / 4);
  if (outLen <= 0) return null;

  const bytes = new Uint8Array(outLen);
  let p = 0;

  for (let i = 0; i < padded.length; i += 4) {
    const ch1 = padded.charCodeAt(i);
    const ch2 = padded.charCodeAt(i + 1);
    const ch3 = padded.charCodeAt(i + 2);
    const ch4 = padded.charCodeAt(i + 3);

    const c1 = ch1 < 256 ? BASE64_LOOKUP[ch1] : -1;
    const c2 = ch2 < 256 ? BASE64_LOOKUP[ch2] : -1;
    const isPad3 = padded[i + 2] === '=';
    const isPad4 = padded[i + 3] === '=';
    const c3 = isPad3 ? 0 : ch3 < 256 ? BASE64_LOOKUP[ch3] : -1;
    const c4 = isPad4 ? 0 : ch4 < 256 ? BASE64_LOOKUP[ch4] : -1;

    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) {
      return null;
    }

    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (p < outLen) bytes[p++] = (triple >> 16) & 0xff;
    if (!isPad3 && p < outLen) bytes[p++] = (triple >> 8) & 0xff;
    if (!isPad4 && p < outLen) bytes[p++] = triple & 0xff;
  }

  return bytes;
}

/**
 * Normalizes a Firebase / Web Push VAPID public key to unpadded URL-safe Base64
 * and verifies that it decodes to a valid 65-byte uncompressed P-256 public key (0x04 prefix).
 * Returns '' if invalid or empty.
 */
export function normalizeVapidPublicKey(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const stripped = raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '');

  if (!stripped || stripped.includes('@')) {
    return '';
  }

  const base64Url = stripped.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decoded = decodeBase64UrlToBytes(base64Url);
  if (!decoded || decoded.length !== 65 || decoded[0] !== 0x04) {
    return '';
  }

  return base64Url;
}

/**
 * Compares an existing PushSubscription.options.applicationServerKey buffer
 * against a normalized or raw VAPID public key string.
 */
export function doVapidKeysMatch(
  applicationServerKey: ArrayBufferLike | ArrayBufferView | null | undefined,
  vapidKey: string
): boolean {
  const normalized = normalizeVapidPublicKey(vapidKey);
  if (!normalized || !applicationServerKey) return false;

  const expected = decodeBase64UrlToBytes(normalized);
  if (!expected) return false;

  const actual = ArrayBuffer.isView(applicationServerKey)
    ? new Uint8Array(
        applicationServerKey.buffer,
        applicationServerKey.byteOffset,
        applicationServerKey.byteLength
      )
    : new Uint8Array(applicationServerKey);

  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}
