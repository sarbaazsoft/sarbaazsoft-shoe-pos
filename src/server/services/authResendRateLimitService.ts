import type { Request } from 'express';
import { pgClient } from '../../db/index.ts';
import { ensureAuthRateLimitSchema } from '../../db/schemaInit.ts';

export type AuthResendFlow = 'email_verification' | 'password_reset';

export const PROGRESSIVE_COOLDOWN_SECONDS = [120, 300, 600, 900, 1800] as const;
export const IP_WINDOW_SECONDS = 15 * 60; // 15 minutes
export const IP_WINDOW_MAX_REQUESTS = 10;

export interface CooldownSnapshot {
  flow: AuthResendFlow;
  attemptCount: number;
  cooldownSeconds: number;
  remainingSeconds: number;
  nextAvailableAt: string | null;
  isInCooldown: boolean;
  blockedByIp?: boolean;
}

export interface ConsumeLimitResult extends CooldownSnapshot {
  allowed: boolean;
  error?: string;
  code?: string;
}

interface RateLimitRow {
  flow: AuthResendFlow;
  scope_type: 'account' | 'ip';
  scope_key: string;
  attempt_count: number;
  last_sent_at: string | Date | null;
  cooldown_until: string | Date | null;
  window_start_at: string | Date | null;
  window_request_count: number;
}

const inFlightAccountSends = new Set<string>();

export function normalizeAuthEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function normalizeAuthFlow(raw: unknown): AuthResendFlow | null {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'email_verification' || val === 'verification' || val === 'confirm_email') {
    return 'email_verification';
  }
  if (val === 'password_reset' || val === 'reset_password' || val === 'forgot_password') {
    return 'password_reset';
  }
  return null;
}

export function getCooldownSecondsForAttempt(attemptCount: number): number {
  const count = Math.floor(Number(attemptCount) || 0);
  if (count <= 0) return 0;
  const idx = Math.min(count - 1, PROGRESSIVE_COOLDOWN_SECONDS.length - 1);
  return PROGRESSIVE_COOLDOWN_SECONDS[idx];
}

export function formatRemainingMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function extractClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  let raw = '';
  if (typeof xff === 'string' && xff.trim()) {
    raw = xff.split(',')[0].trim();
  } else if (Array.isArray(xff) && xff.length > 0) {
    raw = String(xff[0]).split(',')[0].trim();
  } else if (typeof req.headers['x-real-ip'] === 'string' && req.headers['x-real-ip'].trim()) {
    raw = req.headers['x-real-ip'].trim();
  } else {
    raw = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  }
  const normalized = raw.replace(/^::ffff:/i, '');
  return normalized || 'unknown';
}

function toTimestampMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function getRateLimitRow(
  flow: AuthResendFlow,
  scopeType: 'account' | 'ip',
  scopeKey: string
): Promise<RateLimitRow | null> {
  if (!scopeKey) return null;
  await ensureAuthRateLimitSchema();
  const res = await pgClient.query<RateLimitRow>(
    `SELECT flow, scope_type, scope_key, attempt_count, last_sent_at, cooldown_until, window_start_at, window_request_count
     FROM auth_resend_rate_limits
     WHERE flow = $1 AND scope_type = $2 AND scope_key = $3
     LIMIT 1`,
    [flow, scopeType, scopeKey]
  );
  return res.rows[0] || null;
}

async function upsertRateLimitRow(row: RateLimitRow): Promise<void> {
  await ensureAuthRateLimitSchema();
  await pgClient.query(
    `INSERT INTO auth_resend_rate_limits (
       flow, scope_type, scope_key, attempt_count, last_sent_at, cooldown_until, window_start_at, window_request_count, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (flow, scope_type, scope_key) DO UPDATE SET
       attempt_count = EXCLUDED.attempt_count,
       last_sent_at = EXCLUDED.last_sent_at,
       cooldown_until = EXCLUDED.cooldown_until,
       window_start_at = EXCLUDED.window_start_at,
       window_request_count = EXCLUDED.window_request_count,
       updated_at = NOW()`,
    [
      row.flow,
      row.scope_type,
      row.scope_key,
      row.attempt_count,
      row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
      row.cooldown_until ? new Date(row.cooldown_until).toISOString() : null,
      row.window_start_at ? new Date(row.window_start_at).toISOString() : null,
      row.window_request_count,
    ]
  );
}

