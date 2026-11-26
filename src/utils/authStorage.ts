export const AUTH_TOKEN_STORAGE_KEY = 'pos_auth_token';
export const AUTH_ALT_TOKEN_STORAGE_KEY = 'shoe_pos_jwt_token';
export const AUTH_USER_STORAGE_KEY = 'pos_current_user';
export const AUTH_ALT_USER_STORAGE_KEY = 'shoe_pos_user';
export const ACTIVE_TENANT_STORAGE_KEY = 'shoe_pos_active_tenant_id';

export function getStoredAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return (
    localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ||
    localStorage.getItem(AUTH_ALT_TOKEN_STORAGE_KEY)
  );
}

export function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function isJwtTokenValid(
  token?: string | null,
  options: { allowExpiredOffline?: boolean } = {}
): boolean {
  const candidate = token !== undefined ? token : getStoredAuthToken();
  if (!candidate || candidate === 'null' || candidate === 'undefined') {
    return false;
  }
  const payload = decodeJwtPayload(candidate);
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    if (
      options.allowExpiredOffline &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    ) {
      return true;
    }
    return false;
  }
  return true;
}

export function hasValidStoredAuthToken(): boolean {
  try {
    return isJwtTokenValid(undefined, { allowExpiredOffline: false });
  } catch {
    return false;
  }
}
