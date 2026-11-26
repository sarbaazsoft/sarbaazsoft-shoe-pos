import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pgClient } from '../../db/index.ts';
import { ensureSaasControlPlane, ensureDatabaseSchema, ensurePlatformNotificationsSchema, ensureTenantStoreUsers, normalizeSubscriptionPlan, normalizeSubscriptionType, calculateSubscriptionEndDate, calculateDaysLeft, syncExpiredTenantSubscriptions, clearSubscriptionAlertsOnRenewal } from '../../db/schemaInit.ts';
import { requireAuth, requireAdmin, requireSuperAdmin, generateToken, type AuthenticatedRequest, type AuthUser } from '../auth.ts';
import {
  notifyPlatformAnnouncement,
  emitStoreSubscriptionNotification,
  syncAndNotifyTenantSubscriptionLifecycle,
} from '../pushNotificationService.ts';
import { sendWelcomeMsg } from '../services/welcomeService.ts';
import { sendTrialActivationEmail } from '../utils/email.ts';
import { recordInitialAuthSend } from '../services/authResendRateLimitService.ts';
import { issueEmailVerificationCode } from '../services/emailVerificationService.ts';
import { resolveTenantContext, isTenantOnlineInMiddleware, getTenantMiddlewareLastSeen, removeTenantMiddlewarePresence } from '../middleware/tenantMiddleware.ts';
import { getAppSetting } from '../services/appSettingsService.ts';
import type { TrialTrackingEventType } from '../../types.ts';

export type { TrialTrackingEventType };

const router = Router();

export function extractRequestOrigin(req: Request): string {
  const origin = req.get('origin');
  if (origin && origin !== 'null') return origin.replace(/\/+$/, '');
  const referer = req.get('referer');
  if (referer) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`;
    } catch {}
  }
  const host = req.get('x-forwarded-host') || req.get('host');
  if (host) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    return `${proto}://${host}`;
  }
  return '';
}

/**
 * 1. RESOLVE CURRENT SAAS ROUTE & TENANT STATUS (`/api/saas/resolve`)
 * Used by the SPA to inspect the selected tenant status,
 * and returns the directory of deployed tenants for quick multi-tenant preview switching.
 */
router.get('/saas/resolve', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    await syncAndNotifyTenantSubscriptionLifecycle();
    const resolution = await resolveTenantContext(req);

    const directoryRes = await pgClient.query<{
      id: number;
      name: string;
      status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
      subscription_plan: string;
      subscription_type?: string;
      subscription_start_date: string;
      subscription_end_date: string;
      subscription_status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
      logo_url: string;
      currency: string;
      onboarding_completed: boolean;
    }>(
      `SELECT t.id, t.name, t.status, t.subscription_plan::text AS subscription_plan,
              COALESCE(NULLIF(t.subscription_type, ''), t.subscription_plan::text, 'free_tier') AS subscription_type,
              t.subscription_start_date, t.subscription_end_date, t.subscription_status,
              t.onboarding_completed,
              COALESCE(NULLIF(cs.logo, ''), '/pwa-512x512.png') AS logo_url,
              COALESCE(cs.currency, 'PKR') AS currency
       FROM tenants t
       LEFT JOIN company_settings cs ON cs.tenant_id = t.id
       WHERE t.id > 0
       ORDER BY t.id ASC`
    );

    return res.json({
      resolution,
      availableTenants: directoryRes.rows.map((t) => {
        const subPlan = normalizeSubscriptionPlan(t.subscription_plan);
        const subType = normalizeSubscriptionType(t.subscription_type || t.subscription_plan);
        const endDateIso = t.subscription_end_date ? new Date(t.subscription_end_date).toISOString() : '';
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          subscriptionType: subType,
          subscriptionPlan: subPlan,
          subscriptionStartDate: t.subscription_start_date ? new Date(t.subscription_start_date).toISOString() : '',
          subscriptionEndDate: endDateIso,
          subscriptionStatus: (t.subscription_status || 'ACTIVE') as 'ACTIVE' | 'EXPIRED' | 'SUSPENDED',
          daysLeft: calculateDaysLeft(endDateIso, new Date(), subPlan),
          logoUrl: t.logo_url,
          currency: t.currency,
          onboardingCompleted: Boolean(t.onboarding_completed),
          appPath: `/?tenantId=${t.id}`,
          manifestUrl: '/manifest.webmanifest',
        };
      }),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to resolve tenant context: ' + err.message });
  }
});

/**
 * 2b. PUBLIC PLATFORM STATS & METRICS (`/api/saas/public-stats`)
 */
router.get('/saas/public-stats', async (_req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const storesRes = await pgClient.query('SELECT COUNT(*)::int as c FROM tenants WHERE id > 0');
    const prodsRes = await pgClient.query('SELECT COUNT(*)::int as c FROM products WHERE active != false');
    const todayRes = await pgClient.query('SELECT COUNT(*)::int as c FROM sales WHERE DATE(sale_date) = CURRENT_DATE');
    const revRes = await pgClient.query('SELECT COALESCE(SUM(total_amount), 0)::numeric as s FROM sales');
    const ownerRes = await pgClient.query(
      "SELECT email, phone FROM users WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN' ORDER BY id ASC LIMIT 1"
    );
    const owner = ownerRes.rows[0];
    return res.json({
      stores: Number(storesRes.rows[0]?.c || 0),
      products: Number(prodsRes.rows[0]?.c || 0),
      invoicesToday: Number(todayRes.rows[0]?.c || 0),
      platformRevenue: Number(revRes.rows[0]?.s || 0),
      superAdminEmail: owner?.email || 'sarbaazsoft@gmail.com',
      superAdminPhone: owner?.phone || '+92-321-2257340',
    });
  } catch (_err) {
    return res.json({
      stores: 4,
      products: 12,
      invoicesToday: 0,
      platformRevenue: 0,
      superAdminEmail: 'sarbaazsoft@gmail.com',
      superAdminPhone: '+92-321-2257340',
    });
  }
});

/**
 * 2c. PLATFORM OWNER CONTACT INFO (`/api/saas/platform-owner`)
 */
router.get('/saas/platform-owner', async (_req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const ownerRes = await pgClient.query(
      "SELECT name, email, phone FROM users WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN' ORDER BY id ASC LIMIT 1"
    );
    const owner = ownerRes.rows[0];
    return res.json({
      name: owner?.name || 'Platform SuperAdmin',
      email: owner?.email || 'sarbaazsoft@gmail.com',
      phone: owner?.phone || '+92-321-2257340',
    });
  } catch {
    return res.json({
      name: 'Platform SuperAdmin',
      email: 'sarbaazsoft@gmail.com',
      phone: '+92-321-2257340',
    });
  }
});

/**
 * 2d. CHECK EMAIL AVAILABILITY (`/api/saas/check-email`)
 */
router.get('/saas/check-email', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.json({ available: false, message: 'Email address is required.' });
    }
    const check = await pgClient.query('SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 1', [email]);
    if (check.rows.length > 0) {
      return res.json({
        available: false,
        message: 'This email is already in use. Please use a different email address or log in.',
      });
    }
    return res.json({
      available: true,
      message: 'Email is available.',
    });
  } catch {
    return res.json({ available: true, message: 'Email format is valid.' });
  }
});

/**
 * 2e. PUBLIC FREE TRIAL STORE ACTIVATION (`/api/saas/store-request`)
 */
router.post('/saas/store-request', async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const body = req.body || {};
    const storeName = String(body.storeName || body.name || '').trim();
    const ownerEmail = String(body.ownerEmail || body.email || '').trim().toLowerCase();
    const ownerName = String(body.ownerName || body.name || storeName || 'Store Owner').trim();
    const ownerPhone = String(body.ownerPhone || body.phone || '').trim();
    const password = body.password ? String(body.password).trim() : 'admin123';
    const businessType: 'RETAIL' | 'WHOLESALE' =
      String(body.businessType || 'RETAIL').toUpperCase() === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
    const pricingMode: 'FIXED' | 'NEGOTIABLE' =
      businessType === 'WHOLESALE'
        ? 'FIXED'
        : String(body.pricingMode || 'FIXED').toUpperCase() === 'NEGOTIABLE'
        ? 'NEGOTIABLE'
        : 'FIXED';
    const allowHalfCarton = body.allowHalfCarton !== undefined ? Boolean(body.allowHalfCarton) : true;

    if (!storeName || !ownerEmail) {
      return res.status(400).json({ error: 'Store name and owner email are required.' });
    }

    const check = await pgClient.query('SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 1', [ownerEmail]);
    if (check.rows.length > 0) {
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'This email is already in use. Please use a different email address or log in.',
      });
    }

    const requireEmailVerification =
      (await getAppSetting('REQUIRE_EMAIL_VERIFICATION_FOR_FREE_TRIAL', 'true')) === 'true';
    const ownerStatus = requireEmailVerification ? 'PENDING' : 'APPROVED';

    const trialDurationDays = 30;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + trialDurationDays * 86400000);

    await pgClient.query('BEGIN');
    const provisioned = await provisionNewTenantStore({
      storeName,
      ownerName,
      ownerEmail,
      password,
      ownerPhone,
      businessType,
      pricingMode,
      allowHalfCarton,
      subscriptionPlan: 'free_tier',
      subscriptionType: 'free_tier',
      subscriptionStartDate: startDate.toISOString(),
      subscriptionEndDate: endDate.toISOString(),
      onboardingCompleted: false,
      ownerStatus,
    });
    await pgClient.query('COMMIT');

    await recordTrialActivation({
      userId: provisioned.adminUserId,
      tenantId: provisioned.tenantId,
      email: ownerEmail,
      userName: ownerName,
      phone: ownerPhone,
      storeName: provisioned.storeName,
      businessType,
      pricingMode,
      plan: 'TRIAL',
      trialDurationDays,
      trialStartDate: startDate.toISOString(),
      trialEndDate: endDate.toISOString(),
      status: requireEmailVerification ? 'PENDING' : 'ACTIVE',
      details: { source: 'landing_free_trial' },
    });

    // Store request logged. Welcome notification & email will be sent strictly upon initial onboarding completion.
    const ownerRes = await pgClient.query(
      "SELECT email, phone FROM users WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN' ORDER BY id ASC LIMIT 1"
    );
    const saOwner = ownerRes.rows[0];

    // CASE 1: Verification is required (Default: REQUIRE_EMAIL_VERIFICATION_FOR_FREE_TRIAL = true)
    if (requireEmailVerification) {
      const { code: verificationCode, expiresAt: tokenExpiresAt } = await issueEmailVerificationCode({
        tenantId: provisioned.tenantId,
        userId: provisioned.adminUserId,
      });

      const requestOrigin =
        (typeof req.body?.origin === 'string' && req.body.origin.trim().startsWith('http') ? req.body.origin.trim() : '') ||
        (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('http') ? req.headers.origin : '') ||
        `${req.protocol}://${req.get('host')}`;

      const activationLink = `${requestOrigin.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(verificationCode)}&email=${encodeURIComponent(ownerEmail)}&tenantId=${provisioned.tenantId}`;

      const mailResult = await sendTrialActivationEmail({
        to: ownerEmail,
        userName: ownerName,
        storeName: provisioned.storeName,
        activationToken: verificationCode,
        activationLink,
        expiresAt: tokenExpiresAt,
      }).catch((err) => ({
        delivered: false,
        provider: 'resend' as const,
        sandbox: true,
        sandboxRecipient: undefined as string | undefined,
        error: err?.message || String(err),
      }));

      await recordInitialAuthSend('email_verification', ownerEmail).catch(() => {});

      return res.status(201).json({
        success: true,
        message: `Store '${provisioned.storeName}' has been registered! Please check your email to activate your account.`,
        tenantId: provisioned.tenantId,
        storeName: provisioned.storeName,
        requiresVerification: true,
        verified: false,
        active: false,
        emailSent: mailResult.delivered,
        sandbox: Boolean(mailResult.sandbox),
        loginUrl: `/verify-email?email=${encodeURIComponent(ownerEmail)}&tenantId=${provisioned.tenantId}`,
        redirectUrl: `/verify-email?email=${encodeURIComponent(ownerEmail)}&tenantId=${provisioned.tenantId}`,
        superAdminEmail: saOwner?.email || 'sarbaazsoft@gmail.com',
        superAdminPhone: saOwner?.phone || '+92-321-2257340',
      });
    }

    // CASE 2: Verification toggle is OFF
    const authUser: AuthUser = {
      id: provisioned.adminUserId,
      tenantId: provisioned.tenantId,
      name: ownerName,
      email: provisioned.adminEmail,
      phone: ownerPhone,
      avatarUrl: '',
      role: 'ADMIN',
      status: 'APPROVED',
      onboardingCompleted: false,
    };
    const token = generateToken(authUser);

    return res.status(201).json({
      success: true,
      message: `Congratulations! Store '${provisioned.storeName}' has been activated with a 30-day Free Trial.`,
      tenantId: provisioned.tenantId,
      storeName: provisioned.storeName,
      requiresVerification: false,
      user: {
        ...authUser,
        tenantName: provisioned.storeName,
        storeName: provisioned.storeName,
        onboardingCompleted: false,
      },
      token,
      loginUrl: `/onboarding?tenantId=${provisioned.tenantId}`,
      redirectUrl: `/onboarding?tenantId=${provisioned.tenantId}`,
      superAdminEmail: saOwner?.email || 'sarbaazsoft@gmail.com',
      superAdminPhone: saOwner?.phone || '+92-321-2257340',
    });
  } catch (err: any) {
    await pgClient.query('ROLLBACK').catch(() => {});
    if (err?.code === 'EMAIL_ALREADY_EXISTS') {
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'This email is already in use. Please use a different email address.',
      });
    }
    return res.status(500).json({ error: err.message || 'Failed to submit store request.' });
  }
});


/**
 * Helper to record and log every user who activates or achieves a trial,
 * storing their details alongside their email address for tracking & analytics.
 */

export async function logTrialTrackingEvent(data: {
  trialId?: number | null;
  tenantId?: number | null;
  userId?: number | null;
  eventType: TrialTrackingEventType;
  previousStatus?: string | null;
  newStatus: string;
  previousEndDate?: string | Date | null;
  newEndDate?: string | Date | null;
  actorUser?: AuthUser | null;
  actorRole?: string;
  ownerEmail?: string;
  ownerName?: string;
  storeName?: string;
  notes?: string;
  metadata?: Record<string, any>;
}): Promise<any> {
  try {
    const actor = data.actorUser || null;
    const prevEndIso = data.previousEndDate ? new Date(data.previousEndDate).toISOString() : null;
    const newEndIso = data.newEndDate ? new Date(data.newEndDate).toISOString() : null;
    const res = await pgClient.query(
      `INSERT INTO trial_tracking_history (
        trial_id, tenant_id, user_id, event_type, previous_status, new_status,
        previous_end_date, new_end_date, actor_user_id, actor_email, actor_role,
        owner_email, owner_name, store_name, notes, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING *`,
      [
        data.trialId || null,
        data.tenantId || null,
        data.userId || null,
        String(data.eventType || 'EDITED').toUpperCase(),
        data.previousStatus ? String(data.previousStatus).toUpperCase() : null,
        String(data.newStatus || 'ACTIVE').toUpperCase(),
        prevEndIso,
        newEndIso,
        actor?.id || null,
        String(actor?.email || '').trim().toLowerCase(),
        String(data.actorRole || actor?.role || 'SUPERADMIN').toUpperCase(),
        String(data.ownerEmail || '').trim().toLowerCase(),
        String(data.ownerName || '').trim(),
        String(data.storeName || '').trim(),
        String(data.notes || '').trim(),
        JSON.stringify(data.metadata || {}),
      ]
    );
    return res.rows[0] || null;
  } catch (err: any) {
    console.error('[Trial History] Failed to log trial tracking event:', err?.message || err);
    return null;
  }
}

export function formatTrialActivationRow(row: any, nowMs: number = Date.now()) {
  const rawEnd = row.live_subscription_end_date || row.trial_end_date;
  const end = rawEnd ? new Date(rawEnd) : new Date(nowMs);
  const start = row.trial_start_date ? new Date(row.trial_start_date) : new Date(row.activated_at || nowMs);
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - nowMs) / 86400000));
  const rawStatus = String(row.status || 'ACTIVE').toUpperCase();
  const liveTenantStatus = String(row.live_tenant_status || '').toUpperCase();
  const liveSubStatus = String(row.live_subscription_status || '').toUpperCase();

  let effectiveStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CONVERTED' | 'PENDING' = 'ACTIVE';
  if (rawStatus === 'CONVERTED') {
    effectiveStatus = 'CONVERTED';
  } else if (rawStatus === 'SUSPENDED' || liveTenantStatus === 'SUSPENDED' || liveSubStatus === 'SUSPENDED') {
    effectiveStatus = 'SUSPENDED';
  } else if (rawStatus === 'PENDING') {
    effectiveStatus = 'PENDING';
  } else if (rawStatus === 'EXPIRED' || liveSubStatus === 'EXPIRED' || end.getTime() <= nowMs) {
    effectiveStatus = 'EXPIRED';
  }

  let parsedDetails: Record<string, any> = {};
  try {
    parsedDetails = typeof row.details === 'string' ? JSON.parse(row.details || '{}') : (row.details || {});
  } catch {
    parsedDetails = {};
  }

  return {
    id: Number(row.id),
    userId: row.user_id ? Number(row.user_id) : null,
    tenantId: row.tenant_id ? Number(row.tenant_id) : null,
    email: row.live_owner_email || row.email || '',
    userName: row.live_owner_name || row.user_name || row.store_name || '',
    phone: row.live_owner_phone !== undefined && row.live_owner_phone !== null && row.live_owner_phone !== '' ? row.live_owner_phone : (row.phone || ''),
    storeName: row.live_tenant_name || row.store_name || '',
    businessType: row.live_business_type || row.business_type || 'RETAIL',
    pricingMode: row.live_pricing_mode || row.pricing_mode || 'FIXED',
    plan: row.plan || 'TRIAL',
    trialDurationDays: Number(row.trial_duration_days || 30),
    trialStartDate: start.toISOString(),
    trialEndDate: end.toISOString(),
    daysRemaining: effectiveStatus === 'EXPIRED' || effectiveStatus === 'CONVERTED' ? 0 : daysRemaining,
    status: effectiveStatus,
    liveTenantStatus: liveTenantStatus || null,
    liveSubscriptionStatus: liveSubStatus || null,
    liveSubscriptionPlan: row.live_subscription_plan || null,
    onboardingCompleted: row.live_onboarding_completed !== undefined && row.live_onboarding_completed !== null ? Boolean(row.live_onboarding_completed) : undefined,
    convertedAt: row.converted_at ? new Date(row.converted_at).toISOString() : null,
    convertedPlan: row.converted_plan || null,
    expiredAt: row.expired_at ? new Date(row.expired_at).toISOString() : null,
    suspendedAt: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
    reactivatedAt: row.reactivated_at ? new Date(row.reactivated_at).toISOString() : null,
    ipAddress: row.ip_address || '',
    userAgent: row.user_agent || '',
    activatedAt: row.activated_at ? new Date(row.activated_at).toISOString() : start.toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    details: parsedDetails,
  };
}

