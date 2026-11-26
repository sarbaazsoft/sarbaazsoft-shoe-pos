// IndexedDB + LocalStorage Persistent Queue & Tenant-Scoped Product Cache for Offline POS Billing
import type {
  QueuedReturn,
  QueuedReturnItem,
  QueuedSale,
  QueuedSaleItem,
} from '../services/offline/offlineTypes.ts';
import {
  ACTIVE_TENANT_STORAGE_KEY,
  AUTH_ALT_USER_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  decodeJwtPayload,
  getStoredAuthToken,
} from './authStorage.ts';
export type { QueuedReturn, QueuedReturnItem, QueuedSale, QueuedSaleItem };

const DB_NAME = 'ShoePosOfflineDB';
const DB_VERSION = 5;
const STORE_SALES = 'offline_sales_queue';
const STORE_RETURNS = 'offline_returns_queue';
const STORE_SALES_CACHE = 'cached_sales_by_store';
const STORE_CATALOG_LEGACY = 'cached_products';
const STORE_CATALOG = 'cached_products_by_store';

function parseValidTenantId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    const num = Number(value.trim());
    if (Number.isSafeInteger(num) && num > 0) {
      return num;
    }
  }
  return null;
}

/**
 * Resolves the current authenticated tenantId for offline product cache isolation.
 */
export function resolveActiveTenantId(explicitTenantId?: number | string | null): number | null {
  const explicit = parseValidTenantId(explicitTenantId);

  if (typeof localStorage !== 'undefined') {
    const token = getStoredAuthToken();
    const payload = token ? decodeJwtPayload(token) : null;
    const tokenRole = String(payload?.role || '').toUpperCase();
    const tokenTenantId = parseValidTenantId(payload?.tenantId ?? payload?.tenant_id);

    if (tokenRole && tokenRole !== 'SUPERADMIN' && tokenRole !== 'SUPER_ADMIN' && tokenTenantId) {
      return explicit ?? tokenTenantId;
    }

    const userRaw =
      localStorage.getItem(AUTH_USER_STORAGE_KEY) ||
      localStorage.getItem(AUTH_ALT_USER_STORAGE_KEY);
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw);
        const userRole = String(parsed?.originalRole || parsed?.role || '').toUpperCase();
        const userTenantId = parseValidTenantId(parsed?.tenantId ?? parsed?.tenant_id);
        if (userRole !== 'SUPERADMIN' && userRole !== 'SUPER_ADMIN' && userTenantId) {
          return explicit ?? userTenantId;
        }
        if ((userRole === 'SUPERADMIN' || userRole === 'SUPER_ADMIN') && explicit) {
          return explicit;
        }
      } catch {}
    }

    if (explicit) {
      return explicit;
    }

    const selectedTenantId = parseValidTenantId(localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY));
    if (selectedTenantId) {
      return selectedTenantId;
    }
  }

  return explicit;
}

/**
 * Verifies that the current authenticated store user is allowed to access/modify
 * the offline product cache for the target tenantId. Prevents cross-tenant access.
 */
function verifyOfflineTenantId(explicitTenantId?: number | string | null): number {
  const activeTenantId = resolveActiveTenantId(explicitTenantId);

  if (typeof localStorage !== 'undefined') {
    const token = getStoredAuthToken();
    const payload = token ? decodeJwtPayload(token) : null;
    const tokenRole = String(payload?.role || '').toUpperCase();
    const tokenTenantId = parseValidTenantId(payload?.tenantId ?? payload?.tenant_id);

    if (
      tokenRole &&
      tokenRole !== 'SUPERADMIN' &&
      tokenRole !== 'SUPER_ADMIN' &&
      tokenTenantId &&
      activeTenantId &&
      tokenTenantId !== activeTenantId
    ) {
      throw new Error(
        `Cross-tenant offline cache access blocked: authenticated for tenant ${tokenTenantId}, cannot access tenant ${activeTenantId}.`
      );
    }

    const userRaw =
      localStorage.getItem(AUTH_USER_STORAGE_KEY) ||
      localStorage.getItem(AUTH_ALT_USER_STORAGE_KEY);
    if (userRaw) {
      try {
        const parsed = JSON.parse(userRaw);
        const userRole = String(parsed?.originalRole || parsed?.role || '').toUpperCase();
        const userTenantId = parseValidTenantId(parsed?.tenantId ?? parsed?.tenant_id);
        if (
          parsed &&
          userRole !== 'SUPERADMIN' &&
          userRole !== 'SUPER_ADMIN' &&
          userTenantId &&
          activeTenantId &&
          userTenantId !== activeTenantId
        ) {
          throw new Error(
            `Cross-tenant offline cache access blocked: authenticated for tenant ${userTenantId}, cannot access tenant ${activeTenantId}.`
          );
        }
      } catch (err: any) {
        if (err?.message?.includes('Cross-tenant offline cache access blocked')) {
          throw err;
        }
      }
    }
  }

  if (!activeTenantId) {
    throw new Error('No active tenantId available for offline product cache.');
  }

  return activeTenantId;
}

/**
 * Normalizes any product object from online catalog or API into a consistent
 * tenant-scoped POS product structure for offline billing using Product.tenantId.
 */
