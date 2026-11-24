import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pgClient } from '../../db/index.ts';
import { ensureSaasControlPlane, ensureEmailVerificationSchema } from '../../db/schemaInit.ts';
import { generateToken, requireAuth, extractTokenFromRequest, revokeToken, clearAuthCookies } from '../auth.ts';
import type { AuthenticatedRequest, AuthUser } from '../auth.ts';
import { recordTenantMiddlewarePresence, removeTenantMiddlewarePresence } from '../middleware/tenantMiddleware.ts';
import { sendTrialActivationEmail } from '../utils/email.ts';
import { isOwnerRole, markOwnerSessionOffline, isSuperAdminRole, markSuperAdminSessionOffline } from '../services/ownerPresenceService.ts';
import { disconnectOwnerSseClients, disconnectSuperAdminSseClients } from '../pushNotificationService.ts';
import {
  checkIpRateLimit,
  checkVerifyCodeIpRateLimit,
  enforceAndConsumeResendLimit,
  extractClientIp,
  getResendCooldownStatus,
  normalizeAuthEmail,
  normalizeAuthFlow,
  recordIpLookupAttempt,
  recordVerifyCodeIpFailure,
  resetResendCooldown,
} from '../services/authResendRateLimitService.ts';
import {
  issueEmailVerificationCode,
  MAX_VERIFICATION_CODE_ATTEMPTS,
  timingSafeCodeMatch,
} from '../services/emailVerificationService.ts';
import {
  confirmPasswordReset,
  normalizeRoleScope,
  requestPasswordResetCode,
  verifyPasswordResetCode,
} from '../services/passwordResetService.ts';

const router = Router();