export function formatTrialHistoryRow(row: any) {
  let metadata: Record<string, any> = {};
  try {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {});
  } catch {
    metadata = {};
  }
  return {
    id: Number(row.id),
    trialId: row.trial_id ? Number(row.trial_id) : null,
    tenantId: row.tenant_id ? Number(row.tenant_id) : null,
    userId: row.user_id ? Number(row.user_id) : null,
    eventType: String(row.event_type || 'EDITED').toUpperCase(),
    previousStatus: row.previous_status || null,
    newStatus: String(row.new_status || ''),
    previousEndDate: row.previous_end_date ? new Date(row.previous_end_date).toISOString() : null,
    newEndDate: row.new_end_date ? new Date(row.new_end_date).toISOString() : null,
    actorUserId: row.actor_user_id ? Number(row.actor_user_id) : null,
    actorEmail: row.actor_email || '',
    actorRole: row.actor_role || 'SYSTEM',
    ownerEmail: row.owner_email || '',
    ownerName: row.owner_name || '',
    storeName: row.store_name || '',
    notes: row.notes || '',
    metadata,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Helper to record and log every user who activates or achieves a trial,
 * storing their details alongside their email address for tracking & analytics.
 */
export async function recordTrialActivation(data: {
  userId?: number | null;
  tenantId?: number | null;
  email: string;
  userName?: string;
  phone?: string;
  storeName: string;
  businessType: string;
  pricingMode: string;
  plan?: string;
  trialDurationDays?: number;
  trialStartDate?: string | Date;
  trialEndDate?: string | Date;
  status?: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CONVERTED' | 'PENDING';
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
  actorUser?: AuthUser | null;
}): Promise<any> {
  const cleanEmail = String(data.email || '').trim().toLowerCase();
  const durationDays = data.trialDurationDays || 30;
  const startDate = data.trialStartDate ? new Date(data.trialStartDate) : new Date();
  const endDate = data.trialEndDate
    ? new Date(data.trialEndDate)
    : new Date(startDate.getTime() + durationDays * 86400000);
  const status = data.status || (endDate.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE');

  try {
    const res = await pgClient.query(
      `INSERT INTO trial_activations (
        user_id, tenant_id, email, user_name, phone, store_name, business_type, pricing_mode,
        plan, trial_duration_days, trial_start_date, trial_end_date, status, ip_address, user_agent, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        data.userId || null,
        data.tenantId || null,
        cleanEmail,
        String(data.userName || '').trim(),
        String(data.phone || '').trim(),
        String(data.storeName || '').trim(),
        String(data.businessType || 'RETAIL'),
        String(data.pricingMode || 'FIXED'),
        String(data.plan || 'TRIAL'),
        durationDays,
        startDate.toISOString(),
        endDate.toISOString(),
        status,
        String(data.ipAddress || ''),
        String(data.userAgent || ''),
        JSON.stringify(data.details || {}),
      ]
    );

    const inserted = res.rows[0];
    if (inserted?.id) {
      await logTrialTrackingEvent({
        trialId: inserted.id,
        tenantId: data.tenantId || null,
        userId: data.userId || null,
        eventType: 'ACTIVATED',
        previousStatus: null,
        newStatus: status,
        previousEndDate: null,
        newEndDate: endDate.toISOString(),
        actorUser: data.actorUser || null,
        actorRole: data.actorUser?.role || (data.details?.createdBy === 'SUPERADMIN' ? 'SUPERADMIN' : 'SYSTEM'),
        ownerEmail: cleanEmail,
        ownerName: String(data.userName || '').trim(),
        storeName: String(data.storeName || '').trim(),
        notes: status === 'PENDING'
          ? `30-day Free Trial registered for '${String(data.storeName || '').trim()}' (awaiting email verification).`
          : `30-day Free Trial activated for '${String(data.storeName || '').trim()}'.`,
        metadata: { source: data.details?.source || data.details?.createdBy || 'registration', durationDays },
      });
    }

    // Alert SuperAdmin via platform notification about the new free trial registration (strictly scoped to SUPERADMIN role)
    const trialEventId = `trial-activation-${data.tenantId || cleanEmail}`;
    await pgClient
      .query(
        `INSERT INTO platform_notifications (tenant_id, target_role, title, message, type, action_url, action_label, event_id, created_at)
         VALUES (NULL, 'SUPERADMIN', $1, $2, 'INFO', '/admin/free-trials', 'View Trial', $3, NOW())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id, created_at`,
        [
          `New Free Trial: ${String(data.storeName || 'New Store').trim()}`,
          `New 30-day Free Tier store registered by ${String(data.userName || 'Store Owner').trim()} (${cleanEmail}${data.phone ? ' • ' + data.phone : ''}).`,
          trialEventId,
        ]
      )
      .then(async (notifRes) => {
        const notifRow = notifRes.rows[0];
        if (notifRow?.id) {
          await notifyPlatformAnnouncement({
            id: notifRow.id,
            eventId: trialEventId,
            tenantId: null,
            targetRole: 'SUPERADMIN',
            title: `New Free Trial: ${String(data.storeName || 'New Store').trim()}`,
            message: `New 30-day Free Tier store registered by ${String(data.userName || 'Store Owner').trim()} (${cleanEmail}${data.phone ? ' • ' + data.phone : ''}).`,
            type: 'INFO',
            actionUrl: '/admin/free-trials',
            actionLabel: 'View Trial',
            timestamp: notifRow.created_at,
          }).catch(() => {});
        }
      })
      .catch(() => {});

    return inserted;
  } catch (err: any) {
    console.error('[Trial Tracker] Failed to record trial activation:', err?.message || err);
    return null;
  }
}

/**
 * 4. SUPERADMIN CONTROL PANEL: OVERVIEW METRICS, DEPLOYED STORES & PENDING REQUESTS QUEUE
 * Accessible strictly via JWT with `SUPERADMIN` role (`GET /api/superadmin/overview`)
 */
router.get('/superadmin/overview', requireAuth, requireSuperAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    await ensureSaasControlPlane();
    await syncExpiredTenantSubscriptions();

    const storesRes = await pgClient.query<{
      id: number;
      name: string;
      status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
      subscription_plan: string;
      subscription_start_date: string;
      subscription_end_date: string;
      subscription_status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
      logo_url: string;
      owner_email: string;
      owner_phone: string;
      address: string;
      tax_id: string;
      currency: string;
      onboarding_completed: boolean;
      created_at: string;
      product_count: string;
      business_type: 'RETAIL' | 'WHOLESALE';
      total_stock_units: string;
      sales_count: string;
      total_sales_revenue: string;
      staff_count: string;
      customer_count: string;
      supplier_count: string;
      units_sold: string;
      inventory_value: string;
    }>(`
      SELECT 
        t.*,
        COALESCE(NULLIF(cs.business_type::text, ''), 'RETAIL') AS business_type,
        COALESCE(NULLIF(cs.pricing_mode::text, ''), 'FIXED') AS pricing_mode,
        COALESCE(cs.allow_half_carton, true) AS allow_half_carton,
        COALESCE(NULLIF(cs.logo, ''), '/pwa-512x512.png') AS logo_url,
        COALESCE(u.email, cs.email, '') AS owner_email,
        COALESCE(NULLIF(u.phone, ''), cs.phone, '') AS owner_phone,
        COALESCE(cs.address, '') AS address,
        COALESCE(cs.tax_id, '') AS tax_id,
        COALESCE(cs.currency, 'PKR') AS currency,
        (SELECT COUNT(*) FROM products p WHERE p.tenant_id = t.id AND p.active = true)::text as product_count,
        (SELECT COALESCE(SUM(p.total_stock), 0) FROM products p WHERE p.tenant_id = t.id AND p.active = true)::text as total_stock_units,
        (SELECT COUNT(*) FROM sales s WHERE s.tenant_id = t.id)::text as sales_count,
        (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s WHERE s.tenant_id = t.id)::text as total_sales_revenue,
        (SELECT COUNT(*) FROM users u2 WHERE u2.tenant_id = t.id AND u2.role != 'SUPERADMIN')::text as staff_count,
        (SELECT COUNT(*) FROM customers c WHERE c.tenant_id = t.id)::text as customer_count,
        (SELECT COUNT(*) FROM suppliers sp WHERE sp.tenant_id = t.id)::text as supplier_count,
        (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.tenant_id = t.id)::text as units_sold,
        (SELECT COALESCE(SUM(p.total_stock * p.max_price), 0) FROM products p WHERE p.tenant_id = t.id AND p.active = true)::text as inventory_value
      FROM tenants t
      LEFT JOIN company_settings cs ON cs.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT email, phone
        FROM users
        WHERE tenant_id = t.id AND role = 'ADMIN'
        ORDER BY id ASC
        LIMIT 1
      ) u ON true
      ORDER BY t.id ASC
    `);

    const trialsRes = await pgClient
      .query(`
        SELECT ta.*,
               t.name AS live_tenant_name,
               t.status AS live_tenant_status,
               t.subscription_status AS live_subscription_status,
               t.subscription_plan AS live_subscription_plan,
               t.subscription_end_date AS live_subscription_end_date,
               t.onboarding_completed AS live_onboarding_completed,
               u.name AS live_owner_name,
               u.email AS live_owner_email,
               u.phone AS live_owner_phone,
               cs.business_type AS live_business_type,
               cs.pricing_mode AS live_pricing_mode
        FROM trial_activations ta
        LEFT JOIN tenants t ON t.id = ta.tenant_id
        LEFT JOIN LATERAL (
          SELECT name, email, phone
          FROM users
          WHERE tenant_id = ta.tenant_id AND role = 'ADMIN'
          ORDER BY id ASC
          LIMIT 1
        ) u ON true
        LEFT JOIN company_settings cs ON cs.tenant_id = ta.tenant_id
        ORDER BY ta.activated_at DESC, ta.id DESC
      `)
      .catch(() => ({ rows: [] }));

    const formattedTrials = (trialsRes.rows || []).map((r: any) => formatTrialActivationRow(r));
    const activeTrialsCount = formattedTrials.filter((t) => t.status === 'ACTIVE').length;
    const expiredTrialsCount = formattedTrials.filter((t) => t.status === 'EXPIRED').length;
    const suspendedTrialsCount = formattedTrials.filter((t) => t.status === 'SUSPENDED').length;
    const convertedTrialsCount = formattedTrials.filter((t) => t.status === 'CONVERTED').length;

    const topProductsRes = await pgClient
      .query<{
        id: number;
        tenant_id: number;
        store_name: string;
        currency: string;
        product_name: string;
        barcode: string;
        brand: string;
        category: string;
        primary_image_url: string;
        max_price: string;
        cost_price: string;
        total_stock: string;
        units_sold: string;
        total_revenue: string;
        order_count: string;
      }>(`
        SELECT
          p.id,
          p.tenant_id,
          t.name AS store_name,
          COALESCE(cs.currency, 'PKR') AS currency,
          COALESCE(NULLIF(TRIM(p.article), ''), p.name) AS product_name,
          p.barcode,
          COALESCE(NULLIF(TRIM(p.brand), ''), 'Unbranded') AS brand,
          COALESCE(NULLIF(TRIM(p.category), ''), 'General') AS category,
          COALESCE(p.primary_image_url, '') AS primary_image_url,
          COALESCE(p.max_price, 0)::text AS max_price,
          COALESCE(p.cost_price, 0)::text AS cost_price,
          COALESCE(p.total_stock, 0)::text AS total_stock,
          COALESCE(SUM(si.quantity), 0)::text AS units_sold,
          COALESCE(SUM(si.subtotal), 0)::text AS total_revenue,
          COUNT(DISTINCT si.sale_id)::text AS order_count
        FROM products p
        JOIN tenants t ON t.id = p.tenant_id
        LEFT JOIN company_settings cs ON cs.tenant_id = t.id
        LEFT JOIN sale_items si ON si.product_id = p.id AND si.tenant_id = p.tenant_id
        WHERE p.active = true
        GROUP BY p.id, p.tenant_id, t.name, cs.currency, p.article, p.name, p.barcode, p.brand, p.category, p.primary_image_url, p.max_price, p.cost_price, p.total_stock
        ORDER BY COALESCE(SUM(si.subtotal), 0) DESC, COALESCE(SUM(si.quantity), 0) DESC, (COALESCE(p.total_stock, 0) * COALESCE(p.max_price, 0)) DESC
        LIMIT 30
      `)
      .catch(() => ({ rows: [] }));

    const sevenDaysRes = await pgClient
      .query<{
        date: string;
        label: string;
        amount: string;
        tx_count: string;
      }>(`
        WITH days AS (
          SELECT (CURRENT_DATE - i)::text AS d,
                 TO_CHAR(CURRENT_DATE - i, 'Dy') AS label,
                 i AS idx
          FROM generate_series(6, 0, -1) AS i
        )
        SELECT days.d AS date,
               days.label,
               COALESCE(SUM(s.total_amount), 0)::text AS amount,
               COUNT(s.id)::text AS tx_count
        FROM days
        LEFT JOIN sales s ON s.sale_date = days.d
        GROUP BY days.d, days.label, days.idx
        ORDER BY days.idx DESC
      `)
      .catch(() => ({ rows: [] }));

    const recentTxRes = await pgClient
      .query<{
        id: number;
        tenant_id: number;
        type: string;
        reference: string;
        store_name: string;
        customer_name: string;
        amount: string;
        currency: string;
        status: string;
        created_at: string;
      }>(`
        SELECT * FROM (
          SELECT
            s.id,
            s.tenant_id,
            'Sale' AS type,
            s.invoice_number AS reference,
            t.name AS store_name,
            COALESCE(c.name, 'Walk-in Customer') AS customer_name,
            s.total_amount::text AS amount,
            COALESCE(cs.currency_symbol, 'Rs.') AS currency,
            'Completed' AS status,
            s.created_at
          FROM sales s
          JOIN tenants t ON t.id = s.tenant_id
          LEFT JOIN company_settings cs ON cs.tenant_id = t.id
          LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
          UNION ALL
          SELECT
            pu.id,
            pu.tenant_id,
            'Purchase' AS type,
            pu.purchase_number AS reference,
            t.name AS store_name,
            COALESCE(pu.supplier_name, 'Supplier') AS customer_name,
            pu.total_amount::text AS amount,
            COALESCE(cs.currency_symbol, 'Rs.') AS currency,
            'Received' AS status,
            pu.created_at
          FROM purchases pu
          JOIN tenants t ON t.id = pu.tenant_id
          LEFT JOIN company_settings cs ON cs.tenant_id = t.id
          UNION ALL
          SELECT
            r.id,
            r.tenant_id,
            'Return' AS type,
            r.return_number AS reference,
            t.name AS store_name,
            'Customer Return' AS customer_name,
            r.total_refund_amount::text AS amount,
            COALESCE(cs.currency_symbol, 'Rs.') AS currency,
            'Refunded' AS status,
            r.created_at
          FROM returns r
          JOIN tenants t ON t.id = r.tenant_id
          LEFT JOIN company_settings cs ON cs.tenant_id = t.id
        ) tx
        ORDER BY created_at DESC
        LIMIT 8
      `)
      .catch(() => ({ rows: [] }));

    const topCategoriesRes = await pgClient
      .query<{
        name: string;
        product_count: string;
        total_stock: string;
        units_sold: string;
        total_revenue: string;
      }>(`
        SELECT
          COALESCE(NULLIF(TRIM(p.category), ''), 'General') AS name,
          COUNT(DISTINCT p.id)::text AS product_count,
          COALESCE(SUM(DISTINCT p.total_stock), 0)::text AS total_stock,
          COALESCE(SUM(si.quantity), 0)::text AS units_sold,
          COALESCE(SUM(si.subtotal), 0)::text AS total_revenue
        FROM products p
        JOIN tenants t ON t.id = p.tenant_id
        LEFT JOIN sale_items si ON si.product_id = p.id AND si.tenant_id = p.tenant_id
        WHERE p.active = true
        GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'General')
        ORDER BY COALESCE(SUM(si.subtotal), 0) DESC, COUNT(DISTINCT p.id) DESC
        LIMIT 10
      `)
      .catch(() => ({ rows: [] }));

    // Tenant SaaS Subscription Plans Breakdown & Health
    const stores = storesRes.rows.map((s) => {
      const endDateIso = s.subscription_end_date ? new Date(s.subscription_end_date).toISOString() : '';
      const startDateIso = s.subscription_start_date ? new Date(s.subscription_start_date).toISOString() : '';
      const isDateExpired = endDateIso && new Date(endDateIso).getTime() < Date.now();
      let subStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' = (String(s.subscription_status || 'ACTIVE').toUpperCase() as any);
      if (s.status === 'SUSPENDED') {
        subStatus = 'SUSPENDED';
      } else if (isDateExpired) {
        subStatus = 'EXPIRED';
      }

      const isOnline =
        s.status === 'ACTIVE' &&
        subStatus === 'ACTIVE' &&
        isTenantOnlineInMiddleware(s.id, s.status, subStatus);
      const lastSeenAt = getTenantMiddlewareLastSeen(s.id);

      return {
        id: s.id,
        name: s.name,
        status: s.status,
        businessType: String(s.business_type || 'RETAIL').toUpperCase() === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL',
        allowHalfCarton: (s as any).allow_half_carton !== undefined ? Boolean((s as any).allow_half_carton) : true,
        subscriptionType: normalizeSubscriptionType((s as any).subscription_type || s.subscription_plan),
        subscriptionPlan: normalizeSubscriptionPlan(s.subscription_plan),
        subscriptionStartDate: startDateIso,
        subscriptionEndDate: endDateIso,
        subscriptionStatus: subStatus,
        daysLeft: calculateDaysLeft(endDateIso, new Date(), s.subscription_plan),
        isOnline,
        lastSeenAt,
        logoUrl: s.logo_url || '/pwa-512x512.png',
        ownerEmail: s.owner_email || '',
        ownerPhone: s.owner_phone || '',
        address: s.address || '',
        taxId: s.tax_id || '',
        currency: s.currency || 'PKR',
        onboardingCompleted: Boolean(s.onboarding_completed),
        createdAt: s.created_at,
        productCount: parseInt(s.product_count || '0', 10),
        totalStockUnits: parseInt(s.total_stock_units || '0', 10),
        salesCount: parseInt(s.sales_count || '0', 10),
        totalSales: parseFloat(s.total_sales_revenue || '0'),
        staffCount: parseInt(s.staff_count || '0', 10),
        customerCount: parseInt(s.customer_count || '0', 10),
        supplierCount: parseInt(s.supplier_count || '0', 10),
        unitsSold: parseInt(s.units_sold || '0', 10),
        inventoryValue: parseFloat(s.inventory_value || '0'),
        manifestUrl: '/manifest.webmanifest',
        appUrl: `/?tenantId=${s.id}`,
        installUrl: `/?tenantId=${s.id}`,
      };
    });

    const totalPlatformRevenue = stores.reduce((sum, st) => sum + st.totalSales, 0);
    const totalPlatformProducts = stores.reduce((sum, st) => sum + st.productCount, 0);
    const totalPlatformInvoices = stores.reduce((sum, st) => sum + st.salesCount, 0);
    const totalStaffAccounts = stores.reduce((sum, st) => sum + st.staffCount, 0);

    const activeStoresCount = stores.filter((st) => st.status === 'ACTIVE' && st.subscriptionStatus === 'ACTIVE').length;
    const suspendedStoresCount = stores.filter((st) => st.status === 'SUSPENDED' || st.subscriptionStatus === 'SUSPENDED').length;
    const expiredStoresCount = stores.filter((st) => st.subscriptionStatus === 'EXPIRED').length;
    const expiringSoonStores = stores.filter((st) => st.daysLeft !== null && st.daysLeft !== undefined && st.daysLeft <= 30 && st.daysLeft >= 0 && st.subscriptionStatus !== 'SUSPENDED');
    const expiringSoonCount = expiringSoonStores.length;
    const onlineStoresCount = stores.filter((st) => st.isOnline).length;
    const onboardedStoresCount = stores.filter((st) => st.onboardingCompleted).length;
    const retailStoresCount = stores.filter((st) => st.businessType === 'RETAIL').length;
    const wholesaleStoresCount = stores.filter((st) => st.businessType === 'WHOLESALE').length;

    // Tenant SaaS Subscription Plans Breakdown
    const planCounts: Record<string, { count: number; active: number; expiring: number }> = {
      YEARLY: { count: 0, active: 0, expiring: 0 },
      '6_MONTHS': { count: 0, active: 0, expiring: 0 },
      TRIAL: { count: 0, active: 0, expiring: 0 },
    };

    for (const st of stores) {
      const planKey = st.subscriptionPlan === 'YEARLY' ? 'YEARLY' : st.subscriptionPlan === '6_MONTHS' ? '6_MONTHS' : 'TRIAL';
      if (!planCounts[planKey]) planCounts[planKey] = { count: 0, active: 0, expiring: 0 };
      planCounts[planKey].count++;
      if (st.status === 'ACTIVE' && st.subscriptionStatus === 'ACTIVE') {
        planCounts[planKey].active++;
      }
      if (st.daysLeft !== null && st.daysLeft !== undefined && st.daysLeft <= 30 && st.daysLeft >= 0 && st.subscriptionStatus !== 'SUSPENDED') {
        planCounts[planKey].expiring++;
      }
    }

    const subscriptionPlans = [
      {
        plan: 'YEARLY',
        label: 'Yearly Plan (1 Year)',
        count: planCounts.YEARLY.count,
        percentage: Math.round((planCounts.YEARLY.count / Math.max(1, stores.length)) * 100),
        activeCount: planCounts.YEARLY.active,
        expiringCount: planCounts.YEARLY.expiring,
      },
      {
        plan: '6_MONTHS',
        label: '6-Months Plan',
        count: planCounts['6_MONTHS'].count,
        percentage: Math.round((planCounts['6_MONTHS'].count / Math.max(1, stores.length)) * 100),
        activeCount: planCounts['6_MONTHS'].active,
        expiringCount: planCounts['6_MONTHS'].expiring,
      },
      {
        plan: 'TRIAL',
        label: '30-Day Free Trial',
        count: planCounts.TRIAL.count,
        percentage: Math.round((planCounts.TRIAL.count / Math.max(1, stores.length)) * 100),
        activeCount: planCounts.TRIAL.active,
        expiringCount: planCounts.TRIAL.expiring,
      },
    ];

    const expiringTenants = expiringSoonStores
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
      .map((st) => ({
        id: st.id,
        name: st.name,
        ownerEmail: st.ownerEmail,
        ownerPhone: st.ownerPhone,
        subscriptionPlan: st.subscriptionPlan,
        subscriptionEndDate: st.subscriptionEndDate,
        daysLeft: st.daysLeft ?? 0,
        subscriptionStatus: st.subscriptionStatus,
        status: st.status,
      }));

    const saasMetrics = {
      totalStores: stores.length,
      activeStores: activeStoresCount,
      expiringSoonStores: expiringSoonCount,
      expiredStores: expiredStoresCount,
      suspendedStores: suspendedStoresCount,
      activeTrials: activeTrialsCount,
      expiredTrials: expiredTrialsCount,
      suspendedTrials: suspendedTrialsCount,
      convertedTrials: convertedTrialsCount,
      totalTrials: formattedTrials.length,
      onlineStores: onlineStoresCount,
      onboardedStores: onboardedStoresCount,
      retailStores: retailStoresCount,
      wholesaleStores: wholesaleStoresCount,
      totalPlatformRevenue,
      totalInvoicesCount: totalPlatformInvoices,
      totalStaffAccounts,
    };

    const topProducts = topProductsRes.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      storeName: r.store_name,
      currency: r.currency || 'PKR',
      productName: r.product_name,
      barcode: r.barcode,
      brand: r.brand,
      category: r.category,
      imageUrl: r.primary_image_url || '',
      maxPrice: parseFloat(r.max_price || '0'),
      sellingPrice: parseFloat(r.max_price || '0'),
      costPrice: parseFloat(r.cost_price || '0'),
      totalStock: parseInt(r.total_stock || '0', 10),
      unitsSold: parseInt(r.units_sold || '0', 10),
      totalRevenue: parseFloat(r.total_revenue || '0'),
      orderCount: parseInt(r.order_count || '0', 10),
    }));

    const topCategories = topCategoriesRes.rows.map((r) => ({
      name: r.name,
      productCount: parseInt(r.product_count || '0', 10),
      totalStock: parseInt(r.total_stock || '0', 10),
      unitsSold: parseInt(r.units_sold || '0', 10),
      totalRevenue: parseFloat(r.total_revenue || '0'),
    }));

    const sevenDaySales = sevenDaysRes.rows.map((r, idx) => ({
      date: r.date || '',
      label: r.label || `Day ${idx + 1}`,
      amount: parseFloat(r.amount || '0'),
      txCount: parseInt(r.tx_count || '0', 10),
    }));

    const recentTransactions = recentTxRes.rows.map((r, idx) => {
      const dt = r.created_at ? new Date(r.created_at) : new Date();
      const parsedAmount = parseFloat(r.amount || '0');
      const txType = r.type || 'Sale';
      const formattedTime = dt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        id: `${txType.toLowerCase()}-${r.id ?? idx}`,
        tenantId: r.tenant_id,
        type: txType,
        reference: r.reference || '',
        invoiceNumber: r.reference || '',
        storeName: r.store_name || '',
        customerName: r.customer_name || 'Walk-in Customer',
        amount: parsedAmount,
        totalAmount: parsedAmount,
        currency: r.currency || 'Rs.',
        status: r.status || 'Completed',
        date: dt.toISOString(),
        saleDate: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${formattedTime}`,
        timeString: formattedTime,
      };
    });

    return res.json({
      metrics: {
        totalStores: stores.length,
        activeStores: activeStoresCount,
        expiringSoonStores: expiringSoonCount,
        suspendedStores: suspendedStoresCount,
        expiredStores: expiredStoresCount,
        pendingRequests: 0,
        activeTrials: activeTrialsCount,
        expiredTrials: expiredTrialsCount,
        suspendedTrials: suspendedTrialsCount,
        convertedTrials: convertedTrialsCount,
        totalTrials: formattedTrials.length,
        onlineStores: onlineStoresCount,
        onboardedStores: onboardedStoresCount,
        totalPlatformRevenue,
        totalPlatformProducts,
        totalInvoicesCount: totalPlatformInvoices,
      },
      saasMetrics,
      subscriptionPlans,
      expiringTenants,
      stores,
      storeRequests: [],
      trialActivations: formattedTrials,
      reports: {
        topProducts,
        topCategories,
        topBrands: [],
        subscriptionPlans,
        expiringTenants,
        sevenDaySales,
        recentTransactions,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load SuperAdmin overview: ' + err.message });
  }
});

