import crypto from 'node:crypto';
import { pgClient } from '../../db/index.ts';
import { ensureEmailVerificationSchema } from '../../db/schemaInit.ts';

export const EMAIL_VERIFICATION_CODE_LENGTH = 6;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_VERIFICATION_CODE_ATTEMPTS = 5;

/**
 * Generates a cryptographically random 6-digit numeric confirmation code (000000-999999).
 */
export function generateSixDigitVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(EMAIL_VERIFICATION_CODE_LENGTH, '0');
}

/**
 * Constant-time comparison for user-supplied confirmation codes/tokens.
 */
export function timingSafeCodeMatch(expected: string, actual: string): boolean {
  const normExpected = String(expected || '').trim().toLowerCase();
  const normActual = String(actual || '').trim().toLowerCase();
  if (!normExpected || !normActual) return false;
  const bufA = Buffer.from(normExpected, 'utf8');
  const bufB = Buffer.from(normActual, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issues a fresh 6-digit confirmation code for the user, invalidating all prior codes
 * and retrying safely if a rare unique constraint collision occurs.
 */
export async function issueEmailVerificationCode(params: {
  tenantId: number;
  userId: number;
  expiresInMs?: number;
}): Promise<{ code: string; expiresAt: Date }> {
  await ensureEmailVerificationSchema();

  const tenantId = Number(params.tenantId) >= 0 ? Number(params.tenantId) : 1;
  const userId = Number(params.userId);
  const expiresAt = new Date(Date.now() + (params.expiresInMs ?? EMAIL_VERIFICATION_TTL_MS));

  await pgClient.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]).catch(() => {});

  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateSixDigitVerificationCode();
    try {
      await pgClient.query(
        'INSERT INTO email_verification_tokens (tenant_id, user_id, token, attempts, expires_at) VALUES ($1, $2, $3, 0, $4)',
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