function normalizeCachedProduct(p: any, tenantId: number): any {
  if (!p || p.id === undefined || p.id === null) return null;
  const resolvedTenantId = parseValidTenantId(tenantId);
  if (!resolvedTenantId) return null;

  const rawProductTenantId = p.tenantId ?? p.tenant_id;
  if (rawProductTenantId !== undefined && rawProductTenantId !== null) {
    const productTenantId = parseValidTenantId(rawProductTenantId);
    if (!productTenantId || productTenantId !== resolvedTenantId) {
      return null;
    }
  }

  const productId = Number(p.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;

  const costPrice = Math.max(
    0,
    Math.round(Number(p.costPrice ?? p.cost_price ?? 0) || 0)
  );
  const rawSelling = Math.max(
    0,
    Math.round(Number(p.sellingPrice ?? p.selling_price ?? p.salePrice ?? p.sale_price ?? p.price ?? 0) || 0)
  );
  const rawMax = Math.max(
    0,
    Math.round(Number(p.maxPrice ?? p.max_price ?? p.maxSalePrice ?? p.max_sale_price ?? rawSelling) || 0)
  );
  const rawMin = Math.max(
    0,
    Math.round(Number(p.minPrice ?? p.min_price ?? p.minSalePrice ?? p.min_sale_price ?? rawSelling) || 0)
  );
  const retailPrice = rawSelling > 0 ? rawSelling : rawMax;
  const totalStock = Math.max(
    0,
    Math.round(Number(p.totalStock ?? p.total_stock ?? 0) || 0)
  );

  const article = String(p.article || p.name || '').trim();
  const name = String(p.name || p.article || '').trim();
  const barcode = String(p.barcode || '').trim();

  const normalized = {
    ...p,
    id: productId,
    tenantId: resolvedTenantId,
    cacheKey: `${resolvedTenantId}:${productId}`,
    article,
    name,
    barcode,
    brandName: String(p.brandName || p.brand_name || p.brand || '').trim(),
    brand_name: String(p.brand_name || p.brandName || p.brand || '').trim(),
    brandLogo: p.brandLogo || p.brand_logo || '',
    categoryName: String(p.categoryName || p.category_name || p.category || 'General').trim(),
    category_name: String(p.category_name || p.categoryName || p.category || 'General').trim(),
    primaryImageUrl: p.primaryImageUrl || p.primary_image_url || '',
    costPrice,
    cost_price: costPrice,
    sellingPrice: retailPrice,
    selling_price: retailPrice,
    price: retailPrice,
    salePrice: retailPrice,
    sale_price: retailPrice,
    minPrice: rawMin > 0 ? rawMin : retailPrice,
    min_price: rawMin > 0 ? rawMin : retailPrice,
    minSalePrice: rawMin > 0 ? rawMin : retailPrice,
    min_sale_price: rawMin > 0 ? rawMin : retailPrice,
    maxPrice: rawMax > 0 ? rawMax : retailPrice,
    max_price: rawMax > 0 ? rawMax : retailPrice,
    maxSalePrice: rawMax > 0 ? rawMax : retailPrice,
    max_sale_price: rawMax > 0 ? rawMax : retailPrice,
    totalStock,
    total_stock: totalStock,
    active: p.active !== false,
    cachedAt: new Date().toISOString(),
  };
  return normalized;
}

function getLocalStorageCatalogKey(tenantId: number): string {
  return `pos_offline_catalog_tenant:${tenantId}`;
}

function stripHeavyDataUrl(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('data:')) {
    return '';
  }
  return value;
}

function saveCatalogMirrorToLocalStorage(tenantId: number, products: any[]): void {
  if (typeof localStorage === 'undefined') return;
  const validTenantId = parseValidTenantId(tenantId);
  if (!validTenantId) return;
  try {
    const key = getLocalStorageCatalogKey(validTenantId);
    const existingRaw = localStorage.getItem(key);
    const existingMap = new Map<number, any>();
    if (existingRaw) {
      const parsed = JSON.parse(existingRaw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            item.id !== undefined &&
            parseValidTenantId(item.tenantId) === validTenantId
          ) {
            existingMap.set(Number(item.id), {
              ...item,
              primaryImageUrl: stripHeavyDataUrl(item.primaryImageUrl),
              brandLogo: stripHeavyDataUrl(item.brandLogo),
            });
          }
        }
      }
    }
    for (const prod of products) {
      if (
        prod &&
        prod.id !== undefined &&
        parseValidTenantId(prod.tenantId) === validTenantId
      ) {
        existingMap.set(Number(prod.id), {
          ...prod,
          primaryImageUrl: stripHeavyDataUrl(prod.primaryImageUrl),
          brandLogo: stripHeavyDataUrl(prod.brandLogo),
        });
      }
    }
    const merged = Array.from(existingMap.values()).slice(0, 600);
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    // Ignore storage quota warnings
  }
}

function readCatalogMirrorFromLocalStorage(tenantId: number): any[] {
  if (typeof localStorage === 'undefined') return [];
  const validTenantId = parseValidTenantId(tenantId);
  if (!validTenantId) return [];
  try {
    const raw = localStorage.getItem(getLocalStorageCatalogKey(validTenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        parseValidTenantId(p.tenantId) === validTenantId &&
        p.cacheKey === `${validTenantId}:${Number(p.id)}`
    );
  } catch {
    return [];
  }
}

function getLocalStorageQueueKey(tenantId: number | null): string {
  return `pos_offline_sales_queue:${tenantId || 'default'}`;
}

function readSalesMirrorFromLocalStorage(tenantId: number | null): QueuedSale[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getLocalStorageQueueKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSalesMirrorToLocalStorage(tenantId: number | null, sales: QueuedSale[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getLocalStorageQueueKey(tenantId), JSON.stringify(sales.slice(0, 300)));
  } catch {
    // Ignore storage quota warnings
  }
}

function getLocalStorageCustomersKey(tenantId: number): string {
  return `pos_offline_customers_tenant:${tenantId}`;
}

export function cacheCustomersOffline(
  customers: any[],
  explicitTenantId?: number | string | null
): void {
  if (!Array.isArray(customers) || typeof localStorage === 'undefined') return;
  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return;
  }
  try {
    localStorage.setItem(getLocalStorageCustomersKey(tenantId), JSON.stringify(customers.slice(0, 600)));
  } catch {
    // Ignore storage quota warnings
  }
}

