// Central API service with JWT token injection, tenant isolation, and offline POS fallback
import {
  cacheCatalogOffline,
  cacheCompanySettingsOffline,
  cacheCustomersOffline,
  deleteCachedProductOffline,
  getCachedCompanySettingsOffline,
  getCachedCustomersOffline,
  lookupCachedProductOffline,
  searchCachedProductsOffline,
  upsertSingleCachedSaleOffline,
  verifyInvoiceOffline,
} from '../utils/offlineDb.ts';
import { isTransientNetworkError } from './offline/syncEngine.ts';
import { transformKeysToCamelCase } from '../utils/caseTransformer.ts';
import type { ProductFormValues, TrialActivation, TrialTrackingHistoryEntry, FreeTrialSummary, PlatformNotification, PlatformNotificationType, GroupedNotificationsResponse, AllNotificationsResponse } from '../types.ts';
import type {
  NotificationPresetId,
  StoreNotificationChannelId,
  StoreNotificationDeliveryStatus,
  StoreNotificationEventId,
  StoreNotificationPreferences,
} from '../utils/notificationPreferences.ts';
import {
  ACTIVE_TENANT_STORAGE_KEY,
  AUTH_ALT_TOKEN_STORAGE_KEY,
  AUTH_ALT_USER_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  decodeJwtPayload,
  getStoredAuthToken,
  isJwtTokenValid,
} from '../utils/authStorage.ts';

function isPublicOrPlatformPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/install' ||
    pathname.startsWith('/install/')
  );
}

export function getActiveTenantId(): number | null {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return null;
  }
  const token = getAuthToken();
  const hasValidToken = Boolean(token && isStoredTokenValid(token));
  const payload = hasValidToken && token ? decodeJwtPayload(token) : null;
  const tokenRole = String(payload?.role || '').toUpperCase();
  const tokenTenantId = Number(payload?.tenantId ?? payload?.tenant_id);
  if (hasValidToken && tokenRole && tokenRole !== 'SUPERADMIN' && Number.isSafeInteger(tokenTenantId) && tokenTenantId > 0) {
    return tokenTenantId;
  }
  const storedUser = hasValidToken ? getStoredUser() : null;
  const storedRole = String(storedUser?.originalRole || storedUser?.role || '').toUpperCase();
  const storedTenantId = Number(storedUser?.tenantId ?? storedUser?.tenant_id);
  if (hasValidToken && storedRole && storedRole !== 'SUPERADMIN' && Number.isSafeInteger(storedTenantId) && storedTenantId > 0) {
    return storedTenantId;
  }
  const effectiveSuperAdmin =
    hasValidToken && (tokenRole === 'SUPERADMIN' || storedRole === 'SUPERADMIN');
  if (effectiveSuperAdmin && typeof window !== 'undefined' && isPublicOrPlatformPath(pathname)) {
    return null;
  }
  const queryId = (() => {
    if (typeof window === 'undefined') return 0;
    const sp = new URLSearchParams(window.location.search);
    const qVal = sp.get('tenantId') || sp.get('storeId') || sp.get('tenant_id') || sp.get('store_id');
    const num = Number(qVal);
    return Number.isSafeInteger(num) && num > 0 ? num : 0;
  })();
  if (queryId > 0) return queryId;
  const selectedId = effectiveSuperAdmin ? Number(localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)) : 0;
  return Number.isSafeInteger(selectedId) && selectedId > 0 ? selectedId : null;
}

type SessionClearListener = () => void;
type TenantChangeListener = (nextTenantId: number | null, prevTenantId: number | null) => void;
type ApiMutationListener = (endpoint: string, method: string) => void;

const sessionClearListeners = new Set<SessionClearListener>();
const tenantChangeListeners = new Set<TenantChangeListener>();
const apiMutationListeners = new Set<ApiMutationListener>();
let lastTrackedTenantId: number | null = null;

export function subscribeSessionClear(listener: SessionClearListener): () => void {
  sessionClearListeners.add(listener);
  return () => {
    sessionClearListeners.delete(listener);
  };
}

export function subscribeTenantChange(listener: TenantChangeListener): () => void {
  tenantChangeListeners.add(listener);
  return () => {
    tenantChangeListeners.delete(listener);
  };
}

export function subscribeApiMutation(listener: ApiMutationListener): () => void {
  apiMutationListeners.add(listener);
  return () => {
    apiMutationListeners.delete(listener);
  };
}

function isNonMutatingPostEndpoint(endpoint: string): boolean {
  const pathOnly = endpoint.split('?')[0].toLowerCase();
  return (
    pathOnly === '/auth/login' ||
    pathOnly === '/auth/logout' ||
    pathOnly === '/auth/password-reset/request' ||
    pathOnly === '/auth/password-reset/verify' ||
    pathOnly === '/auth/password-reset/confirm' ||
    pathOnly === '/chat' ||
    pathOnly.startsWith('/notifications/fcm-token') ||
    pathOnly.startsWith('/notifications/test-') ||
    pathOnly === '/settings/test-email'
  );
}

function notifyApiMutationSuccess(endpoint: string, method: string): void {
  if (method === 'GET' || method === 'HEAD' || isNonMutatingPostEndpoint(endpoint)) {
    return;
  }
  for (const listener of Array.from(apiMutationListeners)) {
    try {
      listener(endpoint, method);
    } catch (err) {
      console.warn('API mutation listener error:', err);
    }
  }
}

function notifyTenantChanged(nextTenantId: number | null) {
  if (lastTrackedTenantId === nextTenantId) return;
  const prev = lastTrackedTenantId;
  lastTrackedTenantId = nextTenantId;
  for (const listener of Array.from(tenantChangeListeners)) {
    try {
      listener(nextTenantId, prev);
    } catch (err) {
      console.warn('Tenant change listener error:', err);
    }
  }
}

export function setActiveTenantId(tenantId: number | null) {
  const token = getAuthToken();
  const payload = token && isStoredTokenValid(token) ? decodeJwtPayload(token) : null;
  const prevTenantId = lastTrackedTenantId ?? getActiveTenantId();
  let resolvedNext: number | null = null;

  if (String(payload?.role || '').toUpperCase() === 'SUPERADMIN' && Number.isSafeInteger(tenantId) && Number(tenantId) > 0) {
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, String(tenantId));
    resolvedNext = Number(tenantId);
  } else {
    // Store users get tenant context from JWT; unauthenticated PWA launches use URL tenantId.
    localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
    resolvedNext = getActiveTenantId();
  }

  if (prevTenantId !== resolvedNext) {
    lastTrackedTenantId = prevTenantId;
    notifyTenantChanged(resolvedNext);
  }
}

export function getAuthToken(): string | null {
  return getStoredAuthToken();
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  localStorage.setItem(AUTH_ALT_TOKEN_STORAGE_KEY, token);
}

export function removeAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_ALT_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  localStorage.removeItem(AUTH_ALT_USER_STORAGE_KEY);
}

export function setAuthSession(token: string, user: any) {
  setAuthToken(token);
  const roleUpper = String(user?.originalRole || user?.role || '').toUpperCase();
  if (roleUpper === 'SUPERADMIN') {
    localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
    try {
      localStorage.removeItem('pos_unauth_scoped_tenant_id');
      sessionStorage.removeItem('pos_unauth_scoped_tenant_id');
    } catch {}
    setActiveTenantId(null);
  } else {
    setActiveTenantId(Number(user?.tenantId || 0) || null);
  }
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  localStorage.setItem(AUTH_ALT_USER_STORAGE_KEY, JSON.stringify(user));
  notifyTenantChanged(roleUpper === 'SUPERADMIN' ? null : getActiveTenantId());
}