function buildSnapshotFromRows(
  flow: AuthResendFlow,
  accountRow: RateLimitRow | null,
  ipRow: RateLimitRow | null,
  nowMs: number
): CooldownSnapshot {
  const accCooldownMs = toTimestampMs(accountRow?.cooldown_until);
  const ipCooldownMs = toTimestampMs(ipRow?.cooldown_until);

  const accRemaining = accCooldownMs && accCooldownMs > nowMs ? Math.ceil((accCooldownMs - nowMs) / 1000) : 0;
  const ipRemaining = ipCooldownMs && ipCooldownMs > nowMs ? Math.ceil((ipCooldownMs - nowMs) / 1000) : 0;

  const remainingSeconds = Math.max(accRemaining, ipRemaining);
  const blockedByIp = ipRemaining > accRemaining && ipRemaining > 0;
  const attemptCount = Number(accountRow?.attempt_count || 0);
  const effectiveUntilMs = remainingSeconds > 0 ? nowMs + remainingSeconds * 1000 : null;
  const cooldownSeconds =
    remainingSeconds > 0
      ? blockedByIp
        ? Math.max(ipRemaining, getCooldownSecondsForAttempt(Number(ipRow?.attempt_count || 1)))
        : getCooldownSecondsForAttempt(attemptCount)
      : 0;

  return {
    flow,
    attemptCount,
    cooldownSeconds,
    remainingSeconds,
    nextAvailableAt: effectiveUntilMs ? new Date(effectiveUntilMs).toISOString() : null,
    isInCooldown: remainingSeconds > 0,
    ...(blockedByIp ? { blockedByIp: true } : {}),
  };
}

export async function getResendCooldownStatus(
  flow: AuthResendFlow,
  email: string,
  ip?: string,
  nowMs = Date.now()
): Promise<CooldownSnapshot> {
  const cleanEmail = normalizeAuthEmail(email);
  const accountRow = cleanEmail ? await getRateLimitRow(flow, 'account', cleanEmail) : null;
  const ipRow = ip && ip !== 'unknown' ? await getRateLimitRow(flow, 'ip', ip) : null;
  return buildSnapshotFromRows(flow, accountRow, ipRow, nowMs);
}

/**
 * Checks whether the client IP has an active rate-limit block before looking up accounts.
 * Prevents unauthenticated account-enumeration floods.
 */
export async function checkIpRateLimit(
  flow: AuthResendFlow,
  ip: string,
  nowMs = Date.now()
): Promise<ConsumeLimitResult> {
  if (!ip || ip === 'unknown') {
    return {
      allowed: true,
      flow,
      attemptCount: 0,
      cooldownSeconds: 0,
      remainingSeconds: 0,
      nextAvailableAt: null,
      isInCooldown: false,
    };
  }

  const ipRow = await getRateLimitRow(flow, 'ip', ip);
  const ipCooldownMs = toTimestampMs(ipRow?.cooldown_until);
  if (ipCooldownMs && ipCooldownMs > nowMs) {
    const remainingSeconds = Math.ceil((ipCooldownMs - nowMs) / 1000);
    return {
      allowed: false,
      flow,
      attemptCount: Number(ipRow?.attempt_count || 0),
      cooldownSeconds: remainingSeconds,
      remainingSeconds,
      nextAvailableAt: new Date(ipCooldownMs).toISOString(),
      isInCooldown: true,
      blockedByIp: true,
      code: 'IP_RATE_LIMIT_ACTIVE',
      error: `Too many requests from this network. Please wait ${formatRemainingMMSS(remainingSeconds)} before trying again.`,
    };
  }

  return {
    allowed: true,
    flow,
    attemptCount: 0,
    cooldownSeconds: 0,
    remainingSeconds: 0,
    nextAvailableAt: null,
    isInCooldown: false,
  };
}