/** Shared login handler; tenantId selects a store when credentials are store-specific. */
async function handleStoreOrPlatformLogin(req: Request, res: Response) {
  try {
    await ensureSaasControlPlane();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const body = req.body || {};
    const query = req.query || {};
    const email = String(body.email || query.email || '').trim();
    const password = String(body.password || query.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const rawTid =
      req.query?.tenantId ??
      req.query?.tenant_id ??
      req.body?.tenantId ??
      req.body?.tenant_id ??
      req.headers['x-tenant-id'] ??
      (req as any).tenantResolution?.tenant?.id;
    const explicitTenantId = Number(rawTid);
    const hasExplicitTenantId = Number.isInteger(explicitTenantId) && explicitTenantId > 0;

    let matchedUser: any = null;
    let resolvedTenantRow: any = null;

    // Authenticate against the explicitly selected tenant when tenantId is supplied.
    if (hasExplicitTenantId) {
      const tenantRes = await pgClient.query<any>(
              'SELECT id, name, status, onboarding_completed, subscription_plan, subscription_start_date, subscription_end_date, subscription_status FROM tenants WHERE id = $1 LIMIT 1',
              [explicitTenantId]
            );
      if (tenantRes.rows.length === 0) {
        return res.status(404).json({
          error: `The target store does not exist or has been removed.`,
          code: 'TENANT_NOT_FOUND',
        });
      }

      const tenant = tenantRes.rows[0];
      resolvedTenantRow = tenant;

      const verifiedTenantId = Number(tenant.id);

      const isExpiredByDate =
        tenant.subscription_end_date && new Date(tenant.subscription_end_date).getTime() < Date.now();
      const isMarkedExpired =
        String(tenant.subscription_status || '').toUpperCase() === 'EXPIRED' ||
        String(tenant.status || '').toUpperCase() === 'EXPIRED';

      if (isExpiredByDate || isMarkedExpired) {
        if (String(tenant.subscription_status || '').toUpperCase() !== 'EXPIRED') {
          await pgClient
            .query(
              `UPDATE tenants SET subscription_status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
              [verifiedTenantId]
            )
            .catch(() => {});
        }
      }

      const isStoreSuspended =
        String(tenant.status).toUpperCase() === 'SUSPENDED' ||
        String(tenant.subscription_status || '').toUpperCase() === 'SUSPENDED';

      // Strictly query users belonging ONLY to this specific store (WHERE tenant_id = $2 AND LOWER(email) = LOWER($1))
      // Even if Store 1 and Store 2 share identical email & password, only Store 2's rows (with tenant_id = verifiedTenantId) are inspected.
      const storeUsersRes = await pgClient.query(
        `SELECT id, tenant_id, name, email, phone, avatar_url, password_hash, role, status, theme_color
         FROM users
         WHERE COALESCE(tenant_id, 1) = $2 AND LOWER(email) = LOWER($1)
         ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, id ASC`,
        [email.trim(), verifiedTenantId]
      );

      for (const candidate of storeUsersRes.rows) {
        if (Number(candidate.tenant_id) !== verifiedTenantId) continue;
        const isMatch = await bcrypt.compare(password, candidate.password_hash);
        if (isMatch) {
          matchedUser = candidate;
          break;
        }
      }

      // Only if no store user matched in this tenant, check if global SUPERADMIN is logging in
      if (!matchedUser) {
        const saRes = await pgClient.query(
          `SELECT id, tenant_id, name, email, phone, avatar_url, password_hash, role, status, theme_color
           FROM users
           WHERE role = 'SUPERADMIN' AND LOWER(email) = LOWER($1)
           ORDER BY id ASC
           LIMIT 1`,
          [email.trim()]
        );
        if (saRes.rows.length > 0) {
          const saCandidate = saRes.rows[0];
          if (await bcrypt.compare(password, saCandidate.password_hash)) {
            matchedUser = saCandidate;
          }
        }
      }

      if (!matchedUser) {
        return res.status(401).json({
          error: `Invalid email or password for store "${tenant.name}".`,
        });
      }

      if (isStoreSuspended && String(matchedUser.role || '').toUpperCase() !== 'SUPERADMIN') {
        return res.status(423).json({
          error: `Store Suspended: "${tenant.name}" is currently suspended by platform administration.`,
          code: 'TENANT_SUSPENDED',
        });
      }
    } else {
      // Shared platform login resolves the account by its credentials.
      const candidatesRes = await pgClient.query(
        `SELECT id, tenant_id, name, email, phone, avatar_url, password_hash, role, status, theme_color
         FROM users
         WHERE LOWER(email) = LOWER($1)
         ORDER BY CASE WHEN role = 'SUPERADMIN' THEN 0 ELSE 1 END, id ASC`,
        [email.trim()]
      );

      const credentialMatches: any[] = [];
      for (const candidate of candidatesRes.rows) {
        if (await bcrypt.compare(password, candidate.password_hash)) credentialMatches.push(candidate);
      }

      // Email addresses are allowed to repeat across tenants. If the same
      // credentials match multiple stores, require an explicit store choice.
      const matchedSuperAdmin = credentialMatches.find(
        (candidate) => String(candidate.role).toUpperCase() === 'SUPERADMIN'
      );
      const matchingTenantIds = Array.from(
        new Set(
          credentialMatches
            .filter((candidate) => String(candidate.role).toUpperCase() !== 'SUPERADMIN')
            .map((candidate) => Number(candidate.tenant_id))
            .filter((tenantId) => Number.isInteger(tenantId) && tenantId > 0)
        )
      );

      if (matchedSuperAdmin) {
        matchedUser = matchedSuperAdmin;
      } else if (matchingTenantIds.length > 1) {
        const storesRes = await pgClient.query<any>(
          `SELECT id, name
           FROM tenants
           WHERE id = ANY($1::int[])
           ORDER BY name ASC, id ASC`,
          [matchingTenantIds]
        );
        return res.status(409).json({
          code: 'MULTIPLE_STORE_ACCOUNTS',
          error: 'These credentials match accounts in more than one store. Select a store to continue.',
          stores: storesRes.rows.map((store) => ({
            tenantId: Number(store.id),
            name: store.name,
          })),
        });
      } else {
        matchedUser = credentialMatches[0] || null;
      }

      if (!matchedUser) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
    }

    const user: any = matchedUser;

    if (user.status === 'PENDING') {
      return res.status(423).json({
        error: 'Your email address is unverified. Please check your inbox and confirm your email to log in.',
        code: 'EMAIL_VERIFICATION_REQUIRED',
        status: 'PENDING',
        requiresVerification: true,
        email: user.email,
        tenantId: user.tenant_id,
        redirectUrl: `/verify-email?email=${encodeURIComponent(user.email)}&tenantId=${user.tenant_id}`,
      });
    }

    const parsedTid = Number(user.tenant_id);
    const isSuperAdminRole = String(user.role).toUpperCase() === 'SUPERADMIN';
    const isStoreAdminRole = String(user.role).toUpperCase() === 'ADMIN';
    const tenantId =
      isSuperAdminRole
        ? 0
        : resolvedTenantRow?.id
        ? Number(resolvedTenantRow.id)
        : Number.isInteger(parsedTid) && parsedTid > 0
        ? parsedTid
        : 1;

    // Extra safeguard: for non-SuperAdmin store login, user.tenant_id MUST equal resolvedTenantRow.id
    if (!isSuperAdminRole && resolvedTenantRow && Number(user.tenant_id) !== Number(resolvedTenantRow.id)) {
      return res.status(403).json({
        error: 'Store authentication mismatch: Credentials do not belong to the selected store.',
        code: 'CROSS_STORE_LOGIN_DENIED',
      });
    }

    let tenantName = isSuperAdminRole ? 'POS SaaS C-Panel' : resolvedTenantRow?.name || 'Retail Store';
    let onboardingCompleted = resolvedTenantRow ? Boolean(resolvedTenantRow.onboarding_completed) : true;
    let subscriptionStatus = resolvedTenantRow
      ? String(resolvedTenantRow.subscription_status || 'ACTIVE').toUpperCase()
      : 'ACTIVE';

    if (!isSuperAdminRole) {
      const t =
        resolvedTenantRow ||
        (
          await pgClient.query<any>(
            'SELECT id, name, status, onboarding_completed, subscription_end_date, subscription_status FROM tenants WHERE id = $1 LIMIT 1',
            [tenantId]
          )
        ).rows[0];

      if (t) {
        tenantName = t.name;
        onboardingCompleted = Boolean(t.onboarding_completed);
        subscriptionStatus = String(t.subscription_status || 'ACTIVE').toUpperCase();

        const isExpiredByDate =
          t.subscription_end_date && new Date(t.subscription_end_date).getTime() < Date.now();
        const isMarkedExpired =
          subscriptionStatus === 'EXPIRED' || String(t.status || '').toUpperCase() === 'EXPIRED';

        if (isExpiredByDate || isMarkedExpired) {
          subscriptionStatus = 'EXPIRED';
          if (String(t.subscription_status || '').toUpperCase() !== 'EXPIRED') {
            await pgClient
              .query(
                `UPDATE tenants SET subscription_status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
                [t.id]
              )
              .catch(() => {});
          }
          // Cashiers are blocked when expired; Store Owners (ADMIN) can log in to SettingsView to renew subscription
          if (!isStoreAdminRole) {
            return res.status(403).json({
              error: 'Your subscription key has expired. Please contact support to renew.',
              code: 'SUBSCRIPTION_EXPIRED',
            });
          }
        }

        if (
          String(t.status).toUpperCase() === 'SUSPENDED' ||
          String(t.subscription_status || '').toUpperCase() === 'SUSPENDED'
        ) {
          removeTenantMiddlewarePresence(t.id);
          return res.status(423).json({
            error: `Store Suspended: "${t.name}" is currently suspended by platform administration.`,
            code: 'TENANT_SUSPENDED',
          });
        }

        if (subscriptionStatus === 'ACTIVE') {
          recordTenantMiddlewarePresence(t.id, '/api/auth/login');
        }
      }
    }

    const authUser = {
      id: user.id,
      tenantId,
      tenantName,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      avatarUrl: user.avatar_url || '',
      role: user.role,
      originalRole: user.role,
      status: user.status,
      themeColor: user.theme_color || '',
      onboardingCompleted,
      subscriptionStatus,
    };

    const token = generateToken(authUser);
    return res.json({ token, user: authUser });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
}

// All accounts use the same login route (supporting both POST and GET).
router.all('/login', handleStoreOrPlatformLogin);

// Logout: terminates the session server-side and clears auth cookies.
// Intentionally idempotent and public: it must succeed even if the token already expired, so the
// client can always finish logging out. It never touches the remembered email (client-side only).
router.all('/logout', (req: Request, res: Response) => {
  const token = extractTokenFromRequest(req);
  if (token) {
    const decoded = jwt.decode(token) as {
      id?: number;
      userId?: number;
      tenantId?: number;
      role?: string;
      exp?: number;
    } | null;
    revokeToken(token, decoded?.exp ? decoded.exp * 1000 : undefined);

    const tenantId = Number(decoded?.tenantId || 0);
    const userId = Number(decoded?.id || decoded?.userId || 0);
    const role = String(decoded?.role || '').toUpperCase();
    const rawSession =
      req.headers['x-session-id'] ||
      req.body?.sessionId ||
      req.query?.sessionId;
    const sessionId = rawSession ? String(rawSession).trim() : undefined;

    if (userId > 0 && isSuperAdminRole(role)) {
      markSuperAdminSessionOffline({ userId, sessionId });
      disconnectSuperAdminSseClients(userId, sessionId);
    } else if (tenantId > 0 && userId > 0 && isOwnerRole(role)) {
      markOwnerSessionOffline({ tenantId, userId, sessionId });
      disconnectOwnerSseClients(tenantId, userId, sessionId);
    }
  }
  clearAuthCookies(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

// GET & POST /api/auth/verify-email - Verify 6-digit confirmation code (or activation link) and activate user account
router.all('/verify-email', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    await ensureEmailVerificationSchema();

    const clientIp = extractClientIp(req);
    const ipVerifyLimit = await checkVerifyCodeIpRateLimit(clientIp);
    if (!ipVerifyLimit.allowed) {
      res.setHeader('Retry-After', String(ipVerifyLimit.remainingSeconds));
      return res.status(429).json({
        error: ipVerifyLimit.error,
        code: ipVerifyLimit.code,
        remainingSeconds: ipVerifyLimit.remainingSeconds,
        blockedByIp: true,
      });
    }

    const token = String(
      req.body?.code ||
      req.body?.token ||
      req.query.code ||
      req.query.token ||
      req.query.verificationToken ||
      ''
    ).trim();
    const submittedEmail = String(req.body?.email || req.query?.email || '').trim().toLowerCase();

    if (!token) {
      return res.status(400).json({ error: 'Verification code is required.' });
    }

    let row: any = null;

    if (submittedEmail) {
      const scopedRes = await pgClient.query(
        `SELECT evt.id, evt.user_id, evt.tenant_id, evt.token, COALESCE(evt.attempts, 0) as attempts, evt.expires_at,
                u.id as user_id, u.tenant_id, u.name, u.email, u.phone, u.avatar_url, u.role, u.status, u.theme_color,
                t.name as store_name, t.onboarding_completed, t.subscription_status
         FROM email_verification_tokens evt
         JOIN users u ON u.id = evt.user_id
         LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM($1))
         ORDER BY evt.id DESC
         LIMIT 1`,
        [submittedEmail]
      );

      if (scopedRes.rows.length === 0) {
        await recordVerifyCodeIpFailure(clientIp).catch(() => {});
        return res.status(400).json({ error: 'Invalid or expired verification code.' });
      }

      row = scopedRes.rows[0];
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await pgClient.query('DELETE FROM email_verification_tokens WHERE id = $1', [row.id]).catch(() => {});
        return res.status(400).json({ error: 'This verification code has expired. Please request a new confirmation email.' });
      }

      if (!timingSafeCodeMatch(String(row.token || ''), token)) {
        const updateRes = await pgClient
          .query<{ attempts: number }>(
            'UPDATE email_verification_tokens SET attempts = COALESCE(attempts, 0) + 1 WHERE id = $1 RETURNING attempts',
            [row.id]
          )
          .catch(() => ({ rows: [{ attempts: Number(row.attempts || 0) + 1 }] }));
        const nextAttempts = Number(updateRes.rows?.[0]?.attempts ?? Number(row.attempts || 0) + 1);
        const ipFail = await recordVerifyCodeIpFailure(clientIp).catch(() => ({ allowed: true, remainingSeconds: 0 }));

        if (nextAttempts >= MAX_VERIFICATION_CODE_ATTEMPTS) {
          await pgClient.query('DELETE FROM email_verification_tokens WHERE id = $1', [row.id]).catch(() => {});
          return res.status(429).json({
            error: 'Too many incorrect verification attempts. For security, this code has been invalidated—please request a new confirmation email.',
            code: 'VERIFICATION_ATTEMPTS_EXCEEDED',
          });
        }

        if (!ipFail.allowed) {
          res.setHeader('Retry-After', String(ipFail.remainingSeconds));
          return res.status(429).json({
            error: (ipFail as any).error || 'Too many failed verification attempts. Please try again later.',
            code: (ipFail as any).code || 'IP_RATE_LIMIT_ACTIVE',
            remainingSeconds: ipFail.remainingSeconds,
            blockedByIp: true,
          });
        }

        return res.status(400).json({
          error: 'Invalid verification code. Please check the 6-digit code in your email and try again.',
        });
      }
    } else {
      const tokenRes = await pgClient.query(
        `SELECT evt.id, evt.user_id, evt.tenant_id, evt.expires_at,
                u.id as user_id, u.tenant_id, u.name, u.email, u.phone, u.avatar_url, u.role, u.status, u.theme_color,
                t.name as store_name, t.onboarding_completed, t.subscription_status
         FROM email_verification_tokens evt
         JOIN users u ON u.id = evt.user_id
         LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE LOWER(BTRIM(evt.token)) = LOWER(BTRIM($1))
         LIMIT 1`,
        [token]
      );

      if (tokenRes.rows.length === 0) {
        await recordVerifyCodeIpFailure(clientIp).catch(() => {});
        return res.status(400).json({ error: 'Invalid or expired verification code.' });
      }

      row = tokenRes.rows[0];
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await pgClient.query('DELETE FROM email_verification_tokens WHERE id = $1', [row.id]).catch(() => {});
        return res.status(400).json({ error: 'This verification code has expired. Please request a new confirmation email.' });
      }
    }

    await pgClient.query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', ['APPROVED', row.user_id]);
    await pgClient.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [row.user_id]).catch(() => {});
    const verifiedTrialsRes = await pgClient
      .query<any>(
        "UPDATE trial_activations SET status = 'ACTIVE', reactivated_at = COALESCE(reactivated_at, NOW()), updated_at = NOW() WHERE user_id = $1 AND status = 'PENDING' RETURNING *",
        [row.user_id]
      )
      .catch(() => ({ rows: [] as any[] }));
    for (const vt of verifiedTrialsRes.rows || []) {
      await pgClient
        .query(
          `INSERT INTO trial_tracking_history (
            trial_id, tenant_id, user_id, event_type, previous_status, new_status,
            previous_end_date, new_end_date, actor_user_id, actor_email, actor_role,
            owner_email, owner_name, store_name, notes
          ) VALUES ($1, $2, $3, 'EMAIL_VERIFIED', 'PENDING', 'ACTIVE', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            vt.id,
            vt.tenant_id || row.tenant_id || null,
            row.user_id,
            vt.trial_end_date || null,
            vt.trial_end_date || null,
            row.user_id,
            row.email || '',
            String(row.role || 'ADMIN').toUpperCase(),
            vt.email || row.email || '',
            vt.user_name || row.name || '',
            vt.store_name || row.store_name || '',
            'Store owner verified email address and activated the free trial.',
          ]
        )
        .catch(() => {});
    }
    await resetResendCooldown('email_verification', row.email);

    const normalizedRole = String(row.role || 'ADMIN').toUpperCase();
    const authUser = {
      id: row.user_id,
      tenantId: row.tenant_id,
      tenantName: row.store_name,
      name: row.name,
      email: row.email,
      phone: row.phone || '',
      avatarUrl: row.avatar_url || '',
      role: normalizedRole,
      originalRole: normalizedRole,
      status: 'APPROVED',
      themeColor: row.theme_color || '',
      onboardingCompleted: Boolean(row.onboarding_completed),
      subscriptionStatus: row.subscription_status || 'ACTIVE',
    };
    const sessionToken = generateToken(authUser as any);

    return res.json({
      success: true,
      verified: true,
      active: true,
      token: sessionToken,
      user: authUser,
      tenantId: row.tenant_id,
      storeName: row.store_name,
      loginUrl: row.onboarding_completed ? `/?tenantId=${row.tenant_id}` : `/onboarding?tenantId=${row.tenant_id}`,
      message: 'Email verified successfully! Your account is now active and ready for setup.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Email verification failed: ' + err.message });
  }
});

// GET /api/auth/resend-status - Hydrates persisted resend cooldown timer without exposing tokens or account details
router.get('/resend-status', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const flow = normalizeAuthFlow(req.query?.flow);
    if (!flow) {
      return res.status(400).json({ error: 'Valid flow parameter (email_verification or password_reset) is required.' });
    }
    const email = normalizeAuthEmail(String(req.query?.email || ''));
    const clientIp = extractClientIp(req);
    const snapshot = await getResendCooldownStatus(flow, email, clientIp);
    return res.json({
      flow: snapshot.flow,
      attemptCount: snapshot.attemptCount,
      cooldownSeconds: snapshot.cooldownSeconds,
      remainingSeconds: snapshot.remainingSeconds,
      nextAvailableAt: snapshot.nextAvailableAt,
      isInCooldown: snapshot.isInCooldown,
      ...(snapshot.blockedByIp ? { blockedByIp: true } : {}),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to inspect resend cooldown status: ' + err.message });
  }
});

// POST & GET /api/auth/resend-verification - Resends activation email for pending user
router.all('/resend-verification', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    await ensureEmailVerificationSchema();
    const rawEmail = String(req.body?.email || req.query?.email || '').trim().toLowerCase();
    if (!rawEmail) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const clientIp = extractClientIp(req);
    const ipPrecheck = await checkIpRateLimit('email_verification', clientIp);
    if (!ipPrecheck.allowed) {
      res.setHeader('Retry-After', String(ipPrecheck.remainingSeconds));
      return res.status(429).json({
        error: ipPrecheck.error,
        code: ipPrecheck.code,
        flow: ipPrecheck.flow,
        attemptCount: ipPrecheck.attemptCount,
        cooldownSeconds: ipPrecheck.cooldownSeconds,
        remainingSeconds: ipPrecheck.remainingSeconds,
        nextAvailableAt: ipPrecheck.nextAvailableAt,
        blockedByIp: true,
      });
    }

    const userRes = await pgClient.query(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.status, t.name as store_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM($1))
       ORDER BY u.id DESC
       LIMIT 1`,
      [rawEmail]
    );

    if (userRes.rows.length === 0) {
      const ipHit = await recordIpLookupAttempt('email_verification', clientIp);
      if (!ipHit.allowed) {
        res.setHeader('Retry-After', String(ipHit.remainingSeconds));
        return res.status(429).json({
          error: ipHit.error,
          code: ipHit.code,
          flow: ipHit.flow,
          attemptCount: ipHit.attemptCount,
          cooldownSeconds: ipHit.cooldownSeconds,
          remainingSeconds: ipHit.remainingSeconds,
          nextAvailableAt: ipHit.nextAvailableAt,
          blockedByIp: true,
        });
      }
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const user = userRes.rows[0];
    if (user.status === 'APPROVED') {
      return res.status(400).json({
        error: 'This account has already been verified. Please log in directly.',
        alreadyVerified: true,
      });
    }

    const limitResult = await enforceAndConsumeResendLimit({
      flow: 'email_verification',
      email: user.email || rawEmail,
      ip: clientIp,
      mode: 'resend',
    });

    if (!limitResult.allowed) {
      res.setHeader('Retry-After', String(limitResult.remainingSeconds));
      return res.status(429).json({
        error: limitResult.error,
        code: limitResult.code,
        flow: limitResult.flow,
        attemptCount: limitResult.attemptCount,
        cooldownSeconds: limitResult.cooldownSeconds,
        remainingSeconds: limitResult.remainingSeconds,
        nextAvailableAt: limitResult.nextAvailableAt,
        ...(limitResult.blockedByIp ? { blockedByIp: true } : {}),
      });
    }

    // Invalidate prior codes & issue a fresh 6-digit numeric verification code
    const { code: verificationCode, expiresAt } = await issueEmailVerificationCode({
      tenantId: user.tenant_id || 1,
      userId: user.id,
    });

    const requestOrigin =
      (typeof req.body?.origin === 'string' && req.body.origin.trim().startsWith('http') ? req.body.origin.trim() : '') ||
      (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('http') ? req.headers.origin : '') ||
      `${req.protocol}://${req.get('host')}`;

    const activationLink = `${requestOrigin.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(verificationCode)}&email=${encodeURIComponent(rawEmail)}&tenantId=${user.tenant_id || 1}`;

    let mailResult: any;
    try {
      mailResult = await sendTrialActivationEmail({
        to: rawEmail,
        userName: user.name || 'Store Owner',
        storeName: user.store_name || 'SarbaazSoft Shoe POS',
        activationToken: verificationCode,
        activationLink,
        expiresAt,
      });
      if (!mailResult.delivered) {
        console.warn(`[authRoutes.ts] Resend-verification email delivery notice for ${rawEmail}: ${mailResult.error}`);
      }
    } catch (mailErr: any) {
      console.warn(`[authRoutes.ts] Exception resending verification email to ${rawEmail}:`, mailErr?.message || mailErr);
      mailResult = {
        delivered: false,
        provider: 'resend' as const,
        sandbox: true,
        sandboxRecipient: undefined as string | undefined,
        error: mailErr?.message || String(mailErr),
      };
    }

    return res.json({
      success: true,
      emailSent: mailResult.delivered,
      sandbox: Boolean(mailResult.sandbox),
      cooldown: {
        flow: limitResult.flow,
        attemptCount: limitResult.attemptCount,
        cooldownSeconds: limitResult.cooldownSeconds,
        remainingSeconds: limitResult.remainingSeconds,
        nextAvailableAt: limitResult.nextAvailableAt,
        isInCooldown: limitResult.isInCooldown,
      },
      message: mailResult.sandbox
        ? `Resend Sandbox Mode: A 6-digit confirmation code was sent via sandbox to ${mailResult.sandboxRecipient || 'the configured test inbox'}. Please enter that 6-digit code below.`
        : mailResult.delivered
        ? `A new 6-digit confirmation code has been sent to ${rawEmail}. Please check your Inbox or Spam/Junk folder and enter the code below.`
        : `We could not confirm email delivery right now. Please check your mail server configuration or try again once the resend timer finishes.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to resend verification email: ' + err.message });
  }
});

// Get current user profile
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isSuperAdmin = String(req.user!.role).toUpperCase() === 'SUPERADMIN';
    const userTenantId = isSuperAdmin ? 0 : (Number(req.user!.tenantId) > 0 ? Number(req.user!.tenantId) : 1);
    const userRes = await pgClient.query(
      `SELECT id, tenant_id, name, email, phone, avatar_url, role, status, theme_color
       FROM users
       WHERE id = $1 AND (UPPER(role::text) = 'SUPERADMIN' OR tenant_id = $2)`,
      [req.user!.id, userTenantId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const row: any = userRes.rows[0];
    const rowTid = Number(row.tenant_id);
    const effectiveTid = isSuperAdmin ? 0 : (req.user!.tenantId || (Number.isInteger(rowTid) && rowTid > 0 ? rowTid : 1));
    let onboardingCompleted = true;
    if (String(row.role).toUpperCase() !== 'SUPERADMIN') {
      const tRes = await pgClient.query<{ onboarding_completed: boolean }>(
        'SELECT onboarding_completed FROM tenants WHERE id = $1 LIMIT 1',
        [effectiveTid]
      );
      if (tRes.rows.length > 0) {
        onboardingCompleted = Boolean(tRes.rows[0].onboarding_completed);
      }
    }
    res.json({
      user: {
        id: row.id,
        tenantId: effectiveTid,
        name: row.name,
        email: row.email,
        phone: row.phone || '',
        avatarUrl: row.avatar_url || '',
        role: row.role,
        originalRole: row.role,
        status: row.status,
        themeColor: row.theme_color || '',
        onboardingCompleted,
      },
    });
  } catch {
    res.json({ user: req.user });
  }
});

// Update Profile (Name, Phone, and optional Avatar Image; Email is strictly unchangeable)
router.put('/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, avatarUrl } = req.body;
    const userId = req.user!.id;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }

    const trimmedName = name.trim();
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
    const sanitizedAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() : (req.user?.avatarUrl || '');

    const isSuperAdmin = String(req.user!.role).toUpperCase() === 'SUPERADMIN';
    const userTenantId = isSuperAdmin ? 0 : (Number(req.user!.tenantId) > 0 ? Number(req.user!.tenantId) : 1);
    const result = await pgClient.query(
      `UPDATE users
       SET name = $1, phone = $2, avatar_url = $3, updated_at = NOW()
       WHERE id = $4 AND (UPPER(role::text) = 'SUPERADMIN' OR tenant_id = $5)
       RETURNING id, tenant_id, name, email, phone, avatar_url, role, status, theme_color`,
      [trimmedName, trimmedPhone, sanitizedAvatarUrl, userId, userTenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const row: any = result.rows[0];
    const rowTid = Number(row.tenant_id);
    const updatedUser: AuthUser = {
      id: row.id,
      tenantId: isSuperAdmin ? 0 : (req.user!.tenantId || (Number.isInteger(rowTid) && rowTid > 0 ? rowTid : 1)),
      name: row.name,
      email: row.email,
      phone: row.phone || '',
      avatarUrl: row.avatar_url || '',
      role: row.role,
      status: row.status,
      themeColor: row.theme_color || '',
    };
    const token = generateToken(updatedUser);

    res.json({
      message: 'Profile updated successfully.',
      user: updatedUser,
      token,
    });
  } catch (err: any) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile: ' + err.message });
  }
});

// Save authenticated user's personal theme preference into users.theme_color
const handleSaveUserTheme = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const rawThemeColor = req.body?.themeColor ?? req.body?.theme_color;
    if (rawThemeColor === undefined || rawThemeColor === null) {
      return res.status(400).json({ error: 'themeColor value is required.' });
    }
    const serialized = String(rawThemeColor).trim();
    if (serialized.length > 256) {
      return res.status(400).json({ error: 'Theme preference payload exceeds allowed length.' });
    }
    if (serialized && /[<>\x00-\x1F]/.test(serialized)) {
      return res.status(400).json({ error: 'Theme preference contains invalid characters.' });
    }

    const isSuperAdmin = String(req.user!.role).toUpperCase() === 'SUPERADMIN';
    const userTenantId = isSuperAdmin ? 0 : (Number(req.user!.tenantId) > 0 ? Number(req.user!.tenantId) : 1);

    const result = await pgClient.query(
      isSuperAdmin
        ? `UPDATE users SET theme_color = $1, updated_at = NOW() WHERE id = $2 RETURNING id, tenant_id, name, email, phone, avatar_url, role, status, theme_color`
        : `UPDATE users SET theme_color = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING id, tenant_id, name, email, phone, avatar_url, role, status, theme_color`,
      isSuperAdmin ? [serialized, userId] : [serialized, userId, userTenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const row: any = result.rows[0];
    const rowTid = Number(row.tenant_id);
    return res.json({
      success: true,
      themeColor: row.theme_color || '',
      user: {
        id: row.id,
        tenantId: isSuperAdmin ? 0 : (req.user!.tenantId || (Number.isInteger(rowTid) && rowTid > 0 ? rowTid : 1)),
        name: row.name,
        email: row.email,
        phone: row.phone || '',
        avatarUrl: row.avatar_url || '',
        role: row.role,
        originalRole: row.role,
        status: row.status,
        themeColor: row.theme_color || '',
      },
    });
  } catch (err: any) {
    console.error('Theme preference update error:', err);
    return res.status(500).json({ error: 'Failed to save theme preference: ' + err.message });
  }
};

router.put('/theme', requireAuth, handleSaveUserTheme);
router.patch('/theme', requireAuth, handleSaveUserTheme);

// Overwrite all store staff's theme & color preferences (Admin & SuperAdmin only, tenant-isolated)
const handleApplyThemeToAllStaff = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const role = String(req.user?.role || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Only Store Administrators or SuperAdmin can apply theme settings to staff.',
        code: 'FORBIDDEN_ROLE',
      });
    }

    const rawThemeColor = req.body?.themeColor ?? req.body?.theme_color;
    if (rawThemeColor === undefined || rawThemeColor === null) {
      return res.status(400).json({ error: 'themeColor value is required.' });
    }
    const serialized = String(rawThemeColor).trim();
    if (serialized.length > 256) {
      return res.status(400).json({ error: 'Theme preference payload exceeds allowed length.' });
    }
    if (serialized && /[<>\x00-\x1F]/.test(serialized)) {
      return res.status(400).json({ error: 'Theme preference contains invalid characters.' });
    }

    const userId = req.user!.id;
    const isSuperAdmin = role === 'SUPERADMIN';
    const requestedTenantId = Number(req.body?.tenantId ?? req.headers['x-tenant-id'] ?? 0);
    const adminTenantId = Number(req.user!.tenantId) > 0 ? Number(req.user!.tenantId) : 1;

    let result;
    if (!isSuperAdmin) {
      result = await pgClient.query(
        `UPDATE users SET theme_color = $1, updated_at = NOW() WHERE tenant_id = $2 AND UPPER(role) != 'SUPERADMIN' RETURNING id, tenant_id, name, email, phone, avatar_url, role, status, theme_color`,
        [serialized, adminTenantId]
      );
    } else if (Number.isInteger(requestedTenantId) && requestedTenantId > 0) {
      result = await pgClient.query(
        `UPDATE users SET theme_color = $1, updated_at = NOW() WHERE (tenant_id = $2 AND UPPER(role) != 'SUPERADMIN') OR id = $3 RETURNING id, tenant_id, name, email, phone, avatar_url, role, status, theme_color`,
        [serialized, requestedTenantId, userId]
      );
    } else {
      result = await pgClient.query(
        `UPDATE users SET theme_color = $1, updated_at = NOW() WHERE UPPER(role) != 'SUPERADMIN' OR id = $2 RETURNING id, tenant_id, name, email, phone, avatar_url, role, status, theme_color`,
        [serialized, userId]
      );
    }

    const updatedRows = result.rows || [];
    const currentRow: any = updatedRows.find((r: any) => Number(r.id) === Number(userId)) || updatedRows[0];

    return res.json({
      success: true,
      themeColor: serialized,
      updatedCount: updatedRows.length,
      message: `Applied theme & color settings to ${updatedRows.length} ${updatedRows.length === 1 ? 'account' : 'accounts'}.`,
      user: currentRow
        ? {
            id: currentRow.id,
            tenantId: isSuperAdmin ? 0 : adminTenantId,
            name: currentRow.name,
            email: currentRow.email,
            phone: currentRow.phone || '',
            avatarUrl: currentRow.avatar_url || '',
            role: currentRow.role,
            originalRole: currentRow.role,
            status: currentRow.status,
            themeColor: currentRow.theme_color || serialized,
          }
        : undefined,
    });
  } catch (err: any) {
    console.error('Bulk staff theme update error:', err);
    return res.status(500).json({ error: 'Failed to apply theme settings to staff: ' + err.message });
  }
};

router.put('/theme/staff', requireAuth, handleApplyThemeToAllStaff);
router.patch('/theme/staff', requireAuth, handleApplyThemeToAllStaff);

// Change Password
router.put('/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user!.id;

    if (!currentPassword) {
      return res.status(400).json({ error: 'Please enter your current/previous password.' });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Please enter both new password and confirm password.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New password and confirm password do not match.' });
    }

    const isSuperAdmin = String(req.user!.role).toUpperCase() === 'SUPERADMIN';
    const userTenantId = isSuperAdmin ? 0 : (Number(req.user!.tenantId) > 0 ? Number(req.user!.tenantId) : 1);
    const userRes = await pgClient.query(
      `SELECT password_hash, tenant_id, role
       FROM users
       WHERE id = $1 AND (UPPER(role::text) = 'SUPERADMIN' OR tenant_id = $2)`,
      [userId, userTenantId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const user: any = userRes.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect previous/current password. Please check and try again.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pgClient.query(
      `UPDATE users
       SET password_hash = $1, quick_password = $2, updated_at = NOW()
       WHERE id = $3 AND (UPPER(role::text) = 'SUPERADMIN' OR tenant_id = $4)`,
      [newHash, newPassword, userId, userTenantId]
    );

    res.json({ message: 'Password changed successfully. Please remember your new password.' });
  } catch (err: any) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password: ' + err.message });
  }
});

function extractOptionalTenantId(req: Request): number | undefined {
  const rawTid =
    req.body?.tenantId ??
    req.body?.tenant_id ??
    req.query?.tenantId ??
    req.query?.tenant_id ??
    req.headers['x-tenant-id'];
  const parsed = Number(rawTid);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function sendServiceResponse(res: Response, result: { status: number; headers?: Record<string, string>; body: Record<string, any> }) {
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  return res.status(result.status).json(result.body);
}

// Centralized 6-Digit Password Reset Flow (Store Owner, Cashier, Super Admin)
router.post('/password-reset/request', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const { email, isResend, roleScope } = req.body || {};
    const result = await requestPasswordResetCode({
      email: String(email || ''),
      tenantId: extractOptionalTenantId(req),
      roleScope: normalizeRoleScope(roleScope),
      isResend: isResend === true || req.query?.isResend === 'true',
      clientIp: extractClientIp(req),
    });
    return sendServiceResponse(res, result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to process password reset request: ' + err.message });
  }
});

router.post('/password-reset/verify', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const { email, code, roleScope } = req.body || {};
    const result = await verifyPasswordResetCode({
      email: String(email || ''),
      code: String(code || ''),
      tenantId: extractOptionalTenantId(req),
      roleScope: normalizeRoleScope(roleScope),
      clientIp: extractClientIp(req),
    });
    return sendServiceResponse(res, result);
  } catch (err: any) {
    return res.status(500).json({ valid: false, error: 'Failed to verify reset code: ' + err.message });
  }
});

router.post('/password-reset/confirm', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const { email, code, newPassword, confirmPassword, roleScope } = req.body || {};
    const result = await confirmPasswordReset({
      email: String(email || ''),
      code: String(code || ''),
      newPassword: String(newPassword || ''),
      confirmPassword: confirmPassword !== undefined ? String(confirmPassword) : undefined,
      tenantId: extractOptionalTenantId(req),
      roleScope: normalizeRoleScope(roleScope),
      clientIp: extractClientIp(req),
    });
    return sendServiceResponse(res, result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to reset password: ' + err.message });
  }
});

export default router;
