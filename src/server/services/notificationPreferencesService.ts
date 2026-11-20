import { pgClient } from '../../db/index.ts';
import { ensureDatabaseSchema, ensureFcmTokensSchema } from '../../db/schemaInit.ts';
import {
  applyNotificationPreset,
  createDefaultNotificationPreferences,
  isValidNotificationPreset,
  normalizeNotificationPreferences,
  updateNotificationChannelToggle,
  updateNotificationEventToggle,
  type EmailFallbackReason,
  type StoreNotificationChannelId,
  type StoreNotificationDeliveryStatus,
  type StoreNotificationEventId,
  type StoreNotificationPreferences,
} from '../../utils/notificationPreferences.ts';
import { getAppSetting } from './appSettingsService.ts';

let schemaEnsured = false;

export async function ensureNotificationPreferencesSchema(): Promise<void> {
  if (schemaEnsured) return;
  try {
    await ensureDatabaseSchema();
    schemaEnsured = true;
  } catch {
    // Non-blocking in mock or restricted environments
  }
}

export async function getTenantNotificationPreferences(
  tenantId: number
): Promise<StoreNotificationPreferences> {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) {
    return createDefaultNotificationPreferences();
  }

  await ensureNotificationPreferencesSchema();

  try {
    const res = await pgClient.query<{ notification_preferences?: unknown }>(
      'SELECT notification_preferences FROM company_settings WHERE tenant_id = $1 LIMIT 1',
      [cleanTenantId]
    );
    return normalizeNotificationPreferences(res.rows[0]?.notification_preferences ?? null);
  } catch {
    return createDefaultNotificationPreferences();
  }
}

export async function saveTenantNotificationPreferences(
  tenantId: number,
  input: unknown
): Promise<StoreNotificationPreferences> {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) {
    throw new Error('Valid tenantId is required to save notification preferences.');
  }

  await ensureNotificationPreferencesSchema();
  const current = await getTenantNotificationPreferences(cleanTenantId);
  const raw = input && typeof input === 'object' ? (input as Record<string, any>) : {};

  let next: StoreNotificationPreferences;

  if (raw.resetToDefault === true) {
    next = {
      ...createDefaultNotificationPreferences(),
      updatedAt: new Date().toISOString(),
    };
  } else if (typeof raw.eventId === 'string' && typeof raw.enabled === 'boolean') {
    next = updateNotificationEventToggle(
      current,
      raw.eventId as StoreNotificationEventId,
      raw.enabled
    );
  } else if (typeof raw.channelId === 'string' && typeof raw.enabled === 'boolean') {
    next = updateNotificationChannelToggle(
      current,
      raw.channelId as StoreNotificationChannelId,
      raw.enabled
    );
  } else if (isValidNotificationPreset(raw.preset) && !raw.channels && !raw.events) {
    next = applyNotificationPreset(current, raw.preset);
  } else {
    const mergedRaw = {
      ...raw,
      preset: isValidNotificationPreset(raw.preset) ? raw.preset : current.preset,
      custom: raw.custom && typeof raw.custom === 'object' ? raw.custom : current.custom,
      updatedAt: new Date().toISOString(),
    };
    next = normalizeNotificationPreferences(mergedRaw);
  }

  const updateRes = await pgClient.query<{ notification_preferences?: unknown }>(
    `UPDATE company_settings
     SET notification_preferences = $1::jsonb, updated_at = NOW()
     WHERE tenant_id = $2
     RETURNING notification_preferences`,
    [JSON.stringify(next), cleanTenantId]
  );

  if (updateRes.rows.length === 0) {
    await pgClient.query(
      `INSERT INTO company_settings (tenant_id, notification_preferences)
       VALUES ($1, $2::jsonb)`,
      [cleanTenantId, JSON.stringify(next)]
    );
  }

  return normalizeNotificationPreferences(next);
}