export function getCachedCustomersOffline(
  explicitTenantId?: number | string | null
): any[] {
  if (typeof localStorage === 'undefined') return [];
  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return [];
  }
  try {
    const raw = localStorage.getItem(getLocalStorageCustomersKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getLocalStorageSettingsKey(tenantId: number): string {
  return `pos_offline_company_settings_tenant:${tenantId}`;
}

function getLocalStorageTenantKey(tenantId: number): string {
  return `pos_offline_tenant_info:${tenantId}`;
}

export function cacheCompanySettingsOffline(
  settings: any,
  explicitTenantId?: number | string | null
): void {
  if (!settings || typeof settings !== 'object' || typeof localStorage === 'undefined') return;
  let tenantId: number;
  try {
    const candidate =
      parseValidTenantId(explicitTenantId) ??
      parseValidTenantId(settings.tenantId ?? settings.tenant_id);
    tenantId = verifyOfflineTenantId(candidate);
  } catch {
    return;
  }
  try {
    const sanitized = {
      ...settings,
      tenantId,
      tenant_id: tenantId,
      cachedAt: new Date().toISOString(),
    };
    localStorage.setItem(getLocalStorageSettingsKey(tenantId), JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota warnings
  }
}

export function getCachedCompanySettingsOffline(
  explicitTenantId?: number | string | null
): any | null {
  if (typeof localStorage === 'undefined') return null;
  const tenantId = resolveActiveTenantId(explicitTenantId);
  if (!tenantId) return null;
  try {
    const raw = localStorage.getItem(getLocalStorageSettingsKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function cacheTenantInfoOffline(
  tenant: any,
  explicitTenantId?: number | string | null
): void {
  if (!tenant || typeof tenant !== 'object' || typeof localStorage === 'undefined') return;
  const tenantId =
    parseValidTenantId(explicitTenantId) ?? parseValidTenantId(tenant.id ?? tenant.tenantId);
  if (!tenantId) return;
  try {
    localStorage.setItem(
      getLocalStorageTenantKey(tenantId),
      JSON.stringify({ ...tenant, id: tenantId, cachedAt: new Date().toISOString() })
    );
  } catch {
    // Ignore storage quota warnings
  }
}

export function getCachedTenantInfoOffline(
  explicitTenantId?: number | string | null
): any | null {
  if (typeof localStorage === 'undefined') return null;
  const tenantId = resolveActiveTenantId(explicitTenantId);
  if (!tenantId) return null;
  try {
    const raw = localStorage.getItem(getLocalStorageTenantKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function adjustCachedCustomerBalanceOffline(
  customerId: number | null | undefined,
  nextOutstandingBalance: number,
  explicitTenantId?: number | string | null
): void {
  if (!customerId || typeof localStorage === 'undefined') return;
  const customers = getCachedCustomersOffline(explicitTenantId);
  if (!Array.isArray(customers) || customers.length === 0) return;
  const numCustId = Number(customerId);
  let changed = false;
  const next = customers.map((c: any) => {
    if (Number(c?.id) !== numCustId) return c;
    changed = true;
    const rounded = Math.round(Number(nextOutstandingBalance || 0) * 100) / 100;
    return {
      ...c,
      outstanding_balance: rounded,
      outstandingBalance: rounded,
      current_balance: rounded,
      currentBalance: rounded,
      balance: rounded,
    };
  });
  if (changed) {
    cacheCustomersOffline(next, explicitTenantId);
  }
}

function getLocalStorageReturnsQueueKey(tenantId: number | null): string {
  return `pos_offline_returns_queue:${tenantId || 'default'}`;
}

function readReturnsMirrorFromLocalStorage(tenantId: number | null): QueuedReturn[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getLocalStorageReturnsQueueKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReturnsMirrorToLocalStorage(tenantId: number | null, returnsList: QueuedReturn[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getLocalStorageReturnsQueueKey(tenantId), JSON.stringify(returnsList.slice(0, 300)));
  } catch {
    // Ignore storage quota warnings
  }
}

function getLocalStorageSalesCacheKey(tenantId: number): string {
  return `pos_offline_sales_cache_tenant:${tenantId}`;
}

function readSalesCacheMirrorFromLocalStorage(tenantId: number): any[] {
  if (typeof localStorage === 'undefined') return [];
  const validTenantId = parseValidTenantId(tenantId);
  if (!validTenantId) return [];
  try {
    const raw = localStorage.getItem(getLocalStorageSalesCacheKey(validTenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSalesCacheMirrorToLocalStorage(tenantId: number, sales: any[]): void {
  if (typeof localStorage === 'undefined') return;
  const validTenantId = parseValidTenantId(tenantId);
  if (!validTenantId) return;
  try {
    localStorage.setItem(getLocalStorageSalesCacheKey(validTenantId), JSON.stringify(sales.slice(0, 250)));
  } catch {
    // Ignore storage quota warnings
  }
}

function applyOfflineSchema(db: IDBDatabase, oldVersion: number): void {
  if (!db.objectStoreNames.contains(STORE_SALES)) {
    const salesStore = db.createObjectStore(STORE_SALES, { keyPath: 'clientTxId' });
    salesStore.createIndex('status', 'status', { unique: false });
    salesStore.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_RETURNS)) {
    const returnsStore = db.createObjectStore(STORE_RETURNS, { keyPath: 'clientReturnId' });
    returnsStore.createIndex('status', 'status', { unique: false });
    returnsStore.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_SALES_CACHE)) {
    const salesCacheStore = db.createObjectStore(STORE_SALES_CACHE, { keyPath: 'cacheKey' });
    salesCacheStore.createIndex('tenantId', 'tenantId', { unique: false });
    salesCacheStore.createIndex('invoiceUpper', 'invoiceUpper', { unique: false });
  }
  // Remove legacy unscoped product store if present
  if (db.objectStoreNames.contains(STORE_CATALOG_LEGACY)) {
    db.deleteObjectStore(STORE_CATALOG_LEGACY);
  }
  // On upgrade to v3+ (tenantId-scoped product cache), recreate STORE_CATALOG if migrating from <3
  if (oldVersion > 0 && oldVersion < 3 && db.objectStoreNames.contains(STORE_CATALOG)) {
    db.deleteObjectStore(STORE_CATALOG);
  }
  if (!db.objectStoreNames.contains(STORE_CATALOG)) {
    const catalogStore = db.createObjectStore(STORE_CATALOG, { keyPath: 'cacheKey' });
    catalogStore.createIndex('tenantId', 'tenantId', { unique: false });
    catalogStore.createIndex('barcode', 'barcode', { unique: false });
  }
}

function attachVersionChangeCleanup(db: IDBDatabase): IDBDatabase {
  db.onversionchange = () => {
    try {
      db.close();
    } catch {
      // ignore close errors during concurrent version upgrades
    }
  };
  return db;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const openCurrentVersion = () => {
      try {
        const fallbackReq = indexedDB.open(DB_NAME);
        fallbackReq.onupgradeneeded = (event) => {
          applyOfflineSchema((event.target as IDBOpenDBRequest).result, event.oldVersion || 0);
        };
        fallbackReq.onsuccess = () => {
          const db = attachVersionChangeCleanup(fallbackReq.result);
          if (
            !db.objectStoreNames.contains(STORE_SALES) ||
            !db.objectStoreNames.contains(STORE_CATALOG) ||
            !db.objectStoreNames.contains(STORE_RETURNS) ||
            !db.objectStoreNames.contains(STORE_SALES_CACHE)
          ) {
            const nextVersion = db.version + 1;
            db.close();
            const upgradeReq = indexedDB.open(DB_NAME, nextVersion);
            upgradeReq.onupgradeneeded = (event) => {
              applyOfflineSchema((event.target as IDBOpenDBRequest).result, event.oldVersion || 0);
            };
            upgradeReq.onsuccess = () => resolve(attachVersionChangeCleanup(upgradeReq.result));
            upgradeReq.onerror = () => reject(upgradeReq.error);
            return;
          }
          resolve(db);
        };
        fallbackReq.onerror = () => reject(fallbackReq.error);
      } catch (err) {
        reject(err);
      }
    };

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        applyOfflineSchema(db, event.oldVersion || 0);
      };

      request.onsuccess = () => resolve(attachVersionChangeCleanup(request.result));
      request.onerror = () => {
        const err = request.error;
        const msg = String(err?.message || '');
        if (err?.name === 'VersionError' || msg.includes('less than the existing version')) {
          openCurrentVersion();
          return;
        }
        reject(err);
      };
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (err?.name === 'VersionError' || msg.includes('less than the existing version')) {
        openCurrentVersion();
        return;
      }
      reject(err);
    }
  });
}

/**
 * Save an offline sale to IndexedDB (with LocalStorage fallback mirror)
 */
export async function queueOfflineSale(sale: QueuedSale, explicitTenantId?: number | null): Promise<void> {
  const resolvedTenantId = resolveActiveTenantId(sale.tenantId ?? explicitTenantId);
  const scopedSale: QueuedSale = {
    ...sale,
    ...(resolvedTenantId ? { tenantId: resolvedTenantId } : {}),
  };

  // Always mirror in localStorage so offline billing succeeds even if IndexedDB is blocked
  const mirror = readSalesMirrorFromLocalStorage(resolvedTenantId);
  const filteredMirror = mirror.filter((s) => s.clientTxId !== scopedSale.clientTxId);
  filteredMirror.unshift(scopedSale);
  writeSalesMirrorToLocalStorage(resolvedTenantId, filteredMirror);

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SALES, 'readwrite');
      const store = tx.objectStore(STORE_SALES);
      const req = store.put(scopedSale);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // Only fail if neither IndexedDB nor localStorage could hold the record
    if (typeof localStorage === 'undefined') {
      throw err;
    }
  }

  // Also update local cached stock for this tenant so subsequent offline bills & returns see accurate stock
  if (resolvedTenantId) {
    if (Array.isArray(sale.items) && sale.items.length > 0) {
      await adjustCachedProductStockOffline(sale.items, -1, resolvedTenantId).catch(() => {});
    }
    if (sale.exchange && Array.isArray(sale.exchange.items) && sale.exchange.items.length > 0) {
      await adjustCachedProductStockOffline(sale.exchange.items, 1, resolvedTenantId).catch(() => {});
    }
  }
}

/**
 * Get all queued offline sales for the active store tenantId
 */
export async function getOfflineSales(explicitTenantId?: number | null): Promise<QueuedSale[]> {
  const activeTenantId = resolveActiveTenantId(explicitTenantId);
  const byTxId = new Map<string, QueuedSale>();

  for (const s of readSalesMirrorFromLocalStorage(activeTenantId)) {
    if (s && s.clientTxId) {
      if ((activeTenantId && s.tenantId && Number(s.tenantId) === activeTenantId) || !s.tenantId) {
        byTxId.set(s.clientTxId, s);
      }
    }
  }

  try {
    const db = await openDB();
    const idbResults = await new Promise<QueuedSale[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SALES, 'readonly');
      const store = tx.objectStore(STORE_SALES);
      const req = store.getAll();

      req.onsuccess = () => {
        const allResults = (req.result as QueuedSale[]) || [];
        resolve(
          allResults.filter((s) => {
            if (activeTenantId && s.tenantId) {
              return Number(s.tenantId) === activeTenantId;
            }
            return !s.tenantId;
          })
        );
      };
      req.onerror = () => reject(req.error);
    });
    for (const s of idbResults) {
      if (s && s.clientTxId) {
        byTxId.set(s.clientTxId, s);
      }
    }
  } catch {
    // Serve localStorage mirror when IndexedDB is unavailable
  }

  const results = Array.from(byTxId.values());
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

/**
 * Get count of pending offline sales for the active store tenantId
 */
export async function getPendingOfflineSalesCount(explicitTenantId?: number | null): Promise<number> {
  const all = await getOfflineSales(explicitTenantId);
  return all.filter((s) => s.status === 'PENDING' || s.status === 'FAILED').length;
}

/**
 * Update an offline sale status
 */
export async function updateOfflineSaleStatus(
  clientTxId: string,
  status: QueuedSale['status'],
  extra?: {
    syncedInvoiceNumber?: string;
    syncedSaleId?: number;
    syncedItems?: Array<{ id: number; productId: number; quantity: number }>;
    errorMessage?: string;
    syncedAt?: string;
  }
): Promise<void> {
  const activeTenantId = resolveActiveTenantId();
  const mirror = readSalesMirrorFromLocalStorage(activeTenantId);
  let mirrorUpdated = false;
  const nextMirror = mirror.map((item) => {
    if (item.clientTxId !== clientTxId) return item;
    mirrorUpdated = true;
    const nextItem: QueuedSale = { ...item, status };
    if (extra?.syncedInvoiceNumber) nextItem.syncedInvoiceNumber = extra.syncedInvoiceNumber;
    if (extra?.syncedSaleId !== undefined) nextItem.syncedSaleId = extra.syncedSaleId;
    if (extra?.syncedItems !== undefined) nextItem.syncedItems = extra.syncedItems;
    if (extra?.errorMessage !== undefined) nextItem.errorMessage = extra.errorMessage;
    if (extra?.syncedAt) nextItem.syncedAt = extra.syncedAt;
    return nextItem;
  });
  if (mirrorUpdated) {
    writeSalesMirrorToLocalStorage(activeTenantId, nextMirror);
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SALES, 'readwrite');
      const store = tx.objectStore(STORE_SALES);
      const getReq = store.get(clientTxId);

      getReq.onsuccess = () => {
        const item: QueuedSale = getReq.result;
        if (!item) {
          resolve();
          return;
        }
        item.status = status;
        if (extra?.syncedInvoiceNumber) item.syncedInvoiceNumber = extra.syncedInvoiceNumber;
        if (extra?.syncedSaleId !== undefined) item.syncedSaleId = extra.syncedSaleId;
        if (extra?.syncedItems !== undefined) item.syncedItems = extra.syncedItems;
        if (extra?.errorMessage !== undefined) item.errorMessage = extra.errorMessage;
        if (extra?.syncedAt) item.syncedAt = extra.syncedAt;

        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch {
    // Mirror already updated
  }
}

/**
 * Delete a synced or rejected offline sale from IndexedDB
 */
export async function deleteOfflineSale(clientTxId: string): Promise<void> {
  const activeTenantId = resolveActiveTenantId();
  const mirror = readSalesMirrorFromLocalStorage(activeTenantId);
  writeSalesMirrorToLocalStorage(
    activeTenantId,
    mirror.filter((s) => s.clientTxId !== clientTxId)
  );

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SALES, 'readwrite');
      const store = tx.objectStore(STORE_SALES);
      const req = store.delete(clientTxId);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Mirror already updated
  }
}

/**
 * Cache products list into tenantId-scoped IndexedDB & LocalStorage mirror
 * for offline product search, catalog browsing, and barcode/article billing.
 */
export async function cacheCatalogOffline(
  products: any[],
  explicitTenantId?: number | string | null
): Promise<void> {
  if (!Array.isArray(products) || products.length === 0) return;

  let tenantId: number;
  try {
    const candidateTenantId =
      parseValidTenantId(explicitTenantId) ??
      parseValidTenantId(products[0]?.tenantId ?? products[0]?.tenant_id);
    tenantId = verifyOfflineTenantId(candidateTenantId);
  } catch {
    return;
  }

  const normalizedList = products
    .map((p) => normalizeCachedProduct(p, tenantId))
    .filter(Boolean);

  if (normalizedList.length === 0) return;

  // 1. Instant synchronous mirror in tenant-scoped localStorage
  saveCatalogMirrorToLocalStorage(tenantId, normalizedList);

  // 2. Persistent tenant-scoped IndexedDB write
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CATALOG, 'readwrite');
      const store = tx.objectStore(STORE_CATALOG);
      for (const item of normalizedList) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // LocalStorage mirror still serves offline catalog if IndexedDB is blocked
  }
}

/**
 * Adjust stock locally in the tenant-scoped offline catalog cache (-1 deducts on sale, +1 restocks on return)
 */
export async function adjustCachedProductStockOffline(
  items: Array<{ productId: number; quantity: number }>,
  deltaSign: -1 | 1 = -1,
  explicitTenantId?: number | string | null
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;
  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return;
  }

  const deltaByProduct = new Map<number, number>();
  for (const item of items) {
    const pid = Number(item.productId);
    const qty = Number(item.quantity) || 0;
    if (pid && qty > 0) {
      deltaByProduct.set(pid, (deltaByProduct.get(pid) || 0) + qty * deltaSign);
    }
  }
  if (deltaByProduct.size === 0) return;

  const currentMirror = readCatalogMirrorFromLocalStorage(tenantId);
  const updatedItems: any[] = [];
  for (const prod of currentMirror) {
    if (parseValidTenantId(prod.tenantId) !== tenantId) continue;
    const delta = deltaByProduct.get(Number(prod.id));
    if (delta) {
      const newStock = Math.max(0, (Number(prod.totalStock ?? prod.total_stock ?? 0) || 0) + delta);
      updatedItems.push({
        ...prod,
        tenantId,
        cacheKey: `${tenantId}:${Number(prod.id)}`,
        totalStock: newStock,
        total_stock: newStock,
      });
    }
  }
  if (updatedItems.length > 0) {
    saveCatalogMirrorToLocalStorage(tenantId, updatedItems);
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_CATALOG, 'readwrite');
      const store = tx.objectStore(STORE_CATALOG);
      for (const [pid, delta] of deltaByProduct.entries()) {
        const cacheKey = `${tenantId}:${pid}`;
        const getReq = store.get(cacheKey);
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (existing && parseValidTenantId(existing.tenantId) === tenantId) {
            const newStock = Math.max(0, (Number(existing.totalStock ?? existing.total_stock ?? 0) || 0) + delta);
            existing.totalStock = newStock;
            existing.total_stock = newStock;
            store.put(existing);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IDB errors
  }
}

/**
 * Delete a single cached product strictly within the active tenant's offline catalog cache
 */
export async function deleteCachedProductOffline(
  productId: number,
  explicitTenantId?: number | string | null
): Promise<void> {
  const pid = Number(productId);
  if (!Number.isSafeInteger(pid) || pid <= 0) return;

  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return;
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const key = getLocalStorageCatalogKey(tenantId);
      const existing = readCatalogMirrorFromLocalStorage(tenantId);
      const filtered = existing.filter(
        (p) => parseValidTenantId(p.tenantId) === tenantId && Number(p.id) !== pid
      );
      localStorage.setItem(key, JSON.stringify(filtered));
    } catch {}
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_CATALOG, 'readwrite');
      const store = tx.objectStore(STORE_CATALOG);
      const cacheKey = `${tenantId}:${pid}`;
      const getReq = store.get(cacheKey);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && parseValidTenantId(existing.tenantId) === tenantId) {
          store.delete(cacheKey);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

/**
 * Retrieve all cached catalog products strictly belonging to the active tenantId
 */
export async function getAllCachedProductsOffline(
  explicitTenantId?: number | string | null
): Promise<any[]> {
  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return [];
  }

  const byId = new Map<number, any>();

  // 1. Load fast localStorage mirror for this tenantId
  for (const item of readCatalogMirrorFromLocalStorage(tenantId)) {
    const norm = normalizeCachedProduct(item, tenantId);
    if (norm) byId.set(norm.id, norm);
  }

  // 2. Load IndexedDB tenant-scoped catalog
  try {
    const db = await openDB();
    const idbItems = await new Promise<any[]>((resolve) => {
      const tx = db.transaction(STORE_CATALOG, 'readonly');
      const store = tx.objectStore(STORE_CATALOG);
      const req = store.indexNames.contains('tenantId')
        ? store.index('tenantId').getAll(IDBKeyRange.only(tenantId))
        : store.getAll();
      req.onsuccess = () => {
        const all = (req.result as any[]) || [];
        resolve(
          all.filter(
            (p) =>
              p &&
              parseValidTenantId(p.tenantId) === tenantId &&
              p.cacheKey === `${tenantId}:${Number(p.id)}`
          )
        );
      };
      req.onerror = () => resolve([]);
    });

    for (const item of idbItems) {
      const norm = normalizeCachedProduct(item, tenantId);
      if (norm) byId.set(norm.id, norm);
    }
  } catch {
    // Fallback to localStorage mirror already populated in byId
  }

  return Array.from(byId.values());
}