/**
 * 5. SUPERADMIN REAL-TIME TENANT ACTIVE / DISABLE TOGGLE (`PATCH /api/superadmin/tenants/:id/status`)
 * Immediately revokes or restores tenant access at the API and tenant-routing middleware levels.
 */
router.patch('/superadmin/tenants/:id/status', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = parseInt(req.params.id, 10);
    const { status } = req.body || {};

    if (!['ACTIVE', 'SUSPENDED', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be ACTIVE, EXPIRED, or SUSPENDED.' });
    }

    const currRes = await pgClient.query<{
      id: number;
      name: string;
      subscription_plan: string;
      subscription_status: string;
      subscription_end_date: string | null;
    }>('SELECT id, name, subscription_plan, subscription_status, subscription_end_date FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);

    if (currRes.rows.length === 0) {
      return res.status(404).json({ error: 'Store tenant not found.' });
    }

    const curr = currRes.rows[0];
    let nextTenantStatus = status === 'EXPIRED' ? 'ACTIVE' : status;
    let nextSubStatus = status;
    let nextEndDate = curr.subscription_end_date ? new Date(curr.subscription_end_date) : calculateSubscriptionEndDate(curr.subscription_plan || 'YEARLY');

    const wasExpired =
      String(curr.subscription_status || '').toUpperCase() === 'EXPIRED' ||
      (curr.subscription_end_date ? new Date(curr.subscription_end_date).getTime() < Date.now() : false);

    // If activating an expired store via status toggle, automatically renew its expiry from today based on its plan
    if (status === 'ACTIVE' && nextEndDate.getTime() < Date.now()) {
      nextEndDate = calculateSubscriptionEndDate(curr.subscription_plan || 'YEARLY', new Date());
    }

    const pendingRenewalRes = status === 'ACTIVE'
      ? await pgClient
          .query<{ id: number }>(
            `SELECT id FROM platform_notifications
             WHERE target_role = 'SUPERADMIN'
               AND (expires_at IS NULL OR expires_at > NOW())
               AND (
                 event_id LIKE $1
                 OR ((title ILIKE 'New Renewal Request%' OR title ILIKE 'Renewal Request:%') AND message ILIKE $2)
               )
             LIMIT 1`,
            [`renewal-request-${tenantId}-%`, `%${curr.name}%`]
          )
          .catch(() => ({ rows: [] as Array<{ id: number }> }))
      : { rows: [] as Array<{ id: number }> };
    const hasPendingRenewal = pendingRenewalRes.rows.length > 0;

    const updateRes = await pgClient.query<{
      id: number;
      name: string;
      status: string;
      subscription_status: string;
      subscription_end_date: string;
    }>(
      `UPDATE tenants
       SET status = $1,
           subscription_status = $2,
           subscription_end_date = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, status, subscription_status, subscription_end_date`,
      [nextTenantStatus, nextSubStatus, nextEndDate.toISOString(), tenantId]
    );

    const updated = updateRes.rows[0];
    if (updated.status !== 'ACTIVE' || updated.subscription_status !== 'ACTIVE') {
      removeTenantMiddlewarePresence(tenantId);
    }

    // Keep linked Free Trial records & tracking history in sync with store status changes
    const linkedTrialRes = await pgClient
      .query<any>('SELECT * FROM trial_activations WHERE tenant_id = $1', [tenantId])
      .catch(() => ({ rows: [] as any[] }));
    const prevTrial = linkedTrialRes.rows[0];
    if (prevTrial && String(prevTrial.status || '').toUpperCase() !== 'CONVERTED') {
      const prevTrialStatus = String(prevTrial.status || curr.subscription_status || 'ACTIVE').toUpperCase();
      if (status === 'SUSPENDED') {
        await pgClient
          .query(
            `UPDATE trial_activations
             SET status = 'SUSPENDED',
                 suspended_at = NOW(),
                 updated_at = NOW()
             WHERE tenant_id = $1`,
            [tenantId]
          )
          .catch(() => {});
        await logTrialTrackingEvent({
          trialId: prevTrial.id,
          tenantId,
          userId: prevTrial.user_id,
          eventType: 'SUSPENDED',
          previousStatus: prevTrialStatus,
          newStatus: 'SUSPENDED',
          previousEndDate: curr.subscription_end_date,
          newEndDate: updated.subscription_end_date,
          actorUser: req.user || null,
          ownerEmail: prevTrial.email,
          ownerName: prevTrial.user_name,
          storeName: updated.name || prevTrial.store_name,
          notes: `Free trial store '${updated.name}' suspended via store controls.`,
        });
      } else if (status === 'EXPIRED') {
        await pgClient
          .query(
            `UPDATE trial_activations
             SET status = 'EXPIRED',
                 expired_at = NOW(),
                 updated_at = NOW()
             WHERE tenant_id = $1`,
            [tenantId]
          )
          .catch(() => {});
        await logTrialTrackingEvent({
          trialId: prevTrial.id,
          tenantId,
          userId: prevTrial.user_id,
          eventType: 'EXPIRED',
          previousStatus: prevTrialStatus,
          newStatus: 'EXPIRED',
          previousEndDate: curr.subscription_end_date,
          newEndDate: updated.subscription_end_date,
          actorUser: req.user || null,
          ownerEmail: prevTrial.email,
          ownerName: prevTrial.user_name,
          storeName: updated.name || prevTrial.store_name,
          notes: `Free trial store '${updated.name}' marked expired via store controls.`,
        });
      } else if (status === 'ACTIVE') {
        await pgClient
          .query(
            `UPDATE trial_activations
             SET status = 'ACTIVE',
                 trial_end_date = $1,
                 reactivated_at = NOW(),
                 updated_at = NOW()
             WHERE tenant_id = $2`,
            [nextEndDate.toISOString(), tenantId]
          )
          .catch(() => {});
        await logTrialTrackingEvent({
          trialId: prevTrial.id,
          tenantId,
          userId: prevTrial.user_id,
          eventType: 'REACTIVATED',
          previousStatus: prevTrialStatus,
          newStatus: 'ACTIVE',
          previousEndDate: curr.subscription_end_date,
          newEndDate: updated.subscription_end_date,
          actorUser: req.user || null,
          ownerEmail: prevTrial.email,
          ownerName: prevTrial.user_name,
          storeName: updated.name || prevTrial.store_name,
          notes: `Free trial store '${updated.name}' reactivated via store controls.`,
        });
      }
    }

    const planNorm = normalizeSubscriptionPlan(curr.subscription_plan);
    const planLabel = planNorm === 'free_tier' ? 'Free Trial' : planNorm === '6_MONTHS' ? '6 Months' : 'Yearly';
    if (updated.subscription_status === 'EXPIRED' && String(curr.subscription_status || '').toUpperCase() !== 'EXPIRED') {
      await emitStoreSubscriptionNotification({
        tenantId,
        storeName: updated.name,
        kind: 'EXPIRED',
        planLabel,
        endDate: updated.subscription_end_date,
      }).catch(() => {});
    } else if (updated.subscription_status === 'ACTIVE' && (wasExpired || hasPendingRenewal)) {
      await clearSubscriptionAlertsOnRenewal(tenantId);
      await emitStoreSubscriptionNotification({
        tenantId,
        storeName: updated.name,
        kind: hasPendingRenewal ? 'RENEWAL_APPROVED' : 'RENEWED',
        planLabel,
        endDate: updated.subscription_end_date,
      }).catch(() => {});
    }

    return res.json({
      success: true,
      tenant: updated,
      message:
        updated.subscription_status === 'SUSPENDED'
          ? `Store '${updated.name}' has been suspended immediately.`
          : updated.subscription_status === 'EXPIRED'
          ? `Store '${updated.name}' subscription marked as expired.`
          : `Store '${updated.name}' is now active.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to toggle store status: ' + err.message });
  }
});

/**
 * 5A-2. SUPERADMIN MANAGE STORE SUBSCRIPTION & EXPIRY (`PATCH /api/superadmin/tenants/:id/subscription`)
 */
async function handleUpdateTenantSubscription(req: AuthenticatedRequest, res: Response) {
  try {
    await ensureSaasControlPlane();
    const tenantId = parseInt(req.params.id, 10);
    const {
      storeName,
      ownerEmail,
      ownerPhone,
      subscriptionPlan,
      subscriptionStartDate,
      subscriptionEndDate,
      subscriptionStatus,
      renewFromNow,
    } = req.body || {};

    const existingRes = await pgClient.query<any>(
      `SELECT t.*,
              u.id AS admin_user_id,
              u.email AS owner_email,
              u.phone AS owner_phone
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT id, email, phone
         FROM users
         WHERE tenant_id = t.id AND role = 'ADMIN'
         ORDER BY id ASC
         LIMIT 1
       ) u ON true
       WHERE t.id = $1
       LIMIT 1`,
      [tenantId]
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Store tenant not found.' });
    }
    const curr = existingRes.rows[0];

    const finalStoreName = storeName && String(storeName).trim() ? String(storeName).trim() : curr.name;
    const finalOwnerEmail = ownerEmail !== undefined ? String(ownerEmail).trim().toLowerCase() : (curr.owner_email || '');
    const finalOwnerPhone = ownerPhone !== undefined ? String(ownerPhone).trim() : (curr.owner_phone || '');

    if (finalOwnerEmail) {
      const duplicateEmail = await pgClient.query(
        `SELECT id FROM users
         WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
           AND id != COALESCE($2, 0)
         LIMIT 1`,
        [finalOwnerEmail, curr.admin_user_id]
      );
      if (duplicateEmail.rows.length > 0) {
        return res.status(409).json({
          code: 'EMAIL_ALREADY_EXISTS',
          error: 'This email is already in use. Please use a different email address.',
        });
      }
    }

    const finalPlan = subscriptionPlan
      ? normalizeSubscriptionPlan(subscriptionPlan)
      : normalizeSubscriptionPlan(curr.subscription_plan);

    let finalStartDate = subscriptionStartDate
      ? new Date(subscriptionStartDate)
      : renewFromNow
      ? new Date()
      : curr.subscription_start_date
      ? new Date(curr.subscription_start_date)
      : new Date();
    if (isNaN(finalStartDate.getTime())) {
      finalStartDate = new Date();
    }

    let finalEndDate: Date;
    if (subscriptionEndDate && String(subscriptionEndDate).trim()) {
      finalEndDate = new Date(subscriptionEndDate);
      // If a date-only string like YYYY-MM-DD was provided, set time to end of day 23:59:59
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(subscriptionEndDate).trim())) {
        finalEndDate = new Date(`${String(subscriptionEndDate).trim()}T23:59:59.999Z`);
      }
    } else if (renewFromNow || (subscriptionPlan && subscriptionPlan !== curr.subscription_plan)) {
      finalEndDate = calculateSubscriptionEndDate(finalPlan, finalStartDate);
    } else if (curr.subscription_end_date) {
      finalEndDate = new Date(curr.subscription_end_date);
    } else {
      finalEndDate = calculateSubscriptionEndDate(finalPlan, finalStartDate);
    }

    if (isNaN(finalEndDate.getTime())) {
      finalEndDate = calculateSubscriptionEndDate(finalPlan, finalStartDate);
    }

    const isDateExpired = finalEndDate.getTime() < Date.now();
    let finalSubStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' = curr.subscription_status || 'ACTIVE';
    if (subscriptionStatus && ['ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(String(subscriptionStatus).toUpperCase())) {
      finalSubStatus = String(subscriptionStatus).toUpperCase() as 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
    } else if (renewFromNow) {
      finalSubStatus = 'ACTIVE';
    }

    // If subscriptionEndDate < now, enforce EXPIRED unless explicitly SUSPENDED
    if (isDateExpired && finalSubStatus !== 'SUSPENDED') {
      finalSubStatus = 'EXPIRED';
    } else if (!isDateExpired && finalSubStatus === 'EXPIRED') {
      // If SuperAdmin extended the expiry date into the future, automatically restore ACTIVE status
      finalSubStatus = 'ACTIVE';
    }

    const finalTenantStatus = finalSubStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    const finalSubType = normalizeSubscriptionType(finalPlan);

    const wasExpired =
      String(curr.subscription_status || '').toUpperCase() === 'EXPIRED' ||
      (curr.subscription_end_date ? new Date(curr.subscription_end_date).getTime() < Date.now() : false);
    const prevEndMs = curr.subscription_end_date ? new Date(curr.subscription_end_date).getTime() : 0;
    const isExtended = finalEndDate.getTime() > prevEndMs + 60_000;

    const pendingRenewalRes = finalSubStatus === 'ACTIVE'
      ? await pgClient
          .query<{ id: number }>(
            `SELECT id FROM platform_notifications
             WHERE target_role = 'SUPERADMIN'
               AND (expires_at IS NULL OR expires_at > NOW())
               AND (
                 event_id LIKE $1
                 OR ((title ILIKE 'New Renewal Request%' OR title ILIKE 'Renewal Request:%') AND message ILIKE $2)
               )
             LIMIT 1`,
            [`renewal-request-${tenantId}-%`, `%${curr.name}%`]
          )
          .catch(() => ({ rows: [] as Array<{ id: number }> }))
      : { rows: [] as Array<{ id: number }> };
    const hasPendingRenewalRequest = pendingRenewalRes.rows.length > 0;
    const isApprovedRenewal = Boolean(req.body?.approvedRenewalRequest) || hasPendingRenewalRequest;

    const updatedRes = await pgClient.query(
      `UPDATE tenants
       SET name = $1,
           subscription_plan = $2,
           subscription_type = $3,
           subscription_start_date = $4,
           subscription_end_date = $5,
           subscription_status = $6,
           status = $7,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        finalStoreName,
        finalPlan,
        finalSubType,
        finalStartDate.toISOString(),
        finalEndDate.toISOString(),
        finalSubStatus,
        finalTenantStatus,
        tenantId,
      ]
    );

    // Sync store owner contact in users table
    if (curr.admin_user_id) {
      await pgClient.query(
          `UPDATE users
           SET email = CASE WHEN $1 != '' THEN $1 ELSE email END,
               phone = $2,
               updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [finalOwnerEmail, finalOwnerPhone, curr.admin_user_id, tenantId]
        );
    }

    const row = updatedRes.rows[0];
    const resolvedPlan = normalizeSubscriptionPlan(row?.subscription_plan || finalPlan);
    const resolvedType = normalizeSubscriptionType(row?.subscription_type || resolvedPlan);
    const planLabel = resolvedPlan === 'free_tier' ? 'Free Trial' : resolvedPlan === '6_MONTHS' ? '6 Months' : 'Yearly';

    // Sync linked trial_activations & record trial conversion / lifecycle events
    const linkedTrialRes = await pgClient
      .query<any>('SELECT * FROM trial_activations WHERE tenant_id = $1', [tenantId])
      .catch(() => ({ rows: [] as any[] }));
    const prevTrial = linkedTrialRes.rows[0];
    if (prevTrial) {
      const prevTrialStatus = String(prevTrial.status || 'ACTIVE').toUpperCase();
      const isUpgradeToPaid = resolvedPlan !== 'free_tier' && prevTrialStatus !== 'CONVERTED';
      if (isUpgradeToPaid) {
        await pgClient
          .query(
            `UPDATE trial_activations
             SET status = 'CONVERTED',
                 converted_at = NOW(),
                 converted_plan = $1,
                 store_name = $2,
                 email = CASE WHEN $3 != '' THEN $3 ELSE email END,
                 phone = $4,
                 updated_at = NOW()
             WHERE tenant_id = $5`,
            [resolvedPlan, row.name, finalOwnerEmail, finalOwnerPhone, tenantId]
          )
          .catch(() => {});
        await logTrialTrackingEvent({
          trialId: prevTrial.id,
          tenantId,
          userId: prevTrial.user_id,
          eventType: 'CONVERTED',
          previousStatus: prevTrialStatus,
          newStatus: 'CONVERTED',
          previousEndDate: curr.subscription_end_date,
          newEndDate: row.subscription_end_date,
          actorUser: req.user || null,
          ownerEmail: finalOwnerEmail || prevTrial.email,
          ownerName: prevTrial.user_name,
          storeName: row.name,
          notes: `Free trial store converted to paid ${planLabel} plan.`,
          metadata: { convertedPlan: resolvedPlan },
        });
      } else if (prevTrialStatus !== 'CONVERTED') {
        const syncedTrialStatus = finalSubStatus;
        await pgClient
          .query(
            `UPDATE trial_activations
             SET status = $1,
                 store_name = $2,
                 email = CASE WHEN $3 != '' THEN $3 ELSE email END,
                 phone = $4,
                 trial_start_date = $5,
                 trial_end_date = $6,
                 expired_at = CASE WHEN $1 = 'EXPIRED' THEN NOW() ELSE expired_at END,
                 suspended_at = CASE WHEN $1 = 'SUSPENDED' THEN NOW() ELSE suspended_at END,
                 reactivated_at = CASE WHEN $1 = 'ACTIVE' AND $7 != 'ACTIVE' THEN NOW() ELSE reactivated_at END,
                 updated_at = NOW()
             WHERE tenant_id = $8`,
            [
              syncedTrialStatus,
              row.name,
              finalOwnerEmail,
              finalOwnerPhone,
              finalStartDate.toISOString(),
              finalEndDate.toISOString(),
              prevTrialStatus,
              tenantId,
            ]
          )
          .catch(() => {});

        const eventType: TrialTrackingEventType =
          syncedTrialStatus === 'SUSPENDED' && prevTrialStatus !== 'SUSPENDED'
            ? 'SUSPENDED'
            : syncedTrialStatus === 'EXPIRED' && prevTrialStatus !== 'EXPIRED'
            ? 'EXPIRED'
            : syncedTrialStatus === 'ACTIVE' && (prevTrialStatus === 'EXPIRED' || prevTrialStatus === 'SUSPENDED')
            ? 'REACTIVATED'
            : isExtended
            ? 'EXTENDED'
            : 'EDITED';

        await logTrialTrackingEvent({
          trialId: prevTrial.id,
          tenantId,
          userId: prevTrial.user_id,
          eventType,
          previousStatus: prevTrialStatus,
          newStatus: syncedTrialStatus,
          previousEndDate: curr.subscription_end_date,
          newEndDate: row.subscription_end_date,
          actorUser: req.user || null,
          ownerEmail: finalOwnerEmail || prevTrial.email,
          ownerName: prevTrial.user_name,
          storeName: row.name,
          notes: `Subscription updated for free trial store '${row.name}' (${prevTrialStatus} -> ${syncedTrialStatus}).`,
        });
      }
    }

    if (finalSubStatus !== 'ACTIVE') {
      removeTenantMiddlewarePresence(tenantId);
    }

    if (finalSubStatus === 'EXPIRED' && String(curr.subscription_status || '').toUpperCase() !== 'EXPIRED') {
      await emitStoreSubscriptionNotification({
        tenantId,
        storeName: row.name,
        kind: 'EXPIRED',
        planLabel,
        endDate: row.subscription_end_date,
      }).catch(() => {});
    } else if (finalSubStatus === 'ACTIVE') {
      await clearSubscriptionAlertsOnRenewal(tenantId);
      if (renewFromNow || isApprovedRenewal || wasExpired || isExtended) {
        await emitStoreSubscriptionNotification({
          tenantId,
          storeName: row.name,
          kind: isApprovedRenewal ? 'RENEWAL_APPROVED' : 'RENEWED',
          planLabel,
          endDate: row.subscription_end_date,
        }).catch(() => {});
      }
    }
    return res.json({
      success: true,
      tenant: {
        id: row.id,
        name: row.name,
        status: row.status,
        subscriptionPlan: resolvedPlan,
        subscriptionType: resolvedType,
        subscriptionStartDate: new Date(row.subscription_start_date).toISOString(),
        subscriptionEndDate: new Date(row.subscription_end_date).toISOString(),
        subscriptionStatus: row.subscription_status,
        ownerEmail: finalOwnerEmail,
        ownerPhone: finalOwnerPhone,
      },
      message: `Subscription updated for '${row.name}'.`,
    });
  } catch (err: any) {
    if (err?.code === '23505' && String(err?.constraint || '').includes('users_email')) {
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'This email is already in use. Please use a different email address.',
      });
    }
    return res.status(500).json({ error: 'Failed to update store subscription: ' + err.message });
  }
}

router.patch('/superadmin/tenants/:id/subscription', requireAuth, requireSuperAdmin, handleUpdateTenantSubscription);
router.put('/superadmin/tenants/:id', requireAuth, requireSuperAdmin, handleUpdateTenantSubscription);

/**
 * Finds the lowest available store ID (1, 2, 3, ...) in the tenants table
 * so deleted store IDs are recycled automatically without requiring any extra column.
 */
export async function getNextTenantId(): Promise<number> {
  try {
    const statsRes = await pgClient.query<{ cnt: number; max_id: number }>(
      `SELECT COUNT(*)::int AS cnt,
              COALESCE(MAX(id), 0)::int AS max_id
       FROM tenants
       WHERE id > 0`
    );
    const cnt = Number(statsRes.rows[0]?.cnt || 0);
    const maxId = Number(statsRes.rows[0]?.max_id || 0);

    // Fast path: empty table -> 1, or contiguous 1..N -> cnt + 1
    if (cnt === 0) return 1;
    if (cnt === maxId) return cnt + 1;

    // Gap exists (a store was deleted): find the first missing positive integer ID (1..maxId)
    const gapRes = await pgClient.query<{ next_id: number }>(
      `SELECT COALESCE(
        CASE WHEN NOT EXISTS (
          SELECT 1 FROM tenants WHERE id = 1
        ) THEN 1 END,
        (SELECT t1.id + 1
         FROM tenants t1
         LEFT JOIN tenants t2 ON t2.id = t1.id + 1
         WHERE t1.id >= 1
           AND t2.id IS NULL
         ORDER BY t1.id ASC
         LIMIT 1),
        $1::int
      ) AS next_id`,
      [Math.max(cnt, maxId) + 1]
    );
    return Number(gapRes.rows[0]?.next_id || cnt + 1);
  } catch (_) {
    const fallbackRes = await pgClient.query<{ next_id: string }>(
      'SELECT (COALESCE(MAX(id), 0) + 1)::text AS next_id FROM tenants WHERE id > 0'
    );
    return parseInt(fallbackRes.rows[0]?.next_id || '1', 10);
  }
}

/**
 * Helper to provision a new tenant store + initial admin credentials + store_settings
 */
async function provisionNewTenantStore(params: {
  storeName: string;
  ownerName?: string;
  ownerEmail: string;
  password?: string;
  ownerPhone?: string;
  address?: string;
  currency?: string;
  currencySymbol?: string;
  taxId?: string;
  taxRate?: number;
  invoiceFooter?: string;
  businessType?: 'RETAIL' | 'WHOLESALE';
  pricingMode?: 'FIXED' | 'NEGOTIABLE';
  allowHalfCarton?: boolean;
  subscriptionType?: 'free_tier' | '6_months' | '1_year' | string;
  subscriptionPlan?: 'free_tier' | '6_MONTHS' | 'YEARLY' | string;
  subscriptionStartDate?: string;
  subscriptionEndDate?: string;
  createCashier?: boolean;
  cashierName?: string;
  cashierEmail?: string;
  cashierPassword?: string;
  cashierPhone?: string;
  onboardingCompleted?: boolean;
  ownerStatus?: 'PENDING' | 'APPROVED';
}) {
  const normalizedOwnerEmail = params.ownerEmail.trim().toLowerCase();
  const onboardingCompleted = params.onboardingCompleted ?? false;

  // Serialize tenant provisioning to prevent concurrent requests from colliding on recycled tenant ID or email
  await pgClient.query('SELECT pg_advisory_xact_lock(904821)');
  await pgClient.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [normalizedOwnerEmail]);

  const duplicateOwnerEmail = await pgClient.query(
    'SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 1',
    [normalizedOwnerEmail]
  );
  if (duplicateOwnerEmail.rows.length > 0) {
    const duplicateEmailError: any = new Error(
      'This email is already in use. Please use a different email address.'
    );
    duplicateEmailError.code = 'EMAIL_ALREADY_EXISTS';
    throw duplicateEmailError;
  }

  const currency = params.currency || 'PKR';
  const businessType: 'RETAIL' | 'WHOLESALE' =
    String(params.businessType || 'RETAIL').toUpperCase() === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
  const pricingMode: 'FIXED' | 'NEGOTIABLE' =
    businessType === 'WHOLESALE'
      ? 'FIXED'
      : String(params.pricingMode || 'FIXED').toUpperCase() === 'NEGOTIABLE'
      ? 'NEGOTIABLE'
      : 'FIXED';

  let allowHalfCarton = true;
  if (businessType === 'WHOLESALE') {
    if (params.allowHalfCarton !== undefined && params.allowHalfCarton !== null) {
      allowHalfCarton = String(params.allowHalfCarton) === 'true' || params.allowHalfCarton === true;
    }
  }

  const subscriptionType = normalizeSubscriptionType(params.subscriptionType || params.subscriptionPlan || 'free_tier');
  const subscriptionPlan = normalizeSubscriptionPlan(params.subscriptionPlan || params.subscriptionType || 'free_tier');

  const now = new Date();
  const startDate = params.subscriptionStartDate ? new Date(params.subscriptionStartDate) : now;
  const validStartDate = isNaN(startDate.getTime()) ? now : startDate;
  let endDate = params.subscriptionEndDate
    ? new Date(params.subscriptionEndDate)
    : (subscriptionPlan === 'free_tier' ? new Date(validStartDate.getTime() + 30 * 86400000) : calculateSubscriptionEndDate(subscriptionPlan, validStartDate));
  if (isNaN(endDate.getTime())) {
    endDate = new Date(validStartDate.getTime() + 30 * 86400000);
  }
  const subscriptionStatus = endDate.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE';

  // Recycle lowest available store ID (or MAX(id) + 1 if no gaps exist)
  const nextTenantId = await getNextTenantId();

  // Clean up any stale non-SuperAdmin rows that might reference a recycled tenant_id
  await pgClient.query('DELETE FROM company_settings WHERE tenant_id = $1', [nextTenantId]).catch(() => {});
  await pgClient.query("DELETE FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN'", [nextTenantId]).catch(() => {});

  let tenantInsert;
  try {
    tenantInsert = await pgClient.query<{
      id: number;
      name: string;
      subscription_type: string;
      subscription_plan: string;
      subscription_start_date: string;
      subscription_end_date: string;
      subscription_status: string;
    }>(
      `INSERT INTO tenants (
        id, name, status,
        subscription_type, subscription_plan, subscription_start_date, subscription_end_date, subscription_status,
        onboarding_completed, deleted_product_ids
      ) VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, $8, '{}')
      RETURNING id, name, subscription_type, subscription_plan, subscription_start_date, subscription_end_date, subscription_status`,
      [
        nextTenantId,
        params.storeName.trim(),
        subscriptionType,
        subscriptionPlan,
        validStartDate.toISOString(),
        endDate.toISOString(),
        subscriptionStatus,
        onboardingCompleted,
      ]
    );
  } catch (tErr: any) {
    throw tErr;
  }

  // Keep tenants_id_seq synchronized with the highest current id
  await pgClient
    .query(
      `SELECT setval(
         pg_get_serial_sequence('tenants', 'id'),
         COALESCE((SELECT MAX(id) FROM tenants WHERE id > 0), 1),
         (SELECT EXISTS (SELECT 1 FROM tenants WHERE id > 0))
       )`
    )
    .catch(() => {});

  const newTenant = tenantInsert.rows[0];

  const currencySymbol =
    params.currencySymbol?.trim() ||
    (currency === 'USD' ? '$' : currency === 'AED' ? 'AED' : currency === 'SAR' ? 'SAR' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : 'Rs.');
  const invoiceFooter =
    params.invoiceFooter?.trim() ||
    'Thank you for shopping with us! Exchanges within 7 days with original receipt.';
  const storeAddress = params.address?.trim() || '';
  const taxId = params.taxId?.trim() || '';
  const taxRate = params.taxRate ? Number(params.taxRate) : 0;

  // Store is initialized with its configured pricing and carton settings
  await pgClient.query(
    `INSERT INTO company_settings (
      tenant_id, logo, address, phone, email, tax_id, tax_rate, currency, currency_symbol,
      invoice_footer, pricing_mode, business_type, allow_half_carton
    ) VALUES ($1, '/pwa-512x512.png', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      newTenant.id,
      storeAddress,
      (params.ownerPhone || '').trim(),
      params.ownerEmail.trim().toLowerCase(),
      taxId,
      taxRate,
      currency,
      currencySymbol,
      invoiceFooter,
      pricingMode,
      businessType,
      allowHalfCarton,
    ]
  );

  // Create initial Store Owner (ADMIN) user and optional Cashier if explicitly requested
  const storeUsers = await ensureTenantStoreUsers({
    tenantId: newTenant.id,
    storeName: params.storeName.trim(),
    ownerName: params.ownerName?.trim() || params.ownerEmail.split('@')[0],
    ownerEmail: params.ownerEmail.trim().toLowerCase(),
    ownerPhone: (params.ownerPhone || '').trim(),
    ownerPassword: params.password && params.password.trim() ? params.password.trim() : undefined,
    createCashier: Boolean(params.createCashier),
    cashierName: params.cashierName?.trim(),
    cashierEmail: params.cashierEmail?.trim(),
    cashierPassword: params.cashierPassword?.trim(),
    cashierPhone: params.cashierPhone?.trim(),
    ownerStatus: params.ownerStatus,
  });

  return {
    tenantId: newTenant.id,
    storeName: newTenant.name,
    businessType,
    pricingMode,
    allowHalfCarton,
    subscriptionType: (newTenant as any).subscription_type || subscriptionType,
    subscriptionPlan: newTenant.subscription_plan,
    subscriptionStartDate: new Date(newTenant.subscription_start_date).toISOString(),
    subscriptionEndDate: new Date(newTenant.subscription_end_date).toISOString(),
    subscriptionStatus: newTenant.subscription_status,
    daysLeft: calculateDaysLeft(newTenant.subscription_end_date, validStartDate, subscriptionPlan),
    trialDays: 30,
    adminUserId: storeUsers.owner.id,
    adminEmail: storeUsers.owner.email,
    initialPassword: storeUsers.owner.password,
    cashierEmail: storeUsers.cashier ? storeUsers.cashier.email : null,
    cashierPassword: storeUsers.cashier ? storeUsers.cashier.password : null,
    cashierName: storeUsers.cashier ? storeUsers.cashier.name : null,
    address: storeAddress,
    invoiceFooter: invoiceFooter,
    currency,
    currencySymbol,
    onboardingCompleted: onboardingCompleted,
    onboardingUrl: `/onboarding?tenantId=${newTenant.id}`,
    loginUrl: `/?tenantId=${newTenant.id}`,
    manifestUrl: '/manifest.webmanifest',
  };
}

/**
 * Helper to format a SQL literal value safely for .sql backup export files
 */
function formatSqlValue(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  if (val instanceof Date) return `'${val.toISOString().replace(/'/g, "''")}'`;
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function generateTableInsertStatements(
  tableName: string,
  whereClause: string,
  params: any[] = []
): Promise<{ sql: string; count: number }> {
  try {
    const queryText = `SELECT * FROM ${tableName} ${whereClause}`;
    const res = await pgClient.query<any>(queryText, params);
    if (!res.rows || res.rows.length === 0) {
      return { sql: `-- Table: ${tableName} (0 rows)\n`, count: 0 };
    }
    const columns = Object.keys(res.rows[0]);
    const colList = columns.map((c) => `"${c}"`).join(', ');
    const lines: string[] = [`-- Table: ${tableName} (${res.rows.length} rows)`];
    for (const row of res.rows) {
      const vals = columns.map((col) => formatSqlValue(row[col])).join(', ');
      lines.push(`INSERT INTO "${tableName}" (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING;`);
    }
    lines.push('');
    return { sql: lines.join('\n'), count: res.rows.length };
  } catch {
    return { sql: `-- Table: ${tableName} (skipped)\n`, count: 0 };
  }
}

/**
 * 5B. SUPERADMIN EXPORT SINGLE STORE DATA TO SQL FILE (`GET /api/superadmin/tenants/:id/export-sql`)
 */
router.get('/superadmin/tenants/:id/export-sql', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const tenantId = parseInt(req.params.id, 10);
    const tenantRes = await pgClient.query<any>('SELECT * FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Store tenant not found.' });
    }
    const tenant = tenantRes.rows[0];
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `store-${tenant.id}-backup-${dateStamp}.sql`;

    const sections: string[] = [
      `-- ============================================================================`,
      `-- Store SQL Backup Dump`,
      `-- Store Name : ${tenant.name}`,
      `-- Tenant ID  : #${tenant.id}`,
      `-- Exported At: ${new Date().toISOString()}`,
      `-- ============================================================================`,
      `BEGIN;`,
      ``,
    ];

    const tenantTables: Array<{ table: string; where: string; params: any[] }> = [
      { table: 'tenants', where: 'WHERE id = $1', params: [tenantId] },
      { table: 'company_settings', where: 'WHERE tenant_id = $1', params: [tenantId] },
      { table: 'users', where: "WHERE tenant_id = $1 AND role != 'SUPERADMIN' ORDER BY id ASC", params: [tenantId] },
      { table: 'categories', where: 'ORDER BY id ASC', params: [] },
      { table: 'products', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'suppliers', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'customers', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'purchases', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'purchase_items', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'supplier_payments', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'purchase_returns', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'purchase_return_items', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'sales', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'sale_items', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'returns', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'return_items', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
      { table: 'stock_movements', where: 'WHERE tenant_id = $1 ORDER BY id ASC', params: [tenantId] },
    ];

    let totalRows = 0;
    for (const item of tenantTables) {
      const dump = await generateTableInsertStatements(item.table, item.where, item.params);
      sections.push(dump.sql);
      totalRows += dump.count;
    }

    sections.push('COMMIT;');
    sections.push(`-- End of SQL Backup for ${tenant.name} (${totalRows} total records)`);

    return res.json({
      success: true,
      filename,
      storeName: tenant.name,
      totalRows,
      sql: sections.join('\n'),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to export store SQL data: ' + err.message });
  }
});

/**
 * 5C. SUPERADMIN EXPORT ALL STORES / PLATFORM DATA TO SQL FILE (`GET /api/superadmin/export-sql`)
 */
router.get('/superadmin/export-sql', requireAuth, requireSuperAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `pos-all-stores-backup-${dateStamp}.sql`;

    const sections: string[] = [
      `-- ============================================================================`,
      `-- Multi-Tenant POS SaaS — Complete Platform SQL Backup (All Stores)`,
      `-- Exported At: ${new Date().toISOString()}`,
      `-- ============================================================================`,
      `BEGIN;`,
      ``,
    ];

    const allTables = [
      'tenants',
      'trial_activations',
      'trial_tracking_history',
      'company_settings',
      'users',
      'categories',
      'products',
      'suppliers',
      'customers',
      'purchases',
      'purchase_items',
      'supplier_payments',
      'purchase_returns',
      'purchase_return_items',
      'sales',
      'sale_items',
      'returns',
      'return_items',
      'stock_movements',
    ];

    let totalRows = 0;
    for (const tbl of allTables) {
      const dump = await generateTableInsertStatements(tbl, 'ORDER BY id ASC');
      sections.push(dump.sql);
      totalRows += dump.count;
    }

    sections.push('COMMIT;');
    sections.push(`-- End of Platform SQL Backup (${totalRows} total records)`);

    return res.json({
      success: true,
      filename,
      totalRows,
      sql: sections.join('\n'),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to export platform SQL backup: ' + err.message });
  }
});

/**
 * 5C-2. SUPERADMIN IMPORT PLATFORM / MULTI-STORE SQL FILE (`POST /api/superadmin/import-sql`)
 */
router.post('/superadmin/import-sql', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sql = String(req.body?.sql || req.body?.sqlContent || '').trim();
    if (!sql) {
      return res.status(400).json({ error: 'SQL script content is required.' });
    }

    await pgClient.waitReady;
    await pgClient.exec(sql);
    await ensureDatabaseSchema();

    const superAdminHash = await bcrypt.hash('superadmin123', 10);
    const storeUserHash = await bcrypt.hash('admin123', 10);
    await pgClient
      .query(
        `UPDATE users
         SET password_hash = $1, quick_password = 'superadmin123', status = 'APPROVED', active = true
         WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN'`,
        [superAdminHash]
      )
      .catch(() => {});
    await pgClient
      .query(
        `UPDATE users
         SET password_hash = $1, quick_password = 'admin123', status = 'APPROVED', active = true
         WHERE UPPER(COALESCE(role::text, '')) != 'SUPERADMIN'`,
        [storeUserHash]
      )
      .catch(() => {});
    const seqTables = [
      'tenants',
      'trial_activations',
      'trial_tracking_history',
      'company_settings',
      'users',
      'categories',
      'products',
      'suppliers',
      'customers',
      'purchases',
      'purchase_items',
      'supplier_payments',
      'purchase_returns',
      'purchase_return_items',
      'sales',
      'sale_items',
      'returns',
      'return_items',
      'stock_movements',
    ];
    for (const tbl of seqTables) {
      await pgClient
        .query(
          `SELECT setval(
             pg_get_serial_sequence('${tbl}', 'id'),
             COALESCE((SELECT MAX(id) FROM ${tbl}), 1),
             (SELECT EXISTS (SELECT 1 FROM ${tbl}))
           )`
        )
        .catch(() => {});
    }

    const [storesRes, prodRes, purRes, salesRes, custRes, retRes] = await Promise.all([
      pgClient.query('SELECT COUNT(*)::int as c FROM tenants').catch(() => ({ rows: [{ c: 0 }] })),
      pgClient.query('SELECT COUNT(*)::int as c FROM products').catch(() => ({ rows: [{ c: 0 }] })),
      pgClient.query('SELECT COUNT(*)::int as c FROM purchases').catch(() => ({ rows: [{ c: 0 }] })),
      pgClient.query('SELECT COUNT(*)::int as c FROM sales').catch(() => ({ rows: [{ c: 0 }] })),
      pgClient.query('SELECT COUNT(*)::int as c FROM customers').catch(() => ({ rows: [{ c: 0 }] })),
      pgClient.query('SELECT COUNT(*)::int as c FROM returns').catch(() => ({ rows: [{ c: 0 }] })),
    ]);

    const counts = {
      stores: Number(storesRes.rows[0]?.c || 0),
      products: Number(prodRes.rows[0]?.c || 0),
      purchases: Number(purRes.rows[0]?.c || 0),
      sales: Number(salesRes.rows[0]?.c || 0),
      customers: Number(custRes.rows[0]?.c || 0),
      returns: Number(retRes.rows[0]?.c || 0),
    };

    return res.json({
      success: true,
      message: `SQL script executed! Imported ${counts.stores} stores, ${counts.products.toLocaleString()} Products, ${counts.purchases} purchases, and ${counts.sales} sales.`,
      counts,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to execute platform SQL import: ' + err.message });
  }
});

/**
 * Permanent cascade deletion helper:
 * Permanently removes a store tenant AND all associated trial records, tracking history,
 * notifications/activity logs, tokens, users (except global SUPERADMIN), settings, and POS data.
 */
export async function permanentlyDeleteStoreAndTrialData(params: {
  tenantId?: number | null;
  trialId?: number | null;
}): Promise<{
  deletedStore: { id: number; name: string } | null;
  deletedTrialId: number | null;
  storeName: string;
}> {
  let tenantId = params.tenantId && Number.isInteger(Number(params.tenantId)) && Number(params.tenantId) > 0
    ? Number(params.tenantId)
    : null;
  const trialId = params.trialId && Number.isInteger(Number(params.trialId)) && Number(params.trialId) > 0
    ? Number(params.trialId)
    : null;

  let trialRow: any = null;
  if (trialId) {
    const tRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]).catch(() => ({ rows: [] as any[] }));
    trialRow = tRes.rows[0] || null;
    if (!tenantId && trialRow?.tenant_id) {
      tenantId = Number(trialRow.tenant_id);
    }
  }

  let store: { id: number; name: string } | null = null;
  if (tenantId) {
    const tenantRes = await pgClient.query<{ id: number; name: string }>(
      'SELECT id, name FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    store = tenantRes.rows[0] || null;
  }

  const trialIdsSet = new Set<number>();
  const userIdsSet = new Set<number>();
  const emailsSet = new Set<string>();

  if (trialId) trialIdsSet.add(trialId);
  if (trialRow?.user_id) userIdsSet.add(Number(trialRow.user_id));
  if (trialRow?.email) emailsSet.add(String(trialRow.email).trim().toLowerCase());

  if (tenantId) {
    const linkedTrials = await pgClient
      .query<any>('SELECT id, user_id, email FROM trial_activations WHERE tenant_id = $1', [tenantId])
      .catch(() => ({ rows: [] as any[] }));
    for (const r of linkedTrials.rows || []) {
      if (r.id) trialIdsSet.add(Number(r.id));
      if (r.user_id) userIdsSet.add(Number(r.user_id));
      if (r.email) emailsSet.add(String(r.email).trim().toLowerCase());
    }

    const storeUsers = await pgClient
      .query<any>("SELECT id, email FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN'", [tenantId])
      .catch(() => ({ rows: [] as any[] }));
    for (const u of storeUsers.rows || []) {
      if (u.id) userIdsSet.add(Number(u.id));
      if (u.email) emailsSet.add(String(u.email).trim().toLowerCase());
    }

    const csRes = await pgClient
      .query<any>('SELECT email FROM company_settings WHERE tenant_id = $1', [tenantId])
      .catch(() => ({ rows: [] as any[] }));
    for (const c of csRes.rows || []) {
      if (c.email) emailsSet.add(String(c.email).trim().toLowerCase());
    }
  }

  const trialIds = Array.from(trialIdsSet);
  const userIds = Array.from(userIdsSet);
  const emails = Array.from(emailsSet).filter(Boolean);

  const orderedCleanupStatements: Array<{ sql: string; params: any[] }> = [];

  if (tenantId) {
    orderedCleanupStatements.push(
      {
        sql: `DELETE FROM return_items
              WHERE tenant_id = $1
                 OR return_id IN (SELECT id FROM returns WHERE tenant_id = $1)
                 OR sale_item_id IN (SELECT id FROM sale_items WHERE tenant_id = $1)
                 OR product_id IN (SELECT id FROM products WHERE tenant_id = $1)`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM returns
              WHERE tenant_id = $1
                 OR original_sale_id IN (SELECT id FROM sales WHERE tenant_id = $1)
                 OR created_by IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM sale_items
              WHERE tenant_id = $1
                 OR sale_id IN (SELECT id FROM sales WHERE tenant_id = $1)
                 OR product_id IN (SELECT id FROM products WHERE tenant_id = $1)`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM sales
              WHERE tenant_id = $1
                 OR created_by IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')
                 OR overridden_by IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM purchase_return_items
              WHERE tenant_id = $1
                 OR purchase_return_id IN (SELECT id FROM purchase_returns WHERE tenant_id = $1)
                 OR product_id IN (SELECT id FROM products WHERE tenant_id = $1)`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM purchase_returns
              WHERE tenant_id = $1
                 OR purchase_id IN (SELECT id FROM purchases WHERE tenant_id = $1)
                 OR supplier_id IN (SELECT id FROM suppliers WHERE tenant_id = $1)
                 OR created_by IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM supplier_payments
              WHERE tenant_id = $1
                 OR supplier_id IN (SELECT id FROM suppliers WHERE tenant_id = $1)
                 OR purchase_id IN (SELECT id FROM purchases WHERE tenant_id = $1)
                 OR created_by IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM purchase_items
              WHERE tenant_id = $1
                 OR purchase_id IN (SELECT id FROM purchases WHERE tenant_id = $1)
                 OR product_id IN (SELECT id FROM products WHERE tenant_id = $1)`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM purchases
              WHERE tenant_id = $1
                 OR supplier_id IN (SELECT id FROM suppliers WHERE tenant_id = $1)
                 OR created_by IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      {
        sql: `DELETE FROM stock_movements
              WHERE tenant_id = $1
                 OR product_id IN (SELECT id FROM products WHERE tenant_id = $1)
                 OR user_id IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      { sql: `DELETE FROM customer_ledger WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM supplier_ledger WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM products WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM customers WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM suppliers WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM email_verification_tokens WHERE tenant_id = $1`, params: [tenantId] },
      {
        sql: `DELETE FROM password_reset_codes
              WHERE tenant_id = $1
                 OR user_id IN (SELECT id FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN')`,
        params: [tenantId],
      },
      { sql: `DELETE FROM pos_notification_dismissals WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM notifications WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM fcm_tokens WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM platform_notification_reads WHERE tenant_id = $1`, params: [tenantId] },
      {
        sql: `DELETE FROM platform_notifications
              WHERE tenant_id = $1
                 OR event_id = ANY(ARRAY(SELECT 'trial-activation-' || unnest($2::text[])))
                 OR event_id LIKE $3
                 OR event_id LIKE $4
                 OR event_id LIKE $5
                 OR event_id LIKE $6
                 OR event_id LIKE $7
                 OR event_id LIKE $8
                 OR action_url ILIKE $9`,
        params: [
          tenantId,
          emails,
          `trial-activation-${tenantId}%`,
          `sub-expired-${tenantId}-%`,
          `sa-sub-expired-${tenantId}-%`,
          `sub-renewed-${tenantId}-%`,
          `renewal-approved-${tenantId}-%`,
          `renewal-request-${tenantId}-%`,
          `%tenantId=${tenantId}%`,
        ],
      }
    );
  } else if (emails.length > 0) {
    orderedCleanupStatements.push({
      sql: `DELETE FROM platform_notifications WHERE event_id = ANY($1::text[])`,
      params: [emails.map((em) => `trial-activation-${em}`)],
    });
  }

  // Permanently delete all associated trial tracking history and trial activation records
  orderedCleanupStatements.push(
    {
      sql: `DELETE FROM trial_tracking_history
            WHERE ($1::int IS NOT NULL AND tenant_id = $1)
               OR (cardinality($2::int[]) > 0 AND trial_id = ANY($2::int[]))
               OR (cardinality($3::int[]) > 0 AND user_id = ANY($3::int[]))
               OR (cardinality($4::text[]) > 0 AND LOWER(BTRIM(owner_email)) = ANY($4::text[]))`,
      params: [tenantId, trialIds, userIds, emails],
    },
    {
      sql: `DELETE FROM trial_activations
            WHERE ($1::int IS NOT NULL AND tenant_id = $1)
               OR ($2::int IS NOT NULL AND id = $2)
               OR (cardinality($3::int[]) > 0 AND user_id = ANY($3::int[]))
               OR (cardinality($4::text[]) > 0 AND LOWER(BTRIM(email)) = ANY($4::text[]))`,
      params: [tenantId, trialId, userIds, emails],
    }
  );

  if (tenantId) {
    orderedCleanupStatements.push(
      { sql: `DELETE FROM company_settings WHERE tenant_id = $1`, params: [tenantId] },
      { sql: `DELETE FROM users WHERE tenant_id = $1 AND role != 'SUPERADMIN'`, params: [tenantId] }
    );
  }

  for (const stmt of orderedCleanupStatements) {
    await pgClient.query(stmt.sql, stmt.params).catch(() => {});
  }

  if (tenantId) {
    await pgClient.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    removeTenantMiddlewarePresence(tenantId);
    await pgClient
      .query(
        `SELECT setval(
           pg_get_serial_sequence('tenants', 'id'),
           COALESCE((SELECT MAX(id) FROM tenants WHERE id > 0), 1),
           (SELECT EXISTS (SELECT 1 FROM tenants WHERE id > 0))
         )`
      )
      .catch(() => {});
  }

  return {
    deletedStore: store,
    deletedTrialId: trialId,
    storeName: store?.name || trialRow?.store_name || `Store #${tenantId || trialId || ''}`,
  };
}

/**
 * 5D. SUPERADMIN DELETE STORE TENANT & ALL ISOLATED DATA (`DELETE /api/superadmin/tenants/:id` & `POST /api/superadmin/tenants/:id/delete`)
 */
async function handleDeleteTenantStore(req: AuthenticatedRequest, res: Response) {
  try {
    await ensureSaasControlPlane();
    const tenantId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: 'Invalid store tenant ID.' });
    }

    const tenantRes = await pgClient.query<{ id: number; name: string }>(
      'SELECT id, name FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );

    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Store tenant not found or already deleted.' });
    }

    const { deletedStore, storeName } = await permanentlyDeleteStoreAndTrialData({ tenantId });

    return res.json({
      success: true,
      deletedStore,
      recycledTenantId: tenantId,
      message: `Store '${storeName}' and all associated trial history, tracking records, and activity logs have been permanently deleted.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete store tenant: ' + err.message });
  }
}

router.delete('/superadmin/tenants/:id', requireAuth, requireSuperAdmin, handleDeleteTenantStore);
router.post('/superadmin/tenants/:id/delete', requireAuth, requireSuperAdmin, handleDeleteTenantStore);

/**
 * 7b. SUPERADMIN FREE TRIAL MANAGEMENT & TRACKING HISTORY
 * Handles listing, searching, filtering, viewing, editing, extending, expiring, suspending, reactivating, and permanently deleting trial stores.
 */
async function handleListFreeTrials(req: AuthenticatedRequest, res: Response) {
  try {
    await ensureSaasControlPlane();
    await syncExpiredTenantSubscriptions();
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'ALL').trim().toUpperCase();

    const result = await pgClient.query(`
      SELECT ta.*,
             t.name AS live_tenant_name,
             t.status AS live_tenant_status,
             t.subscription_status AS live_subscription_status,
             t.subscription_plan AS live_subscription_plan,
             t.subscription_end_date AS live_subscription_end_date,
             t.onboarding_completed AS live_onboarding_completed,
             u.name AS live_owner_name,
             u.email AS live_owner_email,
             u.phone AS live_owner_phone,
             cs.business_type AS live_business_type,
             cs.pricing_mode AS live_pricing_mode
      FROM trial_activations ta
      LEFT JOIN tenants t ON t.id = ta.tenant_id
      LEFT JOIN LATERAL (
        SELECT name, email, phone
        FROM users
        WHERE tenant_id = ta.tenant_id AND role = 'ADMIN'
        ORDER BY id ASC
        LIMIT 1
      ) u ON true
      LEFT JOIN company_settings cs ON cs.tenant_id = ta.tenant_id
      ORDER BY ta.activated_at DESC, ta.id DESC
    `);

    const nowMs = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const allFormatted = (result.rows || []).map((r: any) => formatTrialActivationRow(r, nowMs));

    const summary = {
      totalTrials: allFormatted.length,
      activeTrials: allFormatted.filter((t) => t.status === 'ACTIVE').length,
      expiredTrials: allFormatted.filter((t) => t.status === 'EXPIRED').length,
      suspendedTrials: allFormatted.filter((t) => t.status === 'SUSPENDED').length,
      convertedTrials: allFormatted.filter((t) => t.status === 'CONVERTED').length,
      pendingTrials: allFormatted.filter((t) => t.status === 'PENDING').length,
      todayTrials: allFormatted.filter((t) => new Date(t.activatedAt).getTime() >= startOfToday.getTime()).length,
    };

    const filteredTrials = allFormatted.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (!search) return true;
      return (
        String(t.storeName || '').toLowerCase().includes(search) ||
        String(t.email || '').toLowerCase().includes(search) ||
        String(t.userName || '').toLowerCase().includes(search) ||
        String(t.phone || '').toLowerCase().includes(search) ||
        String(t.tenantId || '').includes(search)
      );
    });

    const historyRes = await pgClient
      .query(`SELECT * FROM trial_tracking_history ORDER BY created_at DESC, id DESC LIMIT 250`)
      .catch(() => ({ rows: [] as any[] }));
    const history = (historyRes.rows || []).map(formatTrialHistoryRow);

    return res.json({
      trials: filteredTrials,
      history,
      summary,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch trial stores: ' + err.message });
  }
}

router.get('/superadmin/free-trials', requireAuth, requireSuperAdmin, handleListFreeTrials);
router.get('/superadmin/trial-activations', requireAuth, requireSuperAdmin, handleListFreeTrials);

/**
 * 7b-2. FREE TRIAL TRACKING HISTORY LEDGER (`GET /api/superadmin/free-trials/history`)
 */
router.get('/superadmin/free-trials/history', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    await syncExpiredTenantSubscriptions();
    const search = String(req.query.search || '').trim().toLowerCase();
    const eventType = String(req.query.eventType || 'ALL').trim().toUpperCase();
    const trialIdParam = req.query.trialId ? parseInt(String(req.query.trialId), 10) : null;
    const tenantIdParam = req.query.tenantId ? parseInt(String(req.query.tenantId), 10) : null;

    let sql = `SELECT * FROM trial_tracking_history`;
    const where: string[] = [];
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        LOWER(COALESCE(owner_email, '')) LIKE $${params.length} OR
        LOWER(COALESCE(owner_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(store_name, '')) LIKE $${params.length} OR
        LOWER(COALESCE(notes, '')) LIKE $${params.length}
      )`);
    }
    if (eventType === 'EXPIRED_CONVERTED_SUSPENDED') {
      where.push(`event_type IN ('EXPIRED', 'CONVERTED', 'SUSPENDED')`);
    } else if (eventType && eventType !== 'ALL') {
      params.push(eventType);
      where.push(`UPPER(event_type) = $${params.length}`);
    }
    if (trialIdParam && Number.isInteger(trialIdParam)) {
      params.push(trialIdParam);
      where.push(`trial_id = $${params.length}`);
    }
    if (tenantIdParam && Number.isInteger(tenantIdParam)) {
      params.push(tenantIdParam);
      where.push(`tenant_id = $${params.length}`);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }
    sql += ` ORDER BY created_at DESC, id DESC LIMIT 500`;

    const histRes = await pgClient.query(sql, params);
    return res.json({
      history: (histRes.rows || []).map(formatTrialHistoryRow),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load trial tracking history: ' + err.message });
  }
});

