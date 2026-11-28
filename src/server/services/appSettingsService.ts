import { pgClient } from '../../db/index.ts';
import type { AppSettingCategory, AppSettingItem } from '../../types.ts';
import {
  buildUnifiedScreenImagesMap,
  type ScreenImageSlot,
  type ScreenImagesMap,
} from '../../utils/screenImages.ts';

export type { AppSettingCategory, AppSettingItem, ScreenImageSlot, ScreenImagesMap };

export interface AppSettingDefinition {
  key: string;
  defaultValue: string;
  category: AppSettingCategory;
  description: string;
  isSecret: boolean;
}

export const APP_SETTINGS_DEFAULTS: AppSettingDefinition[] = [
  // 1. Billing Group
  {
    key: 'INVOICE_PREFIX',
    defaultValue: 'INV-',
    category: 'billing',
    description: 'Default prefix for customer sales receipts and invoices',
    isSecret: false,
  },
  {
    key: 'PURCHASE_PREFIX',
    defaultValue: 'PUR-',
    category: 'billing',
    description: 'Default prefix for supplier purchase orders and stock receipts',
    isSecret: false,
  },

  // 2. Email Group (Dynamic Provider Support: Resend and Gmail SMTP)
  {
    key: 'ACTIVE_EMAIL_PROVIDER',
    defaultValue: 'resend',
    category: 'email',
    description: 'Active transactional email provider (resend or gmail)',
    isSecret: false,
  },
  {
    key: 'RESEND_API_KEY',
    defaultValue: '',
    category: 'email',
    description: 'Resend API Key for transactional emails (e.g. re_...)',
    isSecret: true,
  },
  {
    key: 'GMAIL_USER',
    defaultValue: 'sarbaazsoft@gmail.com',
    category: 'email',
    description: 'Gmail sender address for SMTP (e.g. sarbaazsoft@gmail.com)',
    isSecret: false,
  },
  {
    key: 'GMAIL_FROM_NAME',
    defaultValue: 'superadmin',
    category: 'email',
    description: 'Display sender name for Gmail SMTP emails (e.g. superadmin)',
    isSecret: false,
  },
  {
    key: 'GMAIL_APP_PASSWORD',
    defaultValue: '',
    category: 'email',
    description: 'Google App Password (16 characters) for Gmail SMTP',
    isSecret: true,
  },
  {
    key: 'RESEND_FROM',
    defaultValue: 'SarbaazSoft Shoe POS Security <onboarding@resend.dev>',
    category: 'email',
    description: 'Default verified sender address for Resend emails',
    isSecret: false,
  },
  {
    key: 'RESEND_FROM_EMAIL',
    defaultValue: 'onboarding@resend.dev',
    category: 'email',
    description: 'Sender email address for Resend emails (RESEND_FROM_EMAIL)',
    isSecret: false,
  },
  {
    key: 'RESEND_REPLY_TO',
    defaultValue: 'noreply@sarbaazsoft.com',
    category: 'email',
    description: 'Reply-To email address for Resend transactional emails',
    isSecret: false,
  },
  {
    key: 'EMAIL_WEBHOOK_URL',
    defaultValue: '',
    category: 'email',
    description: 'Optional backup webhook URL to receive outgoing email payloads',
    isSecret: false,
  },
  {
    key: 'RESEND_WEBHOOK_URL',
    defaultValue: '',
    category: 'email',
    description: 'Optional Resend delivery webhook URL',
    isSecret: false,
  },
  {
    key: 'REQUIRE_EMAIL_VERIFICATION_FOR_FREE_TRIAL',
    defaultValue: 'true',
    category: 'email',
    description: 'Require email verification for new free trial registrations before access is activated',
    isSecret: false,
  },
  {
    key: 'EMAIL_POS_ALERTS_ENABLED',
    defaultValue: 'true',
    category: 'email',
    description: 'Send instant transaction receipts and invoice alerts to store owner email',
    isSecret: false,
  },
  {
    key: 'EMAIL_SUPERADMIN_ON_SALES',
    defaultValue: 'false',
    category: 'email',
    description: 'Send copy of all cashier store sales to SuperAdmin Gmail address',
    isSecret: false,
  },

  // 3. Notifications Group (Firebase Cloud Messaging - Exclusive Push Provider)
  {
    key: 'FCM_PROJECT_ID',
    defaultValue: 'sarbaazsoft-shoe-pos',
    category: 'notifications',
    description: 'Firebase Project ID for Firebase Cloud Messaging (e.g. shoe-pos-app-12345)',
    isSecret: false,
  },
  {
    key: 'FCM_CLIENT_EMAIL',
    defaultValue: '',
    category: 'notifications',
    description: 'Firebase Admin SDK Service Account Client Email',
    isSecret: false,
  },
  {
    key: 'FCM_PRIVATE_KEY',
    defaultValue: '',
    category: 'notifications',
    description: 'Firebase Admin SDK Service Account Private Key (PEM format)',
    isSecret: true,
  },
  {
    key: 'FCM_API_KEY',
    defaultValue: 'AIzaSyD2TDwK8R-J63QkihZrQXBX3ZD-opHG3ts',
    category: 'notifications',
    description: 'Firebase Web API Key for frontend client push notification initialization',
    isSecret: false,
  },
  {
    key: 'FCM_MESSAGING_SENDER_ID',
    defaultValue: '900875095665',
    category: 'notifications',
    description: 'Firebase Cloud Messaging Sender ID (project number)',
    isSecret: false,
  },
  {
    key: 'FCM_APP_ID',
    defaultValue: '1:900875095665:web:2050a569fe0b7eded995d0',
    category: 'notifications',
    description: 'Firebase Web App ID (e.g. 1:123456789:web:abcdef)',
    isSecret: false,
  },
  {
    key: 'FCM_MEASUREMENT_ID',
    defaultValue: 'G-YNR6ETB365',
    category: 'notifications',
    description: 'Optional Firebase Analytics Measurement ID (e.g. G-XXXXXXX)',
    isSecret: false,
  },
  {
    key: 'FCM_VAPID_KEY',
    defaultValue: '',
    category: 'notifications',
    description: 'Firebase Web Push Certificate Public Key (VAPID key) for browser getToken()',
    isSecret: false,
  },

  // 3b. SuperAdmin Native Push Notification Event Triggers
  {
    key: 'SUPERADMIN_PUSH_ON_NEW_TRIAL',
    defaultValue: 'true',
    category: 'notifications',
    description: 'Trigger native push notifications for new 30-day Free Trial store registrations',
    isSecret: false,
  },
  {
    key: 'SUPERADMIN_PUSH_ON_RENEWAL',
    defaultValue: 'true',
    category: 'notifications',
    description: 'Trigger native push notifications for subscription renewals and tier upgrade requests',
    isSecret: false,
  },
  {
    key: 'SUPERADMIN_PUSH_ON_EXPIRED_STORE',
    defaultValue: 'true',
    category: 'notifications',
    description: 'Trigger native push notifications when a store subscription expires',
    isSecret: false,
  },
  {
    key: 'SUPERADMIN_PUSH_ON_SECURITY_ALERT',
    defaultValue: 'true',
    category: 'notifications',
    description: 'Trigger native push notifications for platform security events, backups, and critical system logs',
    isSecret: false,
  },
  {
    key: 'SUPERADMIN_PUSH_ON_SALES',
    defaultValue: 'false',
    category: 'notifications',
    description: 'Trigger native push notifications to SuperAdmin for high-value store sales or platform auditing',
    isSecret: false,
  },
  {
    key: 'LOW_STOCK_EMAIL_ALERTS_ENABLED',
    defaultValue: 'true',
    category: 'notifications',
    description: 'Send consolidated batched email alerts to store owners/admins when sold items cross below low stock threshold',
    isSecret: false,
  },
  {
    key: 'LOW_STOCK_PUSH_ALERTS_ENABLED',
    defaultValue: 'true',
    category: 'notifications',
    description: 'Send consolidated batched push and real-time dashboard alerts to store owners/admins on low stock threshold crossing',
    isSecret: false,
  },

  // 4. System Group
  {
    key: 'DISABLE_HMR',
    defaultValue: 'false',
    category: 'system',
    description: 'Disable Vite Hot Module Reloading in sandbox environments',
    isSecret: false,
  },
  {
    key: 'GEMINI_API_KEY',
    defaultValue: '',
    category: 'system',
    description: 'Google Gemini API Key for Sammi AI assistant',
    isSecret: true,
  },
  {
    key: 'PUBLIC_APP_URL',
    defaultValue: '',
    category: 'system',
    description: 'Public HTTPS application URL embedded in desktop installers',
    isSecret: false,
  },
  {
    key: 'TWA_PACKAGE_NAME',
    defaultValue: 'com.sarbaazsoft.shoepos',
    category: 'system',
    description: 'Android Trusted Web Activity package identifier',
    isSecret: false,
  },
  {
    key: 'ASSETLINKS_SHA256',
    defaultValue: '',
    category: 'system',
    description: 'Comma-separated SHA-256 certificate fingerprints for Android Digital Asset Links',
    isSecret: false,
  },
  {
    key: 'SCREEN_BG_BACKDROP',
    defaultValue: '',
    category: 'system',
    description: 'Unified custom backdrop image URL or uploaded image shared across all routes and screens',
    isSecret: false,
  },
  {
    key: 'SCREEN_BG_LOGIN',
    defaultValue: '',
    category: 'system',
    description: 'Legacy alias synced to unified screen backdrop image',
    isSecret: false,
  },
  {
    key: 'SCREEN_BG_REGISTRATION',
    defaultValue: '',
    category: 'system',
    description: 'Legacy alias synced to unified screen backdrop image',
    isSecret: false,
  },
  {
    key: 'SCREEN_BG_AUTH',
    defaultValue: '',
    category: 'system',
    description: 'Legacy alias synced to unified screen backdrop image',
    isSecret: false,
  },
  {
    key: 'SCREEN_BG_LOADING',
    defaultValue: '',
    category: 'system',
    description: 'Legacy alias synced to unified screen backdrop image',
    isSecret: false,
  },
];