/**
 * Lookup a cached product by barcode or article name in the tenant's offline catalog
 */
export async function lookupCachedProductOffline(
  barcodeOrArticle: string,
  explicitTenantId?: number | string | null
): Promise<any | null> {
  const clean = String(barcodeOrArticle || '').trim().toLowerCase();
  if (!clean) return null;

  const allStoreProducts = await getAllCachedProductsOffline(explicitTenantId);
  if (allStoreProducts.length === 0) return null;

  // 1. Exact match on barcode, article, or product name
  const exactMatch = allStoreProducts.find(
    (p: any) =>
      (p.barcode && String(p.barcode).trim().toLowerCase() === clean) ||
      (p.article && String(p.article).trim().toLowerCase() === clean) ||
      (p.name && String(p.name).trim().toLowerCase() === clean)
  );
  if (exactMatch) return exactMatch;

  // 2. Prefix or partial match on article, name, or barcode (so typing an article in offline mode finds it)
  const partialMatch = allStoreProducts.find(
    (p: any) =>
      (p.article && String(p.article).toLowerCase().includes(clean)) ||
      (p.name && String(p.name).toLowerCase().includes(clean)) ||
      (p.barcode && String(p.barcode).toLowerCase().includes(clean))
  );

  return partialMatch || null;
}