export function clearAllSessionState(): void {
  removeAuthToken();
  lastTrackedTenantId = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
      localStorage.removeItem('pos_unauth_scoped_tenant_id');
      localStorage.removeItem('pos_read_notifications');
      localStorage.removeItem('pos_superadmin_read_notifs');
      localStorage.removeItem('sammi_chat_history');
      localStorage.removeItem('pos_barcode_tag_options');
      localStorage.removeItem('pos_last_synced_at');
      localStorage.removeItem('pos_cashier_last_activity_at');

      // Clear any tenant-scoped or user-scoped keys without removing device preferences like pos_theme, remembered accounts, or offline transaction queues
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('pos_dashboard_visited_') ||
          key.startsWith('pos_read_notifs_') ||
          key.startsWith('pos_offline_company_settings_tenant:') ||
          key.startsWith('pos_offline_tenant_info:')
        )) {
          localStorage.removeItem(key);
        }
      }
    } catch {}
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.clear();
    } catch {}
  }

  for (const listener of Array.from(sessionClearListeners)) {
    try {
      listener();
    } catch (err) {
      console.warn('Session clear listener error:', err);
    }
  }
}

/**
 * Tells the server to terminate the current session (revokes the token, clears auth cookies).
 * Fire-and-forget on purpose: logging out in the UI must be immediate and must never be blocked
 * by the network. `keepalive` lets the request finish even if the page is navigating away.
 * The token is read synchronously, so callers can clear local state right after calling this.
 */
export function revokeSessionOnServer(): void {
  const token = getAuthToken();
  if (!token || typeof fetch === 'undefined') return;
  let sessionId = '';
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionId = sessionStorage.getItem('pos_owner_presence_session_id') || '';
    }
  } catch {}
  try {
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    }).catch(() => {});
  } catch {
    // Never let a logout request failure surface to the user.
  }
}

function getStoredUser() {
  const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY) || localStorage.getItem(AUTH_ALT_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isStoredTokenValid(token?: string | null): boolean {
  const candidate = token !== undefined ? token : getAuthToken();
  return isJwtTokenValid(candidate, { allowExpiredOffline: true });
}

export function getValidatedStoredSession(): { token: string; user: any } | null {
  try {
    const token = getAuthToken();
    if (!isStoredTokenValid(token)) {
      if (token) {
        removeAuthToken();
      }
      return null;
    }
    const user = getStoredUser();
    if (!user || typeof user !== 'object') {
      return null;
    }
    return { token: token!, user };
  } catch {
    return null;
  }
}

interface RequestOptions extends RequestInit {
  body?: any;
  idempotent?: boolean;
  skipKeyTransform?: boolean;
  omitTenantHeader?: boolean;
}

export function createAbortError(message = 'The operation was aborted.'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      ((err as { name?: string }).name === 'AbortError' ||
        String((err as { message?: string }).message || '').includes('aborted'))
  );
}

function waitWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) {
    return signal?.aborted ? Promise.reject(createAbortError()) : Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function apiFetch<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const activeTenantId = options.omitTenantHeader ? null : getActiveTenantId();
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['X-Auth-Token'] = token;
  }

  if (activeTenantId && !headers['X-Tenant-Id']) headers['X-Tenant-Id'] = String(activeTenantId);

  const { body: rawBody, idempotent, skipKeyTransform, omitTenantHeader: _omitTenantHeader, ...restOptions } = options;
  const method = (restOptions.method || 'GET').toUpperCase();
  const isIdempotentRequest = method === 'GET' || method === 'HEAD' || Boolean(idempotent);

  const serializedBody =
    rawBody === undefined || rawBody === null
      ? undefined
      : typeof rawBody === 'object'
      ? JSON.stringify(rawBody)
      : typeof rawBody === 'number' || typeof rawBody === 'boolean'
      ? JSON.stringify({ value: rawBody })
      : (rawBody as BodyInit);

  const config: RequestInit = {
    ...restOptions,
    method,
    credentials: 'include',
    cache: 'no-store',
    headers,
    ...(serializedBody !== undefined ? { body: serializedBody } : {}),
  };

  let response: Response | null = null;
  let contentType = '';
  let lastNetworkError: any = null;

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  // Retry transient network errors or 502/503/504 gateway responses ONLY for idempotent requests when online.
  // Non-idempotent mutations (POST/PUT/PATCH/DELETE) make a single attempt to prevent duplicate writes.
  const retryDelays = isBrowserOffline || !isIdempotentRequest ? [0] : [0, 400, 800, 1400, 2200, 3200];
  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt] > 0) {
      await waitWithSignal(retryDelays[attempt], options.signal);
    }
    try {
      const candidate = await fetch(`/api${endpoint}`, config);
      const candType = candidate.headers.get('content-type') || '';
      if (
        isIdempotentRequest &&
        (candidate.status === 502 || candidate.status === 503 || candidate.status === 504) &&
        attempt < retryDelays.length - 1
      ) {
        continue;
      }
      response = candidate;
      contentType = candType;
      lastNetworkError = null;
      break;
    } catch (err: any) {
      if (isAbortError(err) || options.signal?.aborted) {
        throw createAbortError();
      }
      lastNetworkError = err;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        break;
      }
    }
  }

  // If an iframe proxy or service worker intercepts requests with non-JSON 403/405 responses
  // (or network reset for idempotent GET/HEAD), retry via GET RPC query bridge.
  // For non-idempotent mutations, only trigger the bridge when a proxy explicitly blocked the HTTP verb (non-JSON 403/405), never on dropped sockets or 502/503/504.
  const shouldUseGetBridge =
    !isBrowserOffline &&
    !options.signal?.aborted &&
    (isIdempotentRequest
      ? !response || (!contentType.includes('application/json') && !response.ok)
      : Boolean(response && !contentType.includes('application/json') && (response.status === 403 || response.status === 405)));

  if (shouldUseGetBridge) {
    const fallbackDelays = isIdempotentRequest ? [0, 600, 1400] : [0];
    for (let fbAttempt = 0; fbAttempt < fallbackDelays.length; fbAttempt++) {
      if (fallbackDelays[fbAttempt] > 0) {
        await waitWithSignal(fallbackDelays[fbAttempt], options.signal);
      }
      try {
        const separator = endpoint.includes('?') ? '&' : '?';
        const fallbackParams = new URLSearchParams();
        if (method !== 'GET') {
          fallbackParams.set('__method', method);
        }
        if (typeof serializedBody === 'string' && serializedBody.length < 6000) {
          fallbackParams.set('__body', serializedBody);
        }
        if (token) {
          fallbackParams.set('__token', token);
        }
        if (activeTenantId) fallbackParams.set('__tenantId', String(activeTenantId));
        fallbackParams.set('_t', String(Date.now()));

        const fallbackUrl = `/api${endpoint}${separator}${fallbackParams.toString()}`;
        const fallbackRes = await fetch(fallbackUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: options.signal,
        });
        const fallbackType = fallbackRes.headers.get('content-type') || '';
        if (
          isIdempotentRequest &&
          (fallbackRes.status === 502 || fallbackRes.status === 503 || fallbackRes.status === 504) &&
          fbAttempt < fallbackDelays.length - 1
        ) {
          continue;
        }
        if (!response || fallbackType.includes('application/json') || fallbackRes.ok) {
          response = fallbackRes;
          contentType = fallbackType;
          lastNetworkError = null;
        }
        break;
      } catch (fallbackErr: any) {
        if (isAbortError(fallbackErr) || options.signal?.aborted) {
          throw createAbortError();
        }
        if (!lastNetworkError) {
          lastNetworkError = fallbackErr;
        }
      }
    }
  }

  if (!response) {
    const rawMsg = String(lastNetworkError?.message || '');
    const isConnectivityFailure = isBrowserOffline || !rawMsg || isTransientNetworkError(lastNetworkError);
    if (isConnectivityFailure && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('pos:backend-disconnected'));
      } catch {}
    }
    throw new Error(
      isConnectivityFailure
        ? 'Server is temporarily reconnecting. Please try again in a moment.'
        : rawMsg
    );
  }

  // Handle 204 No Content / 205 Reset Content safely (no body expected)
  if (response.status === 204 || response.status === 205) {
    return {} as T;
  }

  let data: any = null;
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    data = await response.json().catch(() => ({}));
  } else {
    // Attempt parsing JSON in case content-type was omitted or returned as text/plain
    const textBody = await response.text().catch(() => '');
    if (!textBody.trim()) {
      data = {};
    } else {
      try {
        data = JSON.parse(textBody);
      } catch {
        if (!response.ok) {
          throw new Error(`Server Error (${response.status}): Endpoint /api${endpoint} unavailable.`);
        }
        throw new Error(`Unexpected non-JSON response from server on /api${endpoint}.`);
      }
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !endpoint.includes('/auth/') && !endpoint.includes('/login')) {
      clearAllSessionState();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
    }
    if (data?.code === 'SUBSCRIPTION_EXPIRED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tenant:subscription-expired', { detail: data }));
    }
    const apiError = new Error(data.error || `API Error (${response.status})`) as Error & {
      code?: string;
      stores?: Array<{ tenantId: number; name: string }>;
      status?: number;
      remainingSeconds?: number;
      cooldownSeconds?: number;
      attemptCount?: number;
      nextAvailableAt?: string | null;
      flow?: string;
      blockedByIp?: boolean;
      detail?: string;
      hint?: string;
      position?: string;
    };
    apiError.code = data.code;
    apiError.stores = Array.isArray(data.stores) ? data.stores : undefined;
    apiError.status = response.status;
    if (typeof data.remainingSeconds === 'number') apiError.remainingSeconds = data.remainingSeconds;
    if (typeof data.cooldownSeconds === 'number') apiError.cooldownSeconds = data.cooldownSeconds;
    if (typeof data.attemptCount === 'number') apiError.attemptCount = data.attemptCount;
    if (data.nextAvailableAt !== undefined) apiError.nextAvailableAt = data.nextAvailableAt;
    if (typeof data.flow === 'string') apiError.flow = data.flow;
    if (typeof data.blockedByIp === 'boolean') apiError.blockedByIp = data.blockedByIp;
    if (typeof data.detail === 'string') apiError.detail = data.detail;
    if (typeof data.hint === 'string') apiError.hint = data.hint;
    if (typeof data.position === 'string') apiError.position = data.position;
    throw apiError;
  }

  const transformed = skipKeyTransform ? (data as T) : transformKeysToCamelCase<T>(data);
  notifyApiMutationSuccess(endpoint, method);
  return transformed;
}

