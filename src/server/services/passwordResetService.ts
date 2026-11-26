import bcrypt from 'bcryptjs';
import { pgClient } from '../../db/index.ts';
import { ensurePasswordResetSchema } from '../../db/schemaInit.ts';
import { sendPasswordResetCodeEmail } from '../utils/email.ts';
import {
  checkIpRateLimit,
  checkVerifyCodeIpRateLimit,
  enforceAndConsumeResendLimit,
  recordIpLookupAttempt,
  recordVerifyCodeIpFailure,
  resetResendCooldown,
} from './authResendRateLimitService.ts';
import {
  issueStoredSixDigitCode,
  verifyStoredSixDigitCode,
  clearStoredVerificationCodesForUser,
} from './verificationCodeCore.ts';
import type { PasswordResetRoleScope } from '../../types.ts';

export type { PasswordResetRoleScope };
export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface PasswordResetAccount {
  id: number;
  name: string;
  email: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'CASHIER' | string;
  tenantId: number;
  storeName: string;
}

export function normalizeRoleScope(rawScope?: unknown): PasswordResetRoleScope {
  const clean = String(rawScope || '').trim().toUpperCase();
  if (clean === 'SUPERADMIN') return 'SUPERADMIN';
  if (clean === 'STORE') return 'STORE';
  return 'ALL';
}

/**
 * Resolves the target account across Store Owner (ADMIN), Cashier (CASHIER), and Super Admin (SUPERADMIN).
 * Role-specific logic is isolated strictly to account identification and authorization.
 */