async function incrementIpWindow(flow: AuthResendFlow, ip: string, nowMs: number): Promise<ConsumeLimitResult> {
  if (!ip || ip === 'unknown') {
    return {
      allowed: true,
      flow,
      attemptCount: 0,
      cooldownSeconds: 0,
      remainingSeconds: 0,
      nextAvailableAt: null,
      isInCooldown: false,
    };
  }

  const existing = await getRateLimitRow(flow, 'ip', ip);
  const existingCooldownMs = toTimestampMs(existing?.cooldown_until);
  if (existingCooldownMs && existingCooldownMs > nowMs) {
    const remainingSeconds = Math.ceil((existingCooldownMs - nowMs) / 1000);
    return {
      allowed: false,
      flow,
      attemptCount: Number(existing?.attempt_count || 0),
      cooldownSeconds: remainingSeconds,
      remainingSeconds,
      nextAvailableAt: new Date(existingCooldownMs).toISOString(),
      isInCooldown: true,
      blockedByIp: true,
      code: 'IP_RATE_LIMIT_ACTIVE',
      error: `Too many requests from this network. Please wait ${formatRemainingMMSS(remainingSeconds)} before trying again.`,
    };
  }

  const prevWindowStartMs = toTimestampMs(existing?.window_start_at);
  const isWindowActive = Boolean(prevWindowStartMs && nowMs - prevWindowStartMs < IP_WINDOW_SECONDS * 1000);
  const windowStartAt = isWindowActive ? new Date(prevWindowStartMs!).toISOString() : new Date(nowMs).toISOString();
  const nextWindowCount = isWindowActive ? Number(existing?.window_request_count || 0) + 1 : 1;

  if (nextWindowCount > IP_WINDOW_MAX_REQUESTS) {
    const nextIpAttempts = Number(existing?.attempt_count || 0) + 1;
    const lockSeconds = Math.max(
      getCooldownSecondsForAttempt(nextIpAttempts),
      isWindowActive ? Math.ceil((prevWindowStartMs! + IP_WINDOW_SECONDS * 1000 - nowMs) / 1000) : 120
    );
    const cooldownUntilIso = new Date(nowMs + lockSeconds * 1000).toISOString();
    await upsertRateLimitRow({
      flow,
      scope_type: 'ip',
      scope_key: ip,
      attempt_count: nextIpAttempts,
      last_sent_at: new Date(nowMs).toISOString(),
      cooldown_until: cooldownUntilIso,
      window_start_at: windowStartAt,
      window_request_count: nextWindowCount,
    });
    return {
      allowed: false,
      flow,
      attemptCount: nextIpAttempts,
      cooldownSeconds: lockSeconds,
      remainingSeconds: lockSeconds,
      nextAvailableAt: cooldownUntilIso,
      isInCooldown: true,
      blockedByIp: true,
      code: 'IP_RATE_LIMIT_ACTIVE',
      error: `Too many requests from this network. Please wait ${formatRemainingMMSS(lockSeconds)} before trying again.`,
    };
  }

  await upsertRateLimitRow({
    flow,
    scope_type: 'ip',
    scope_key: ip,
    attempt_count: Number(existing?.attempt_count || 0),
    last_sent_at: new Date(nowMs).toISOString(),
    cooldown_until: null,
    window_start_at: windowStartAt,
    window_request_count: nextWindowCount,
  });

  return {
    allowed: true,
    flow,
    attemptCount: 0,
    cooldownSeconds: 0,
    remainingSeconds: 0,
    nextAvailableAt: null,
    isInCooldown: false,
  };
}

export async function recordIpLookupAttempt(
  flow: AuthResendFlow,
  ip: string,
  nowMs = Date.now()
): Promise<ConsumeLimitResult> {
  return incrementIpWindow(flow, ip, nowMs);
}

/**
 * Atomically verifies IP + account cooldown state and consumes the next progressive attempt.
 * - For 'resend' (or repeated 'initial' when an email was already sent): increments attempt_count (1..5+)
 *   and applies progressive cooldown [120s, 300s, 600s, 900s, 1800s].
 * - Rejects concurrent in-flight duplicate requests and active cooldown requests with 429 metadata.
 */