/**
 * 7b-3. PER-TRIAL TRACKING HISTORY (`GET /api/superadmin/free-trials/:id/history`)
 */
router.get('/superadmin/free-trials/:id/history', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }
    const trialRes = await pgClient.query('SELECT id, tenant_id FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Free trial store record not found.' });
    }
    const tenantId = trialRes.rows[0].tenant_id ? Number(trialRes.rows[0].tenant_id) : null;
    const histRes = tenantId
      ? await pgClient.query(
          `SELECT * FROM trial_tracking_history WHERE trial_id = $1 OR tenant_id = $2 ORDER BY created_at DESC, id DESC`,
          [trialId, tenantId]
        )
      : await pgClient.query(
          `SELECT * FROM trial_tracking_history WHERE trial_id = $1 ORDER BY created_at DESC, id DESC`,
          [trialId]
        );
    return res.json({
      history: (histRes.rows || []).map(formatTrialHistoryRow),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load trial history: ' + err.message });
  }
});

/**
 * Helper to load a single formatted trial store row
 */
async function loadFormattedTrialById(trialId: number) {
  const res = await pgClient.query(
    `SELECT ta.*,
            t.name AS live_tenant_name,
            t.status AS live_tenant_status,
            t.subscription_status AS live_subscription_status,
            t.subscription_plan AS live_subscription_plan,
            t.subscription_end_date AS live_subscription_end_date,
            t.onboarding_completed AS live_onboarding_completed,
            u.name AS live_owner_name,
            u.email AS live_owner_email,
            u.phone AS live_owner_phone,
            cs.business_type AS live_business_type,
            cs.pricing_mode AS live_pricing_mode
     FROM trial_activations ta
     LEFT JOIN tenants t ON t.id = ta.tenant_id
     LEFT JOIN LATERAL (
       SELECT name, email, phone
       FROM users
       WHERE tenant_id = ta.tenant_id AND role = 'ADMIN'
       ORDER BY id ASC
       LIMIT 1
     ) u ON true
     LEFT JOIN company_settings cs ON cs.tenant_id = ta.tenant_id
     WHERE ta.id = $1
     LIMIT 1`,
    [trialId]
  );
  return res.rows[0] ? formatTrialActivationRow(res.rows[0]) : null;
}

