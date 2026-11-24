import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pgClient } from './index.ts';
import { ensureAppSettingsSchema } from '../server/services/appSettingsService.ts';
import { resetSchemaColumnSyncState, syncMissingSchemaColumns } from './schemaSync.ts';

let saasControlPlaneInitialized = false;
let saasControlPlanePromise: Promise<void> | null = null;
let devSeedBootstrapPromise: Promise<boolean> | null = null;
let databaseSchemaPromise: Promise<void> | null = null;
let databaseEnumsSchemaPromise: Promise<void> | null = null;
let customerLedgerSchemaPromise: Promise<void> | null = null;
let platformNotificationsSchemaPromise: Promise<void> | null = null;
let notificationsSchemaPromise: Promise<void> | null = null;
let emailVerificationSchemaVerified = false;
let passwordResetSchemaVerified = false;
let authRateLimitSchemaVerified = false;
let fcmTokensSchemaPromise: Promise<void> | null = null;

export function isSaasControlPlaneInitialized(): boolean {
  return saasControlPlaneInitialized;
}

export function resetSaasControlPlaneState(): void {
  saasControlPlaneInitialized = false;
  saasControlPlanePromise = null;
  databaseSchemaPromise = null;
  databaseEnumsSchemaPromise = null;
  customerLedgerSchemaPromise = null;
  platformNotificationsSchemaPromise = null;
  notificationsSchemaPromise = null;
  emailVerificationSchemaVerified = false;
  passwordResetSchemaVerified = false;
  authRateLimitSchemaVerified = false;
  fcmTokensSchemaPromise = null;
  resetSchemaColumnSyncState();
}

/**
 * Normalizes subscription plan / type to 'free_tier', '6_MONTHS' or 'YEARLY'
 */