/**
 * Search cached products in IndexedDB/LocalStorage when offline (strictly scoped by tenantId)
 */
export async function searchCachedProductsOffline(
  query: string,
  explicitTenantId?: number | string | null,
  limit = 50
): Promise<any[]> {
  const all = await getAllCachedProductsOffline(explicitTenantId);
  const q = String(query || '').toLowerCase().trim();
  if (!q) {
    return all.slice(0, limit);
  }

  // Score matches so exact/prefix article matches appear first
  const matched = all.filter((p) => {
    return (
      (p.article && String(p.article).toLowerCase().includes(q)) ||
      (p.name && String(p.name).toLowerCase().includes(q)) ||
      (p.barcode && String(p.barcode).toLowerCase().includes(q)) ||
      (p.brandName && String(p.brandName).toLowerCase().includes(q)) ||
      (p.brand_name && String(p.brand_name).toLowerCase().includes(q)) ||
      (p.categoryName && String(p.categoryName).toLowerCase().includes(q))
    );
  });

  matched.sort((a, b) => {
    const aExact =
      String(a.article || '').toLowerCase() === q ||
      String(a.barcode || '').toLowerCase() === q;
    const bExact =
      String(b.article || '').toLowerCase() === q ||
      String(b.barcode || '').toLowerCase() === q;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return 0;
  });

  return matched.slice(0, limit);
}

