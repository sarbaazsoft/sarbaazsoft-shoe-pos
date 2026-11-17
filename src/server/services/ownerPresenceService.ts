/**
 * Real-time Store Owner (ADMIN / OWNER) session and heartbeat presence tracker.
 *
 * Used by transaction notification routing to decide cleanly:
 * - Owner Online  -> In-app (SSE) / Push notification only (zero email)
 * - Owner Offline -> Email alert only (no duplicate owner push/in-app alerts)
 */

export const OWNER_HEARTBEAT_TTL_MS = 75_000; // 75s (> 2x the 30s client heartbeat cadence)
export const OWNER_SSE_GRACE_TTL_MS = 8_000; // Brief grace window for page reloads on silent SSE close

export interface OwnerSessionRecord {
  tenantId: number;
  userId: number;
  role: string;
  sessionId: string;
  lastSeenAt: number;
  expiresAt: number;
}

const ownerHeartbeatSessions = new Map<string, OwnerSessionRecord>();
const superAdminHeartbeatSessions = new Map<string, OwnerSessionRecord>();
let activeSuperAdminSseChecker: (() => boolean) | null = null;

export function isOwnerRole(role?: string | null): boolean {
  const clean = String(role || '').trim().toUpperCase();
  return clean === 'ADMIN' || clean === 'OWNER';
}

export function isSuperAdminRole(role?: string | null): boolean {
  return String(role || '').trim().toUpperCase() === 'SUPERADMIN';
}

function sanitizeSessionId(sessionId?: string | null): string {
  const clean = String(sessionId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '');
  return clean ? clean.slice(0, 64) : 'default';
}

function makeSessionKey(tenantId: number, userId: number, sessionId?: string | null): string {
  return `${tenantId}:${userId}:${sanitizeSessionId(sessionId)}`;
}

function makeSuperAdminSessionKey(userId: number, sessionId?: string | null): string {
  return `SA:${userId}:${sanitizeSessionId(sessionId)}`;
}

export function pruneExpiredOwnerSessions(now: number = Date.now()): void {
  for (const [key, entry] of ownerHeartbeatSessions.entries()) {
    if (entry.expiresAt <= now) {
      ownerHeartbeatSessions.delete(key);
    }
  }
}

export function recordOwnerHeartbeat(params: {
  tenantId: number;
  userId: number;
  role?: string | null;
  sessionId?: string | null;
  ttlMs?: number;
  now?: number;
}): boolean {
  const cleanTenantId = Number(params.tenantId);
  const cleanUserId = Number(params.userId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return false;
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) return false;
  if (!isOwnerRole(params.role)) return false;

  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? params.now : Date.now();
  const ttlMs =
    typeof params.ttlMs === 'number' && params.ttlMs > 0 ? params.ttlMs : OWNER_HEARTBEAT_TTL_MS;
  const cleanSessionId = sanitizeSessionId(params.sessionId);

  pruneExpiredOwnerSessions(now);

  ownerHeartbeatSessions.set(makeSessionKey(cleanTenantId, cleanUserId, cleanSessionId), {
    tenantId: cleanTenantId,
    userId: cleanUserId,
    role: String(params.role).trim().toUpperCase(),
    sessionId: cleanSessionId,
    lastSeenAt: now,
    expiresAt: now + ttlMs,
  });

  return true;
}

export function markOwnerSessionOffline(params: {
  tenantId?: number | null;
  userId?: number | null;
  sessionId?: string | null;
}): number {
  const cleanTenantId = Number(params.tenantId);
  const cleanUserId = Number(params.userId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return 0;
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) return 0;

  let removed = 0;
  if (params.sessionId && String(params.sessionId).trim()) {
    const key = makeSessionKey(cleanTenantId, cleanUserId, params.sessionId);
    if (ownerHeartbeatSessions.delete(key)) {
      removed++;
    }
    return removed;
  }

  const userPrefix = `${cleanTenantId}:${cleanUserId}:`;
  for (const key of ownerHeartbeatSessions.keys()) {
    if (key.startsWith(userPrefix)) {
      ownerHeartbeatSessions.delete(key);
      removed++;
    }
  }
  return removed;
}