export function normalizeSubscriptionPlan(plan?: string | null): 'free_tier' | '6_MONTHS' | 'YEARLY' {
  const clean = String(plan || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (
    clean === 'free_tier' ||
    clean === 'freetier' ||
    clean === 'free' ||
    clean === 'trial' ||
    clean === 'free_trial' ||
    clean === '30_day_trial' ||
    clean === '30_days' ||
    clean === 'pro_trial' ||
    !clean
  ) {
    return 'free_tier';
  }
  if (clean === '6_months' || clean === '6_month' || clean === 'six_months' || clean.startsWith('6_month')) {
    return '6_MONTHS';
  }
  if (clean === '1_year' || clean === 'yearly' || clean === 'year' || clean === '1year' || clean === 'one_year') {
    return 'YEARLY';
  }
  return 'free_tier';
}

export function normalizeSubscriptionType(plan?: string | null): 'free_tier' | '6_months' | '1_year' {
  const norm = normalizeSubscriptionPlan(plan);
  if (norm === '6_MONTHS') return '6_months';
  if (norm === 'YEARLY') return '1_year';
  return 'free_tier';
}

export { calculateDaysLeft, daysLeft } from '../utils/subscription.ts';

/**
 * Calculates subscriptionEndDate automatically based on plan ('free_tier' => +30 days, '6_MONTHS' => +6 months, 'YEARLY' => +1 year)
 */
export function calculateSubscriptionEndDate(
  plan: 'free_tier' | 'TRIAL' | '6_MONTHS' | 'YEARLY' | string,
  startDate: Date = new Date()
): Date {
  const normalized = normalizeSubscriptionPlan(plan);
  const end = new Date(startDate.getTime());
  if (normalized === 'free_tier') {
    end.setDate(end.getDate() + 30);
  } else if (normalized === '6_MONTHS') {
    end.setMonth(end.getMonth() + 6);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return end;
}

/**
 * Synchronizes expired subscriptions in PostgreSQL so any tenant whose subscription_end_date < NOW()
 * is automatically marked with subscription_status = 'EXPIRED', along with any linked active trial records.
 */
export async function syncExpiredTenantSubscriptions(): Promise<void> {
  try {
    await pgClient.query(`
      UPDATE tenants
      SET subscription_status = 'EXPIRED',
          updated_at = NOW()
      WHERE subscription_end_date IS NOT NULL
        AND subscription_end_date < NOW()
        AND subscription_status NOT IN ('EXPIRED', 'SUSPENDED')
    `);
    await pgClient
      .query(`
        WITH newly_expired AS (
          UPDATE trial_activations ta
          SET status = 'EXPIRED',
              expired_at = COALESCE(ta.expired_at, NOW()),
              updated_at = NOW()
          FROM tenants t
          WHERE (ta.tenant_id = t.id OR ta.tenant_id IS NULL)
            AND ta.status IN ('ACTIVE', 'PENDING')
            AND (
              ta.trial_end_date <= NOW()
              OR (ta.tenant_id IS NOT NULL AND t.subscription_status::text = 'EXPIRED')
            )
          RETURNING ta.id, ta.tenant_id, ta.user_id, ta.status, ta.trial_end_date, ta.email, ta.user_name, ta.store_name
        )
        INSERT INTO trial_tracking_history (
          trial_id, tenant_id, user_id, event_type, previous_status, new_status,
          previous_end_date, new_end_date, actor_role, owner_email, owner_name, store_name, notes
        )
        SELECT DISTINCT
          ne.id, ne.tenant_id, ne.user_id, 'EXPIRED', 'ACTIVE', 'EXPIRED',
          ne.trial_end_date, ne.trial_end_date, 'SYSTEM', ne.email, ne.user_name, ne.store_name,
          'Free trial period ended and status transitioned to EXPIRED automatically.'
        FROM newly_expired ne
        WHERE NOT EXISTS (
          SELECT 1 FROM trial_tracking_history tth
          WHERE tth.trial_id = ne.id
            AND tth.event_type = 'EXPIRED'
            AND tth.new_status = 'EXPIRED'
            AND tth.created_at >= NOW() - INTERVAL '5 minutes'
        )
      `)
      .catch(() => {});
  } catch {}
}

export const REQUIRED_DATABASE_TABLES = [
  'tenants',
  'users',
  'password_reset_codes',
  'email_verification_tokens',
  'auth_resend_rate_limits',
  'company_settings',
  'categories',
  'products',
  'customers',
  'suppliers',
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
  'customer_ledger',
  'supplier_ledger',
  'trial_activations',
  'trial_tracking_history',
  'app_settings',
  'platform_notifications',
  'platform_notification_reads',
  'pos_notification_dismissals',
  'notifications',
  'fcm_tokens',
] as const;

export const DATABASE_ENUM_DDL: string[] = [
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'business_type_enum') THEN
      CREATE TYPE business_type_enum AS ENUM ('RETAIL', 'WHOLESALE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_mode_enum') THEN
      CREATE TYPE pricing_mode_enum AS ENUM ('FIXED', 'NEGOTIABLE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'movement_type_enum') THEN
      CREATE TYPE movement_type_enum AS ENUM ('PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'packing_type_enum') THEN
      CREATE TYPE packing_type_enum AS ENUM ('PAIR', 'CARTON');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sale_type_enum') THEN
      CREATE TYPE sale_type_enum AS ENUM ('RETAIL', 'WHOLESALE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
      CREATE TYPE user_role_enum AS ENUM ('SUPERADMIN', 'ADMIN', 'CASHIER', 'MANAGER');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status_enum') THEN
      CREATE TYPE user_status_enum AS ENUM ('PENDING', 'APPROVED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_status_enum') THEN
      CREATE TYPE tenant_status_enum AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
      CREATE TYPE subscription_status_enum AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan_enum') THEN
      CREATE TYPE subscription_plan_enum AS ENUM ('free_tier', 'FREE_TIER', 'TRIAL', '6_MONTHS', 'YEARLY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_type_enum') THEN
      CREATE TYPE subscription_type_enum AS ENUM ('free_tier', '6_months', '1_year', 'TRIAL', '6_MONTHS', 'YEARLY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_payment_status_enum') THEN
      CREATE TYPE purchase_payment_status_enum AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
    END IF;
  END $$;`,
  `CREATE OR REPLACE FUNCTION upper(val user_role_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION btrim(val user_role_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val user_role_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val user_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION btrim(val user_status_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val user_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val business_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION btrim(val business_type_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val business_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val pricing_mode_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION btrim(val pricing_mode_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val pricing_mode_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val tenant_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val tenant_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val subscription_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val subscription_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val subscription_plan_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val subscription_plan_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val sale_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val sale_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val packing_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val packing_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val movement_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val movement_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION upper(val purchase_payment_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;`,
  `CREATE OR REPLACE FUNCTION lower(val purchase_payment_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;`,
];

export const DATABASE_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    status tenant_status_enum NOT NULL DEFAULT 'ACTIVE',
    subscription_type TEXT NOT NULL DEFAULT 'free_tier',
    subscription_plan TEXT NOT NULL DEFAULT 'free_tier',
    subscription_start_date TIMESTAMP NOT NULL DEFAULT NOW(),
    subscription_end_date TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    subscription_status subscription_status_enum NOT NULL DEFAULT 'ACTIVE',
    onboarding_completed BOOLEAN NOT NULL DEFAULT true,
    welcome_dismissed BOOLEAN NOT NULL DEFAULT false,
    deleted_product_ids INTEGER[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 0 CHECK (tenant_id >= 0),
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    quick_password TEXT NOT NULL DEFAULT '',
    role user_role_enum NOT NULL DEFAULT 'CASHIER',
    status user_status_enum NOT NULL DEFAULT 'PENDING',
    active BOOLEAN NOT NULL DEFAULT true,
    theme_color TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_codes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 0 CHECK (tenant_id >= 0),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS auth_resend_rate_limits (
    id SERIAL PRIMARY KEY,
    flow TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMP NULL,
    cooldown_until TIMESTAMP NULL,
    window_start_at TIMESTAMP NULL,
    window_request_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_resend_rate_limits_scope_unique UNIQUE (flow, scope_type, scope_key)
  )`,
  `CREATE TABLE IF NOT EXISTS company_settings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    logo TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    strn TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'PKR',
    currency_name TEXT NOT NULL DEFAULT 'Pakistani Rupee',
    currency_symbol TEXT NOT NULL DEFAULT 'Rs.',
    invoice_footer TEXT NOT NULL DEFAULT 'Thank you for shopping with us!',
    show_receipt_logo BOOLEAN NOT NULL DEFAULT false,
    receipt_logo TEXT NOT NULL DEFAULT '',
    low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
    pricing_mode pricing_mode_enum NOT NULL DEFAULT 'FIXED',
    business_type business_type_enum NOT NULL DEFAULT 'RETAIL',
    allow_half_carton BOOLEAN NOT NULL DEFAULT true,
    notification_preferences JSONB DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT company_settings_tenant_unique UNIQUE (tenant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_product_no INTEGER,
    name TEXT NOT NULL,
    brand VARCHAR(100) NOT NULL DEFAULT 'Unbranded',
    category VARCHAR(100) NOT NULL DEFAULT 'Men',
    barcode TEXT NOT NULL,
    article TEXT NOT NULL DEFAULT '',
    primary_image_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    min_price INTEGER NOT NULL DEFAULT 0,
    max_price INTEGER NOT NULL DEFAULT 0,
    pairs_per_carton INTEGER NOT NULL DEFAULT 12 CHECK (pairs_per_carton > 0),
    allow_half_carton BOOLEAN NOT NULL DEFAULT true,
    total_stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
    is_low_stock_alert_sent BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    customer_type VARCHAR(30) NOT NULL DEFAULT 'RETAILER',
    shop_name TEXT NOT NULL DEFAULT '',
    market_name TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    notes TEXT,
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    outstanding_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    ntn_number TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_number TEXT NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL,
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_status purchase_payment_status_enum NOT NULL DEFAULT 'UNPAID',
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_purchase_price NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS supplier_payments (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    payment_number TEXT NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_name TEXT NOT NULL,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    payment_date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    reference_number TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_returns (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    return_number TEXT NOT NULL,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    return_date TEXT NOT NULL,
    total_debit_amount NUMERIC(12, 2) NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_return_items (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_purchase_price NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    defect_type TEXT NOT NULL DEFAULT 'MANUFACTURING_DEFECT'
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    sale_type sale_type_enum NOT NULL DEFAULT 'RETAIL',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    sale_date TEXT NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12, 2) NOT NULL,
    total_cartons NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    previous_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    remaining_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    transaction_id TEXT NOT NULL DEFAULT '',
    cash_received NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    change_given NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_by INTEGER NOT NULL REFERENCES users(id),
    is_min_price_overridden BOOLEAN NOT NULL DEFAULT false,
    overridden_by INTEGER REFERENCES users(id),
    notes TEXT,
    client_tx_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    packing_type packing_type_enum NOT NULL DEFAULT 'PAIR',
    carton_quantity NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    pairs_per_carton INTEGER NOT NULL DEFAULT 1,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    subtotal NUMERIC(12, 2) NOT NULL,
    purchase_price NUMERIC(12, 2) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS returns (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    return_number TEXT NOT NULL,
    original_sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    return_date TEXT NOT NULL,
    total_refund_amount NUMERIC(12, 2) NOT NULL,
    reason TEXT NOT NULL,
    payment_method TEXT,
    customer_name TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS return_items (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    sale_item_id INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_refund_price NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_change INTEGER NOT NULL,
    prev_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    movement_type movement_type_enum NOT NULL,
    reference_id TEXT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS customer_ledger (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    transaction_date TEXT NOT NULL,
    invoice_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL DEFAULT '',
    total_bill NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    balance_change NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    running_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_method TEXT NOT NULL DEFAULT 'KHATA',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS supplier_ledger (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL DEFAULT 'OPENING_BALANCE',
    entry_date TEXT NOT NULL,
    reference_number TEXT NOT NULL DEFAULT '',
    debit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    credit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS trial_activations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    store_name TEXT NOT NULL,
    business_type TEXT NOT NULL DEFAULT 'RETAIL',
    pricing_mode TEXT NOT NULL DEFAULT 'FIXED',
    plan TEXT NOT NULL DEFAULT 'TRIAL',
    trial_duration_days INTEGER NOT NULL DEFAULT 30,
    trial_start_date TIMESTAMP NOT NULL DEFAULT NOW(),
    trial_end_date TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    converted_at TIMESTAMP NULL,
    converted_plan TEXT NULL,
    expired_at TIMESTAMP NULL,
    suspended_at TIMESTAMP NULL,
    reactivated_at TIMESTAMP NULL,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    activated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS trial_tracking_history (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER NULL,
    tenant_id INTEGER NULL,
    user_id INTEGER NULL,
    event_type TEXT NOT NULL,
    previous_status TEXT NULL,
    new_status TEXT NOT NULL,
    previous_end_date TIMESTAMP NULL,
    new_end_date TIMESTAMP NULL,
    actor_user_id INTEGER NULL,
    actor_email TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL DEFAULT 'SYSTEM',
    owner_email TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL DEFAULT '',
    store_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    category VARCHAR(50) NOT NULL DEFAULT 'system',
    description TEXT NOT NULL DEFAULT '',
    is_secret BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS platform_notifications (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NULL REFERENCES tenants(id) ON DELETE CASCADE,
    target_role TEXT NOT NULL DEFAULT 'ALL',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'INFO',
    action_url TEXT NOT NULL DEFAULT '',
    action_label TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP NULL,
    event_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS platform_notification_reads (
    id SERIAL PRIMARY KEY,
    notification_id INTEGER NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
    user_id INTEGER NOT NULL DEFAULT 0 CHECK (user_id >= 0),
    read_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT platform_notification_reads_unique UNIQUE (notification_id, tenant_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pos_notification_dismissals (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
    user_id INTEGER NOT NULL DEFAULT 0 CHECK (user_id >= 0),
    item_type TEXT NOT NULL DEFAULT 'SALE',
    item_id INTEGER NOT NULL,
    dismissed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT pos_notification_dismissals_unique UNIQUE (tenant_id, user_id, item_type, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
    target_role TEXT NOT NULL DEFAULT 'ADMIN',
    type TEXT NOT NULL DEFAULT 'LOW_STOCK',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    sale_id INTEGER NULL REFERENCES sales(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL DEFAULT '',
    action_url TEXT NOT NULL DEFAULT '/?tab=inventory&lowStockOnly=true',
    items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    event_id TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS fcm_tokens (
    token TEXT PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
    user_id INTEGER NOT NULL DEFAULT 0 CHECK (user_id >= 0),
    user_role TEXT NOT NULL DEFAULT 'ADMIN',
    user_agent TEXT NOT NULL DEFAULT '',
    device_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
];

export const DATABASE_INDEX_DDL: string[] = [
  `CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status)`,
  `CREATE INDEX IF NOT EXISTS tenants_subscription_status_idx ON tenants(subscription_status)`,
  `CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx ON users (LOWER(BTRIM(email)))`,
  `CREATE INDEX IF NOT EXISTS password_reset_codes_user_idx ON password_reset_codes(user_id)`,
  `CREATE INDEX IF NOT EXISTS password_reset_codes_code_idx ON password_reset_codes(code)`,
  `CREATE INDEX IF NOT EXISTS email_verification_tokens_token_idx ON email_verification_tokens(token)`,
  `CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS auth_resend_rate_limits_lookup_idx ON auth_resend_rate_limits(flow, scope_type, scope_key)`,
  `CREATE INDEX IF NOT EXISTS company_settings_tenant_idx ON company_settings(tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_unique_idx ON categories (LOWER(BTRIM(name)))`,
  `CREATE INDEX IF NOT EXISTS products_tenant_idx ON products(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS products_tenant_product_no_idx ON products(tenant_id, tenant_product_no)`,
  `CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand)`,
  `CREATE INDEX IF NOT EXISTS products_category_idx ON products(category)`,
  `CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode)`,
  `CREATE INDEX IF NOT EXISTS products_article_idx ON products(article)`,
  `CREATE INDEX IF NOT EXISTS products_tenant_article_idx ON products(tenant_id, article)`,
  `CREATE INDEX IF NOT EXISTS products_tenant_barcode_idx ON products(tenant_id, barcode)`,
  `CREATE INDEX IF NOT EXISTS products_active_idx ON products(active)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_unique_idx ON products (COALESCE(tenant_id, 1), LOWER(BTRIM(barcode))) WHERE barcode IS NOT NULL AND BTRIM(barcode) <> ''`,
  `CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_article_unique_idx ON products (COALESCE(tenant_id, 1), LOWER(BTRIM(article))) WHERE article IS NOT NULL AND BTRIM(article) <> ''`,
  `CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone)`,
  `CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS purchases_tenant_idx ON purchases(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS purchases_tenant_supplier_idx ON purchases(tenant_id, supplier_id)`,
  `CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON purchase_items(purchase_id)`,
  `CREATE INDEX IF NOT EXISTS supplier_payments_tenant_idx ON supplier_payments(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS supplier_payments_date_idx ON supplier_payments(payment_date)`,
  `CREATE INDEX IF NOT EXISTS supplier_payments_number_idx ON supplier_payments(payment_number)`,
  `CREATE INDEX IF NOT EXISTS purchase_returns_tenant_idx ON purchase_returns(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS purchase_returns_number_idx ON purchase_returns(return_number)`,
  `CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx ON purchase_returns(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS purchase_return_items_return_idx ON purchase_return_items(purchase_return_id)`,
  `CREATE INDEX IF NOT EXISTS purchase_return_items_product_idx ON purchase_return_items(product_id)`,
  `CREATE INDEX IF NOT EXISTS sales_tenant_idx ON sales(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS sales_tenant_date_idx ON sales(tenant_id, sale_date)`,
  `CREATE INDEX IF NOT EXISTS sales_invoice_idx ON sales(invoice_number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_client_tx_id_unique_idx ON sales(COALESCE(tenant_id, 1), client_tx_id) WHERE client_tx_id IS NOT NULL AND BTRIM(client_tx_id) <> ''`,
  `CREATE INDEX IF NOT EXISTS sale_items_tenant_sale_idx ON sale_items(tenant_id, sale_id)`,
  `CREATE INDEX IF NOT EXISTS returns_tenant_idx ON returns(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS returns_tenant_sale_idx ON returns(tenant_id, original_sale_id)`,
  `CREATE INDEX IF NOT EXISTS return_items_return_idx ON return_items(return_id)`,
  `CREATE INDEX IF NOT EXISTS stock_movements_tenant_idx ON stock_movements(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id)`,
  `CREATE INDEX IF NOT EXISTS stock_movements_created_at_idx ON stock_movements(created_at)`,
  `CREATE INDEX IF NOT EXISTS customer_ledger_tenant_cust_idx ON customer_ledger(tenant_id, customer_id)`,
  `CREATE INDEX IF NOT EXISTS customer_ledger_date_idx ON customer_ledger(transaction_date)`,
  `CREATE INDEX IF NOT EXISTS customer_ledger_invoice_idx ON customer_ledger(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS supplier_ledger_supplier_idx ON supplier_ledger(tenant_id, supplier_id)`,
  `CREATE INDEX IF NOT EXISTS trial_activations_email_idx ON trial_activations(LOWER(BTRIM(email)))`,
  `CREATE INDEX IF NOT EXISTS trial_activations_tenant_idx ON trial_activations(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS trial_activations_status_idx ON trial_activations(status)`,
  `CREATE INDEX IF NOT EXISTS trial_tracking_history_trial_idx ON trial_tracking_history(trial_id)`,
  `CREATE INDEX IF NOT EXISTS trial_tracking_history_tenant_idx ON trial_tracking_history(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS trial_tracking_history_event_idx ON trial_tracking_history(event_type)`,
  `CREATE INDEX IF NOT EXISTS trial_tracking_history_created_idx ON trial_tracking_history(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS trial_tracking_history_email_idx ON trial_tracking_history(LOWER(BTRIM(owner_email)))`,
  `CREATE INDEX IF NOT EXISTS app_settings_category_idx ON app_settings(category)`,
  `CREATE INDEX IF NOT EXISTS platform_notifications_tenant_idx ON platform_notifications(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS platform_notifications_target_role_idx ON platform_notifications(target_role)`,
  `CREATE INDEX IF NOT EXISTS platform_notifications_created_at_idx ON platform_notifications(created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS platform_notifications_event_id_unique_idx ON platform_notifications(event_id) WHERE event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS platform_notification_reads_notif_idx ON platform_notification_reads(notification_id)`,
  `CREATE INDEX IF NOT EXISTS platform_notification_reads_tenant_idx ON platform_notification_reads(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS pos_notification_dismissals_idx ON pos_notification_dismissals(tenant_id, user_id, item_type)`,
  `CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx ON notifications(tenant_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(tenant_id, is_read)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_id_unique_idx ON notifications(event_id) WHERE event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS fcm_tokens_tenant_idx ON fcm_tokens(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS fcm_tokens_user_role_idx ON fcm_tokens(user_role)`,
  `CREATE INDEX IF NOT EXISTS fcm_tokens_user_id_idx ON fcm_tokens(user_id)`,
];

function findTableDdl(tableName: string): string {
  const ddl = DATABASE_TABLE_DDL.find((statement) =>
    new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\b`, 'i').test(statement)
  );
  if (!ddl) {
    throw new Error(`Missing DDL definition for table: ${tableName}`);
  }
  return ddl;
}

/**
 * Ensures all custom PostgreSQL ENUM types and helper functions exist.
 */
export function ensureDatabaseEnumsSchema(): Promise<void> {
  if (!databaseEnumsSchemaPromise) {
    databaseEnumsSchemaPromise = (async () => {
      await pgClient.waitReady;
      for (const enumDdl of DATABASE_ENUM_DDL) {
        await pgClient.exec(enumDdl);
      }
    })().catch((error) => {
      databaseEnumsSchemaPromise = null;
      throw error;
    });
  }
  return databaseEnumsSchemaPromise;
}

/**
 * Ensures all standalone database tables and indexes exist in topological order.
 */
export async function ensureDatabaseSchema(): Promise<void> {
  if (databaseSchemaPromise) return databaseSchemaPromise;

  databaseSchemaPromise = (async () => {
    try {
      await pgClient.waitReady;
      await ensureDatabaseEnumsSchema();

      for (const ddl of DATABASE_TABLE_DDL) {
        await pgClient.exec(ddl);
      }

      await syncMissingSchemaColumns({
        tableDdls: DATABASE_TABLE_DDL,
        indexDdls: DATABASE_INDEX_DDL,
        ensureEnums: ensureDatabaseEnumsSchema,
      });

      await pgClient
        .exec(`DROP TABLE IF EXISTS password_reset_tokens CASCADE`)
        .catch(() => {});

      await pgClient
        .exec(
          `ALTER TABLE sales
           DROP COLUMN IF EXISTS transport_name,
           DROP COLUMN IF EXISTS bilty_number,
           DROP COLUMN IF EXISTS booking_destination`
        )
        .catch(() => {});

      for (const idxDdl of DATABASE_INDEX_DDL) {
        await pgClient.exec(idxDdl).catch(() => {});
      }
    } finally {
      databaseSchemaPromise = null;
    }
  })();

  return databaseSchemaPromise;
}

/** Ensures customer_ledger table and indexes exist cleanly. */
export function ensureCustomerLedgerSchema(): Promise<void> {
  if (!customerLedgerSchemaPromise) {
    customerLedgerSchemaPromise = (async () => {
      await pgClient.waitReady;
      await pgClient.exec(findTableDdl('customer_ledger'));
      for (const idxDdl of DATABASE_INDEX_DDL.filter((ddl) => ddl.includes('customer_ledger'))) {
        await pgClient.exec(idxDdl).catch(() => {});
      }
    })().catch((error) => {
      customerLedgerSchemaPromise = null;
      throw error;
    });
  }
  return customerLedgerSchemaPromise;
}

/** Ensures platform_notifications, platform_notification_reads, and pos_notification_dismissals tables exist cleanly. */
export function ensurePlatformNotificationsSchema(): Promise<void> {
  if (!platformNotificationsSchemaPromise) {
    platformNotificationsSchemaPromise = (async () => {
      await pgClient.waitReady;
      await pgClient.exec(findTableDdl('platform_notifications'));
      await pgClient.exec(findTableDdl('platform_notification_reads'));
      await pgClient.exec(findTableDdl('pos_notification_dismissals'));
      for (const idxDdl of DATABASE_INDEX_DDL.filter(
        (ddl) =>
          ddl.includes('platform_notifications') ||
          ddl.includes('platform_notification_reads') ||
          ddl.includes('pos_notification_dismissals')
      )) {
        await pgClient.exec(idxDdl).catch(() => {});
      }
    })().catch((error) => {
      platformNotificationsSchemaPromise = null;
      throw error;
    });
  }
  return platformNotificationsSchemaPromise;
}

/** Ensures the tenant-scoped notifications table and indexes exist cleanly. */
export function ensureNotificationsSchema(): Promise<void> {
  if (!notificationsSchemaPromise) {
    notificationsSchemaPromise = (async () => {
      await pgClient.waitReady;
      await pgClient.exec(findTableDdl('notifications'));
      for (const idxDdl of DATABASE_INDEX_DDL.filter((ddl) => ddl.includes('notifications_'))) {
        await pgClient.exec(idxDdl).catch(() => {});
      }
    })().catch((error) => {
      notificationsSchemaPromise = null;
      throw error;
    });
  }
  return notificationsSchemaPromise;
}

/**
 * Automatically clears subscription and renewal alerts upon renewal or trial extension
 * by setting expires_at = NOW().
 */
export async function clearSubscriptionAlertsOnRenewal(tenantId: number): Promise<void> {
  const cleanId = Number(tenantId) || 1;
  try {
    const tenantRes = await pgClient
      .query<{ name: string }>('SELECT name FROM tenants WHERE id = $1 LIMIT 1', [cleanId])
      .catch(() => ({ rows: [] as Array<{ name: string }> }));
    const storeName = String(tenantRes.rows[0]?.name || '').trim();
    const storeNamePattern = storeName ? `%${storeName}%` : '__never_match_store_name__';

    await pgClient.query(
      `UPDATE platform_notifications
       SET expires_at = NOW()
       WHERE (
         (tenant_id = $1 AND (
           title ILIKE '%Expiring Soon%'
           OR title ILIKE '%Subscription Expired%'
           OR title ILIKE '%Free Trial%'
           OR title ILIKE '%Subscription%'
         ))
         OR (target_role = 'SUPERADMIN' AND (
           event_id LIKE $2
           OR event_id LIKE $3
           OR ((title ILIKE 'New Renewal Request%' OR title ILIKE 'Renewal Request:%' OR title ILIKE '%Expired%') AND message ILIKE $4)
         ))
       )
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [cleanId, `renewal-request-${cleanId}-%`, `sa-sub-expired-${cleanId}-%`, storeNamePattern]
    );
  } catch (err) {
    console.warn('Could not clear subscription alerts on renewal:', err);
  }
}

export async function ensureEmailVerificationSchema(): Promise<void> {
  if (emailVerificationSchemaVerified) return;
  try {
    await pgClient.waitReady;
    await pgClient.exec(findTableDdl('email_verification_tokens'));
    await pgClient.exec(
      `ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`
    ).catch(() => {});
    for (const idxDdl of DATABASE_INDEX_DDL.filter((ddl) => ddl.includes('email_verification_tokens'))) {
      await pgClient.exec(idxDdl).catch(() => {});
    }
    emailVerificationSchemaVerified = true;
  } catch (err) {
    console.warn('Could not ensure email_verification_tokens table:', err);
  }
}

export async function ensurePasswordResetSchema(): Promise<void> {
  if (passwordResetSchemaVerified) return;
  try {
    await pgClient.waitReady;
    await pgClient.exec(`DROP TABLE IF EXISTS password_reset_tokens CASCADE`).catch(() => {});
    await pgClient.exec(findTableDdl('password_reset_codes'));
    await pgClient.exec(
      `ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`
    ).catch(() => {});
    for (const idxDdl of DATABASE_INDEX_DDL.filter((ddl) => ddl.includes('password_reset_codes'))) {
      await pgClient.exec(idxDdl).catch(() => {});
    }
    passwordResetSchemaVerified = true;
  } catch (err) {
    console.warn('Could not ensure password_reset_codes table:', err);
  }
}

export async function ensureAuthRateLimitSchema(): Promise<void> {
  if (authRateLimitSchemaVerified) return;
  try {
    await pgClient.waitReady;
    await pgClient.exec(findTableDdl('auth_resend_rate_limits'));
    for (const idxDdl of DATABASE_INDEX_DDL.filter((ddl) => ddl.includes('auth_resend_rate_limits'))) {
      await pgClient.exec(idxDdl).catch(() => {});
    }
    authRateLimitSchemaVerified = true;
  } catch (err) {
    console.warn('Could not ensure auth_resend_rate_limits table:', err);
  }
}

export async function ensureFcmTokensSchema(): Promise<void> {
  if (fcmTokensSchemaPromise) return fcmTokensSchemaPromise;
  fcmTokensSchemaPromise = (async () => {
    try {
      await pgClient.waitReady;
      await pgClient.exec(findTableDdl('fcm_tokens'));
      for (const idxDdl of DATABASE_INDEX_DDL.filter((ddl) => ddl.includes('fcm_tokens'))) {
        await pgClient.exec(idxDdl).catch(() => {});
      }
    } catch (err) {
      console.warn('Notice ensuring FCM tokens schema:', err);
    }
  })();
  return fcmTokensSchemaPromise;
}

/**
 * Ensures that a given tenant store has an active Store Owner (ADMIN) and resolves optional Store Cashier (CASHIER)
 * credentials for quick login.
 */
export interface StoreQuickCredential {
  id: number;
  name: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'CASHIER';
}

export async function ensureTenantStoreUsers(params: {
  tenantId: number;
  storeName?: string;
  ownerEmail?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerPassword?: string;
  createCashier?: boolean;
  cashierName?: string;
  cashierEmail?: string;
  cashierPhone?: string;
  cashierPassword?: string;
  ownerStatus?: 'PENDING' | 'APPROVED';
}): Promise<{
  owner: StoreQuickCredential;
  cashier: StoreQuickCredential | null;
}> {
  const tenantId = Number(params.tenantId) || 1;
  const storeLabel = (params.storeName || 'Store').trim();
  const ownerStatus = params.ownerStatus || 'APPROVED';

  const defaultOwnerEmail = (params.ownerEmail || `admin+${tenantId}@store.com`).trim().toLowerCase();
  const defaultOwnerName = (params.ownerName || params.ownerEmail?.split('@')[0] || `${storeLabel} Owner`).trim();
  const explicitPassword = params.ownerPassword && params.ownerPassword.trim() ? params.ownerPassword.trim() : '';
  const defaultOwnerPassword = explicitPassword || 'admin123';

  const adminRes = await pgClient.query<{
    id: number;
    name: string;
    email: string;
    password_hash: string;
    quick_password: string;
    status: string;
  }>(
    `SELECT id, name, email, password_hash, COALESCE(quick_password, '') as quick_password, status
     FROM users
     WHERE tenant_id = $1 AND role = 'ADMIN'
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );

  let ownerCred: StoreQuickCredential;
  if (adminRes.rows.length > 0) {
    const row = adminRes.rows[0];
    let verifiedPass = '';
    const targetStatus = row.status === 'PENDING' && ownerStatus === 'PENDING' ? 'PENDING' : 'APPROVED';
    if (row.quick_password && (await bcrypt.compare(row.quick_password, row.password_hash))) {
      verifiedPass = row.quick_password;
    } else {
      const candidates = Array.from(
        new Set([defaultOwnerPassword, 'admin123', 'password123', '123456'])
      );
      for (const cand of candidates) {
        if (await bcrypt.compare(cand, row.password_hash)) {
          verifiedPass = cand;
          break;
        }
      }
      if (!verifiedPass) {
        verifiedPass = defaultOwnerPassword;
        const freshHash = await bcrypt.hash(verifiedPass, 10);
        await pgClient.query(
          `UPDATE users SET password_hash = $1, quick_password = $2, status = $3, active = true WHERE id = $4`,
          [freshHash, verifiedPass, targetStatus, row.id]
        );
      } else {
        await pgClient.query(
          `UPDATE users SET quick_password = $1, status = $2, active = true WHERE id = $3`,
          [verifiedPass, targetStatus, row.id]
        );
      }
    }
    ownerCred = {
      id: row.id,
      name: row.name,
      email: row.email,
      password: verifiedPass,
      role: 'ADMIN',
    };
  } else {
    let candidateOwnerEmail = defaultOwnerEmail;
    const emailConflictRes = await pgClient.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1)) LIMIT 1`,
      [candidateOwnerEmail]
    );
    if (emailConflictRes.rows.length > 0) {
      if (params.ownerEmail && params.ownerEmail.trim()) {
        const duplicateEmailError: any = new Error(
          'This email is already in use. Please use a different email address.'
        );
        duplicateEmailError.code = 'EMAIL_ALREADY_EXISTS';
        throw duplicateEmailError;
      }
      candidateOwnerEmail = `admin+${tenantId}@store.com`;
    }

    const ownerHash = await bcrypt.hash(defaultOwnerPassword, 10);
    const createdOwner = await pgClient.query<{ id: number; name: string; email: string }>(
      `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status, active)
       VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', $7, true)
       RETURNING id, name, email`,
      [tenantId, defaultOwnerName, candidateOwnerEmail, (params.ownerPhone || '').trim(), ownerHash, defaultOwnerPassword, ownerStatus]
    );
    ownerCred = {
      id: createdOwner.rows[0].id,
      name: createdOwner.rows[0].name,
      email: createdOwner.rows[0].email,
      password: defaultOwnerPassword,
      role: 'ADMIN',
    };
  }

  const cashierRes = await pgClient.query<{
    id: number;
    name: string;
    email: string;
    password_hash: string;
    quick_password: string;
    status: string;
  }>(
    `SELECT id, name, email, password_hash, COALESCE(quick_password, '') as quick_password, status
     FROM users
     WHERE tenant_id = $1 AND role = 'CASHIER'
     ORDER BY CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [tenantId]
  );

  let cashierCred: StoreQuickCredential | null = null;
  if (cashierRes.rows.length > 0) {
    const row = cashierRes.rows[0];
    let verifiedPass = row.quick_password || '';
    if (!verifiedPass) {
      const candidates = Array.from(
        new Set(['admin123', 'cashier123', '123456'])
      );
      for (const cand of candidates) {
        if (await bcrypt.compare(cand, row.password_hash)) {
          verifiedPass = cand;
          break;
        }
      }
    }
    cashierCred = {
      id: row.id,
      name: row.name,
      email: row.email,
      password: verifiedPass,
      role: 'CASHIER',
    };
  } else if (params.createCashier && params.cashierEmail && params.cashierPassword) {
    const cPass = params.cashierPassword.trim();
    const cEmail = params.cashierEmail.trim().toLowerCase();
    const cName = (params.cashierName || `${storeLabel} Cashier`).trim();
    const cPhone = (params.cashierPhone || '').trim();

    const existingCashierEmail = await pgClient.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1)) LIMIT 1`,
      [cEmail]
    );
    if (existingCashierEmail.rows.length > 0) {
      const duplicateEmailError: any = new Error(
        'This email is already in use. Please use a different email address.'
      );
      duplicateEmailError.code = 'EMAIL_ALREADY_EXISTS';
      throw duplicateEmailError;
    }

    const cashierHash = await bcrypt.hash(cPass, 10);

    const createdCashier = await pgClient.query<{ id: number; name: string; email: string }>(
      `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status, active)
       VALUES ($1, $2, $3, $4, $5, $6, 'CASHIER', 'APPROVED', true)
       RETURNING id, name, email`,
      [tenantId, cName, cEmail, cPhone, cashierHash, cPass]
    );
    cashierCred = {
      id: createdCashier.rows[0].id,
      name: createdCashier.rows[0].name,
      email: createdCashier.rows[0].email,
      password: cPass,
      role: 'CASHIER',
    };
  }

  return {
    owner: ownerCred,
    cashier: cashierCred,
  };
}

/**
 * Initializes the SaaS schema and synchronizes existing tenant subscriptions.
 * Uses only fresh CREATE TABLE / CREATE INDEX definitions without incremental ALTER TABLE patches.
 */
export async function ensureSaasControlPlane(): Promise<void> {
  if (saasControlPlaneInitialized) return;
  if (saasControlPlanePromise) return saasControlPlanePromise;

  saasControlPlanePromise = (async () => {
    try {
      await pgClient.waitReady;

      const fastCheck = await pgClient
        .query<{ count: string; has_core_tables: boolean }>(
          `SELECT COUNT(*) as count,
                  (to_regclass('public.users') IS NOT NULL
                   AND to_regclass('public.tenants') IS NOT NULL
                   AND to_regclass('public.company_settings') IS NOT NULL
                   AND to_regclass('public.products') IS NOT NULL
                   AND to_regclass('public.customers') IS NOT NULL
                   AND to_regclass('public.customer_ledger') IS NOT NULL
                   AND to_regclass('public.trial_activations') IS NOT NULL
                   AND to_regclass('public.platform_notifications') IS NOT NULL
                   AND to_regclass('public.platform_notification_reads') IS NOT NULL
                   AND to_regclass('public.notifications') IS NOT NULL
                   AND to_regclass('public.fcm_tokens') IS NOT NULL
                   AND to_regclass('public.email_verification_tokens') IS NOT NULL
                   AND to_regclass('public.auth_resend_rate_limits') IS NOT NULL) as has_core_tables
           FROM app_settings
           WHERE key IN ('__schema_fresh_v1__', '__schema_v17_product_low_stock_alerts__')`
        )
        .catch(() => null);

      if (
        fastCheck &&
        fastCheck.rows[0]?.has_core_tables &&
        parseInt(fastCheck.rows[0]?.count || '0', 10) > 0
      ) {
        await syncMissingSchemaColumns({
          tableDdls: DATABASE_TABLE_DDL,
          indexDdls: DATABASE_INDEX_DDL,
          ensureEnums: ensureDatabaseEnumsSchema,
        });
        await pgClient.exec(`DROP TABLE IF EXISTS password_reset_tokens CASCADE`).catch(() => {});
        await ensurePasswordResetSchema();
        await ensureAppSettingsSchema();
        await syncExpiredTenantSubscriptions();
        saasControlPlaneInitialized = true;
        return;
      }

      await ensureDatabaseSchema();

      const allTenants = await pgClient.query<{
        id: number;
        name: string;
        status: string;
        subscription_plan: string | null;
        subscription_start_date: Date | string | null;
        subscription_end_date: Date | string | null;
        subscription_status: string | null;
        owner_email: string | null;
        owner_phone: string | null;
      }>(
        `SELECT t.id, t.name, t.status, t.subscription_plan,
                t.subscription_start_date, t.subscription_end_date, t.subscription_status,
                u.email AS owner_email, u.phone AS owner_phone
         FROM tenants t
         LEFT JOIN LATERAL (
           SELECT email, phone
           FROM users
           WHERE tenant_id = t.id AND role = 'ADMIN'
           ORDER BY id ASC
           LIMIT 1
         ) u ON true
         ORDER BY t.id ASC`
      );

      for (const t of allTenants.rows) {
        let needsSubUpdate = false;

        const nextPlan = normalizeSubscriptionPlan(t.subscription_plan || 'YEARLY');
        if (t.subscription_plan !== nextPlan) {
          needsSubUpdate = true;
        }

        const startDt = t.subscription_start_date ? new Date(t.subscription_start_date) : new Date();
        const endDt = t.subscription_end_date
          ? new Date(t.subscription_end_date)
          : calculateSubscriptionEndDate(nextPlan, startDt);
        if (!t.subscription_start_date || !t.subscription_end_date) {
          needsSubUpdate = true;
        }

        const isExpiredNow = endDt.getTime() < Date.now();
        let nextSubStatus = (t.subscription_status || '').toUpperCase();
        if (String(t.status).toUpperCase() === 'SUSPENDED') {
          nextSubStatus = 'SUSPENDED';
        } else if (isExpiredNow) {
          nextSubStatus = 'EXPIRED';
        } else if (!['ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(nextSubStatus)) {
          nextSubStatus = 'ACTIVE';
        }
        if (t.subscription_status !== nextSubStatus) {
          needsSubUpdate = true;
        }

        if (needsSubUpdate) {
          await pgClient.query(
            `UPDATE tenants
             SET subscription_plan = $1,
                 subscription_start_date = $2,
                 subscription_end_date = $3,
                 subscription_status = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [nextPlan, startDt.toISOString(), endDt.toISOString(), nextSubStatus, t.id]
          );
        }

        await ensureTenantStoreUsers({
          tenantId: t.id,
          storeName: t.name,
          ownerEmail: t.owner_email || undefined,
          ownerPhone: t.owner_phone || undefined,
          createCashier: false,
        });
      }

      const superAdminHash = await bcrypt.hash('admin123', 10);
      const storeAdminHash = await bcrypt.hash('admin123', 10);

      const existingSuperAdmin = await pgClient.query<{ id: number; password_hash: string; quick_password: string }>(
        `SELECT id, password_hash, COALESCE(quick_password, '') AS quick_password FROM users WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN' ORDER BY id ASC LIMIT 1`
      );
      if (existingSuperAdmin.rows.length > 0) {
        const saRow = existingSuperAdmin.rows[0];
        if (!saRow.password_hash) {
          await pgClient.query(
            `UPDATE users
             SET tenant_id = 0,
                 password_hash = $1,
                 quick_password = 'admin123',
                 status = 'APPROVED',
                 active = true,
                 updated_at = NOW()
             WHERE id = $2`,
            [superAdminHash, saRow.id]
          );
        } else {
          await pgClient.query(
            `UPDATE users
             SET tenant_id = 0,
                 status = 'APPROVED',
                 active = true,
                 updated_at = NOW()
             WHERE UPPER(COALESCE(role::text, '')) = 'SUPERADMIN'`
          );
        }
      } else {
        const defaultSaEmail = 'sarbaazsoft@gmail.com';
        const emailTaken = await pgClient.query<{ id: number }>(
          `SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 1`,
          [defaultSaEmail]
        );
        const saEmail = emailTaken.rows.length > 0 ? 'superadmin@shoepos.local' : defaultSaEmail;
        await pgClient
          .query(
            `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status, active)
             VALUES (0, 'Khalid Dashti', $1, '+92-321-2257340', $2, 'admin123', 'SUPERADMIN', 'APPROVED', true)
             ON CONFLICT (email) DO NOTHING`,
            [saEmail, superAdminHash]
          )
          .catch(() => {});
      }

      await pgClient.query(
        `UPDATE users
         SET password_hash = $1,
             quick_password = 'admin123',
             status = 'APPROVED',
             active = true,
             updated_at = NOW()
         WHERE UPPER(COALESCE(role::text, '')) != 'SUPERADMIN'`,
        [storeAdminHash]
      );

      await syncExpiredTenantSubscriptions();
      await ensureAppSettingsSchema();

      await pgClient
        .query(
          `INSERT INTO app_settings (key, value, category, description, is_secret)
           VALUES ('__schema_fresh_v1__', 'true', 'system', 'Fresh standalone PostgreSQL schema initialized cleanly', false)
           ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
        )
        .catch(() => {});

      saasControlPlaneInitialized = true;
    } catch (err: any) {
      console.warn('Notice during SaaS control plane initialization:', err?.message || err);
    } finally {
      saasControlPlanePromise = null;
    }
  })();

  return saasControlPlanePromise;
}

/**
 * Executes the standalone idempotent seed.sql script against PostgreSQL.
 * Safe to invoke on an empty or freshly created schema.
 */
export async function applySeedSql(): Promise<boolean> {
  await pgClient.waitReady;
  const seedPath = path.resolve(process.cwd(), 'seed.sql');
  if (!fs.existsSync(seedPath)) {
    return false;
  }
  const seedSql = fs.readFileSync(seedPath, 'utf8').trim();
  if (!seedSql) {
    return false;
  }
  await pgClient.exec(seedSql);
  return true;
}

/**
 * Idempotently runs seed.sql and ensures all app_settings defaults exist
 * without overwriting any previously configured values or secrets.
 */
export async function seedDatabaseAndAppSettings(): Promise<{
  seedSqlApplied: boolean;
  appSettingsCount: number;
}> {
  await pgClient.waitReady;

  const coreCheck = await pgClient
    .query<{ has_app_settings: boolean; has_users: boolean }>(
      `SELECT
         (to_regclass('public.app_settings') IS NOT NULL) AS has_app_settings,
         (to_regclass('public.users') IS NOT NULL) AS has_users`
    )
    .catch(() => null);

  if (!coreCheck || !coreCheck.rows[0]?.has_app_settings || !coreCheck.rows[0]?.has_users) {
    await ensureDatabaseSchema();
  } else {
    await syncMissingSchemaColumns({
      tableDdls: DATABASE_TABLE_DDL,
      indexDdls: DATABASE_INDEX_DDL,
      ensureEnums: ensureDatabaseEnumsSchema,
    });
  }

  const seedSqlApplied = await applySeedSql();
  await ensureAppSettingsSchema({ force: true });

  const countRes = await pgClient
    .query<{ count: string }>(`SELECT COUNT(*) AS count FROM public.app_settings`)
    .catch(() => ({ rows: [{ count: '0' }] }));
  const appSettingsCount = parseInt(countRes.rows[0]?.count || '0', 10) || 0;

  return { seedSqlApplied, appSettingsCount };
}

/**
 * Automatically creates missing schema tables and applies seed.sql when running
 * in development mode if tables do not exist yet.
 */
export async function autoSeedDevDatabaseIfTablesMissing(
  checkMissingTables: () => Promise<boolean>
): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  if (devSeedBootstrapPromise) {
    return devSeedBootstrapPromise;
  }

  devSeedBootstrapPromise = (async () => {
    await pgClient.waitReady;
    const missing = await checkMissingTables();
    if (!missing) {
      return false;
    }
    await ensureDatabaseSchema();
    await applySeedSql();
    await ensureAppSettingsSchema({ force: true });
    await ensureSaasControlPlane();
    return true;
  })().finally(() => {
    devSeedBootstrapPromise = null;
  });

  return devSeedBootstrapPromise;
}

/**
 * Drops all tables in the public database schema with CASCADE.
 */
export async function dropAllTables(): Promise<void> {
  await pgClient.waitReady;
  resetSaasControlPlaneState();

  await pgClient.exec(`
    DROP TABLE IF EXISTS
      fcm_tokens,
      notifications,
      pos_notification_dismissals,
      platform_notification_reads,
      platform_notifications,
      app_settings,
      trial_tracking_history,
      trial_activations,
      customer_ledger,
      supplier_ledger,
      email_verification_tokens,
      password_reset_codes,
      auth_resend_rate_limits,
      stock_movements,
      return_items,
      returns,
      sale_items,
      sales,
      purchase_return_items,
      purchase_returns,
      supplier_payments,
      purchase_items,
      purchases,
      products,
      customers,
      suppliers,
      categories,
      company_settings,
      users,
      tenants
    CASCADE;
  `);

  try {
    const remainingTables = await pgClient.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    for (const row of remainingTables.rows) {
      await pgClient.exec(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE;`);
    }
  } catch (err: any) {
    console.warn('Notice during dynamic table drop:', err.message);
  }

  resetSaasControlPlaneState();
  console.log('🗑️ All database tables successfully dropped with CASCADE.');
}