// =========================================================================
// Offline Returns Queue & Recent Invoices Cache (for offline Exchange & Return)
// =========================================================================

function deterministicNegativeId(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return -Math.max(1, (hash >>> 0) % 1000000000);
}

function normalizeCachedSaleForOffline(rawSale: any, tenantId: number): any | null {
  if (!rawSale) return null;
  const inv = String(rawSale.invoiceNumber || rawSale.invoice_number || '').trim();
  const saleId = Number(rawSale.id || 0);
  if (!inv && !saleId) return null;

  const rawItems = Array.isArray(rawSale.items) ? rawSale.items : [];
  const cachedAt = rawSale.cachedAt || new Date().toISOString();

  return {
    id: saleId,
    tenantId,
    cacheKey: `${tenantId}:${saleId || inv.toUpperCase()}`,
    invoiceNumber: inv,
    invoice_number: inv,
    invoiceUpper: inv.toUpperCase(),
    saleDate: rawSale.saleDate || rawSale.sale_date || String(rawSale.createdAt || rawSale.created_at || '').slice(0, 10),
    sale_date: rawSale.sale_date || rawSale.saleDate || String(rawSale.created_at || rawSale.createdAt || '').slice(0, 10),
    totalAmount: Number(rawSale.totalAmount ?? rawSale.total_amount ?? 0) || 0,
    total_amount: Number(rawSale.total_amount ?? rawSale.totalAmount ?? 0) || 0,
    customerId: rawSale.customerId ?? rawSale.customer_id ?? null,
    customer_id: rawSale.customer_id ?? rawSale.customerId ?? null,
    customerName: rawSale.customerName || rawSale.customer_name || 'Walk-in Customer',
    customer_name: rawSale.customer_name || rawSale.customerName || 'Walk-in Customer',
    customerPhone: rawSale.customerPhone || rawSale.customer_phone || '-',
    customer_phone: rawSale.customer_phone || rawSale.customerPhone || '-',
    cashierName: rawSale.cashierName || rawSale.cashier_name || 'Counter',
    cashier_name: rawSale.cashier_name || rawSale.cashierName || 'Counter',
    paymentMethod: rawSale.paymentMethod || rawSale.payment_method || 'CASH',
    saleType: rawSale.saleType || rawSale.sale_type || 'RETAIL',
    cachedAt,
    items: rawItems.map((it: any) => {
      const soldQty = Number(it.soldQuantity ?? it.quantity ?? 0) || 0;
      const alreadyRet = Number(it.alreadyReturnedQuantity ?? it.already_returned_qty ?? it.already_returned_quantity ?? 0) || 0;
      const unitPrice = Number(it.unitPrice ?? it.unit_price ?? 0) || 0;
      const discount = Number(it.discount ?? 0) || 0;
      const subtotal = Number(it.subtotal ?? (unitPrice * soldQty - discount)) || 0;
      const effPrice = soldQty > 0 ? Math.max(0, Math.round((subtotal / soldQty) * 100) / 100) : unitPrice;
      return {
        id: Number(it.id || 0),
        productId: Number(it.productId ?? it.product_id ?? 0),
        product_id: Number(it.product_id ?? it.productId ?? 0),
        article: it.article || it.productName || it.product_name || 'Shoe',
        productName: it.productName || it.product_name || it.article || 'Shoe',
        product_name: it.product_name || it.productName || it.article || 'Shoe',
        barcode: it.barcode || '',
        quantity: soldQty,
        soldQuantity: soldQty,
        already_returned_qty: alreadyRet,
        alreadyReturnedQuantity: alreadyRet,
        returnableQuantity: Math.max(0, soldQty - alreadyRet),
        unit_price: unitPrice,
        unitPrice,
        discount,
        effectiveUnitPrice: Number(it.effectiveUnitPrice ?? effPrice) || effPrice,
        subtotal,
      };
    }),
  };
}

export async function cacheSalesHistoryOffline(
  sales: any[],
  explicitTenantId?: number | string | null
): Promise<void> {
  if (!Array.isArray(sales) || sales.length === 0) return;
  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return;
  }

  const normalized = sales
    .map((s) => normalizeCachedSaleForOffline(s, tenantId))
    .filter(Boolean);
  if (normalized.length === 0) return;

  const existing = readSalesCacheMirrorFromLocalStorage(tenantId);
  const byKey = new Map<string, any>();
  for (const s of existing) {
    if (s && s.cacheKey) byKey.set(s.cacheKey, s);
  }
  for (const s of normalized) {
    if (s && s.cacheKey) byKey.set(s.cacheKey, s);
  }
  const merged = Array.from(byKey.values())
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    .slice(0, 250);
  writeSalesCacheMirrorToLocalStorage(tenantId, merged);

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_SALES_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_SALES_CACHE);
      for (const s of normalized) {
        store.put(s);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // LocalStorage mirror holds cache
  }
}

export async function upsertSingleCachedSaleOffline(
  sale: any,
  explicitTenantId?: number | string | null
): Promise<void> {
  if (!sale) return;
  return cacheSalesHistoryOffline([sale], explicitTenantId);
}

export async function getCachedSalesHistoryOffline(
  explicitTenantId?: number | string | null
): Promise<any[]> {
  let tenantId: number;
  try {
    tenantId = verifyOfflineTenantId(explicitTenantId);
  } catch {
    return [];
  }

  const byKey = new Map<string, any>();
  for (const s of readSalesCacheMirrorFromLocalStorage(tenantId)) {
    if (s && s.cacheKey) byKey.set(s.cacheKey, s);
  }

  try {
    const db = await openDB();
    const idbSales = await new Promise<any[]>((resolve) => {
      const tx = db.transaction(STORE_SALES_CACHE, 'readonly');
      const store = tx.objectStore(STORE_SALES_CACHE);
      const req = store.indexNames.contains('tenantId')
        ? store.index('tenantId').getAll(IDBKeyRange.only(tenantId))
        : store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as any[]) || [];
        resolve(rows.filter((r) => r && parseValidTenantId(r.tenantId) === tenantId));
      };
      req.onerror = () => resolve([]);
    });
    for (const s of idbSales) {
      if (s && s.cacheKey) byKey.set(s.cacheKey, s);
    }
  } catch {
    // Fallback to mirror
  }

  return Array.from(byKey.values()).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