export function shrinkOwnerSessionGraceWindow(params: {
  tenantId: number;
  userId?: number | null;
  sessionId?: string | null;
  graceMs?: number;
  now?: number;
}): void {
  const cleanTenantId = Number(params.tenantId);
  const cleanUserId = Number(params.userId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return;

  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? params.now : Date.now();
  const graceMs =
    typeof params.graceMs === 'number' && params.graceMs >= 0 ? params.graceMs : OWNER_SSE_GRACE_TTL_MS;
  const maxAllowedExpiry = now + graceMs;

  if (Number.isInteger(cleanUserId) && cleanUserId > 0 && params.sessionId) {
    const key = makeSessionKey(cleanTenantId, cleanUserId, params.sessionId);
    const existing = ownerHeartbeatSessions.get(key);
    if (existing) {
      existing.expiresAt = Math.min(existing.expiresAt, maxAllowedExpiry);
    }
    return;
  }

  const prefix =
    Number.isInteger(cleanUserId) && cleanUserId > 0
      ? `${cleanTenantId}:${cleanUserId}:`
      : `${cleanTenantId}:`;

  for (const [key, entry] of ownerHeartbeatSessions.entries()) {
    if (key.startsWith(prefix)) {
      entry.expiresAt = Math.min(entry.expiresAt, maxAllowedExpiry);
    }
  }
}

export function clearTenantOwnerPresence(tenantId: number): number {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return 0;
  let removed = 0;
  const prefix = `${cleanTenantId}:`;
  for (const key of ownerHeartbeatSessions.keys()) {
    if (key.startsWith(prefix)) {
      ownerHeartbeatSessions.delete(key);
      removed++;
    }
  }
  return removed;
}

export function hasFreshOwnerHeartbeat(tenantId: number, now: number = Date.now()): boolean {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return false;

  pruneExpiredOwnerSessions(now);

  for (const entry of ownerHeartbeatSessions.values()) {
    if (
      entry.tenantId === cleanTenantId &&
      entry.expiresAt > now &&
      isOwnerRole(entry.role)
    ) {
      return true;
    }
  }
  return false;
}

export function getActiveOwnerSessions(tenantId: number, now: number = Date.now()): OwnerSessionRecord[] {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return [];
  pruneExpiredOwnerSessions(now);

  const list: OwnerSessionRecord[] = [];
  for (const entry of ownerHeartbeatSessions.values()) {
    if (entry.tenantId === cleanTenantId && entry.expiresAt > now && isOwnerRole(entry.role)) {
      list.push({ ...entry });
    }
  }
  return list;
}

export function pruneExpiredSuperAdminSessions(now: number = Date.now()): void {
  for (const [key, entry] of superAdminHeartbeatSessions.entries()) {
    if (entry.expiresAt <= now) {
      superAdminHeartbeatSessions.delete(key);
    }
  }
}

export function recordSuperAdminHeartbeat(params: {
  userId: number;
  role?: string | null;
  sessionId?: string | null;
  ttlMs?: number;
  now?: number;
}): boolean {
  const cleanUserId = Number(params.userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) return false;
  if (params.role && !isSuperAdminRole(params.role)) return false;

  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? params.now : Date.now();
  const ttlMs =
    typeof params.ttlMs === 'number' && params.ttlMs > 0 ? params.ttlMs : OWNER_HEARTBEAT_TTL_MS;
  const cleanSessionId = sanitizeSessionId(params.sessionId);

  pruneExpiredSuperAdminSessions(now);

  superAdminHeartbeatSessions.set(makeSuperAdminSessionKey(cleanUserId, cleanSessionId), {
    tenantId: 0,
    userId: cleanUserId,
    role: 'SUPERADMIN',
    sessionId: cleanSessionId,
    lastSeenAt: now,
    expiresAt: now + ttlMs,
  });

  return true;
}

export function markSuperAdminSessionOffline(params: {
  userId?: number | null;
  sessionId?: string | null;
}): number {
  const cleanUserId = Number(params.userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) return 0;

  let removed = 0;
  if (params.sessionId && String(params.sessionId).trim()) {
    const key = makeSuperAdminSessionKey(cleanUserId, params.sessionId);
    if (superAdminHeartbeatSessions.delete(key)) {
      removed++;
    }
    return removed;
  }

  const userPrefix = `SA:${cleanUserId}:`;
  for (const key of superAdminHeartbeatSessions.keys()) {
    if (key.startsWith(userPrefix)) {
      superAdminHeartbeatSessions.delete(key);
      removed++;
    }
  }
  return removed;
}

export function shrinkSuperAdminSessionGraceWindow(params: {
  userId?: number | null;
  sessionId?: string | null;
  graceMs?: number;
  now?: number;
}): void {
  const cleanUserId = Number(params.userId);
  const now = typeof params.now === 'number' && Number.isFinite(params.now) ? params.now : Date.now();
  const graceMs =
    typeof params.graceMs === 'number' && params.graceMs >= 0 ? params.graceMs : OWNER_SSE_GRACE_TTL_MS;
  const maxAllowedExpiry = now + graceMs;

  if (Number.isInteger(cleanUserId) && cleanUserId > 0 && params.sessionId) {
    const key = makeSuperAdminSessionKey(cleanUserId, params.sessionId);
    const existing = superAdminHeartbeatSessions.get(key);
    if (existing) {
      existing.expiresAt = Math.min(existing.expiresAt, maxAllowedExpiry);
    }
    return;
  }

  const prefix =
    Number.isInteger(cleanUserId) && cleanUserId > 0 ? `SA:${cleanUserId}:` : 'SA:';

  for (const [key, entry] of superAdminHeartbeatSessions.entries()) {
    if (key.startsWith(prefix)) {
      entry.expiresAt = Math.min(entry.expiresAt, maxAllowedExpiry);
    }
  }
}

export function hasFreshSuperAdminHeartbeat(now: number = Date.now()): boolean {
  pruneExpiredSuperAdminSessions(now);

  for (const entry of superAdminHeartbeatSessions.values()) {
    if (entry.expiresAt > now && isSuperAdminRole(entry.role)) {
      return true;
    }
  }
  return false;
}

export function getActiveSuperAdminSessions(now: number = Date.now()): OwnerSessionRecord[] {
  pruneExpiredSuperAdminSessions(now);

  const list: OwnerSessionRecord[] = [];
  for (const entry of superAdminHeartbeatSessions.values()) {
    if (entry.expiresAt > now && isSuperAdminRole(entry.role)) {
      list.push({ ...entry });
    }
  }
  return list;
}

export function registerSuperAdminSseChecker(fn: (() => boolean) | null): void {
  activeSuperAdminSseChecker = fn;
}

export function isPlatformSuperAdminOnline(now: number = Date.now()): boolean {
  return Boolean(activeSuperAdminSseChecker?.()) || hasFreshSuperAdminHeartbeat(now);
}

export function resetOwnerPresenceForTests(): void {
  ownerHeartbeatSessions.clear();
  superAdminHeartbeatSessions.clear();
}