export async function fetchRegisteredStoreOwnerEmails(tenantId: number): Promise<string[]> {
  const cleanTenantId = Number(tenantId);
  if (!Number.isInteger(cleanTenantId) || cleanTenantId <= 0) return [];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recipients = new Set<string>();

  try {
    const [csRes, usersRes] = await Promise.all([
      pgClient
        .query<{ email: string | null }>(
          'SELECT email FROM company_settings WHERE tenant_id = $1 LIMIT 1',
          [cleanTenantId]
        )
        .catch(() => ({ rows: [] as Array<{ email: string | null }> })),
      pgClient
        .query<{ email: string | null }>(
          `SELECT email FROM users
           WHERE tenant_id = $1
             AND UPPER(COALESCE(role::text, '')) IN ('ADMIN', 'OWNER')
             AND status = 'APPROVED'
             AND COALESCE(active, true) = true`,
          [cleanTenantId]
        )
        .catch(() => ({ rows: [] as Array<{ email: string | null }> })),
    ]);

    const csEmail = String(csRes.rows[0]?.email || '').trim().toLowerCase();
    if (csEmail && emailRegex.test(csEmail)) {
      recipients.add(csEmail);
    }

    for (const row of usersRes.rows) {
      const candidate = String(row.email || '').trim().toLowerCase();
      if (candidate && emailRegex.test(candidate)) {
        recipients.add(candidate);
      }
    }
  } catch {
    // Non-blocking email lookup
  }

  return Array.from(recipients);
}

export interface DeliveryStatusDeps {
  isFirebaseReadyFn?: () => Promise<boolean>;
  fetchOwnerTokensFn?: (tenantId: number) => Promise<string[]>;
}

export async function getStoreNotificationDeliveryStatus(
  tenantId: number,
  preferences?: StoreNotificationPreferences,
  deps?: DeliveryStatusDeps
): Promise<StoreNotificationDeliveryStatus> {
  const cleanTenantId = Number(tenantId) || 1;
  const prefs = preferences
    ? normalizeNotificationPreferences(preferences)
    : await getTenantNotificationPreferences(cleanTenantId);

  let fcmServerConfigured = false;
  try {
    if (deps?.isFirebaseReadyFn) {
      fcmServerConfigured = await deps.isFirebaseReadyFn();
    } else {
      const { getFirebaseAdmin } = await import('../pushNotificationService.ts');
      fcmServerConfigured = Boolean(await getFirebaseAdmin());
    }
  } catch {
    fcmServerConfigured = false;
  }

  let ownerTokens: string[] = [];
  try {
    if (deps?.fetchOwnerTokensFn) {
      ownerTokens = await deps.fetchOwnerTokensFn(cleanTenantId);
    } else {
      await ensureFcmTokensSchema();
      const tokensRes = await pgClient.query<{ token: string }>(
        `SELECT token
         FROM public.fcm_tokens
         WHERE tenant_id = $1
           AND UPPER(user_role) IN ('ADMIN', 'OWNER')
           AND tenant_id != 0`,
        [cleanTenantId]
      );
      ownerTokens = Array.from(
        new Set(tokensRes.rows.map((r) => String(r.token || '').trim()).filter(Boolean))
      );
    }
  } catch {
    ownerTokens = [];
  }

  const registeredOwnerEmails = await fetchRegisteredStoreOwnerEmails(cleanTenantId);
  const globalEmailAlertsEnabled =
    (await getAppSetting('EMAIL_POS_ALERTS_ENABLED', 'true')).toLowerCase() !== 'false';

  let emailFallbackReason: EmailFallbackReason = null;
  if (!prefs.channels.webPush) {
    emailFallbackReason = 'web_push_inactive';
  } else if (!fcmServerConfigured) {
    emailFallbackReason = 'web_push_unavailable';
  } else if (ownerTokens.length === 0) {
    emailFallbackReason = 'no_active_subscription';
  }

  const emailFallbackActive = Boolean(
    emailFallbackReason !== null &&
      prefs.channels.emailAlerts &&
      globalEmailAlertsEnabled &&
      registeredOwnerEmails.length > 0
  );

  return {
    fcmServerConfigured,
    hasActiveOwnerPushSubscription: ownerTokens.length > 0,
    activeOwnerSubscriptionCount: ownerTokens.length,
    registeredOwnerEmails,
    globalEmailAlertsEnabled,
    emailFallbackActive,
    emailFallbackReason,
  };
}