export async function queueOfflineReturn(
  ret: QueuedReturn,
  explicitTenantId?: number | null
): Promise<void> {
  const resolvedTenantId = resolveActiveTenantId(ret.tenantId ?? explicitTenantId);
  const scopedRet: QueuedReturn = {
    ...ret,
    ...(resolvedTenantId ? { tenantId: resolvedTenantId } : {}),
  };

  const mirror = readReturnsMirrorFromLocalStorage(resolvedTenantId);
  const filtered = mirror.filter((r) => r.clientReturnId !== scopedRet.clientReturnId);
  filtered.unshift(scopedRet);
  writeReturnsMirrorToLocalStorage(resolvedTenantId, filtered);

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RETURNS, 'readwrite');
      const store = tx.objectStore(STORE_RETURNS);
      const req = store.put(scopedRet);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    if (typeof localStorage === 'undefined') {
      throw err;
    }
  }

  // Restock returned items locally right away so POS & subsequent sales see restored stock
  if (Array.isArray(ret.items) && ret.items.length > 0 && resolvedTenantId) {
    await adjustCachedProductStockOffline(ret.items, 1, resolvedTenantId).catch(() => {});
  }
}

export async function getOfflineReturns(explicitTenantId?: number | null): Promise<QueuedReturn[]> {
  const activeTenantId = resolveActiveTenantId(explicitTenantId);
  const byId = new Map<string, QueuedReturn>();

  for (const r of readReturnsMirrorFromLocalStorage(activeTenantId)) {
    if (r && r.clientReturnId) {
      if ((activeTenantId && r.tenantId && Number(r.tenantId) === activeTenantId) || !r.tenantId) {
        byId.set(r.clientReturnId, r);
      }
    }
  }

  try {
    const db = await openDB();
    const idbResults = await new Promise<QueuedReturn[]>((resolve) => {
      if (!db.objectStoreNames.contains(STORE_RETURNS)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(STORE_RETURNS, 'readonly');
      const store = tx.objectStore(STORE_RETURNS);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as QueuedReturn[]) || [];
        resolve(
          all.filter((r) => {
            if (activeTenantId && r.tenantId) return Number(r.tenantId) === activeTenantId;
            return !r.tenantId;
          })
        );
      };
      req.onerror = () => resolve([]);
    });
    for (const r of idbResults) {
      if (r && r.clientReturnId) {
        byId.set(r.clientReturnId, r);
      }
    }
  } catch {
    // Serve mirror
  }

  const results = Array.from(byId.values());
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

export async function getPendingOfflineReturnsCount(explicitTenantId?: number | null): Promise<number> {
  const all = await getOfflineReturns(explicitTenantId);
  return all.filter((r) => r.status === 'PENDING' || r.status === 'FAILED').length;
}

export async function updateOfflineReturnStatus(
  clientReturnId: string,
  status: QueuedReturn['status'],
  extra?: { syncedReturnNumber?: string; errorMessage?: string; syncedAt?: string }
): Promise<void> {
  const activeTenantId = resolveActiveTenantId();
  const mirror = readReturnsMirrorFromLocalStorage(activeTenantId);
  let mirrorUpdated = false;
  const nextMirror = mirror.map((item) => {
    if (item.clientReturnId !== clientReturnId) return item;
    mirrorUpdated = true;
    const nextItem: QueuedReturn = { ...item, status };
    if (extra?.syncedReturnNumber) nextItem.syncedReturnNumber = extra.syncedReturnNumber;
    if (extra?.errorMessage !== undefined) nextItem.errorMessage = extra.errorMessage;
    if (extra?.syncedAt) nextItem.syncedAt = extra.syncedAt;
    return nextItem;
  });
  if (mirrorUpdated) {
    writeReturnsMirrorToLocalStorage(activeTenantId, nextMirror);
  }

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_RETURNS)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RETURNS, 'readwrite');
      const store = tx.objectStore(STORE_RETURNS);
      const getReq = store.get(clientReturnId);
      getReq.onsuccess = () => {
        const item: QueuedReturn = getReq.result;
        if (!item) {
          resolve();
          return;
        }
        item.status = status;
        if (extra?.syncedReturnNumber) item.syncedReturnNumber = extra.syncedReturnNumber;
        if (extra?.errorMessage !== undefined) item.errorMessage = extra.errorMessage;
        if (extra?.syncedAt) item.syncedAt = extra.syncedAt;
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch {
    // Mirror already updated
  }
}

export async function deleteOfflineReturn(clientReturnId: string): Promise<void> {
  const activeTenantId = resolveActiveTenantId();
  const mirror = readReturnsMirrorFromLocalStorage(activeTenantId);
  writeReturnsMirrorToLocalStorage(
    activeTenantId,
    mirror.filter((r) => r.clientReturnId !== clientReturnId)
  );

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_RETURNS)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RETURNS, 'readwrite');
      const store = tx.objectStore(STORE_RETURNS);
      const req = store.delete(clientReturnId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Mirror updated
  }
}

/**
 * Verifies an invoice offline using both locally cached server sales and queued offline invoices,
 * subtracting any quantities already returned by pending/offline returns and exchanges.
 */