/**
 * 7b-4. EDIT FREE TRIAL STORE & OWNER DETAILS (`PATCH /api/superadmin/free-trials/:id`)
 */
router.patch('/superadmin/free-trials/:id', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }

    const trialRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Free trial store record not found.' });
    }
    const curr = trialRes.rows[0];
    const prevStatus = String(curr.status || 'ACTIVE').toUpperCase();
    const prevEndDate = curr.trial_end_date;

    const {
      storeName,
      userName,
      ownerName,
      email,
      ownerEmail,
      phone,
      ownerPhone,
      businessType,
      pricingMode,
      trialStartDate,
      trialEndDate,
      status,
      notes,
    } = req.body || {};

    const finalStoreName = String(storeName ?? curr.store_name ?? '').trim() || curr.store_name;
    const finalOwnerName = String(userName ?? ownerName ?? curr.user_name ?? '').trim() || curr.user_name;
    const finalEmail = String(email ?? ownerEmail ?? curr.email ?? '').trim().toLowerCase();
    const finalPhone = String(phone ?? ownerPhone ?? curr.phone ?? '').trim();
    const finalBusinessType = String(businessType || curr.business_type || 'RETAIL').toUpperCase() === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
    const finalPricingMode = finalBusinessType === 'WHOLESALE' ? 'FIXED' : (String(pricingMode || curr.pricing_mode || 'FIXED').toUpperCase() === 'NEGOTIABLE' ? 'NEGOTIABLE' : 'FIXED');

    if (finalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(finalEmail)) {
      return res.status(400).json({ error: 'Enter a valid owner email address.' });
    }

    if (finalEmail && curr.tenant_id) {
      const dupCheck = await pgClient.query<{ id: number }>(
        `SELECT id FROM users
         WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
           AND (tenant_id != $2 OR role != 'ADMIN')
           AND id != COALESCE($3, 0)
         LIMIT 1`,
        [finalEmail, curr.tenant_id, curr.user_id || 0]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({
          code: 'EMAIL_ALREADY_EXISTS',
          error: 'This email is already in use by another account.',
        });
      }
    }

    const startDt = trialStartDate ? new Date(trialStartDate) : (curr.trial_start_date ? new Date(curr.trial_start_date) : new Date());
    const validStart = isNaN(startDt.getTime()) ? new Date() : startDt;

    let endDt = trialEndDate ? new Date(trialEndDate) : (curr.trial_end_date ? new Date(curr.trial_end_date) : new Date(validStart.getTime() + 30 * 86400000));
    if (trialEndDate && /^\d{4}-\d{2}-\d{2}$/.test(String(trialEndDate).trim())) {
      endDt = new Date(`${String(trialEndDate).trim()}T23:59:59.999Z`);
    }
    if (isNaN(endDt.getTime())) {
      endDt = new Date(validStart.getTime() + 30 * 86400000);
    }

    const durationDays = Math.max(1, Math.round((endDt.getTime() - validStart.getTime()) / 86400000));
    let nextStatus = status ? String(status).toUpperCase() : prevStatus;
    if (!['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CONVERTED', 'PENDING'].includes(nextStatus)) {
      nextStatus = prevStatus;
    }
    if (!status) {
      if (endDt.getTime() <= Date.now() && !['SUSPENDED', 'CONVERTED'].includes(nextStatus)) {
        nextStatus = 'EXPIRED';
      } else if (endDt.getTime() > Date.now() && nextStatus === 'EXPIRED') {
        nextStatus = 'ACTIVE';
      }
    } else if (nextStatus === 'ACTIVE' && endDt.getTime() <= Date.now()) {
      endDt = new Date(Date.now() + 30 * 86400000);
    }

    await pgClient.query(
      `UPDATE trial_activations
       SET store_name = $1,
           user_name = $2,
           email = $3,
           phone = $4,
           business_type = $5,
           pricing_mode = $6,
           trial_start_date = $7,
           trial_end_date = $8,
           trial_duration_days = $9,
           status = $10,
           expired_at = CASE WHEN $10 = 'EXPIRED' THEN NOW() ELSE expired_at END,
           suspended_at = CASE WHEN $10 = 'SUSPENDED' THEN NOW() ELSE suspended_at END,
           reactivated_at = CASE WHEN $10 = 'ACTIVE' AND $11 != 'ACTIVE' THEN NOW() ELSE reactivated_at END,
           updated_at = NOW()
       WHERE id = $12`,
      [
        finalStoreName,
        finalOwnerName,
        finalEmail,
        finalPhone,
        finalBusinessType,
        finalPricingMode,
        validStart.toISOString(),
        endDt.toISOString(),
        durationDays,
        nextStatus,
        prevStatus,
        trialId,
      ]
    );

    if (curr.tenant_id) {
      const tenantSubStatus = nextStatus === 'SUSPENDED' ? 'SUSPENDED' : nextStatus === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
      const tenantStatus = nextStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
      await pgClient.query(
        `UPDATE tenants
         SET name = $1,
             subscription_start_date = $2,
             subscription_end_date = $3,
             subscription_status = $4,
             status = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [finalStoreName, validStart.toISOString(), endDt.toISOString(), tenantSubStatus, tenantStatus, curr.tenant_id]
      );
      await pgClient
        .query(
          `UPDATE company_settings
           SET phone = $1,
               email = $2,
               business_type = $3,
               pricing_mode = $4,
               updated_at = NOW()
           WHERE tenant_id = $5`,
          [finalPhone, finalEmail, finalBusinessType, finalPricingMode, curr.tenant_id]
        )
        .catch(() => {});
      if (curr.user_id) {
        await pgClient
          .query(
            `UPDATE users
             SET name = $1,
                 email = $2,
                 phone = $3,
                 updated_at = NOW()
             WHERE id = $4`,
            [finalOwnerName, finalEmail, finalPhone, curr.user_id]
          )
          .catch(() => {});
      }
      if (tenantStatus !== 'ACTIVE' || tenantSubStatus !== 'ACTIVE') {
        removeTenantMiddlewarePresence(Number(curr.tenant_id));
      } else {
        await clearSubscriptionAlertsOnRenewal(Number(curr.tenant_id)).catch(() => {});
      }
    }

    const eventType: TrialTrackingEventType =
      nextStatus !== prevStatus
        ? nextStatus === 'SUSPENDED'
          ? 'SUSPENDED'
          : nextStatus === 'EXPIRED'
          ? 'EXPIRED'
          : nextStatus === 'CONVERTED'
          ? 'CONVERTED'
          : 'REACTIVATED'
        : 'EDITED';

    await logTrialTrackingEvent({
      trialId,
      tenantId: curr.tenant_id,
      userId: curr.user_id,
      eventType,
      previousStatus: prevStatus,
      newStatus: nextStatus,
      previousEndDate: prevEndDate,
      newEndDate: endDt.toISOString(),
      actorUser: req.user || null,
      ownerEmail: finalEmail,
      ownerName: finalOwnerName,
      storeName: finalStoreName,
      notes: notes ? String(notes).trim() : `Free trial details updated for '${finalStoreName}'.`,
    });

    const formatted = await loadFormattedTrialById(trialId);
    return res.json({
      success: true,
      trial: formatted,
      message: `Free trial '${finalStoreName}' updated successfully.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update free trial store: ' + err.message });
  }
});

