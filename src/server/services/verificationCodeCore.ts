import crypto from 'node:crypto';
import { pgClient } from '../../db/index.ts';
import {
  checkVerifyCodeIpRateLimit,
  recordVerifyCodeIpFailure,
} from './authResendRateLimitService.ts';

export const SIX_DIGIT_CODE_LENGTH = 6;
export const MAX_VERIFICATION_CODE_ATTEMPTS = 5;

export function generateSixDigitVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(SIX_DIGIT_CODE_LENGTH, '0');
}

export function isValidSixDigitCodeFormat(value: string): boolean {
  return /^\d{6}$/.test(String(value || '').trim());
}

export function timingSafeCodeMatch(expected: string, actual: string): boolean {
  const normExpected = String(expected || '').trim().toLowerCase();
  const normActual = String(actual || '').trim().toLowerCase();
  if (!normExpected || !normActual) return false;
  const bufA = Buffer.from(normExpected, 'utf8');
  const bufB = Buffer.from(normActual, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export type VerificationCodeTable = 'email_verification_tokens' | 'password_reset_codes';
export type VerificationCodeColumn = 'token' | 'code';

export async function issueStoredSixDigitCode(params: {
  tableName: VerificationCodeTable;
  codeColumn: VerificationCodeColumn;
  ensureSchema: () => Promise<void>;
  tenantId: number;
  userId: number;
  expiresInMs: number;
}): Promise<{ code: string; expiresAt: Date }> {
  await params.ensureSchema();

  const tenantId = Number(params.tenantId) >= 0 ? Number(params.tenantId) : 0;
  const userId = Number(params.userId);
  const expiresAt = new Date(Date.now() + params.expiresInMs);

  await pgClient.query(`DELETE FROM ${params.tableName} WHERE user_id = $1`, [userId]).catch(() => {});

  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateSixDigitVerificationCode();
    try {
      await pgClient.query(
        `INSERT INTO ${params.tableName} (tenant_id, user_id, ${params.codeColumn}, attempts, expires_at) VALUES ($1, $2, $3, 0, $4)`,
        [tenantId, userId, code, expiresAt]
      );
      return { code, expiresAt };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '').toLowerCase();
      if (err?.code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Failed to generate unique verification code.');
}

export type VerifyCodeOutcome =
  | {
      valid: true;
      recordId: number;
      userId: number;
      tenantId: number;
      expiresAt: string;
    }
  | {
      valid: false;
      status: number;
      error: string;
      code?: string;
      remainingSeconds?: number;
      blockedByIp?: boolean;
    };

export async function verifyStoredSixDigitCode(params: {
  tableName: VerificationCodeTable;
  codeColumn: VerificationCodeColumn;
  ensureSchema: () => Promise<void>;
  userId: number;
  submittedCode: string;
  clientIp: string;
  expiredErrorMessage: string;
  invalidErrorMessage: string;
  lockoutErrorMessage: string;
}): Promise<VerifyCodeOutcome> {
  await params.ensureSchema();

  const ipVerifyLimit = await checkVerifyCodeIpRateLimit(params.clientIp);
  if (!ipVerifyLimit.allowed) {
    return {
      valid: false,
      status: 429,
      error: ipVerifyLimit.error || 'Too many verification attempts. Please try again later.',
      code: ipVerifyLimit.code,
      remainingSeconds: ipVerifyLimit.remainingSeconds,
      blockedByIp: true,
    };
  }

  const normalizedCode = String(params.submittedCode || '').trim();
  if (!isValidSixDigitCodeFormat(normalizedCode)) {
    return {
      valid: false,
      status: 400,
      error: 'Please enter a valid 6-digit verification code.',
      code: 'INVALID_CODE_FORMAT',
    };
  }

  const existingRes = await pgClient.query<any>(
    `SELECT id, user_id, tenant_id, ${params.codeColumn}, ${params.codeColumn} AS stored_code, COALESCE(attempts, 0) AS attempts, expires_at
     FROM ${params.tableName}
     WHERE user_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [params.userId]
  );

  if (existingRes.rows.length === 0) {
    await recordVerifyCodeIpFailure(params.clientIp).catch(() => {});
    return {
      valid: false,
      status: 400,
      error: params.invalidErrorMessage,
      code: 'INVALID_OR_EXPIRED_CODE',
    };
  }

  const row = existingRes.rows[0];
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pgClient.query(`DELETE FROM ${params.tableName} WHERE id = $1`, [row.id]).catch(() => {});
    return {
      valid: false,
      status: 400,
      error: params.expiredErrorMessage,
      code: 'VERIFICATION_CODE_EXPIRED',
    };
  }

  const storedCodeValue = String(row[params.codeColumn] ?? row.stored_code ?? '');
  if (!timingSafeCodeMatch(storedCodeValue, normalizedCode)) {
    const updateRes = await pgClient
      .query<{ attempts: number }>(
        `UPDATE ${params.tableName} SET attempts = COALESCE(attempts, 0) + 1 WHERE id = $1 RETURNING attempts`,
        [row.id]
      )
      .catch(() => ({ rows: [{ attempts: Number(row.attempts || 0) + 1 }] }));
    const nextAttempts = Number(updateRes.rows?.[0]?.attempts ?? Number(row.attempts || 0) + 1);
    const ipFail = await recordVerifyCodeIpFailure(params.clientIp).catch(() => ({
      allowed: true,
      remainingSeconds: 0,
    }));

    if (nextAttempts >= MAX_VERIFICATION_CODE_ATTEMPTS) {
      await pgClient.query(`DELETE FROM ${params.tableName} WHERE id = $1`, [row.id]).catch(() => {});
      return {
        valid: false,
        status: 429,
        error: params.lockoutErrorMessage,
        code: 'VERIFICATION_ATTEMPTS_EXCEEDED',
      };
    }

    if (!ipFail.allowed) {
      return {
        valid: false,
        status: 429,
        error: (ipFail as any).error || 'Too many failed verification attempts. Please try again later.',
        code: (ipFail as any).code || 'IP_RATE_LIMIT_ACTIVE',
        remainingSeconds: ipFail.remainingSeconds,
        blockedByIp: true,
      };
    }

    return {
      valid: false,
      status: 400,
      error: params.invalidErrorMessage,
      code: 'INVALID_VERIFICATION_CODE',
    };
  }

  return {
    valid: true,
    recordId: Number(row.id),
    userId: Number(row.user_id),
    tenantId: Number(row.tenant_id ?? 0),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function clearStoredVerificationCodesForUser(
  tableName: VerificationCodeTable,
  userId: number
): Promise<void> {
  await pgClient.query(`DELETE FROM ${tableName} WHERE user_id = $1`, [userId]).catch(() => {});
}