export const api = {
  // Multi-Tenant SaaS & Onboarding Endpoints
  saas: {
    resolve: (targetTenantId?: number | string | null, reqOptions?: { signal?: AbortSignal }) => {
      let q = '';
      const hasExplicitSystemScope =
        targetTenantId === null || targetTenantId === 0 || targetTenantId === '0';
      const numericTid =
        targetTenantId !== undefined && targetTenantId !== null && String(targetTenantId).trim() !== ''
          ? Number(targetTenantId)
          : 0;
      const hasPositiveExplicitTid = Number.isSafeInteger(numericTid) && numericTid > 0;
      if (hasPositiveExplicitTid) {
        q = `?tenantId=${encodeURIComponent(numericTid)}&storeId=${encodeURIComponent(numericTid)}`;
      } else if (!hasExplicitSystemScope && typeof window !== 'undefined' && window.location.search) {
        q = window.location.search;
      }
      return apiFetch(`/saas/resolve${q}`, {
        signal: reqOptions?.signal,
        omitTenantHeader: !hasPositiveExplicitTid && hasExplicitSystemScope,
      });
    },
    getOnboarding: (tenantId?: number) => {
      const query = tenantId ? `?tenantId=${encodeURIComponent(String(tenantId))}` : '';
      return apiFetch(`/tenants/onboarding${query}`, {
        headers: tenantId ? { 'X-Tenant-Id': String(tenantId) } : undefined,
      });
    },
    completeOnboarding: (data: any, tenantId?: number) => {
      const query = tenantId ? `?tenantId=${encodeURIComponent(String(tenantId))}` : '';
      return apiFetch(`/tenants/onboarding${query}`, {
        method: 'POST',
        body: tenantId ? { ...data, tenantId } : data,
        headers: tenantId ? { 'X-Tenant-Id': String(tenantId) } : undefined,
      });
    },
    checkEmailAvailability: (email: string) =>
      apiFetch<{ available: boolean; message?: string }>(`/saas/check-email?email=${encodeURIComponent(email)}`),
    getPublicStats: () =>
      apiFetch<{
        stores: number;
        products: number;
        invoicesToday: number;
        platformRevenue: number;
        superAdminEmail?: string;
        superAdminPhone?: string;
      }>('/saas/public-stats'),
    getPlatformOwner: () =>
      apiFetch<{
        name?: string;
        email?: string;
        phone?: string;
      }>('/saas/platform-owner'),
    submitStoreRequest: (data: any) =>
      apiFetch<any>('/saas/store-request', {
        method: 'POST',
        body: data,
      }),
  },
  get tenant() {
    return this.saas;
  },

  // SuperAdmin Control Panel Endpoints
  superAdmin: {
    getOverview: () => apiFetch('/superadmin/overview'),
    getTrialActivations: (params?: { search?: string; status?: string }) => {
      const q = new URLSearchParams();
      if (params?.search) q.set('search', params.search);
      if (params?.status) q.set('status', params.status);
      const queryStr = q.toString() ? `?${q.toString()}` : '';
      return apiFetch<{
        trials: TrialActivation[];
        history?: TrialTrackingHistoryEntry[];
        summary: FreeTrialSummary;
      }>(`/superadmin/trial-activations${queryStr}`);
    },
    getFreeTrials: (params?: { search?: string; status?: string }) => {
      const q = new URLSearchParams();
      if (params?.search) q.set('search', params.search);
      if (params?.status) q.set('status', params.status);
      const queryStr = q.toString() ? `?${q.toString()}` : '';
      return apiFetch<{
        trials: TrialActivation[];
        history: TrialTrackingHistoryEntry[];
        summary: FreeTrialSummary;
      }>(`/superadmin/free-trials${queryStr}`);
    },
    getTrialHistory: (params?: { search?: string; eventType?: string; trialId?: number; tenantId?: number }) => {
      const q = new URLSearchParams();
      if (params?.search) q.set('search', params.search);
      if (params?.eventType) q.set('eventType', params.eventType);
      if (params?.trialId) q.set('trialId', String(params.trialId));
      if (params?.tenantId) q.set('tenantId', String(params.tenantId));
      const queryStr = q.toString() ? `?${q.toString()}` : '';
      return apiFetch<{ history: TrialTrackingHistoryEntry[] }>(`/superadmin/free-trials/history${queryStr}`);
    },
    getFreeTrialHistory: (id: number) =>
      apiFetch<{ history: TrialTrackingHistoryEntry[] }>(`/superadmin/free-trials/${id}/history`),
    updateFreeTrial: (
      id: number,
      data: {
        storeName?: string;
        userName?: string;
        email?: string;
        phone?: string;
        businessType?: 'RETAIL' | 'WHOLESALE' | string;
        pricingMode?: 'FIXED' | 'NEGOTIABLE' | string;
        trialStartDate?: string;
        trialEndDate?: string;
        status?: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CONVERTED' | 'PENDING' | string;
        notes?: string;
      }
    ) =>
      apiFetch<{
        success: boolean;
        message: string;
        trial: TrialActivation;
      }>(`/superadmin/free-trials/${id}`, {
        method: 'PATCH',
        body: data,
      }),
    extendFreeTrial: (id: number, days = 30, notes?: string) =>
      apiFetch<{
        success: boolean;
        message: string;
        trial: TrialActivation;
        newEndDate?: string;
      }>(`/superadmin/free-trials/${id}/extend`, {
        method: 'POST',
        body: { days, notes },
      }),
    expireFreeTrial: (id: number, notes?: string) =>
      apiFetch<{
        success: boolean;
        message: string;
        trial: TrialActivation;
      }>(`/superadmin/free-trials/${id}/expire`, {
        method: 'POST',
        body: { notes },
      }),
    suspendFreeTrial: (id: number, notes?: string) =>
      apiFetch<{
        success: boolean;
        message: string;
        trial: TrialActivation;
      }>(`/superadmin/free-trials/${id}/suspend`, {
        method: 'POST',
        body: { notes },
      }),
    reactivateFreeTrial: (id: number, days?: number, notes?: string) =>
      apiFetch<{
        success: boolean;
        message: string;
        trial: TrialActivation;
      }>(`/superadmin/free-trials/${id}/reactivate`, {
        method: 'POST',
        body: { days, notes },
      }),
    deleteFreeTrial: (id: number) =>
      apiFetch<{
        success: boolean;
        deletedTrialId: number;
        deletedTenantId?: number | null;
        message: string;
      }>(`/superadmin/free-trials/${id}`, {
        method: 'DELETE',
      }),
    extendTrialActivation: (id: number, days = 30) =>
      apiFetch<{
        success: boolean;
        message: string;
        trial: TrialActivation;
      }>(`/superadmin/trial-activations/${id}/extend`, {
        method: 'POST',
        body: { days },
      }),
    toggleTenantStatus: (tenantId: number, status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED') =>
      apiFetch(`/superadmin/tenants/${tenantId}/status`, {
        method: 'PATCH',
        body: { status },
      }),
    updateTenantSubscription: (
      tenantId: number,
      data: {
        storeName?: string;
        ownerEmail?: string;
        ownerPhone?: string;
        subscriptionPlan?: '6_MONTHS' | 'YEARLY' | string;
        subscriptionStartDate?: string;
        subscriptionEndDate?: string;
        subscriptionStatus?: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
        renewFromNow?: boolean;
      }
    ) =>
      apiFetch(`/superadmin/tenants/${tenantId}/subscription`, {
        method: 'PATCH',
        body: data,
      }),
    deleteTenant: (tenantId: number) =>
      apiFetch(`/superadmin/tenants/${tenantId}/delete`, {
        method: 'POST',
      }),
    exportTenantSql: (tenantId: number) =>
      apiFetch<{
        success: boolean;
        filename: string;
        storeName: string;
        totalRows: number;
        sql: string;
      }>(`/superadmin/tenants/${tenantId}/export-sql`),
    exportPlatformSql: () =>
      apiFetch<{
        success: boolean;
        filename: string;
        totalRows: number;
        sql: string;
      }>('/superadmin/export-sql'),
    importPlatformSql: (sqlContent: string) =>
      apiFetch<{
        success: boolean;
        message: string;
        counts?: {
          stores: number;
          products: number;
          purchases: number;
          sales: number;
          customers: number;
          returns: number;
        };
        timestamp?: string;
      }>('/superadmin/import-sql', {
        method: 'POST',
        body: { sql: sqlContent, sqlContent },
      }),
    createTenant: (data: {
      storeName: string;
      ownerName: string;
      ownerEmail: string;
      password?: string;
      ownerPhone?: string;
      currency?: string;
      businessType?: 'RETAIL' | 'WHOLESALE' | string;
      pricingMode?: 'FIXED' | 'NEGOTIABLE' | string;
      allowHalfCarton?: boolean;
      subscriptionPlan?: '6_MONTHS' | 'YEARLY' | string;
      subscriptionStartDate?: string;
      subscriptionEndDate?: string;
    }) => apiFetch('/superadmin/tenants', { method: 'POST', body: data }),
    getNotifications: () =>
      apiFetch<{ notifications: PlatformNotification[] }>('/superadmin/notifications'),
    sendNotification: (data: {
      tenantId?: number | null;
      targetRole?: 'ALL' | 'ADMIN' | 'CASHIER' | 'SUPERADMIN';
      title: string;
      message: string;
      type?: PlatformNotificationType;
      actionUrl?: string;
      actionLabel?: string;
      expiresAt?: string | null;
      eventId?: string;
    }) =>
      apiFetch<{ success: boolean; message: string; notification: PlatformNotification; deduplicated?: boolean }>(
        '/superadmin/notifications',
        { method: 'POST', body: data }
      ),
    deleteNotification: (id: number) =>
      apiFetch<{ success: boolean; message: string }>(`/superadmin/notifications/${id}`, {
        method: 'DELETE',
      }),
  },

  install: {
    status: () => apiFetch<any>('/install/status'),
    installPlatform: (data: { name: string; email: string; password: string; phone?: string; whatsapp?: string }) =>
      apiFetch('/install/install-platform', { method: 'POST', body: data }),
    reset: (password: string, email?: string, dropTables?: boolean) =>
      apiFetch('/install/reset', { method: 'POST', body: { password, email, dropTables } }),
    dropTables: (password: string) =>
      apiFetch('/install/drop-tables', { method: 'POST', body: { password } }),
    lock: (password?: string) =>
      apiFetch('/install/lock', { method: 'POST', body: { password } }),
  },
  auth: {
    login: (credentials: any) => {
      const rawTid = Number(credentials?.tenantId ?? credentials?.tenant_id ?? 0);
      const cleanTenantId = Number.isInteger(rawTid) && rawTid > 0 ? rawTid : undefined;
      const bodyPayload: Record<string, any> = { ...credentials };
      if (cleanTenantId) {
        bodyPayload.tenantId = cleanTenantId;
        bodyPayload.tenant_id = cleanTenantId;
      } else {
        delete bodyPayload.tenantId;
        delete bodyPayload.tenant_id;
      }
      return apiFetch('/auth/login', {
        method: 'POST',
        body: bodyPayload,
        omitTenantHeader: !cleanTenantId,
        ...(cleanTenantId ? { headers: { 'X-Tenant-Id': String(cleanTenantId) } } : {}),
      });
    },
    requestPasswordResetCode: (data: {
      email: string;
      tenantId?: number | null;
      roleScope?: 'ALL' | 'STORE' | 'SUPERADMIN';
      isResend?: boolean;
    }) => {
      const isSuperAdminScope = data.roleScope === 'SUPERADMIN';
      const hasExplicitNoTenant = data.tenantId === null || data.tenantId === 0 || (data.roleScope === 'ALL' && !data.tenantId);
      const rawTid = isSuperAdminScope || hasExplicitNoTenant ? 0 : Number(data?.tenantId ?? getActiveTenantId() ?? 0);
      const cleanTenantId = Number.isInteger(rawTid) && rawTid > 0 ? rawTid : undefined;
      return apiFetch<{
        success: boolean;
        emailSent: boolean;
        emailProvider?: string;
        email: string;
        expiresAt: string;
        message: string;
        cooldown?: {
          flow: 'email_verification' | 'password_reset';
          attemptCount: number;
          cooldownSeconds: number;
          remainingSeconds: number;
          nextAvailableAt: string | null;
          isInCooldown: boolean;
        };
      }>('/auth/password-reset/request', {
        method: 'POST',
        body: {
          email: data.email,
          roleScope: data.roleScope || 'ALL',
          isResend: Boolean(data.isResend),
          ...(cleanTenantId ? { tenantId: cleanTenantId } : {}),
        },
        omitTenantHeader: !cleanTenantId,
        ...(cleanTenantId ? { headers: { 'X-Tenant-Id': String(cleanTenantId) } } : {}),
      });
    },
    getResendStatus: (flow: 'email_verification' | 'password_reset', email?: string) => {
      const qs = new URLSearchParams({ flow });
      if (email && email.trim()) {
        qs.set('email', email.trim().toLowerCase());
      }
      return apiFetch<{
        flow: 'email_verification' | 'password_reset';
        attemptCount: number;
        cooldownSeconds: number;
        remainingSeconds: number;
        nextAvailableAt: string | null;
        isInCooldown: boolean;
        blockedByIp?: boolean;
      }>(`/auth/resend-status?${qs.toString()}`);
    },
    verifyPasswordResetCode: (data: {
      email: string;
      code: string;
      tenantId?: number | null;
      roleScope?: 'ALL' | 'STORE' | 'SUPERADMIN';
    }) => {
      const isSuperAdminScope = data.roleScope === 'SUPERADMIN';
      const hasExplicitNoTenant =
        data.tenantId === null || data.tenantId === 0 || (data.roleScope === 'ALL' && !data.tenantId);
      const rawTid = isSuperAdminScope || hasExplicitNoTenant ? 0 : Number(data?.tenantId ?? getActiveTenantId() ?? 0);
      const cleanTenantId = Number.isInteger(rawTid) && rawTid > 0 ? rawTid : undefined;
      return apiFetch<{
        valid: boolean;
        verified: boolean;
        email?: string;
        expiresAt?: string;
        message?: string;
      }>('/auth/password-reset/verify', {
        method: 'POST',
        body: {
          email: data.email,
          code: data.code,
          roleScope: data.roleScope || 'ALL',
          ...(cleanTenantId ? { tenantId: cleanTenantId } : {}),
        },
        omitTenantHeader: !cleanTenantId,
        ...(cleanTenantId ? { headers: { 'X-Tenant-Id': String(cleanTenantId) } } : {}),
      });
    },
    confirmPasswordReset: (data: {
      email: string;
      code: string;
      newPassword: string;
      confirmPassword?: string;
      tenantId?: number | null;
      roleScope?: 'ALL' | 'STORE' | 'SUPERADMIN';
    }) => {
      const isSuperAdminScope = data.roleScope === 'SUPERADMIN';
      const hasExplicitNoTenant =
        data.tenantId === null || data.tenantId === 0 || (data.roleScope === 'ALL' && !data.tenantId);
      const rawTid = isSuperAdminScope || hasExplicitNoTenant ? 0 : Number(data?.tenantId ?? getActiveTenantId() ?? 0);
      const cleanTenantId = Number.isInteger(rawTid) && rawTid > 0 ? rawTid : undefined;
      return apiFetch<{
        success: boolean;
        message: string;
      }>('/auth/password-reset/confirm', {
        method: 'POST',
        body: {
          email: data.email,
          code: data.code,
          newPassword: data.newPassword,
          ...(data.confirmPassword !== undefined ? { confirmPassword: data.confirmPassword } : {}),
          roleScope: data.roleScope || 'ALL',
          ...(cleanTenantId ? { tenantId: cleanTenantId } : {}),
        },
        omitTenantHeader: !cleanTenantId,
        ...(cleanTenantId ? { headers: { 'X-Tenant-Id': String(cleanTenantId) } } : {}),
      });
    },
    changePassword: (data: { currentPassword?: string; newPassword: string; confirmPassword?: string }) =>
      apiFetch('/auth/change-password', { method: 'PUT', body: data }),
    me: () => apiFetch('/auth/me'),
    updateProfile: (data: any) => apiFetch('/auth/profile', { method: 'PUT', body: data }),
    saveTheme: (themeColor: string) =>
      apiFetch<{ success: boolean; themeColor: string; user: any }>('/auth/theme', {
        method: 'PUT',
        body: { themeColor },
      }),
    applyThemeToStaff: (themeColor: string) =>
      apiFetch<{ success: boolean; themeColor: string; updatedCount: number; message: string; user?: any }>(
        '/auth/theme/staff',
        {
          method: 'PUT',
          body: { themeColor },
        }
      ),
    verifyEmail: (token: string, email?: string) =>
      apiFetch<{
        success: boolean;
        verified: boolean;
        active: boolean;
        token?: string;
        user?: any;
        message: string;
      }>('/auth/verify-email', {
        method: 'POST',
        body: {
          token,
          code: token,
          ...(email ? { email } : {}),
        },
      }),
    resendVerification: (email: string, tenantId?: number) =>
      apiFetch<{
        success: boolean;
        emailSent: boolean;
        sandbox?: boolean;
        message: string;
        cooldown?: {
          flow: 'email_verification' | 'password_reset';
          attemptCount: number;
          cooldownSeconds: number;
          remainingSeconds: number;
          nextAvailableAt: string | null;
          isInCooldown: boolean;
        };
      }>('/auth/resend-verification', {
        method: 'POST',
        body: { email, tenantId },
      }),
  },
  products: {
    list: async (
      params?: { search?: string; category?: string; brand?: string; lowStock?: boolean; lowStockOnly?: boolean; limit?: number },
      reqOptions?: { signal?: AbortSignal }
    ) => {
      const activeTenantId = getActiveTenantId();
      const qs = new URLSearchParams();
      if (params?.search) qs.set('search', params.search);
      if (params?.category) qs.set('category', params.category);
      if (params?.brand) qs.set('brand', params.brand);
      if (params?.lowStock || params?.lowStockOnly) qs.set('lowStockOnly', 'true');
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString() ? `?${qs.toString()}` : '';

      const fallbackFromOfflineCache = async () => {
        let cached = await searchCachedProductsOffline(
          params?.search || '',
          activeTenantId,
          params?.limit || 500
        );
        if (params?.brand) {
          const b = params.brand.toLowerCase().trim();
          cached = cached.filter(
            (p: any) => String(p.brandName || p.brand_name || p.brand || '').toLowerCase() === b
          );
        }
        if (params?.category) {
          const c = params.category.toLowerCase().trim();
          cached = cached.filter(
            (p: any) => String(p.categoryName || p.category_name || p.category || '').toLowerCase() === c
          );
        }
        if (params?.lowStock || params?.lowStockOnly) {
          const globalThreshold = 5;
          cached = cached.filter(
            (p: any) => (Number(p.totalStock ?? p.total_stock ?? 0) || 0) <= globalThreshold
          );
        }
        return { products: cached, offline: true };
      };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return fallbackFromOfflineCache();
      }

      try {
        const res = await apiFetch<any>(`/products${query}`, { signal: reqOptions?.signal });
        if (res && Array.isArray(res.products) && res.products.length > 0) {
          cacheCatalogOffline(res.products, activeTenantId).catch(() => {});
        }
        return res;
      } catch (err: any) {
        if (isAbortError(err) || reqOptions?.signal?.aborted) {
          throw err;
        }
        const msg = String(err?.message || '');
        if (
          (typeof navigator !== 'undefined' && navigator.onLine === false) ||
          msg.includes('Failed to fetch') ||
          msg.includes('temporarily reconnecting') ||
          msg.includes('Network')
        ) {
          return fallbackFromOfflineCache();
        }
        throw err;
      }
    },
    lookupBarcode: async (code: string, reqOptions?: { signal?: AbortSignal }) => {
      const activeTenantId = getActiveTenantId();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const cached = await lookupCachedProductOffline(code, activeTenantId);
        if (cached) return { product: cached, offline: true };
      }
      try {
        const res = await apiFetch<any>(`/products/barcode/${encodeURIComponent(code)}`, {
          signal: reqOptions?.signal,
        });
        if (res && res.product) {
          cacheCatalogOffline([res.product], activeTenantId).catch(() => {});
        }
        return res;
      } catch (err: any) {
        if (isAbortError(err) || reqOptions?.signal?.aborted) {
          throw err;
        }
        const cached = await lookupCachedProductOffline(code, activeTenantId).catch(() => null);
        if (cached) return { product: cached, offline: true };
        throw err;
      }
    },
    getNextId: () => apiFetch('/products/next-id'),
    generateBarcode: (
      data?: number | string | { productId?: number | string; category?: string },
      categoryHint?: string
    ) => {
      const productId =
        typeof data === 'number' || typeof data === 'string'
          ? data
          : data?.productId;
      const category =
        typeof data === 'object' && data !== null ? data.category || categoryHint : categoryHint;
      const params = new URLSearchParams();
      if (productId !== undefined && productId !== null && productId !== '') {
        params.set('productId', String(productId));
      }
      if (category && category.trim()) {
        params.set('category', category.trim());
      }
      const qs = params.toString() ? `?${params.toString()}` : '';
      return apiFetch(`/products/generate-barcode${qs}`);
    },
    validateBarcode: async (barcode: string, excludeId?: number) => {
      const cleanBarcode = String(barcode || '').trim();
      const qs = new URLSearchParams({ barcode: cleanBarcode });
      if (excludeId !== undefined && excludeId !== null) {
        qs.set('excludeId', String(excludeId));
      }
      try {
        return await apiFetch(`/products/validate-barcode?${qs.toString()}`);
      } catch (err) {
        const activeTenantId = getActiveTenantId();
        const cached = await searchCachedProductsOffline('', activeTenantId, 2000).catch(() => []);
        const dup = cached.find(
          (p: any) =>
            String(p.barcode || '').trim().toLowerCase() === cleanBarcode.toLowerCase() &&
            (!excludeId || Number(p.id) !== Number(excludeId))
        );
        if (dup) {
          return {
            valid: false,
            isDuplicate: true,
            existingProduct: dup,
            error: `Barcode is already in use in this store by product: "${dup.name || dup.article}"`,
          };
        }
        throw err;
      }
    },
    validateArticle: async (article: string, excludeId?: number) => {
      const cleanArt = String(article || '').trim().toUpperCase();
      const qs = new URLSearchParams({ article: cleanArt });
      if (excludeId !== undefined && excludeId !== null) {
        qs.set('excludeId', String(excludeId));
      }
      try {
        return await apiFetch(`/products/validate-article?${qs.toString()}`);
      } catch (err) {
        const activeTenantId = getActiveTenantId();
        const cached = await searchCachedProductsOffline('', activeTenantId, 2000).catch(() => []);
        const artDup = cached.find(
          (p: any) =>
            String(p.article || '').trim().toUpperCase() === cleanArt &&
            (!excludeId || Number(p.id) !== Number(excludeId))
        );
        if (artDup) {
          const msg = `Article "${cleanArt}" already exists in this store.`;
          return {
            valid: false,
            isDuplicate: true,
            duplicateField: 'article',
            articleError: msg,
            existingProduct: artDup,
            error: msg,
          };
        }
        throw err;
      }
    },
    suggestArticle: (params: {
      brand?: string;
      category?: string;
      article?: string;
      productId?: number;
      excludeId?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params.brand) qs.set('brand', params.brand);
      if (params.category) qs.set('category', params.category);
      if (params.article) qs.set('article', params.article);
      if (params.productId !== undefined && params.productId !== null) qs.set('productId', String(params.productId));
      if (params.excludeId !== undefined && params.excludeId !== null) qs.set('excludeId', String(params.excludeId));
      return apiFetch<any>(`/products/suggest-article?${qs.toString()}`);
    },
    create: async (data: ProductFormValues) => {
      const normalizedData = { ...data, brand: String(data.brand ?? '').trim() || 'Unbranded' };
      const res = await apiFetch<any>('/products', { method: 'POST', body: normalizedData });
      if (res && res.product) {
        cacheCatalogOffline([res.product], getActiveTenantId()).catch(() => {});
      }
      return res;
    },
    bulkImport: async (payload: any) => {
      const res = await apiFetch<any>('/products/bulk-import', {
        method: 'POST',
        body: Array.isArray(payload) ? { products: payload } : payload,
      });
      if (res && Array.isArray(res.products) && res.products.length > 0) {
        cacheCatalogOffline(res.products, getActiveTenantId()).catch(() => {});
      }
      return res;
    },
    update: async (id: number, data: ProductFormValues) => {
      const normalizedData = { ...data, brand: String(data.brand ?? '').trim() || 'Unbranded' };
      const res = await apiFetch<any>(`/products/${id}`, { method: 'PUT', body: normalizedData });
      if (res && res.product) {
        cacheCatalogOffline([res.product], getActiveTenantId()).catch(() => {});
      }
      return res;
    },
    delete: async (id: number) => {
      const res = await apiFetch<any>(`/products/${id}`, { method: 'DELETE' });
      deleteCachedProductOffline(id, getActiveTenantId()).catch(() => {});
      return res;
    },
  },
  categories: {
    getCategories: (reqOptions?: { signal?: AbortSignal }) =>
      apiFetch('/categories', { signal: reqOptions?.signal }),
  },
  pos: {
    checkout: async (saleData: any) => {
      const res = await apiFetch<any>('/pos/checkout', { method: 'POST', body: saleData });
      if (res?.sale) {
        upsertSingleCachedSaleOffline(res.sale, getActiveTenantId()).catch(() => {});
      }
      return res;
    },
    listSales: (
      params?: { startDate?: string; endDate?: string; search?: string; limit?: number; includeItems?: boolean },
      reqOptions?: { signal?: AbortSignal }
    ) => {
      const qs = new URLSearchParams();
      if (params?.startDate) qs.set('startDate', params.startDate);
      if (params?.endDate) qs.set('endDate', params.endDate);
      if (params?.search) qs.set('search', params.search);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.includeItems) qs.set('includeItems', '1');
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch(`/pos/sales${query}`, { signal: reqOptions?.signal });
    },
    getSale: (id: number) => apiFetch(`/pos/sales/${id}`),
  },
  returns: {
    verifyInvoice: async (invoiceNumber: string) => {
      const activeTenantId = getActiveTenantId();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const offlineResult = await verifyInvoiceOffline(invoiceNumber, activeTenantId);
        if (offlineResult) return offlineResult;
        throw new Error(`Invoice "${invoiceNumber}" was not found in the local offline cache.`);
      }
      try {
        const res = await apiFetch<any>(`/returns/verify-invoice/${encodeURIComponent(invoiceNumber)}`);
        if (res?.sale) {
          upsertSingleCachedSaleOffline(
            { ...res.sale, items: res.items || res.sale.items || [] },
            activeTenantId
          ).catch(() => {});
        }
        return res;
      } catch (err: any) {
        if (isTransientNetworkError(err)) {
          const offlineResult = await verifyInvoiceOffline(invoiceNumber, activeTenantId);
          if (offlineResult) return offlineResult;
        }
        throw err;
      }
    },
    create: (data: any) => apiFetch('/returns', { method: 'POST', body: data }),
  },
  suppliers: {
    list: (search?: string | { search?: string }, reqOptions?: { signal?: AbortSignal }) => {
      const term = typeof search === 'string' ? search : search?.search;
      const query = term ? `?search=${encodeURIComponent(term)}` : '';
      return apiFetch(`/suppliers${query}`, { signal: reqOptions?.signal });
    },
    get: (id: number) => apiFetch(`/suppliers/${id}`),
    getLedger: (id: number) => apiFetch(`/suppliers/${id}/ledger`),
    create: (data: any) => apiFetch('/suppliers', { method: 'POST', body: data }),
    recordPayment: (id: number, data: any) =>
      apiFetch(`/suppliers/${id}/payments`, { method: 'POST', body: data }),
    deletePayment: (paymentId: number) =>
      apiFetch(`/suppliers/payments/${paymentId}`, { method: 'DELETE' }),
    update: (id: number, data: any) => apiFetch(`/suppliers/${id}`, { method: 'PUT', body: data }),
    delete: (id: number) => apiFetch(`/suppliers/${id}`, { method: 'DELETE' }),
  },
  purchases: {
    create: (data: any) => apiFetch('/purchases', { method: 'POST', body: data }),
    list: (search?: string | { search?: string }, reqOptions?: { signal?: AbortSignal }) => {
      const term = typeof search === 'string' ? search : search?.search;
      const query = term ? `?search=${encodeURIComponent(term)}` : '';
      return apiFetch(`/purchases${query}`, { signal: reqOptions?.signal });
    },
    get: (id: number) => apiFetch(`/purchases/${id}`),
  },
  purchaseReturns: {
    create: (data: any) => apiFetch('/purchase-returns', { method: 'POST', body: data }),
    verifyPurchase: (purchaseNumber: string) =>
      apiFetch(`/purchase-returns/verify-purchase/${encodeURIComponent(purchaseNumber)}`),
    list: (search?: string | { search?: string }, reqOptions?: { signal?: AbortSignal }) => {
      const term = typeof search === 'string' ? search : search?.search;
      const query = term ? `?search=${encodeURIComponent(term)}` : '';
      return apiFetch(`/purchase-returns${query}`, { signal: reqOptions?.signal });
    },
    get: (id: number) => apiFetch(`/purchase-returns/${id}`),
  },
  customers: {
    list: async (search?: string, reqOptions?: { signal?: AbortSignal }) => {
      const activeTenantId = getActiveTenantId();
      const query = search ? `?search=${encodeURIComponent(search)}` : '';
      const fallbackFromOfflineCustomers = () => {
        let cached = getCachedCustomersOffline(activeTenantId);
        if (search && search.trim()) {
          const q = search.trim().toLowerCase();
          cached = cached.filter(
            (c: any) =>
              String(c.name || '').toLowerCase().includes(q) ||
              String(c.phone || '').toLowerCase().includes(q) ||
              String(c.shopName || c.shop_name || '').toLowerCase().includes(q)
          );
        }
        return { customers: cached, offline: true };
      };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return fallbackFromOfflineCustomers();
      }

      try {
        const res = await apiFetch<any>(`/customers${query}`, { signal: reqOptions?.signal });
        if (!search && res && Array.isArray(res.customers)) {
          cacheCustomersOffline(res.customers, activeTenantId);
        }
        return res;
      } catch (err: any) {
        if (isAbortError(err) || reqOptions?.signal?.aborted) {
          throw err;
        }
        if (isTransientNetworkError(err)) {
          return fallbackFromOfflineCustomers();
        }
        throw err;
      }
    },
    get: (id: number) => apiFetch(`/customers/${id}`),
    recordPayment: (id: number, data: { amount: number; paymentMethod?: string; notes?: string; paymentDate?: string }) =>
      apiFetch(`/customers/${id}/payments`, { method: 'POST', body: data }),
    create: (data: any) => apiFetch('/customers', { method: 'POST', body: data }),
    update: (id: number, data: any) => apiFetch(`/customers/${id}`, { method: 'PUT', body: data }),
    delete: (id: number) => apiFetch(`/customers/${id}`, { method: 'DELETE' }),
  },
  inventory: {
    ledger: (
      params?: { productId?: number; movementType?: string; limit?: number },
      reqOptions?: { signal?: AbortSignal }
    ) => {
      const qs = new URLSearchParams();
      if (params?.productId) qs.set('productId', String(params.productId));
      if (params?.movementType) qs.set('movementType', String(params.movementType));
      if (params?.limit) qs.set('limit', String(params.limit));
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch(`/inventory/ledger${query}`, { signal: reqOptions?.signal });
    },
    adjust: (data: { productId: number; newStock: number; reason?: string }) =>
      apiFetch('/inventory/adjust', { method: 'POST', body: data }),
    updateInlineStock: (data: { productId: number; newStock: number; reason?: string }) =>
      apiFetch('/inventory/inline-stock', { method: 'PATCH', body: data }),
  },
  reports: {
    getDashboard: (reqOptions?: { signal?: AbortSignal }) =>
      apiFetch('/reports/dashboard', { signal: reqOptions?.signal }),
    getProfitLoss: (
      params?: { startDate?: string; endDate?: string },
      reqOptions?: { signal?: AbortSignal }
    ) => {
      const qs = new URLSearchParams();
      if (params?.startDate) qs.set('startDate', params.startDate);
      if (params?.endDate) qs.set('endDate', params.endDate);
      const query = qs.toString() ? `?${qs.toString()}` : '';
      return apiFetch(`/reports/profit-loss${query}`, { signal: reqOptions?.signal });
    },
    getTopSelling: (reqOptions?: { signal?: AbortSignal }) =>
      apiFetch('/reports/top-selling', { signal: reqOptions?.signal }),
  },
  settings: {
    get: async (reqOptions?: { signal?: AbortSignal }) => {
      const activeTenantId = getActiveTenantId();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const cached = getCachedCompanySettingsOffline(activeTenantId);
        if (cached) return { settings: cached, offline: true };
      }
      try {
        const res = await apiFetch<any>('/settings', { signal: reqOptions?.signal });
        if (res?.settings) {
          cacheCompanySettingsOffline(res.settings, activeTenantId);
        }
        return res;
      } catch (err: any) {
        if (isAbortError(err) || reqOptions?.signal?.aborted) {
          throw err;
        }
        if (isTransientNetworkError(err)) {
          const cached = getCachedCompanySettingsOffline(activeTenantId);
          if (cached) return { settings: cached, offline: true };
        }
        throw err;
      }
    },
    getAppSettings: () => apiFetch<{ appSettings: Record<string, string>; appSettingsGrouped: Record<string, any[]> }>('/settings/app'),
    saveAppSettings: (appSettings: Record<string, string>) =>
      apiFetch('/settings/app', { method: 'PUT', body: { appSettings } }).catch(() =>
        apiFetch('/settings', { method: 'POST', body: { appSettings } })
      ),
    getScreenImages: () =>
      apiFetch<{
        backdropImage?: string;
        screenImages: { backdrop?: string; login: string; registration: string; auth: string; loading: string };
      }>('/settings/screen-images'),
    saveScreenImages: (
      input:
        | string
        | Partial<{ backdrop: string; login: string; registration: string; auth: string; loading: string }>
    ) => {
      const cleanUrl =
        typeof input === 'string'
          ? input.trim()
          : String(input.backdrop ?? input.login ?? input.auth ?? input.registration ?? input.loading ?? '').trim();
      return apiFetch<{
        success: boolean;
        message: string;
        backdropImage: string;
        screenImages: { backdrop: string; login: string; registration: string; auth: string; loading: string };
      }>('/settings/screen-images', {
        method: 'PUT',
        body: {
          backdropImage: cleanUrl,
          screenImages: {
            backdrop: cleanUrl,
            login: cleanUrl,
            registration: cleanUrl,
            auth: cleanUrl,
            loading: cleanUrl,
          },
        },
      });
    },
    testEmail: (recipientEmail?: string) =>
      apiFetch<{
        success: boolean;
        delivered: boolean;
        message: string;
        details?: any;
      }>('/settings/test-email', { method: 'POST', body: { recipientEmail } }),
    getSubscription: () => apiFetch('/settings/subscription'),
    requestSubscriptionRenewal: (data: { plan: '6_MONTHS' | 'YEARLY' | string; notes?: string; eventId?: string }) =>
      apiFetch('/settings/renew-subscription', { method: 'POST', body: data }),
    update: (data: any) => apiFetch('/settings', { method: 'PUT', body: data }),
    getUsers: () => apiFetch('/settings/users'),
    createUser: (data: any) =>
      apiFetch<{
        message: string;
        user: any;
        welcomeNotification?: {
          delivered: boolean;
          previewUrl?: string | null;
          provider?: string | null;
          terminalUrl?: string;
          notificationId?: number;
        };
      }>('/settings/users', { method: 'POST', body: data }),
    updateUserStatus: (id: number, status: string) =>
      apiFetch(`/settings/users/${id}/status`, { method: 'PATCH', body: { status } }),
    updateUserRole: (id: number, role: string) =>
      apiFetch(`/settings/users/${id}/role`, { method: 'PATCH', body: { role } }),
    deleteUser: (id: number) => apiFetch(`/settings/users/${id}`, { method: 'DELETE' }),
  },
  backup: {
    stats: () => apiFetch('/backup/stats'),
    export: () => apiFetch('/backup/export'),
    restore: (backupPayload: any) =>
      apiFetch('/backup/restore', { method: 'POST', body: backupPayload }),
    importSql: (sqlContent: string) =>
      apiFetch('/backup/import-sql', { method: 'POST', body: { sql: sqlContent, sqlContent } }),
    executeSql: (sql: string, confirmExecution: boolean) =>
      apiFetch<{
        success: boolean;
        command: string;
        rowCount: number;
        columns: string[];
        rows: Record<string, any>[];
        totalRowsReturned: number;
        truncated: boolean;
        statementCount: number;
        durationMs: number;
        message: string;
        timestamp: string;
      }>('/backup/execute-sql', {
        method: 'POST',
        body: { sql, confirmExecution },
        skipKeyTransform: true,
      }),
  },
  notifications: {
    grouped: (limit: number = 5, reqOptions?: { signal?: AbortSignal; noticesOnly?: boolean }) =>
      apiFetch<GroupedNotificationsResponse>(
        `/notifications/grouped?limit=${limit}${reqOptions?.noticesOnly ? '&noticesOnly=1' : ''}`,
        {
          signal: reqOptions?.signal,
        }
      ),
    all: (
      params?: {
        page?: number;
        limit?: number;
        tab?: string;
        category?: string;
        search?: string;
        sortBy?: string;
        sortOrder?: string;
        unreadOnly?: boolean;
      },
      reqOptions?: { signal?: AbortSignal }
    ) => {
      const sp = new URLSearchParams();
      if (params?.page) sp.set('page', String(params.page));
      if (params?.limit) sp.set('limit', String(params.limit));
      if (params?.tab) sp.set('tab', params.tab);
      if (params?.category) sp.set('category', params.category);
      if (params?.search) sp.set('search', params.search);
      if (params?.sortBy) sp.set('sortBy', params.sortBy);
      if (params?.sortOrder) sp.set('sortOrder', params.sortOrder);
      if (params?.unreadOnly !== undefined) sp.set('unreadOnly', String(params.unreadOnly));
      const qs = sp.toString() ? `?${sp.toString()}` : '';
      return apiFetch<AllNotificationsResponse>(`/notifications/all${qs}`, {
        signal: reqOptions?.signal,
      });
    },
    dismiss: (id: string | number, itemType?: string) =>
      apiFetch<{ success: boolean; message: string }>(`/notifications/${encodeURIComponent(String(id))}/dismiss`, {
        method: 'POST',
        body: itemType ? { itemType } : {},
      }),
    dismissAll: (category?: string) =>
      apiFetch<{ success: boolean; message: string }>('/notifications/dismiss-all', {
        method: 'POST',
        body: category ? { category } : {},
      }),
    markAllRead: () =>
      apiFetch<{ success: boolean; message: string }>('/notifications/mark-all-read', {
        method: 'POST',
      }),
    getFcmConfig: () =>
      apiFetch<{
        configured: boolean;
        projectId: string;
        apiKey: string;
        messagingSenderId: string;
        appId: string;
        measurementId?: string;
        vapidKey?: string;
      }>('/notifications/fcm-config'),
    getFcmStats: () =>
      apiFetch<{
        configured: boolean;
        projectId: string;
        totalTokens: number;
        tokensByRole: Record<string, number>;
      }>('/notifications/fcm-stats'),
    registerFcmToken: (data: {
      token: string;
      previousToken?: string;
      userAgent?: string;
      deviceName?: string;
      userRole?: string;
      tenantId?: number;
      userId?: number;
    }) =>
      apiFetch<{ success: boolean; tenantId: number; role: string }>('/notifications/fcm-token', {
        method: 'POST',
        body: data,
      }),
    removeFcmToken: (token: string) =>
      apiFetch<{ success: boolean }>('/notifications/fcm-token/remove', {
        method: 'POST',
        body: { token },
      }),
    /** SuperAdmin-only: dispatch test push alert to SuperAdmin devices */
    testPush: (data?: { title?: string; message?: string; eventId?: string }) =>
      apiFetch<{
        success: boolean;
        message: string;
        sentCount?: number;
        fcmSentCount?: number;
        failureCount?: number;
        channel?: 'fcm' | 'sse';
        eventId?: string;
      }>('/notifications/test-push', { method: 'POST', body: data || {} }),
    dismissAnnouncement: (id: number) =>
      apiFetch<{ success: boolean; message: string }>(`/notifications/platform/${id}/dismiss`, {
        method: 'POST',
      }),
    dismissWelcome: () =>
      apiFetch<{ success: boolean; message: string }>('/notifications/dismiss-welcome', {
        method: 'POST',
      }),
    getPreferences: (tenantId?: number) => {
      const qs = tenantId ? `?tenantId=${encodeURIComponent(String(tenantId))}` : '';
      return apiFetch<{
        success: boolean;
        tenantId: number;
        preferences: StoreNotificationPreferences;
        deliveryStatus: StoreNotificationDeliveryStatus;
      }>(`/notifications/preferences${qs}`);
    },
    updatePreferences: (
      payload:
        | Partial<StoreNotificationPreferences>
        | { preset: NotificationPresetId }
        | { eventId: StoreNotificationEventId; enabled: boolean }
        | { channelId: StoreNotificationChannelId; enabled: boolean }
        | { resetToDefault: true },
      tenantId?: number
    ) => {
      const qs = tenantId ? `?tenantId=${encodeURIComponent(String(tenantId))}` : '';
      return apiFetch<{
        success: boolean;
        tenantId: number;
        preferences: StoreNotificationPreferences;
        deliveryStatus: StoreNotificationDeliveryStatus;
      }>(`/notifications/preferences${qs}`, {
        method: 'PUT',
        body: payload,
      });
    },
  },
  chat: {
    send: (payload: any, history?: any) =>
      apiFetch('/chat', {
        method: 'POST',
        body: typeof payload === 'string' ? { message: payload, history } : payload,
      }),
  },
};
