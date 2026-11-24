import { ensureEmailVerificationSchema } from '../../db/schemaInit.ts';
import {
  SIX_DIGIT_CODE_LENGTH,
  MAX_VERIFICATION_CODE_ATTEMPTS,
  generateSixDigitVerificationCode,
  timingSafeCodeMatch,
  issueStoredSixDigitCode,
} from './verificationCodeCore.ts';

export const EMAIL_VERIFICATION_CODE_LENGTH = SIX_DIGIT_CODE_LENGTH;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export { MAX_VERIFICATION_CODE_ATTEMPTS, generateSixDigitVerificationCode, timingSafeCodeMatch };

/**
 * Issues a fresh 6-digit confirmation code for email verification, invalidating all prior codes.
 */
export async function issueEmailVerificationCode(params: {
  tenantId: number;
  userId: number;
  expiresInMs?: number;
}): Promise<{ code: string; expiresAt: Date }> {
  return issueStoredSixDigitCode({
    tableName: 'email_verification_tokens',
    codeColumn: 'token',
    ensureSchema: ensureEmailVerificationSchema,
    tenantId: params.tenantId,
    userId: params.userId,
    expiresInMs: params.expiresInMs ?? EMAIL_VERIFICATION_TTL_MS,
  });
}