export async function resolvePasswordResetAccount(params: {
  email: string;
  tenantId?: number | null;
  roleScope?: PasswordResetRoleScope;
}): Promise<PasswordResetAccount | null> {
  const cleanEmail = String(params.email || '').trim();
  if (!cleanEmail) return null;

  const roleScope = params.roleScope || 'ALL';
  const parsedTenantId = Number(params.tenantId);
  const hasExplicitTenantId = Number.isInteger(parsedTenantId) && parsedTenantId > 0;

  let userRow: any = null;

  if (roleScope === 'SUPERADMIN') {
    const saRes = await pgClient.query<any>(
      `SELECT id, name, email, role, COALESCE(tenant_id, 0) AS tenant_id
       FROM users
       WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
         AND UPPER(COALESCE(role::text, '')) = 'SUPERADMIN'
       ORDER BY id ASC
       LIMIT 1`,
      [cleanEmail]
    );
    userRow = saRes.rows[0] || null;
  } else if (hasExplicitTenantId) {
    const scopedRes = await pgClient.query<any>(
      `SELECT id, name, email, role, COALESCE(tenant_id, 1) AS tenant_id
       FROM users
       WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
         AND COALESCE(tenant_id, 1) = $2
         AND UPPER(COALESCE(role::text, '')) <> 'SUPERADMIN'
       ORDER BY CASE WHEN UPPER(role::text) = 'ADMIN' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [cleanEmail, parsedTenantId]
    );
    userRow = scopedRes.rows[0] || null;
  } else {
    const roleFilterSql =
      roleScope === 'STORE'
        ? `AND UPPER(COALESCE(role::text, '')) <> 'SUPERADMIN'`
        : '';
    const globalRes = await pgClient.query<any>(
      `SELECT id, name, email, role, COALESCE(tenant_id, 1) AS tenant_id
       FROM users
       WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
         ${roleFilterSql}
       ORDER BY CASE
         WHEN UPPER(role::text) = 'SUPERADMIN' THEN 0
         WHEN UPPER(role::text) = 'ADMIN' THEN 1
         ELSE 2
       END, id ASC
       LIMIT 1`,
      [cleanEmail]
    );
    userRow = globalRes.rows[0] || null;
  }

  if (!userRow) return null;

  const normalizedRole = String(userRow.role || 'ADMIN').toUpperCase();
  const isSuperAdmin = normalizedRole === 'SUPERADMIN';
  const tenantId = isSuperAdmin
    ? 0
    : Number(userRow.tenant_id) > 0
    ? Number(userRow.tenant_id)
    : 1;

  let storeName = isSuperAdmin ? 'POS SaaS C-Panel | SarbaazSoft' : 'SarbaazSoft Shoe POS';
  if (!isSuperAdmin && tenantId > 0) {
    const tenantRes = await pgClient
      .query<{ name: string }>('SELECT name FROM tenants WHERE id = $1 LIMIT 1', [tenantId])
      .catch(() => ({ rows: [] as Array<{ name: string }> }));
    if (tenantRes.rows[0]?.name) {
      storeName = tenantRes.rows[0].name;
    }
  }

  return {
    id: Number(userRow.id),
    name: String(userRow.name || ''),
    email: String(userRow.email || cleanEmail),
    role: normalizedRole,
    tenantId,
    storeName,
  };
}

export async function issuePasswordResetCode(params: {
  tenantId: number;
  userId: number;
  expiresInMs?: number;
}): Promise<{ code: string; expiresAt: Date }> {
  return issueStoredSixDigitCode({
    tableName: 'password_reset_codes',
    codeColumn: 'code',
    ensureSchema: ensurePasswordResetSchema,
    tenantId: params.tenantId,
    userId: params.userId,
    expiresInMs: params.expiresInMs ?? PASSWORD_RESET_TTL_MS,
  });
}

export interface PasswordResetServiceResponse {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, any>;
}

export async function requestPasswordResetCode(params: {
  email: string;
  tenantId?: number | null;
  roleScope?: PasswordResetRoleScope;
  isResend?: boolean;
  clientIp: string;
}): Promise<PasswordResetServiceResponse> {
  const cleanEmail = String(params.email || '').trim();
  if (!cleanEmail) {
    return { status: 400, body: { error: 'Email is required.' } };
  }

  const roleScope = params.roleScope || 'ALL';
  const ipPrecheck = await checkIpRateLimit('password_reset', params.clientIp);
  if (!ipPrecheck.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(ipPrecheck.remainingSeconds) },
      body: {
        error: ipPrecheck.error,
        code: ipPrecheck.code,
        flow: ipPrecheck.flow,
        attemptCount: ipPrecheck.attemptCount,
        cooldownSeconds: ipPrecheck.cooldownSeconds,
        remainingSeconds: ipPrecheck.remainingSeconds,
        nextAvailableAt: ipPrecheck.nextAvailableAt,
        blockedByIp: true,
      },
    };
  }

  const account = await resolvePasswordResetAccount({
    email: cleanEmail,
    tenantId: params.tenantId,
    roleScope,
  });

  if (!account) {
    const ipHit = await recordIpLookupAttempt('password_reset', params.clientIp);
    if (!ipHit.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(ipHit.remainingSeconds) },
        body: {
          error: ipHit.error,
          code: ipHit.code,
          flow: ipHit.flow,
          attemptCount: ipHit.attemptCount,
          cooldownSeconds: ipHit.cooldownSeconds,
          remainingSeconds: ipHit.remainingSeconds,
          nextAvailableAt: ipHit.nextAvailableAt,
          blockedByIp: true,
        },
      };
    }

    return {
      status: 404,
      body: {
        error:
          roleScope === 'SUPERADMIN'
            ? 'No SuperAdmin account found with that email address.'
            : 'No account found with that email address. Please check your email and try again.',
      },
    };
  }

  const limitResult = await enforceAndConsumeResendLimit({
    flow: 'password_reset',
    email: account.email,
    ip: params.clientIp,
    mode: params.isResend ? 'resend' : 'initial',
  });

  if (!limitResult.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(limitResult.remainingSeconds) },
      body: {
        error: limitResult.error,
        code: limitResult.code,
        flow: limitResult.flow,
        attemptCount: limitResult.attemptCount,
        cooldownSeconds: limitResult.cooldownSeconds,
        remainingSeconds: limitResult.remainingSeconds,
        nextAvailableAt: limitResult.nextAvailableAt,
        ...(limitResult.blockedByIp ? { blockedByIp: true } : {}),
      },
    };
  }

  const cooldownPayload = {
    flow: limitResult.flow,
    attemptCount: limitResult.attemptCount,
    cooldownSeconds: limitResult.cooldownSeconds,
    remainingSeconds: limitResult.remainingSeconds,
    nextAvailableAt: limitResult.nextAvailableAt,
    isInCooldown: limitResult.isInCooldown,
  };

  const { code, expiresAt } = await issuePasswordResetCode({
    tenantId: account.tenantId,
    userId: account.id,
  });

  let mailResult: any;
  try {
    mailResult = await sendPasswordResetCodeEmail({
      to: account.email,
      userName: account.name,
      storeName: account.storeName,
      code,
      expiresAt,
      role: account.role,
    });
    if (!mailResult.delivered) {
      console.warn(
        `[passwordResetService] Password reset code email delivery notice for ${account.email}: ${mailResult.error}`
      );
    }
  } catch (mailErr: any) {
    console.warn(
      `[passwordResetService] Exception sending password reset code email to ${account.email}:`,
      mailErr?.message || mailErr
    );
    mailResult = {
      delivered: false,
      provider: 'resend',
      error: mailErr?.message || String(mailErr),
    };
  }

  if (mailResult.delivered && !mailResult.sandbox) {
    return {
      status: 200,
      body: {
        success: true,
        emailSent: true,
        emailProvider: mailResult.provider,
        email: account.email,
        expiresAt: expiresAt.toISOString(),
        cooldown: cooldownPayload,
        message: `A 6-digit verification code has been sent to ${account.email}.`,
      },
    };
  }

  if (mailResult.sandbox) {
    return {
      status: 200,
      body: {
        success: true,
        emailSent: true,
        sandbox: true,
        emailProvider: mailResult.provider,
        email: account.email,
        expiresAt: expiresAt.toISOString(),
        cooldown: cooldownPayload,
        message: `Your 6-digit password reset code was dispatched via Resend Sandbox (forwarded to ${mailResult.sandboxRecipient || 'developer email'}). Please enter the 6-digit code below.`,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      emailSent: false,
      emailProvider: mailResult.provider,
      email: account.email,
      expiresAt: expiresAt.toISOString(),
      cooldown: cooldownPayload,
      warning: mailResult.error || 'Email could not be delivered to inbox.',
      message: `Unable to deliver the password reset code right now (${mailResult.error || 'delivery failed'}). Please check your mail server configuration and try again once the resend timer completes.`,
    },
  };
}

async function resolveAndVerifyResetCode(params: {
  email: string;
  code: string;
  tenantId?: number | null;
  roleScope?: PasswordResetRoleScope;
  clientIp: string;
}): Promise<
  | {
      ok: true;
      account: PasswordResetAccount;
      expiresAt: string;
    }
  | {
      ok: false;
      response: PasswordResetServiceResponse;
    }
> {
  const cleanEmail = String(params.email || '').trim();
  const cleanCode = String(params.code || '').trim();
  if (!cleanEmail || !cleanCode) {
    return {
      ok: false,
      response: {
        status: 400,
        body: { valid: false, error: 'Email and 6-digit verification code are required.' },
      },
    };
  }

  const ipVerifyLimit = await checkVerifyCodeIpRateLimit(params.clientIp);
  if (!ipVerifyLimit.allowed) {
    return {
      ok: false,
      response: {
        status: 429,
        headers: { 'Retry-After': String(ipVerifyLimit.remainingSeconds) },
        body: {
          valid: false,
          error: ipVerifyLimit.error,
          code: ipVerifyLimit.code,
          remainingSeconds: ipVerifyLimit.remainingSeconds,
          blockedByIp: true,
        },
      },
    };
  }

  const account = await resolvePasswordResetAccount({
    email: cleanEmail,
    tenantId: params.tenantId,
    roleScope: params.roleScope || 'ALL',
  });

  if (!account) {
    await recordVerifyCodeIpFailure(params.clientIp).catch(() => {});
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          valid: false,
          error: 'Invalid or expired verification code.',
          code: 'INVALID_OR_EXPIRED_CODE',
        },
      },
    };
  }

  const outcome = await verifyStoredSixDigitCode({
    tableName: 'password_reset_codes',
    codeColumn: 'code',
    ensureSchema: ensurePasswordResetSchema,
    userId: account.id,
    submittedCode: cleanCode,
    clientIp: params.clientIp,
    expiredErrorMessage:
      'This password reset code has expired. Please request a new 6-digit verification code.',
    invalidErrorMessage:
      'Invalid 6-digit verification code. Please check your email and try again.',
    lockoutErrorMessage:
      'Too many incorrect verification attempts. For security, this code has been invalidated—please request a new 6-digit reset code.',
  });

  if (!outcome.valid) {
    return {
      ok: false,
      response: {
        status: outcome.status,
        headers:
          outcome.remainingSeconds && outcome.remainingSeconds > 0
            ? { 'Retry-After': String(outcome.remainingSeconds) }
            : undefined,
        body: {
          valid: false,
          error: outcome.error,
          ...(outcome.code ? { code: outcome.code } : {}),
          ...(typeof outcome.remainingSeconds === 'number'
            ? { remainingSeconds: outcome.remainingSeconds }
            : {}),
          ...(outcome.blockedByIp ? { blockedByIp: true } : {}),
        },
      },
    };
  }

  return {
    ok: true,
    account,
    expiresAt: outcome.expiresAt,
  };
}

export async function verifyPasswordResetCode(params: {
  email: string;
  code: string;
  tenantId?: number | null;
  roleScope?: PasswordResetRoleScope;
  clientIp: string;
}): Promise<PasswordResetServiceResponse> {
  const verified = await resolveAndVerifyResetCode(params);
  if (!verified.ok) return verified.response;

  return {
    status: 200,
    body: {
      valid: true,
      verified: true,
      email: verified.account.email,
      expiresAt: verified.expiresAt,
      message: 'Verification code confirmed. Enter your new password below.',
    },
  };
}

export async function confirmPasswordReset(params: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword?: string;
  tenantId?: number | null;
  roleScope?: PasswordResetRoleScope;
  clientIp: string;
}): Promise<PasswordResetServiceResponse> {
  const newPassword = String(params.newPassword || '');
  if (!newPassword || newPassword.length < 6) {
    return {
      status: 400,
      body: { error: 'Password must be at least 6 characters long.' },
    };
  }
  if (params.confirmPassword !== undefined && String(params.confirmPassword) !== newPassword) {
    return {
      status: 400,
      body: { error: 'Passwords do not match. Please enter the same password twice.' },
    };
  }

  const verified = await resolveAndVerifyResetCode({
    email: params.email,
    code: params.code,
    tenantId: params.tenantId,
    roleScope: params.roleScope,
    clientIp: params.clientIp,
  });

  if (!verified.ok) return verified.response;

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pgClient.query(
    'UPDATE users SET password_hash = $1, quick_password = $2, updated_at = NOW() WHERE id = $3',
    [passwordHash, newPassword, verified.account.id]
  );

  await clearStoredVerificationCodesForUser('password_reset_codes', verified.account.id);
  await resetResendCooldown('password_reset', verified.account.email);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Password has been reset successfully. You may now sign in with your new password.',
    },
  };
}