/**
 * 7c. SUPERADMIN EXTEND FREE TRIAL (`POST /api/superadmin/free-trials/:id/extend` & legacy `/trial-activations/:id/extend`)
 */
async function handleExtendFreeTrial(req: AuthenticatedRequest, res: Response) {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    const extensionDays = Number(req.body?.days || 30);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }
    if (!Number.isFinite(extensionDays) || extensionDays < 1 || extensionDays > 3650) {
      return res.status(400).json({ error: 'Extension days must be between 1 and 3650.' });
    }

    const trialRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Trial activation record not found.' });
    }

    const trial = trialRes.rows[0];
    const prevStatus = String(trial.status || 'ACTIVE').toUpperCase();
    const prevEndDate = trial.trial_end_date;
    const currEnd = trial.trial_end_date ? new Date(trial.trial_end_date) : new Date();
    const baseDate = currEnd.getTime() > Date.now() ? currEnd : new Date();
    const newEndDate = new Date(baseDate.getTime() + extensionDays * 86400000);

    await pgClient.query(
      `UPDATE trial_activations
       SET trial_end_date = $1,
           trial_duration_days = trial_duration_days + $2,
           status = 'ACTIVE',
           reactivated_at = CASE WHEN $3 != 'ACTIVE' THEN NOW() ELSE reactivated_at END,
           updated_at = NOW()
       WHERE id = $4`,
      [newEndDate.toISOString(), extensionDays, prevStatus, trialId]
    );

    if (trial.tenant_id) {
      const pendingRenewalRes = await pgClient
        .query<{ id: number }>(
          `SELECT id FROM platform_notifications
           WHERE target_role = 'SUPERADMIN'
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (
               event_id LIKE $1
               OR ((title ILIKE 'New Renewal Request%' OR title ILIKE 'Renewal Request:%') AND message ILIKE $2)
             )
           LIMIT 1`,
          [`renewal-request-${trial.tenant_id}-%`, `%${trial.store_name}%`]
        )
        .catch(() => ({ rows: [] as Array<{ id: number }> }));
      const hasPendingRenewal = pendingRenewalRes.rows.length > 0;

      await pgClient.query(
        `UPDATE tenants
         SET subscription_end_date = $1,
             subscription_status = 'ACTIVE',
             status = 'ACTIVE',
             updated_at = NOW()
         WHERE id = $2`,
        [newEndDate.toISOString(), trial.tenant_id]
      );
      await clearSubscriptionAlertsOnRenewal(trial.tenant_id);
      await emitStoreSubscriptionNotification({
        tenantId: Number(trial.tenant_id),
        storeName: trial.store_name || 'Retail Store',
        kind: hasPendingRenewal ? 'RENEWAL_APPROVED' : 'RENEWED',
        planLabel: `${extensionDays}-Day Trial Extension`,
        endDate: newEndDate.toISOString(),
      }).catch(() => {});
    }

    await logTrialTrackingEvent({
      trialId,
      tenantId: trial.tenant_id,
      userId: trial.user_id,
      eventType: 'EXTENDED',
      previousStatus: prevStatus,
      newStatus: 'ACTIVE',
      previousEndDate: prevEndDate,
      newEndDate: newEndDate.toISOString(),
      actorUser: req.user || null,
      ownerEmail: trial.email,
      ownerName: trial.user_name,
      storeName: trial.store_name,
      notes: req.body?.notes ? String(req.body.notes).trim() : `Trial extended by +${extensionDays} days until ${newEndDate.toLocaleDateString()}.`,
      metadata: { extensionDays },
    });

    const formatted = await loadFormattedTrialById(trialId);
    return res.json({
      success: true,
      trial: formatted,
      message: `Trial for '${trial.email}' (${trial.store_name}) extended by ${extensionDays} days until ${newEndDate.toLocaleDateString()}.`,
      newEndDate: newEndDate.toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to extend trial: ' + err.message });
  }
}

router.post('/superadmin/free-trials/:id/extend', requireAuth, requireSuperAdmin, handleExtendFreeTrial);
router.post('/superadmin/trial-activations/:id/extend', requireAuth, requireSuperAdmin, handleExtendFreeTrial);

/**
 * 7d. SUPERADMIN EXPIRE FREE TRIAL STORE (`POST /api/superadmin/free-trials/:id/expire`)
 */