export async function verifyInvoiceOffline(
  invoiceNumber: string,
  explicitTenantId?: number | string | null
): Promise<{ sale: any; items: any[]; offline: true } | null> {
  const rawQuery = String(invoiceNumber || '').trim();
  if (!rawQuery) return null;
  const cleanUpper = rawQuery.replace(/\s*\(OFFLINE\)\s*$/i, '').trim().toUpperCase();
  const resolvedTenantId = resolveActiveTenantId(explicitTenantId);

  const [cachedSales, offlineSales, offlineReturns] = await Promise.all([
    resolvedTenantId ? getCachedSalesHistoryOffline(resolvedTenantId) : Promise.resolve([]),
    getOfflineSales(resolvedTenantId),
    getOfflineReturns(resolvedTenantId),
  ]);

  let matchedSale: any = null;
  let isOfflineQueuedSale = false;
  let matchedClientTxId: string | null = null;

  // 1. Check cached server sales first (matches invoice number or numeric ID)
  const serverMatch = cachedSales.find((s) => {
    const inv = String(s.invoiceNumber || s.invoice_number || '').trim().toUpperCase();
    return inv === cleanUpper || (/^\d+$/.test(cleanUpper) && Number(s.id) === Number(cleanUpper));
  });

  if (serverMatch) {
    matchedSale = {
      ...serverMatch,
      items: (serverMatch.items || []).map((it: any) => ({ ...it })),
    };
  } else {
    // 2. Check queued offline sales (by clientTxId or syncedInvoiceNumber)
    const queuedMatch = offlineSales.find((s) => {
      const txUpper = String(s.clientTxId || '').trim().toUpperCase();
      const syncedUpper = String(s.syncedInvoiceNumber || '').trim().toUpperCase();
      return txUpper === cleanUpper || (syncedUpper && syncedUpper === cleanUpper);
    });

    if (queuedMatch) {
      isOfflineQueuedSale = true;
      matchedClientTxId = queuedMatch.clientTxId;
      const syntheticSaleId = queuedMatch.syncedSaleId || deterministicNegativeId(queuedMatch.clientTxId);
      const effectiveInvoice = queuedMatch.syncedInvoiceNumber || queuedMatch.clientTxId;
      matchedSale = {
        id: syntheticSaleId,
        invoiceNumber: effectiveInvoice,
        invoice_number: effectiveInvoice,
        originalClientTxId: queuedMatch.clientTxId,
        isOfflineSale: !queuedMatch.syncedSaleId,
        saleDate: String(queuedMatch.createdAt || '').slice(0, 10),
        sale_date: String(queuedMatch.createdAt || '').slice(0, 10),
        totalAmount: Number(queuedMatch.totalAmount || 0),
        total_amount: Number(queuedMatch.totalAmount || 0),
        customerName: queuedMatch.customerName || 'Walk-in Customer',
        customer_name: queuedMatch.customerName || 'Walk-in Customer',
        customerPhone: queuedMatch.customerPhone || '-',
        customer_phone: queuedMatch.customerPhone || '-',
        customerId: queuedMatch.customerId || null,
        customer_id: queuedMatch.customerId || null,
        cashierName: queuedMatch.cashierName || 'Counter',
        cashier_name: queuedMatch.cashierName || 'Counter',
        cachedAt: queuedMatch.createdAt,
        items: (queuedMatch.items || []).map((it, idx) => {
          const soldQty = Number(it.quantity || 0) || 0;
          const unitPrice = Number(it.unitPrice || 0) || 0;
          const discount = Number(it.discount || 0) || 0;
          const subtotal = Number(it.subtotal ?? (soldQty * unitPrice - discount)) || 0;
          const syncedItem = queuedMatch.syncedItems?.find((si) => Number(si.productId) === Number(it.productId));
          const syntheticItemId = syncedItem?.id || -(Math.abs(syntheticSaleId) * 100 + idx + 1);
          const effUnit = soldQty > 0 ? Math.max(0, Math.round((subtotal / soldQty) * 100) / 100) : unitPrice;
          return {
            id: syntheticItemId,
            productId: it.productId,
            product_id: it.productId,
            article: it.article || it.name || 'Shoe',
            productName: it.name || it.article || 'Shoe',
            product_name: it.name || it.article || 'Shoe',
            barcode: it.barcode || '',
            quantity: soldQty,
            soldQuantity: soldQty,
            already_returned_qty: 0,
            alreadyReturnedQuantity: 0,
            returnableQuantity: soldQty,
            unit_price: unitPrice,
            unitPrice,
            discount,
            effectiveUnitPrice: effUnit,
            subtotal,
          };
        }),
      };
    }
  }

  if (!matchedSale) return null;

  // Subtract locally queued (or post-cache-synced) offline returns and exchanges for this invoice
  const saleCachedAtMs = matchedSale.cachedAt ? Date.parse(matchedSale.cachedAt) : 0;
  const targetInvUpper = String(matchedSale.invoiceNumber || '').trim().toUpperCase();
  const targetSaleId = Number(matchedSale.id || 0);

  const extraReturnedByItemId = new Map<number, number>();
  const extraReturnedByProductId = new Map<number, number>();

  const recordOfflineReturnItems = (retItems: any[], createdAt?: string, syncedAt?: string) => {
    if (syncedAt && saleCachedAtMs && Date.parse(syncedAt) <= saleCachedAtMs) {
      return; // Already reflected in cached server snapshot
    }
    void createdAt;
    for (const ri of retItems) {
      const qty = Number(ri?.quantity ?? ri?.returnQty ?? 0) || 0;
      if (qty <= 0) continue;
      const siId = Number(ri?.saleItemId || 0);
      const pid = Number(ri?.productId ?? ri?.product_id ?? 0);
      if (siId !== 0) {
        extraReturnedByItemId.set(siId, (extraReturnedByItemId.get(siId) || 0) + qty);
      } else if (pid > 0) {
        extraReturnedByProductId.set(pid, (extraReturnedByProductId.get(pid) || 0) + qty);
      }
    }
  };

  for (const r of offlineReturns) {
    if (!r) continue;
    const refInv = String(r.originalInvoiceNumber || r.originalClientTxId || '').replace(/\s*\(OFFLINE\)\s*$/i, '').trim().toUpperCase();
    const matchesInv =
      (targetSaleId !== 0 && Number(r.originalSaleId) === targetSaleId) ||
      (matchedClientTxId && r.originalClientTxId === matchedClientTxId) ||
      (refInv && refInv === targetInvUpper);
    if (matchesInv && Array.isArray(r.items)) {
      recordOfflineReturnItems(r.items, r.createdAt, r.syncedAt);
    }
  }

  for (const s of offlineSales) {
    if (!s?.exchange || !Array.isArray(s.exchange.items)) continue;
    const ex = s.exchange;
    const refInv = String(ex.originalInvoiceNumber || ex.originalClientTxId || '').replace(/\s*\(OFFLINE\)\s*$/i, '').trim().toUpperCase();
    const matchesInv =
      (targetSaleId !== 0 && Number(ex.originalSaleId) === targetSaleId) ||
      (matchedClientTxId && ex.originalClientTxId === matchedClientTxId) ||
      (refInv && refInv === targetInvUpper);
    if (matchesInv) {
      recordOfflineReturnItems(ex.items, s.createdAt, s.syncedAt);
    }
  }

  const finalItems = (matchedSale.items || []).map((item: any) => {
    const soldQty = Number(item.soldQuantity ?? item.quantity ?? 0) || 0;
    const baseReturned = Number(item.alreadyReturnedQuantity ?? item.already_returned_qty ?? 0) || 0;
    const byItem = extraReturnedByItemId.get(Number(item.id)) || 0;
    const byProd = extraReturnedByProductId.get(Number(item.productId)) || 0;
    const totalReturned = Math.min(soldQty, baseReturned + byItem + byProd);
    const returnable = Math.max(0, soldQty - totalReturned);
    return {
      ...item,
      already_returned_qty: totalReturned,
      alreadyReturnedQuantity: totalReturned,
      returnableQuantity: returnable,
    };
  });

  return {
    sale: {
      ...matchedSale,
      isOfflineSale: isOfflineQueuedSale && !matchedSale.syncedSaleId,
      items: finalItems,
    },
    items: finalItems,
    offline: true,
  };
}