export async function enforceAndConsumeResendLimit(params: {
  flow: AuthResendFlow;
  email: string;
  ip: string;
  mode: 'initial' | 'resend';
  nowMs?: number;
}): Promise<ConsumeLimitResult> {
  const { flow, email, ip, mode } = params;
  const nowMs = params.nowMs ?? Date.now();
  const cleanEmail = normalizeAuthEmail(email);
  const lockKey = `${flow}:${cleanEmail}`;

  if (inFlightAccountSends.has(lockKey)) {
    const existingStatus = await getResendCooldownStatus(flow, cleanEmail, ip, nowMs);
    const remainingSeconds = Math.max(existingStatus.remainingSeconds, 5);
    return {
      allowed: false,
      flow,
      attemptCount: existingStatus.attemptCount,
      cooldownSeconds: existingStatus.cooldownSeconds || remainingSeconds,
      remainingSeconds,
      nextAvailableAt: new Date(nowMs + remainingSeconds * 1000).toISOString(),
      isInCooldown: true,
      code: 'RESEND_IN_PROGRESS',
      error: 'A request is already being processed. Please wait a moment before trying again.',
    };
  }

  inFlightAccountSends.add(lockKey);
  try {
    const ipPrecheck = await checkIpRateLimit(flow, ip, nowMs);
    if (!ipPrecheck.allowed) {
      return ipPrecheck;
    }

    const accountRow = await getRateLimitRow(flow, 'account', cleanEmail);
    const accCooldownMs = toTimestampMs(accountRow?.cooldown_until);
    if (accCooldownMs && accCooldownMs > nowMs) {
      const remainingSeconds = Math.ceil((accCooldownMs - nowMs) / 1000);
      const attemptCount = Number(accountRow?.attempt_count || 1);
      const cooldownSeconds = getCooldownSecondsForAttempt(attemptCount);
      return {
        allowed: false,
        flow,
        attemptCount,
        cooldownSeconds,
        remainingSeconds,
        nextAvailableAt: new Date(accCooldownMs).toISOString(),
        isInCooldown: true,
        code: 'RESEND_COOLDOWN_ACTIVE',
        error: `Please wait ${formatRemainingMMSS(remainingSeconds)} before requesting another email.`,
      };
    }

    // Consume IP request budget once we know account isn't already in cooldown
    const ipConsume = await incrementIpWindow(flow, ip, nowMs);
    if (!ipConsume.allowed) {
      return ipConsume;
    }

    const hasExistingInitialSend = Boolean(toTimestampMs(accountRow?.last_sent_at));
    const shouldIncrementAttempt = mode === 'resend' || hasExistingInitialSend;
    const nextAttemptCount = shouldIncrementAttempt ? Number(accountRow?.attempt_count || 0) + 1 : 0;
    const cooldownSeconds = getCooldownSecondsForAttempt(nextAttemptCount);
    const cooldownUntilIso =
      cooldownSeconds > 0 ? new Date(nowMs + cooldownSeconds * 1000).toISOString() : null;

    await upsertRateLimitRow({
      flow,
      scope_type: 'account',
      scope_key: cleanEmail,
      attempt_count: nextAttemptCount,
      last_sent_at: new Date(nowMs).toISOString(),
      cooldown_until: cooldownUntilIso,
      window_start_at: accountRow?.window_start_at ? new Date(accountRow.window_start_at).toISOString() : null,
      window_request_count: Number(accountRow?.window_request_count || 0),
    });

    return {
      allowed: true,
      flow,
      attemptCount: nextAttemptCount,
      cooldownSeconds,
      remainingSeconds: cooldownSeconds,
      nextAvailableAt: cooldownUntilIso,
      isInCooldown: cooldownSeconds > 0,
    };
  } finally {
    inFlightAccountSends.delete(lockKey);
  }
}

/**
 * Records an initial verification email send on signup without locking the first manual resend,
 * ensuring any stale rate-limit record for that email starts fresh at attemptCount = 0.
 */
export async function recordInitialAuthSend(
  flow: AuthResendFlow,
  email: string,
  nowMs = Date.now()
): Promise<void> {
  const cleanEmail = normalizeAuthEmail(email);
  if (!cleanEmail) return;
  await upsertRateLimitRow({
    flow,
    scope_type: 'account',
    scope_key: cleanEmail,
    attempt_count: 0,
    last_sent_at: new Date(nowMs).toISOString(),
    cooldown_until: null,
    window_start_at: null,
    window_request_count: 0,
  });
}

/**
 * Resets the progressive resend attempt counter & cooldown for a single flow upon completion
 * (e.g. email verification succeeded or password reset succeeded).
 */
export async function resetResendCooldown(flow: AuthResendFlow, email: string): Promise<void> {
  const cleanEmail = normalizeAuthEmail(email);
  if (!cleanEmail) return;
  await ensureAuthRateLimitSchema();
  await pgClient
    .query(
      `DELETE FROM auth_resend_rate_limits
       WHERE flow = $1 AND scope_type = $2 AND scope_key = $3`,
      [flow, 'account', cleanEmail]
    )
    .catch(() => {});
}