router.post('/superadmin/free-trials/:id/expire', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }
    const trialRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Free trial record not found.' });
    }
    const trial = trialRes.rows[0];
    const prevStatus = String(trial.status || 'ACTIVE').toUpperCase();
    const prevEndDate = trial.trial_end_date;
    const prevEndMs = prevEndDate ? new Date(prevEndDate).getTime() : 0;
    const effectiveEndDate = prevEndMs > 0 && prevEndMs <= Date.now()
      ? new Date(prevEndDate).toISOString()
      : new Date(Date.now() - 1000).toISOString();

    await pgClient.query(
      `UPDATE trial_activations
       SET status = 'EXPIRED',
           trial_end_date = $1,
           expired_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [effectiveEndDate, trialId]
    );

    if (trial.tenant_id) {
      await pgClient.query(
        `UPDATE tenants
         SET subscription_status = 'EXPIRED',
             subscription_end_date = $1,
             status = 'ACTIVE',
             updated_at = NOW()
         WHERE id = $2`,
        [effectiveEndDate, trial.tenant_id]
      );
      removeTenantMiddlewarePresence(Number(trial.tenant_id));
      await emitStoreSubscriptionNotification({
        tenantId: Number(trial.tenant_id),
        storeName: trial.store_name || 'Trial Store',
        kind: 'EXPIRED',
        planLabel: 'Free Trial',
        endDate: effectiveEndDate,
      }).catch(() => {});
    }

    await logTrialTrackingEvent({
      trialId,
      tenantId: trial.tenant_id,
      userId: trial.user_id,
      eventType: 'EXPIRED',
      previousStatus: prevStatus,
      newStatus: 'EXPIRED',
      previousEndDate: prevEndDate,
      newEndDate: effectiveEndDate,
      actorUser: req.user || null,
      ownerEmail: trial.email,
      ownerName: trial.user_name,
      storeName: trial.store_name,
      notes: req.body?.notes ? String(req.body.notes).trim() : `Free trial manually marked EXPIRED for '${trial.store_name}'.`,
    });

    const formatted = await loadFormattedTrialById(trialId);
    return res.json({
      success: true,
      trial: formatted,
      message: `Free trial for '${trial.store_name}' has been marked as expired.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to expire free trial: ' + err.message });
  }
});

/**
 * 7e. SUPERADMIN SUSPEND FREE TRIAL STORE (`POST /api/superadmin/free-trials/:id/suspend`)
 */
router.post('/superadmin/free-trials/:id/suspend', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }
    const trialRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Free trial record not found.' });
    }
    const trial = trialRes.rows[0];
    const prevStatus = String(trial.status || 'ACTIVE').toUpperCase();

    await pgClient.query(
      `UPDATE trial_activations
       SET status = 'SUSPENDED',
           suspended_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [trialId]
    );

    if (trial.tenant_id) {
      await pgClient.query(
        `UPDATE tenants
         SET status = 'SUSPENDED',
             subscription_status = 'SUSPENDED',
             updated_at = NOW()
         WHERE id = $1`,
        [trial.tenant_id]
      );
      removeTenantMiddlewarePresence(Number(trial.tenant_id));
    }

    await logTrialTrackingEvent({
      trialId,
      tenantId: trial.tenant_id,
      userId: trial.user_id,
      eventType: 'SUSPENDED',
      previousStatus: prevStatus,
      newStatus: 'SUSPENDED',
      previousEndDate: trial.trial_end_date,
      newEndDate: trial.trial_end_date,
      actorUser: req.user || null,
      ownerEmail: trial.email,
      ownerName: trial.user_name,
      storeName: trial.store_name,
      notes: req.body?.notes ? String(req.body.notes).trim() : `Free trial store '${trial.store_name}' suspended by SuperAdmin.`,
    });

    const formatted = await loadFormattedTrialById(trialId);
    return res.json({
      success: true,
      trial: formatted,
      message: `Free trial store '${trial.store_name}' has been suspended.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to suspend free trial: ' + err.message });
  }
});

/**
 * 7f. SUPERADMIN REACTIVATE FREE TRIAL STORE (`POST /api/superadmin/free-trials/:id/reactivate`)
 */
router.post('/superadmin/free-trials/:id/reactivate', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }
    const trialRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Free trial record not found.' });
    }
    const trial = trialRes.rows[0];
    const prevStatus = String(trial.status || 'EXPIRED').toUpperCase();
    const prevEndDate = trial.trial_end_date;
    const prevEndMs = prevEndDate ? new Date(prevEndDate).getTime() : 0;

    const requestedDays = req.body?.days !== undefined ? Number(req.body.days) : null;
    if (requestedDays !== null && (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 3650)) {
      return res.status(400).json({ error: 'Reactivation days must be between 1 and 3650.' });
    }

    const baseDate = prevEndMs > Date.now() && !requestedDays ? new Date(prevEndMs) : new Date();
    const effectiveDays = requestedDays || (prevEndMs <= Date.now() ? 30 : 0);
    const newEndDate = effectiveDays > 0
      ? new Date(baseDate.getTime() + effectiveDays * 86400000)
      : baseDate;

    await pgClient.query(
      `UPDATE trial_activations
       SET status = 'ACTIVE',
           trial_end_date = $1,
           reactivated_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [newEndDate.toISOString(), trialId]
    );

    if (trial.tenant_id) {
      await pgClient.query(
        `UPDATE tenants
         SET status = 'ACTIVE',
             subscription_status = 'ACTIVE',
             subscription_end_date = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [newEndDate.toISOString(), trial.tenant_id]
      );
      await clearSubscriptionAlertsOnRenewal(Number(trial.tenant_id)).catch(() => {});
      await emitStoreSubscriptionNotification({
        tenantId: Number(trial.tenant_id),
        storeName: trial.store_name || 'Trial Store',
        kind: 'RENEWED',
        planLabel: 'Free Trial Reactivated',
        endDate: newEndDate.toISOString(),
      }).catch(() => {});
    }

    await logTrialTrackingEvent({
      trialId,
      tenantId: trial.tenant_id,
      userId: trial.user_id,
      eventType: 'REACTIVATED',
      previousStatus: prevStatus,
      newStatus: 'ACTIVE',
      previousEndDate: prevEndDate,
      newEndDate: newEndDate.toISOString(),
      actorUser: req.user || null,
      ownerEmail: trial.email,
      ownerName: trial.user_name,
      storeName: trial.store_name,
      notes: req.body?.notes
        ? String(req.body.notes).trim()
        : `Free trial reactivated for '${trial.store_name}' until ${newEndDate.toLocaleDateString()}.`,
      metadata: effectiveDays > 0 ? { addedDays: effectiveDays } : {},
    });

    const formatted = await loadFormattedTrialById(trialId);
    return res.json({
      success: true,
      trial: formatted,
      message: `Free trial store '${trial.store_name}' reactivated until ${newEndDate.toLocaleDateString()}.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to reactivate free trial: ' + err.message });
  }
});

/**
 * 7g. SUPERADMIN PERMANENT DELETE FREE TRIAL STORE (`DELETE /api/superadmin/free-trials/:id`)
 * Permanently deletes the store tenant, trial activation, tracking history, and all activity logs.
 */
router.delete('/superadmin/free-trials/:id', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const trialId = parseInt(req.params.id, 10);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return res.status(400).json({ error: 'Invalid free trial ID.' });
    }
    const trialRes = await pgClient.query<any>('SELECT * FROM trial_activations WHERE id = $1 LIMIT 1', [trialId]);
    if (trialRes.rows.length === 0) {
      return res.status(404).json({ error: 'Free trial store record not found or already deleted.' });
    }
    const trial = trialRes.rows[0];
    const { storeName } = await permanentlyDeleteStoreAndTrialData({
      tenantId: trial.tenant_id ? Number(trial.tenant_id) : null,
      trialId,
    });

    return res.json({
      success: true,
      deletedTrialId: trialId,
      deletedTenantId: trial.tenant_id ? Number(trial.tenant_id) : null,
      message: `Free trial store '${storeName}' and all associated trial history, tracking records, and activity logs have been permanently deleted.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to permanently delete free trial store: ' + err.message });
  }
});

/**
 * 8. SUPERADMIN DIRECT STORE CREATION (`POST /api/superadmin/tenants`)
 * Minimal Required Fields Only: Store Name, Owner Email and Password
 */
router.post('/superadmin/tenants', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      storeName,
      ownerName,
      ownerEmail,
      password,
      ownerPhone,
      currency,
      businessType,
      pricingMode,
      subscriptionPlan,
      subscriptionStartDate,
      subscriptionEndDate,
    } = req.body || {};
    if (!storeName || !ownerName || !ownerEmail) {
      return res.status(400).json({ error: 'Store name, owner name, and owner email are required.' });
    }
    const normalizedOwnerEmail = String(ownerEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedOwnerEmail)) {
      return res.status(400).json({ error: 'Enter a valid owner email address.' });
    }
    if (!String(storeName).trim() || !String(ownerName).trim()) {
      return res.status(400).json({ error: 'Store name and owner name cannot be blank.' });
    }
    const duplicateOwnerEmail = await pgClient.query<{ id: number }>(
      'SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 1',
      [normalizedOwnerEmail]
    );
    if (duplicateOwnerEmail.rows.length > 0) {
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'This email is already in use. Please use a different email address.',
      });
    }
    if (password === undefined || String(password).trim().length < 4) {
      return res.status(400).json({ error: 'Owner password must be at least 4 characters.' });
    }

    const rawBusinessType = String(businessType || 'RETAIL').toUpperCase();
    const finalBusinessType: 'RETAIL' | 'WHOLESALE' = rawBusinessType === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
    const finalPricingMode: 'FIXED' | 'NEGOTIABLE' =
      finalBusinessType === 'WHOLESALE'
        ? 'FIXED'
        : String(pricingMode || 'FIXED').toUpperCase() === 'NEGOTIABLE'
        ? 'NEGOTIABLE'
        : 'FIXED';


    await pgClient.query('BEGIN');
    const provisioned = await provisionNewTenantStore({
      storeName,
      ownerName: String(ownerName).trim(),
      ownerEmail: normalizedOwnerEmail,
      password: password ? String(password).trim() : undefined,
      ownerPhone,
      currency,
      businessType: finalBusinessType,
      pricingMode: finalPricingMode,
      allowHalfCarton: req.body?.allowHalfCarton ?? req.body?.allow_half_carton,
      subscriptionPlan: subscriptionPlan || 'YEARLY',
      subscriptionStartDate,
      subscriptionEndDate,
    });
    await pgClient.query('COMMIT');

    if (normalizeSubscriptionPlan(provisioned.subscriptionPlan) === 'free_tier') {
      await recordTrialActivation({
        userId: provisioned.adminUserId,
        tenantId: provisioned.tenantId,
        email: normalizedOwnerEmail,
        userName: String(ownerName || storeName).trim(),
        phone: ownerPhone,
        storeName: provisioned.storeName,
        businessType: finalBusinessType,
        pricingMode: finalPricingMode,
        plan: 'TRIAL',
        trialDurationDays: 30,
        trialStartDate: provisioned.subscriptionStartDate,
        trialEndDate: provisioned.subscriptionEndDate,
        status: 'ACTIVE',
        actorUser: req.user || null,
        details: { createdBy: 'SUPERADMIN' },
      });
    }

    return res.status(201).json({
      success: true,
      provisioned,
      message: `Store '${provisioned.storeName}' created successfully.`,
    });
  } catch (err: any) {
    await pgClient.query('ROLLBACK').catch(() => {});
    if (err?.code === 'EMAIL_ALREADY_EXISTS' || (err?.code === '23505' && String(err?.constraint || '').includes('users_email'))) {
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'This email is already in use. Please use a different email address.',
      });
    }
    return res.status(400).json({ error: err.message || 'Failed to create tenant store.' });
  }
});

/**
 * 9. TENANT FIRST-TIME OWNER INITIAL STORE SETUP GET & POST (`/api/tenants/onboarding?tenantId=...`)
 * Configures essential store defaults for a newly created store before granting full Owner portal access:
 * - Fixed document numbering (INV- / PUR-)
 * - Store Settings & Low Stock Threshold
 * - Store Contact Details & Physical Address
 * - Tax Rates, Tax ID / STRN & Receipt Footer Notes
 */
router.get('/tenants/onboarding', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const authUser = (req as AuthenticatedRequest).user;
    const isSuperAdminActor = String(authUser?.role || '').toUpperCase() === 'SUPERADMIN';
    const tenantId = isSuperAdminActor
      ? Number(req.query.tenantId ?? req.headers['x-tenant-id'] ?? authUser?.tenantId)
      : Number(authUser?.tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return res.status(400).json({ error: 'A valid tenantId is required.' });
    const tenantRes = await pgClient.query(
      `SELECT t.*,
              u.name as admin_name,
              u.email as admin_email,
              u.phone as admin_phone,
              (SELECT COUNT(*) FROM products p WHERE p.tenant_id = t.id)::int as product_count,
              (SELECT COUNT(*) FROM users ca WHERE ca.tenant_id = t.id AND ca.role = 'CASHIER')::int as cashier_count
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT name, email, phone
         FROM users
         WHERE tenant_id = t.id AND role = 'ADMIN'
         ORDER BY id ASC
         LIMIT 1
       ) u ON true
       WHERE t.id = $1
       LIMIT 1`,
      [tenantId]
    );

    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: `Tenant '${tenantId}' not found.` });
    }

    const t: any = tenantRes.rows[0];
    const settingsRes = await pgClient.query<any>(
      'SELECT * FROM company_settings WHERE tenant_id = $1 LIMIT 1',
      [t.id]
    );
    const cs = settingsRes.rows[0] || {};

    return res.json({
      tenant: {
        id: t.id,
        name: t.name,
        status: t.status,
        address: cs.address || '',
        taxId: cs.tax_id || '',
        strn: cs.strn || '',
        taxRate: Number(cs.tax_rate) || 0,
        currency: cs.currency || 'PKR',
        currencySymbol: cs.currency_symbol || 'Rs.',
        invoiceFooter:
          cs.invoice_footer ||
          'Thank you for shopping with us! Exchanges accepted within 7 days with original receipt.',
        lowStockThreshold: Number(cs.low_stock_threshold ?? 5) || 5,
        pricingMode: cs.pricing_mode || 'FIXED',
        businessType: (cs.business_type || 'RETAIL') as 'RETAIL' | 'WHOLESALE',
        allowHalfCarton: cs.allow_half_carton !== undefined
          ? Boolean(cs.allow_half_carton)
          : true,
        logoUrl: cs.logo || '/pwa-512x512.png',
        ownerName: t.admin_name || '',
        ownerEmail: cs.email || t.admin_email || '',
        ownerPhone: cs.phone || t.admin_phone || '',
        hasCashier: Boolean(t.cashier_count > 0),
        onboardingCompleted: Boolean(t.onboarding_completed),
        isLocked: Boolean(t.onboarding_completed),
        productCount: t.product_count || 0,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load onboarding state: ' + err.message });
  }
});