export const SCREEN_IMAGE_KEYS = {
  backdrop: 'SCREEN_BG_BACKDROP',
  login: 'SCREEN_BG_LOGIN',
  registration: 'SCREEN_BG_REGISTRATION',
  auth: 'SCREEN_BG_AUTH',
  loading: 'SCREEN_BG_LOADING',
} as const;

const MAX_SCREEN_IMAGE_DATA_URI_LENGTH = 4_500_000;
const MAX_SCREEN_IMAGE_URL_LENGTH = 2048;

export function validateScreenImageInput(raw: unknown): { valid: boolean; value: string; error?: string } {
  if (raw === undefined || raw === null) {
    return { valid: true, value: '' };
  }
  const str = String(raw).trim();
  if (!str) {
    return { valid: true, value: '' };
  }
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i.test(str)) {
    if (str.length > MAX_SCREEN_IMAGE_DATA_URI_LENGTH) {
      return { valid: false, value: '', error: 'Uploaded image is too large (max ~3 MB after compression).' };
    }
    return { valid: true, value: str };
  }
  if (str.startsWith('data:')) {
    return { valid: false, value: '', error: 'Only raster image uploads (PNG, JPG, WEBP, GIF, AVIF) are supported.' };
  }
  if (str.length > MAX_SCREEN_IMAGE_URL_LENGTH) {
    return { valid: false, value: '', error: 'Image URL exceeds maximum length (2048 characters).' };
  }
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, value: '', error: 'Only http:// or https:// image URLs are allowed.' };
    }
    return { valid: true, value: parsed.toString() };
  } catch {
    return { valid: false, value: '', error: 'Please enter a valid http(s) image URL or upload an image file.' };
  }
}