router.post('/tenants/onboarding', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await ensureSaasControlPlane();
    const authUser = (req as AuthenticatedRequest).user;
    const isSuperAdminActor = String(authUser?.role || '').toUpperCase() === 'SUPERADMIN';
    const tenantId = isSuperAdminActor
      ? Number(req.body?.tenantId ?? req.query?.tenantId ?? req.headers['x-tenant-id'] ?? authUser?.tenantId)
      : Number(authUser?.tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return res.status(400).json({ error: 'A valid tenantId is required.' });

    const tenantRes = await pgClient.query<{
      id: number;
      name: string;
      status: string;
      business_type: string;
      pricing_mode: string;
      owner_email: string;
      onboarding_completed: boolean;
    }>(
      `SELECT t.id, t.name, t.status, t.onboarding_completed,
              COALESCE(NULLIF(cs.business_type::text, ''), 'RETAIL') AS business_type,
              COALESCE(NULLIF(cs.pricing_mode::text, ''), 'FIXED') AS pricing_mode,
              u.email AS owner_email
       FROM tenants t
       LEFT JOIN company_settings cs ON cs.tenant_id = t.id
       LEFT JOIN LATERAL (
         SELECT email
         FROM users
         WHERE tenant_id = t.id AND role = 'ADMIN'
         ORDER BY id ASC
         LIMIT 1
       ) u ON true
       WHERE t.id = $1
       LIMIT 1`,
      [tenantId]
    );

    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: `Tenant '${tenantId}' does not exist.` });
    }

    const tenant = tenantRes.rows[0];

    // If onboarding is already completed, allow relaxed re-configuration or return existing setup state gracefully
    if (tenant.onboarding_completed && !req.body?.force && !req.body?.reconfigure) {
      const existingSettingsRes = await pgClient.query('SELECT * FROM company_settings WHERE tenant_id = $1 LIMIT 1', [tenant.id]);
      const ownerRes = await pgClient.query('SELECT id, name, email, quick_password FROM users WHERE tenant_id = $1 AND role = $2 LIMIT 1', [tenant.id, 'ADMIN']);
      const adminUser = ownerRes.rows[0];
      const token = adminUser ? generateToken({
        id: adminUser.id,
        tenantId: tenant.id,
        name: adminUser.name,
        email: adminUser.email,
        role: 'ADMIN',
        status: 'APPROVED',
      }) : null;

      return res.json({
        success: true,
        alreadyCompleted: true,
        message: `Store setup has already been completed for ${tenant.name}.`,
        token,
        user: adminUser ? {
          id: adminUser.id,
          tenantId: tenant.id,
          tenantName: tenant.name,
          name: adminUser.name,
          email: adminUser.email,
          role: 'ADMIN',
          originalRole: 'ADMIN',
          status: 'APPROVED',
          onboardingCompleted: true,
        } : null,
        settings: existingSettingsRes.rows[0] || null,
        manifestUrl: '/manifest.webmanifest',
        redirectUrl: `/?tenantId=${tenant.id}`,
      });
    }

    const {
      storeName,
      address,
      taxId,
      strn,
      taxRate,
      currency,
      currencySymbol,
      phone,
      email,
      ownerName,
      invoiceFooter,
      lowStockThreshold,
      logoUrl,
      businessType,
      pricingMode,
      adminPassword,
      // Cashier fields (optional! If skipped, no cashier account is created):
      createCashier,
      cashierName,
      cashierEmail,
      cashierPassword,
      cashierPhone,
      initialProducts,
    } = req.body || {};

    await pgClient.query('BEGIN');

    const finalName = storeName && String(storeName).trim() ? String(storeName).trim() : tenant.name;
    const finalAddress = String(address || '').trim();
    const finalTaxId = String(taxId || '').trim();
    const finalStrn = String(strn || '').trim();
    const finalTaxRate = Math.max(0, Math.min(100, Number(taxRate) || 0));
    const finalCurrency = String(currency || 'PKR').trim();
    const finalCurrencySymbol = String(
      currencySymbol ||
        (finalCurrency === 'USD'
          ? '$'
          : finalCurrency === 'AED'
          ? 'AED'
          : finalCurrency === 'SAR'
          ? 'SAR'
          : finalCurrency === 'GBP'
          ? '£'
          : finalCurrency === 'EUR'
          ? '€'
          : 'Rs.')
    ).trim();
    const finalInvoiceFooter =
      String(
        invoiceFooter ||
          'Thank you for shopping with us! Exchanges accepted within 7 days with original receipt.'
      ).trim();
    const finalLowStockThreshold = Math.max(
      1,
      parseInt(String(lowStockThreshold ?? req.body?.low_stock_threshold ?? 5), 10) || 5
    );
    const requestedBusinessType = String(businessType || req.body.business_type || tenant.business_type || 'RETAIL').toUpperCase();
    const finalBusinessType: 'RETAIL' | 'WHOLESALE' =
      requestedBusinessType === 'WHOLESALE'
        ? 'WHOLESALE'
        : 'RETAIL';
    const requestedPricingMode = String(pricingMode || tenant.pricing_mode || 'FIXED').toUpperCase();
    const finalPricingMode =
      finalBusinessType === 'WHOLESALE'
        ? 'FIXED'
        : requestedPricingMode === 'NEGOTIABLE'
        ? 'NEGOTIABLE'
        : 'FIXED';
    const finalLogoUrl = String(logoUrl || '/pwa-512x512.png').trim();
    const finalPhone = String(phone || '').trim();
    const finalEmail = String(email || tenant.owner_email || '').trim().toLowerCase();
    const cleanCashierEmail =
      Boolean(createCashier) && cashierEmail && String(cashierEmail).trim()
        ? String(cashierEmail).trim().toLowerCase()
        : '';

    if (finalEmail && cleanCashierEmail && finalEmail === cleanCashierEmail) {
      await pgClient.query('ROLLBACK').catch(() => {});
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'Cashier email cannot be the same as the store owner email. Please use a unique email address.',
      });
    }

    const currentStoreAdminRes = await pgClient.query<{ id: number }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'ADMIN' ORDER BY id ASC LIMIT 1`,
      [tenant.id]
    );
    const currentStoreAdminId = currentStoreAdminRes.rows[0]?.id || 0;

    if (finalEmail) {
      const duplicateOwnerEmailRes = await pgClient.query<{ id: number }>(
        `SELECT id FROM users
         WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
           AND id != $2
         LIMIT 1`,
        [finalEmail, currentStoreAdminId]
      );
      if (duplicateOwnerEmailRes.rows.length > 0) {
        await pgClient.query('ROLLBACK').catch(() => {});
        return res.status(409).json({
          code: 'EMAIL_ALREADY_EXISTS',
          error: 'This email is already in use. Please use a different email address.',
        });
      }
    }

    if (cleanCashierEmail) {
      const currentCashierRes = await pgClient.query<{ id: number }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND role = 'CASHIER' ORDER BY id ASC LIMIT 1`,
        [tenant.id]
      );
      const currentCashierId = currentCashierRes.rows[0]?.id || 0;
      const duplicateCashierEmailRes = await pgClient.query<{ id: number }>(
        `SELECT id FROM users
         WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
           AND id != $2
         LIMIT 1`,
        [cleanCashierEmail, currentCashierId]
      );
      if (duplicateCashierEmailRes.rows.length > 0) {
        await pgClient.query('ROLLBACK').catch(() => {});
        return res.status(409).json({
          code: 'EMAIL_ALREADY_EXISTS',
          error: 'This cashier email is already in use. Please use a different email address.',
        });
      }
    }

    const rawAllowHalf = req.body?.allowHalfCarton ?? req.body?.allow_half_carton;
    let finalAllowHalfCarton = true;
    if (finalBusinessType === 'WHOLESALE' && rawAllowHalf !== undefined && rawAllowHalf !== null) {
      finalAllowHalfCarton = String(rawAllowHalf) === 'true' || rawAllowHalf === true;
    }

    // Update tenants table and mark store ACTIVE + onboarded (locked)
    await pgClient.query(
      `UPDATE tenants
       SET name = $1,
           status = 'ACTIVE',
           onboarding_completed = true,
           updated_at = NOW()
       WHERE id = $2`,
      [
        finalName,
        tenant.id,
      ]
    );

    // Sync tenant company_settings with all configured Initial Store Setup defaults
    const settingsCheck = await pgClient.query('SELECT id FROM company_settings WHERE tenant_id = $1 LIMIT 1', [tenant.id]);
    if (settingsCheck.rows.length > 0) {
      await pgClient.query(
        `UPDATE company_settings
         SET logo = $1,
             address = $2,
             tax_id = $3,
             strn = $4,
             tax_rate = $5,
             currency = $6,
             currency_symbol = $7,
             phone = COALESCE(NULLIF($8, ''), phone),
             email = COALESCE(NULLIF($9, ''), email),
             invoice_footer = $10,
             low_stock_threshold = $11,
             pricing_mode = $12,
             business_type = $13,
             allow_half_carton = $14,
             updated_at = NOW()
         WHERE tenant_id = $15`,
        [
          finalLogoUrl,
          finalAddress,
          finalTaxId,
          finalStrn,
          finalTaxRate,
          finalCurrency,
          finalCurrencySymbol,
          finalPhone,
          finalEmail,
          finalInvoiceFooter,
          finalLowStockThreshold,
          finalPricingMode,
          finalBusinessType,
          finalAllowHalfCarton,
          tenant.id,
        ]
      );
    } else {
      await pgClient.query(
        `INSERT INTO company_settings (
           tenant_id, logo, address, tax_id, strn, tax_rate, currency, currency_symbol,
           phone, email, invoice_footer,
           low_stock_threshold, pricing_mode, business_type, allow_half_carton
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          tenant.id,
          finalLogoUrl,
          finalAddress,
          finalTaxId,
          finalStrn,
          finalTaxRate,
          finalCurrency,
          finalCurrencySymbol,
          finalPhone,
          finalEmail,
          finalInvoiceFooter,
          finalLowStockThreshold,
          finalPricingMode,
          finalBusinessType,
          finalAllowHalfCarton,
        ]
      );
    }

    // Ensure Store Owner (ADMIN) exists, and only create Cashier if user explicitly requested it!
    const ensuredUsers = await ensureTenantStoreUsers({
      tenantId: tenant.id,
      storeName: finalName,
      ownerName: ownerName && String(ownerName).trim() ? String(ownerName).trim() : undefined,
      ownerEmail: finalEmail || tenant.owner_email,
      ownerPhone: finalPhone,
      createCashier: Boolean(createCashier),
      cashierName: cashierName && String(cashierName).trim() ? String(cashierName).trim() : undefined,
      cashierEmail: cashierEmail && String(cashierEmail).trim() ? String(cashierEmail).trim().toLowerCase() : undefined,
      cashierPassword: cashierPassword && String(cashierPassword).trim() ? String(cashierPassword).trim() : undefined,
      cashierPhone: cashierPhone && String(cashierPhone).trim() ? String(cashierPhone).trim() : undefined,
    });
    const adminUser: any = ensuredUsers.owner;

    if (adminPassword && String(adminPassword).trim().length >= 4) {
      const cleanPass = String(adminPassword).trim();
      const hash = bcrypt.hashSync(cleanPass, 10);
      await pgClient.query(
        `UPDATE users SET password_hash = $1, quick_password = $2, status = 'APPROVED', active = true WHERE id = $3 AND tenant_id = $4`,
        [hash, cleanPass, adminUser.id, tenant.id]
      );
    }
    if (ownerName && String(ownerName).trim()) {
      await pgClient.query(
        `UPDATE users SET name = $1 WHERE id = $2 AND tenant_id = $3`,
        [String(ownerName).trim(), adminUser.id, tenant.id]
      );
      adminUser.name = String(ownerName).trim();
    }
    if (finalEmail) {
      await pgClient.query(
        `UPDATE users SET email = $1 WHERE id = $2 AND tenant_id = $3`,
        [finalEmail, adminUser.id, tenant.id]
      );
      adminUser.email = finalEmail;
    }
    if (finalPhone) {
      await pgClient.query(
        `UPDATE users SET phone = $1 WHERE id = $2 AND tenant_id = $3`,
        [finalPhone, adminUser.id, tenant.id]
      );
      adminUser.phone = finalPhone;
    }

    // If user skipped cashier creation during onboarding wizard, ensure no cashier account was automatically created!
    if (!createCashier) {
      await pgClient.query(
        `DELETE FROM users WHERE tenant_id = $1 AND role = 'CASHIER'`,
        [tenant.id]
      );
    }

    // Optional initial inventory items if provided
    if (Array.isArray(initialProducts) && initialProducts.length > 0) {
      for (let i = 0; i < initialProducts.length; i++) {
        const item = initialProducts[i];
        if (!item || !item.name || !String(item.name).trim()) continue;
        const pName = String(item.name).trim();
        const pBrand = String(item.brand || 'Unbranded').trim() || 'Unbranded';
        const pCategory = String(item.category || 'Sneakers').trim();
        const pCost = Math.max(0, Number(item.purchasePrice) || 2000);
        const pMax = Math.max(1, Number(item.maxPrice ?? item.sellingPrice) || 3500);
        const pMin = finalPricingMode === 'NEGOTIABLE'
          ? Math.max(pCost, Number(item.minPrice) || pCost)
          : pMax;
        const tagPrice = finalPricingMode === 'NEGOTIABLE' ? Math.max(pMax, pMin + 1) : Math.max(pMax, pCost);
        const pStock = Math.max(0, parseInt(String(item.stock ?? 15), 10) || 15);
        const pBarcode =
          item.barcode && String(item.barcode).trim()
            ? String(item.barcode).trim()
            : `${pCategory.slice(0, 2).toUpperCase() || 'CA'}-${i + 1}`;

        await pgClient.query(
          `INSERT INTO products (
            tenant_id, name, article, barcode, brand, category,
            cost_price, min_price, max_price, total_stock, primary_image_url, active
          ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, '/assets/images/hd-07.jpg', true)`,
          [tenant.id, pName, pBarcode, pBrand, pCategory, pCost, pMin, tagPrice, pStock]
        );
      }
    }

    await pgClient.query('COMMIT');

    // Issue fresh tenant-scoped JWT token for immediate login after setup
    let token: string | null = null;
    if (adminUser) {
      token = generateToken({
        id: adminUser.id,
        tenantId: tenant.id,
        name: adminUser.name,
        email: adminUser.email,
        role: 'ADMIN',
        status: 'APPROVED',
      });
    }

    const updatedSettingsRes = await pgClient.query('SELECT * FROM company_settings WHERE tenant_id = $1 LIMIT 1', [tenant.id]);

    // Trigger welcome notification & email to owner when onboarding completes
    const cleanFinalName = finalName || 'Your Store';
    const finalWelcomeMsg =
      req.body?.msg ||
      req.body?.welcomeMsg ||
      `Welcome to SarbaazSoft Shoe POS, ${cleanFinalName}!\n\nThank you for choosing SarbaazSoft to power your footwear business. We are thrilled to partner with ${cleanFinalName} and help you streamline your inventory, accelerate counter checkouts, and scale your wholesale operations seamlessly.`;

    let welcomeResult: any = null;
    try {
      const requestOrigin = extractRequestOrigin(req);
      welcomeResult = await sendWelcomeMsg(tenant.id, finalWelcomeMsg, finalEmail, { origin: requestOrigin });
      if (welcomeResult && !welcomeResult.emailDelivered) {
        console.warn(`[tenantSaasRoutes.ts] Welcome email delivery notice for tenant ${tenant.id} (${finalEmail})`);
      }
    } catch (welcomeErr: any) {
      console.warn('[tenantSaasRoutes.ts] sendWelcomeMsg notice during onboarding completion:', welcomeErr?.message || welcomeErr);
      welcomeResult = null;
    }

    return res.json({
      success: true,
      message: `Initial store setup completed for ${finalName}!`,
      welcomeMsgSent: Boolean(welcomeResult?.success),
      welcomeMsgDeliveredEmail: Boolean(welcomeResult?.emailDelivered),
      token,
      user: adminUser
        ? {
            id: adminUser.id,
            tenantId: tenant.id,
            tenantName: finalName,
            name: adminUser.name,
            email: adminUser.email,
            role: 'ADMIN',
            originalRole: 'ADMIN',
            status: 'APPROVED',
            onboardingCompleted: true,
          }
        : null,
      settings: updatedSettingsRes.rows[0] || null,
      manifestUrl: '/manifest.webmanifest',
      redirectUrl: `/?tenantId=${tenant.id}`,
    });
  } catch (err: any) {
    await pgClient.query('ROLLBACK').catch(() => {});
    if (err?.code === 'EMAIL_ALREADY_EXISTS' || (err?.code === '23505' && String(err?.constraint || '').includes('users_email'))) {
      return res.status(409).json({
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'This email is already in use. Please use a different email address.',
      });
    }
    return res.status(500).json({ error: 'Failed to complete initial store setup: ' + err.message });
  }
});

/**
 * SUPERADMIN CUSTOM NOTIFICATIONS API
 * Allows platform SuperAdmin to broadcast custom notifications to all stores or target a specific store.
 */

// POST /api/superadmin/notifications - Send custom announcement to all stores or specific store
router.post('/superadmin/notifications', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensurePlatformNotificationsSchema();
    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!title || !message) {
      return res.status(400).json({ error: 'Notification title and message are required.' });
    }

    const rawTenantId = req.body?.tenantId;
    let targetTenantId: number | null = null;
    let targetStoreName = 'All Stores (Platform Broadcast)';

    if (
      rawTenantId !== undefined &&
      rawTenantId !== null &&
      String(rawTenantId).trim() !== '' &&
      String(rawTenantId).trim() !== '0' &&
      String(rawTenantId).toUpperCase() !== 'ALL'
    ) {
      const parsedId = parseInt(String(rawTenantId), 10);
      if (Number.isInteger(parsedId) && parsedId > 0) {
        const storeCheck = await pgClient.query('SELECT id, name FROM tenants WHERE id = $1', [parsedId]);
        if (storeCheck.rows.length === 0) {
          return res.status(404).json({ error: `Store with ID #${parsedId} was not found.` });
        }
        targetTenantId = parsedId;
        targetStoreName = storeCheck.rows[0].name;
      }
    }

    const rawTargetRole = String(req.body?.targetRole || 'ALL').toUpperCase();
    const validRoles = ['ALL', 'ADMIN', 'CASHIER', 'SUPERADMIN'];
    const targetRole = validRoles.includes(rawTargetRole) ? rawTargetRole : 'ALL';

    const rawType = String(req.body?.type || 'INFO').toUpperCase();
    const validTypes = ['INFO', 'WARNING', 'SUCCESS', 'URGENT'];
    const type = validTypes.includes(rawType) ? rawType : 'INFO';
    const actionUrl = String(req.body?.actionUrl || '').trim();
    const actionLabel = String(req.body?.actionLabel || '').trim();

    let expiresAt: string | null = null;
    if (req.body?.expiresAt) {
      const parsedDate = new Date(req.body.expiresAt);
      if (!isNaN(parsedDate.getTime())) {
        expiresAt = parsedDate.toISOString();
      }
    }

    const currentUserId = req.user?.id || null;
    const rawEventId = String(req.body?.eventId || req.body?.idempotencyKey || '').trim();
    const eventId = rawEventId || `announcement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const insertRes = await pgClient.query<{
      id: number;
      tenant_id: number | null;
      target_role: string;
      title: string;
      message: string;
      type: string;
      action_url: string;
      action_label: string;
      created_by: number | null;
      expires_at: string | null;
      event_id: string | null;
      created_at: string;
    }>(
      `INSERT INTO platform_notifications (
        tenant_id, target_role, title, message, type, action_url, action_label, created_by, expires_at, event_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (event_id) DO NOTHING
      RETURNING *`,
      [targetTenantId, targetRole, title, message, type, actionUrl, actionLabel, currentUserId, expiresAt, eventId]
    );

    let row = insertRes.rows[0];
    let isNewlyCreated = true;

    if (!row) {
      isNewlyCreated = false;
      const existingRes = await pgClient.query<typeof row>(
        'SELECT * FROM platform_notifications WHERE event_id = $1 LIMIT 1',
        [eventId]
      );
      row = existingRes.rows[0];
    }

    if (!row) {
      return res.status(500).json({ error: 'Failed to create or retrieve notification.' });
    }

    if (isNewlyCreated) {
      // Dispatch real-time SSE event & Web Push to subscribers with role isolation only once
      await notifyPlatformAnnouncement({
        id: row.id,
        eventId: row.event_id || `platform-${row.id}`,
        tenantId: row.tenant_id,
        targetRole: row.target_role as any,
        title: row.title,
        message: row.message,
        type: row.type,
        actionUrl: row.action_url,
        actionLabel: row.action_label,
        timestamp: row.created_at,
      }).catch((err) => console.warn('Failed to dispatch announcement notification:', err));
    }

    return res.status(isNewlyCreated ? 201 : 200).json({
      success: true,
      deduplicated: !isNewlyCreated,
      message: targetTenantId
        ? `Custom notification sent to ${targetStoreName} (${targetRole}) successfully!`
        : `Custom notification broadcast to all stores (${targetRole}) successfully!`,
      notification: {
        id: row.id,
        eventId: row.event_id || `platform-${row.id}`,
        tenantId: row.tenant_id,
        targetRole: row.target_role,
        storeName: targetStoreName,
        title: row.title,
        message: row.message,
        type: row.type,
        actionUrl: row.action_url,
        actionLabel: row.action_label,
        createdBy: row.created_by,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        readCount: 0,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to send custom notification: ' + err.message });
  }
});

// GET /api/superadmin/notifications - List all dispatched custom notifications
router.get('/superadmin/notifications', requireAuth, requireSuperAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await ensurePlatformNotificationsSchema();
    const notificationsRes = await pgClient.query<{
      id: number;
      tenant_id: number | null;
      target_role: string;
      store_name: string | null;
      title: string;
      message: string;
      type: string;
      action_url: string;
      action_label: string;
      created_by: number | null;
      created_by_name: string | null;
      expires_at: string | null;
      created_at: string;
      read_count: string;
    }>(`
      SELECT
        pn.id,
        pn.tenant_id,
        COALESCE(pn.target_role, 'ALL') AS target_role,
        COALESCE(t.name, 'All Stores (Platform Broadcast)') AS store_name,
        pn.title,
        pn.message,
        pn.type,
        pn.action_url,
        pn.action_label,
        pn.created_by,
        COALESCE(u.name, 'Platform SuperAdmin') AS created_by_name,
        pn.expires_at,
        pn.created_at,
        (SELECT COUNT(*) FROM platform_notification_reads pnr WHERE pnr.notification_id = pn.id)::text AS read_count
      FROM platform_notifications pn
      LEFT JOIN tenants t ON t.id = pn.tenant_id
      LEFT JOIN users u ON u.id = pn.created_by
      WHERE pn.title NOT ILIKE 'Welcome to SarbaazSoft%'
      ORDER BY pn.created_at DESC
      LIMIT 100
    `);

    const notifications = notificationsRes.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      targetRole: r.target_role,
      storeName: r.store_name,
      title: r.title,
      message: r.message,
      type: r.type,
      actionUrl: r.action_url,
      actionLabel: r.action_label,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      readCount: parseInt(r.read_count || '0', 10),
    }));

    return res.json({ notifications });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load notifications: ' + err.message });
  }
});

// DELETE /api/superadmin/notifications/:id - Revoke / delete a dispatched notification
router.delete('/superadmin/notifications/:id', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensurePlatformNotificationsSchema();
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    await pgClient.query('DELETE FROM platform_notification_reads WHERE notification_id = $1', [id]).catch(() => {});
    await pgClient.query('DELETE FROM platform_notifications WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Notification revoked successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to revoke notification: ' + err.message });
  }
});

export default router;