let schemaInitPromise: Promise<void> | null = null;

// Optional listener when settings are updated
type SettingsUpdateListener = (updatedKey: string, newValue: string) => void;
const updateListeners = new Set<SettingsUpdateListener>();

export function registerSettingsUpdateListener(listener: SettingsUpdateListener): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

/**
 * Initializes the app_settings table and seeds default values exclusively in the database.
 */
export async function ensureAppSettingsSchema(options?: { force?: boolean }): Promise<void> {
  if (options?.force) {
    schemaInitPromise = null;
  }
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS public.app_settings (
          key VARCHAR(100) PRIMARY KEY,
          value TEXT NOT NULL DEFAULT '',
          category VARCHAR(50) NOT NULL DEFAULT 'system',
          description TEXT DEFAULT '',
          is_secret BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS app_settings_category_idx ON public.app_settings (category)
      `);

      // Sanitize any malformed non-HTTP URLs that may have been saved into webhook fields
      await pgClient.query(`
        UPDATE public.app_settings 
        SET value = '' 
        WHERE key IN ('EMAIL_WEBHOOK_URL', 'RESEND_WEBHOOK_URL') 
          AND value != '' 
          AND value NOT ILIKE 'http://%' 
          AND value NOT ILIKE 'https://%'
      `).catch(() => {});

      // Remove legacy Telegram, VAPID, SW_KILL_SWITCH, and ACTIVE_ALERT_PROVIDER keys from app_settings
      await pgClient.query(`
        DELETE FROM public.app_settings 
        WHERE key IN ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_SUPERADMIN_CHAT_ID', 'TELEGRAM_ALERTS_ENABLED', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'SW_KILL_SWITCH', 'ACTIVE_ALERT_PROVIDER')
      `).catch(() => {});

      // Seed all default settings if not already present (strictly from APP_SETTINGS_DEFAULTS, never from process.env)
      for (const def of APP_SETTINGS_DEFAULTS) {
        await pgClient.query(
          `INSERT INTO public.app_settings (key, value, category, description, is_secret, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (key) DO NOTHING`,
          [def.key, def.defaultValue, def.category, def.description, def.isSecret]
        );
      }

      // Ensure Gmail SMTP sender credentials have the requested defaults if currently empty
      await pgClient.query(`
        UPDATE public.app_settings
        SET value = 'sarbaazsoft@gmail.com'
        WHERE key = 'GMAIL_USER' AND (value IS NULL OR value = '')
      `).catch(() => {});
      await pgClient.query(`
        UPDATE public.app_settings
        SET value = 'superadmin'
        WHERE key = 'GMAIL_FROM_NAME' AND (value IS NULL OR value = '')
      `).catch(() => {});

      // Seed default FCM frontend configuration if currently empty
      await pgClient.query(`
        UPDATE public.app_settings SET value = 'sarbaazsoft-shoe-pos' WHERE key = 'FCM_PROJECT_ID' AND (value IS NULL OR value = '');
        UPDATE public.app_settings SET value = 'AIzaSyD2TDwK8R-J63QkihZrQXBX3ZD-opHG3ts' WHERE key = 'FCM_API_KEY' AND (value IS NULL OR value = '');
        UPDATE public.app_settings SET value = '900875095665' WHERE key = 'FCM_MESSAGING_SENDER_ID' AND (value IS NULL OR value = '');
        UPDATE public.app_settings SET value = '1:900875095665:web:2050a569fe0b7eded995d0' WHERE key = 'FCM_APP_ID' AND (value IS NULL OR value = '');
        UPDATE public.app_settings SET value = 'G-YNR6ETB365' WHERE key = 'FCM_MEASUREMENT_ID' AND (value IS NULL OR value = '');
      `).catch(() => {});
    } catch (err: any) {
      schemaInitPromise = null;
      console.warn('Notice while ensuring app_settings schema:', err?.message || err);
    }
  })();

  return schemaInitPromise;
}

/**
 * Dynamic asynchronous getter for an app setting with fallback value.
 * Always reads directly from PostgreSQL app_settings table without any in-memory caching
 * and without falling back to process.env or .env files.
 */
export async function getAppSetting(key: string, fallback?: string): Promise<string> {
  const def = APP_SETTINGS_DEFAULTS.find((d) => d.key === key);

  try {
    if (key === 'RESEND_FROM' || key === 'RESEND_FROM_EMAIL') {
      const res = await pgClient.query<{ key: string; value: string }>(
        `SELECT key, value FROM public.app_settings WHERE key IN ('RESEND_FROM', 'RESEND_FROM_EMAIL')`
      );
      const map = new Map(res.rows.map((r) => [r.key, (r.value || '').trim()]));
      const directVal = map.get(key);
      if (directVal) {
        return directVal;
      }
      if (key === 'RESEND_FROM' && map.get('RESEND_FROM_EMAIL')) {
        return `SarbaazSoft Shoe POS Security <${map.get('RESEND_FROM_EMAIL')}>`;
      }
      if (key === 'RESEND_FROM_EMAIL' && map.get('RESEND_FROM')) {
        const fromVal = map.get('RESEND_FROM') || '';
        const match = fromVal.match(/<([^>]+)>/);
        const emailVal = match ? match[1].trim() : fromVal;
        if (emailVal && emailVal.includes('@')) {
          return emailVal;
        }
      }
    } else {
      const res = await pgClient.query<{ value: string }>(
        `SELECT value FROM public.app_settings WHERE UPPER(key) = UPPER($1) LIMIT 1`,
        [key]
      );
      if (res.rows.length > 0) {
        const val = (res.rows[0].value || '').trim();
        if (key === 'RESEND_API_KEY') {
          return val || fallback || '';
        }
        if (val !== '') {
          return val;
        }
      }
    }
  } catch (err) {
    console.warn(`Notice querying ${key} directly from app_settings:`, err);
  }

  if (key === 'RESEND_API_KEY') {
    return fallback || '';
  }

  return fallback ?? def?.defaultValue ?? '';
}

/**
 * Returns all app settings grouped by category and keyed by key name directly from PostgreSQL.
 * Service-layer enforcement: Validates that callers specifying a user role hold Platform Owner (SUPERADMIN).
 */
export async function getAllAppSettings(
  userRole?: string,
  options?: { allowInternal?: boolean }
): Promise<{
  byKey: Record<string, string>;
  grouped: Record<AppSettingCategory, AppSettingItem[]>;
  items: AppSettingItem[];
}> {
  if (userRole !== undefined && !options?.allowInternal) {
    if (String(userRole).toUpperCase() !== 'SUPERADMIN') {
      const err: any = new Error('Forbidden: Platform Owner (SuperAdmin) permission required to access root system settings.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_PLATFORM_OWNER_REQUIRED';
      throw err;
    }
  }

  await ensureAppSettingsSchema();
  const res = await pgClient.query<AppSettingItem>(
    `SELECT key, value, category, description, is_secret as "isSecret", updated_at as "updatedAt"
     FROM public.app_settings
     ORDER BY category ASC, key ASC`
  );

  const byKey: Record<string, string> = {};
  const grouped: Record<AppSettingCategory, AppSettingItem[]> = {
    billing: [],
    email: [],
    notifications: [],
    system: [],
  };

  const rows: AppSettingItem[] = (
    res.rows.length > 0
      ? res.rows.map((r: any) => ({
          key: r.key,
          value: r.value ?? '',
          category: (r.category || 'system') as AppSettingCategory,
          description: r.description ?? '',
          isSecret: r.isSecret ?? Boolean(r.is_secret),
          updatedAt: r.updatedAt ?? r.updated_at,
        }))
      : APP_SETTINGS_DEFAULTS.map((d) => ({
          key: d.key,
          value: d.defaultValue,
          category: d.category,
          description: d.description,
          isSecret: d.isSecret,
          updatedAt: new Date().toISOString(),
        }))
  );

  for (const item of rows) {
    byKey[item.key] = item.value ?? '';
    const cat = (item.category || 'system') as AppSettingCategory;
    if (!grouped[cat]) {
      grouped[cat] = [];
    }
    grouped[cat].push(item);
  }

  // Ensure all known defaults appear in the response even if unseeded
  for (const def of APP_SETTINGS_DEFAULTS) {
    if (byKey[def.key] === undefined) {
      const val = def.defaultValue;
      byKey[def.key] = val;
      const item: AppSettingItem = {
        key: def.key,
        value: val,
        category: def.category,
        description: def.description,
        isSecret: def.isSecret,
      };
      grouped[def.category].push(item);
    }
  }

  // Provide uppercase canonical keys for platform email settings
  if (byKey.ACTIVE_EMAIL_PROVIDER) byKey.active_email_provider = byKey.ACTIVE_EMAIL_PROVIDER;
  if (byKey.RESEND_API_KEY) byKey.resend_api_key = byKey.RESEND_API_KEY;

  return { byKey, grouped, items: rows };
}

/**
 * Updates one or multiple app settings directly in PostgreSQL.
 * Service-layer enforcement: Validates that callers specifying a user role hold Platform Owner (SUPERADMIN).
 */
export async function updateAppSettings(
  updates: Record<string, string | number | boolean | null | undefined>,
  userRole?: string,
  options?: { allowInternal?: boolean }
): Promise<Record<string, string>> {
  if (userRole !== undefined && !options?.allowInternal) {
    if (String(userRole).toUpperCase() !== 'SUPERADMIN') {
      const err: any = new Error('Forbidden: Platform Owner (SuperAdmin) permission required to mutate root system settings.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_PLATFORM_OWNER_REQUIRED';
      throw err;
    }
  }

  await ensureAppSettingsSchema();

  const cleanUpdates: Record<string, string> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null) continue;
    cleanUpdates[k] = String(v).trim();
  }

  // Alias uppercase configuration keys for platform email providers
  if (cleanUpdates.active_email_provider && !cleanUpdates.ACTIVE_EMAIL_PROVIDER) {
    cleanUpdates.ACTIVE_EMAIL_PROVIDER = cleanUpdates.active_email_provider;
  }
  if (cleanUpdates.resend_api_key !== undefined && !cleanUpdates.RESEND_API_KEY) {
    cleanUpdates.RESEND_API_KEY = cleanUpdates.resend_api_key;
  }

  if (cleanUpdates.ACTIVE_EMAIL_PROVIDER) {
    cleanUpdates.ACTIVE_EMAIL_PROVIDER = cleanUpdates.ACTIVE_EMAIL_PROVIDER.toLowerCase() === 'gmail' ? 'gmail' : 'resend';
  }

  // Cross-synchronize sender address and sender email for Resend routines
  if (cleanUpdates.RESEND_FROM && !cleanUpdates.RESEND_FROM_EMAIL) {
    const match = cleanUpdates.RESEND_FROM.match(/<([^>]+)>/);
    const emailVal = match ? match[1].trim() : cleanUpdates.RESEND_FROM.trim();
    if (emailVal.includes('@')) {
      cleanUpdates.RESEND_FROM_EMAIL = emailVal;
    }
  } else if (cleanUpdates.RESEND_FROM_EMAIL && (!cleanUpdates.RESEND_FROM || cleanUpdates.RESEND_FROM === 'SarbaazSoft Shoe POS Security <onboarding@resend.dev>')) {
    const emailVal = cleanUpdates.RESEND_FROM_EMAIL.trim();
    if (emailVal.includes('@')) {
      cleanUpdates.RESEND_FROM = `SarbaazSoft Shoe POS Security <${emailVal}>`;
    }
  }

  // Sanitize webhook URLs to ensure malformed non-URL text is not stored
  for (const hookKey of ['EMAIL_WEBHOOK_URL', 'RESEND_WEBHOOK_URL']) {
    if (cleanUpdates[hookKey]) {
      const val = cleanUpdates[hookKey];
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        cleanUpdates[hookKey] = '';
      }
    }
  }

  // Detect Firebase project / Sender ID / App ID / API Key / VAPID / Service Account rotation before persisting so stale tokens from an older project/app or VAPID key are purged
  const fcmRotationKeys = [
    'FCM_PROJECT_ID',
    'FCM_MESSAGING_SENDER_ID',
    'FCM_APP_ID',
    'FCM_VAPID_KEY',
    'FCM_API_KEY',
    'FCM_CLIENT_EMAIL',
    'FCM_PRIVATE_KEY',
  ] as const;
  const hasFcmRotationInput = fcmRotationKeys.some((k) => cleanUpdates[k] !== undefined);
  let shouldPurgeStaleFcmTokens = false;

  if (hasFcmRotationInput) {
    try {
      const existingFcmRes = await pgClient.query<{ key: string; value: string }>(
        `SELECT key, value FROM public.app_settings WHERE key = ANY($1::text[])`,
        [Array.from(fcmRotationKeys)]
      );
      const prevMap = new Map(existingFcmRes.rows.map((r) => [r.key, String(r.value || '').trim()]));
      for (const k of fcmRotationKeys) {
        const nextVal = cleanUpdates[k];
        if (nextVal !== undefined) {
          const prevVal = prevMap.get(k) || '';
          if (k === 'FCM_VAPID_KEY' && prevVal !== nextVal && (prevVal !== '' || nextVal !== '')) {
            shouldPurgeStaleFcmTokens = true;
            break;
          }
          if (prevVal && nextVal && prevVal !== nextVal) {
            shouldPurgeStaleFcmTokens = true;
            break;
          }
        }
      }
    } catch {}
  }

  for (const [key, value] of Object.entries(cleanUpdates)) {
    const def = APP_SETTINGS_DEFAULTS.find((d) => d.key === key);
    const category = def?.category || 'system';
    const description = def?.description || '';
    const isSecret = def?.isSecret || false;

    await pgClient.query(
      `INSERT INTO public.app_settings (key, value, category, description, is_secret, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [key, value, category, description, isSecret]
    );

    // Notify listeners (e.g. push notification service when credentials change)
    for (const listener of updateListeners) {
      try {
        listener(key, value);
      } catch (lErr) {
        console.warn('Listener notice during setting update:', lErr);
      }
    }
  }

  if (shouldPurgeStaleFcmTokens) {
    await pgClient.query(`DELETE FROM public.fcm_tokens`).catch(() => {});
  }

  return cleanUpdates;
}

export async function getScreenImageSettings(): Promise<ScreenImagesMap> {
  await ensureAppSettingsSchema();
  try {
    const res = await pgClient.query<{ key: string; value: string }>(
      `SELECT key, value FROM public.app_settings WHERE key IN ('SCREEN_BG_BACKDROP', 'SCREEN_BG_LOGIN', 'SCREEN_BG_REGISTRATION', 'SCREEN_BG_AUTH', 'SCREEN_BG_LOADING')`
    );
    const byKey = new Map<string, string>();
    for (const row of res.rows) {
      byKey.set(String(row.key || '').toUpperCase(), String(row.value || '').trim());
    }
    const unified =
      byKey.get('SCREEN_BG_BACKDROP') ||
      byKey.get('SCREEN_BG_LOGIN') ||
      byKey.get('SCREEN_BG_AUTH') ||
      byKey.get('SCREEN_BG_REGISTRATION') ||
      byKey.get('SCREEN_BG_LOADING') ||
      '';
    return buildUnifiedScreenImagesMap(unified);
  } catch (err) {
    console.warn('Notice reading screen image settings:', err);
  }
  return buildUnifiedScreenImagesMap('');
}

export async function updateScreenImageSettings(
  updates: string | Partial<Record<ScreenImageSlot | 'backdropImage' | 'image' | 'url', unknown>>,
  userRole?: string
): Promise<ScreenImagesMap> {
  const cleanRole = String(userRole || '').toUpperCase();
  if (cleanRole !== 'SUPERADMIN' && cleanRole !== 'ADMIN') {
    const err: any = new Error('Forbidden: Store Admin or SuperAdmin permission required to customize screen backdrop image.');
    err.statusCode = 403;
    err.code = 'FORBIDDEN_ROLE';
    throw err;
  }

  let candidateValue: unknown;
  let hasInput = false;

  if (typeof updates === 'string') {
    candidateValue = updates;
    hasInput = true;
  } else if (updates && typeof updates === 'object') {
    const priorityKeys = ['backdrop', 'backdropImage', 'image', 'url', 'login', 'auth', 'registration', 'loading'] as const;
    for (const k of priorityKeys) {
      if (Object.prototype.hasOwnProperty.call(updates, k)) {
        const val = (updates as Record<string, unknown>)[k];
        if (!hasInput) {
          candidateValue = val;
          hasInput = true;
        }
        if (typeof val === 'string' && val.trim()) {
          candidateValue = val;
          break;
        }
      }
    }
  }

  if (hasInput) {
    const checked = validateScreenImageInput(candidateValue);
    if (!checked.valid) {
      const err: any = new Error(checked.error || 'Invalid backdrop image.');
      err.statusCode = 400;
      throw err;
    }

    const mapped: Record<string, string> = {};
    (Object.values(SCREEN_IMAGE_KEYS) as string[]).forEach((settingKey) => {
      mapped[settingKey] = checked.value;
    });
    await updateAppSettings(mapped, cleanRole, { allowInternal: true });
  }

  return getScreenImageSettings();
}

