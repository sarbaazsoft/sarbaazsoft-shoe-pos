import 'dotenv/config';

import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import bcrypt from 'bcryptjs';

const Pool = pg.Pool;

// Transaction context storage to ensure queries between BEGIN and COMMIT/ROLLBACK
// execute on the same checked-out client from the pool.
interface TxContext {
  client: PoolClient | null;
}

export const txStorage = new AsyncLocalStorage<TxContext>();

export interface DbConnectionInfo {
  type: 'PostgreSQL Server';
  isStandardPostgres: true;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  maskedUrl: string;
  connected?: boolean;
  lastError?: string;
}

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();

export const isStandardPostgres = true;
let dbInfo: DbConnectionInfo;
let rawPool: PgPool | null = null;
let useMock = false;

// In-memory mock store used when DATABASE_URL is not configured or unreachable in AI Studio
const defaultPasswordHash = bcrypt.hashSync('admin123', 10);
const defaultStorePasswordHash = bcrypt.hashSync('baloch@2026', 10);

const mockStore: Record<string, any[]> = {
  tenants: [
    {
      id: 1,
      name: 'Baloch Shoes',
      status: 'ACTIVE',
      subscription_type: '1_year',
      subscription_plan: 'YEARLY',
      subscription_start_date: new Date(Date.now() - 86400000 * 30).toISOString(),
      subscription_end_date: new Date(Date.now() + 86400000 * 335).toISOString(),
      subscription_status: 'ACTIVE',
      logo_url: '/pwa-512x512.png',
      address: 'Main Boulevard, Retail District',
      tax_id: 'STRN-100200300',
      currency: 'PKR',
      onboarding_completed: true,
      welcome_dismissed: false,
      deleted_product_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 2,
      name: 'StepUp Footwear',
      status: 'ACTIVE',
      subscription_type: '6_months',
      subscription_plan: '6_MONTHS',
      subscription_start_date: new Date(Date.now() - 86400000 * 15).toISOString(),
      subscription_end_date: new Date(Date.now() + 86400000 * 165).toISOString(),
      subscription_status: 'ACTIVE',
      logo_url: '',
      address: 'Liberty Market, Gulberg, Lahore',
      tax_id: 'STRN-200300400',
      currency: 'PKR',
      onboarding_completed: true,
      welcome_dismissed: false,
      deleted_product_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 3,
      name: 'Metro Shoes Studio',
      status: 'ACTIVE',
      subscription_type: '1_year',
      subscription_plan: 'YEARLY',
      subscription_start_date: new Date(Date.now() - 86400000 * 45).toISOString(),
      subscription_end_date: new Date(Date.now() + 86400000 * 320).toISOString(),
      subscription_status: 'ACTIVE',
      logo_url: '',
      address: 'Tariq Road Commercial Area, Karachi',
      tax_id: 'STRN-300400500',
      currency: 'PKR',
      onboarding_completed: true,
      welcome_dismissed: false,
      deleted_product_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 4,
      name: 'Apex Walk Store',
      status: 'ACTIVE',
      subscription_type: '1_year',
      subscription_plan: 'YEARLY',
      subscription_start_date: new Date(Date.now() - 86400000 * 10).toISOString(),
      subscription_end_date: new Date(Date.now() + 86400000 * 355).toISOString(),
      subscription_status: 'ACTIVE',
      logo_url: '',
      address: 'Bank Road, Saddar Bazaar, Rawalpindi',
      tax_id: 'STRN-400500600',
      currency: 'PKR',
      onboarding_completed: true,
      welcome_dismissed: false,
      deleted_product_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  users: [
    {
      id: 1,
      tenant_id: 0,
      name: 'Platform SuperAdmin',
      email: 'sarbaazsoft@gmail.com',
      phone: '+92-321-2257340',
      avatar_url: '',
      password_hash: defaultPasswordHash,
      quick_password: 'admin123',
      role: 'SUPERADMIN',
      status: 'APPROVED',
      active: true,
      theme_color: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 2,
      tenant_id: 1,
      name: 'Store Owner',
      email: 'admin@balochshoes.com',
      phone: '+923001234567',
      avatar_url: '',
      password_hash: defaultStorePasswordHash,
      quick_password: 'baloch@2026',
      role: 'ADMIN',
      status: 'APPROVED',
      active: true,
      theme_color: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 3,
      tenant_id: 2,
      name: 'StepUp Owner',
      email: 'owner@stepupfootwear.com',
      phone: '+923019876543',
      avatar_url: '',
      password_hash: defaultStorePasswordHash,
      quick_password: 'stepup@2026',
      role: 'ADMIN',
      status: 'APPROVED',
      active: true,
      theme_color: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 4,
      tenant_id: 3,
      name: 'Metro Shoes Manager',
      email: 'admin@metroshoes.pk',
      phone: '+923214567890',
      avatar_url: '',
      password_hash: defaultStorePasswordHash,
      quick_password: 'metro@2026',
      role: 'ADMIN',
      status: 'APPROVED',
      active: true,
      theme_color: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 5,
      tenant_id: 4,
      name: 'Apex Walk Owner',
      email: 'contact@apexwalk.com',
      phone: '+923335551234',
      avatar_url: '',
      password_hash: defaultStorePasswordHash,
      quick_password: 'apex@2026',
      role: 'ADMIN',
      status: 'APPROVED',
      active: true,
      theme_color: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  company_settings: [
    {
      id: 1,
      tenant_id: 1,
      name: 'Baloch Shoes',
      logo: '',
      address: 'Main Boulevard, Retail District',
      phone: '+923001234567',
      email: 'admin@balochshoes.com',
      website: '',
      strn: 'STRN-100200300',
      tax_id: 'STRN-100200300',
      tax_rate: 0,
      currency: 'PKR',
      currency_name: 'Pakistani Rupee',
      currency_symbol: 'Rs.',
      invoice_footer: 'Thank you for shopping with us!',
      show_receipt_logo: false,
      receipt_logo: '',
      low_stock_threshold: 5,
      pricing_mode: 'FIXED',
      business_type: 'RETAIL',
      allow_half_carton: true,
      notification_preferences: null,
      updated_at: new Date().toISOString(),
    },
    {
      id: 2,
      tenant_id: 2,
      name: 'StepUp Footwear',
      logo: '',
      address: 'Liberty Market, Gulberg, Lahore',
      phone: '+923019876543',
      email: 'owner@stepupfootwear.com',
      website: '',
      strn: 'STRN-200300400',
      tax_id: 'STRN-200300400',
      tax_rate: 0,
      currency: 'PKR',
      currency_name: 'Pakistani Rupee',
      currency_symbol: 'Rs.',
      invoice_footer: 'Quality footwear for every step.',
      show_receipt_logo: false,
      receipt_logo: '',
      low_stock_threshold: 5,
      pricing_mode: 'NEGOTIABLE',
      business_type: 'RETAIL',
      allow_half_carton: true,
      notification_preferences: null,
      updated_at: new Date().toISOString(),
    },
    {
      id: 3,
      tenant_id: 3,
      name: 'Metro Shoes Studio',
      logo: '',
      address: 'Tariq Road Commercial Area, Karachi',
      phone: '+923214567890',
      email: 'admin@metroshoes.pk',
      website: '',
      strn: 'STRN-300400500',
      tax_id: 'STRN-300400500',
      tax_rate: 0,
      currency: 'PKR',
      currency_name: 'Pakistani Rupee',
      currency_symbol: 'Rs.',
      invoice_footer: 'Style and comfort combined.',
      show_receipt_logo: false,
      receipt_logo: '',
      low_stock_threshold: 5,
      pricing_mode: 'FIXED',
      business_type: 'RETAIL',
      allow_half_carton: true,
      notification_preferences: null,
      updated_at: new Date().toISOString(),
    },
    {
      id: 4,
      tenant_id: 4,
      name: 'Apex Walk Store',
      logo: '',
      address: 'Bank Road, Saddar Bazaar, Rawalpindi',
      phone: '+923335551234',
      email: 'contact@apexwalk.com',
      website: '',
      strn: 'STRN-400500600',
      tax_id: 'STRN-400500600',
      tax_rate: 0,
      currency: 'PKR',
      currency_name: 'Pakistani Rupee',
      currency_symbol: 'Rs.',
      invoice_footer: 'Walk with confidence.',
      show_receipt_logo: false,
      receipt_logo: '',
      low_stock_threshold: 5,
      pricing_mode: 'FIXED',
      business_type: 'RETAIL',
      allow_half_carton: true,
      notification_preferences: null,
      updated_at: new Date().toISOString(),
    },
  ],
  categories: [
    { id: 1, name: 'Men', created_at: new Date().toISOString() },
    { id: 2, name: 'Women', created_at: new Date().toISOString() },
    { id: 3, name: 'Kids', created_at: new Date().toISOString() },
    { id: 4, name: 'Toddler', created_at: new Date().toISOString() },
    { id: 5, name: 'Infant', created_at: new Date().toISOString() },
  ],
  products: [
    {
      id: 1,
      tenant_id: 1,
      tenant_product_no: 1,
      name: 'Classic Leather Runner',
      brand: 'Unbranded',
      category: 'Casual Shoes',
      barcode: '890100000001',
      article: 'SF-0001',
      primary_image_url: '',
      description: 'Everyday comfort leather runner',
      cost_price: 2500,
      min_price: 3800,
      max_price: 4200,
      pairs_per_carton: 12,
      total_stock: 20,
      low_stock_threshold: 5,
      is_low_stock_alert_sent: false,
      allow_half_carton: true,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  customers: [
    {
      id: 1,
      tenant_id: 1,
      name: 'Tariq Wholesale Traders',
      customer_type: 'WHOLESALER',
      shop_name: 'Tariq Shoes & Sons',
      market_name: 'Moti Bazar',
      city: 'Rawalpindi',
      phone: '+923009876543',
      email: 'tariq.traders@example.com',
      address: 'Shop 14, Moti Bazar, Rawalpindi',
      notes: 'Registered Wholesale Dealer',
      credit_limit: 100000,
      current_balance: 0,
      outstanding_balance: 0,
      ntn_number: 'NTN-7890123-4',
      created_at: new Date().toISOString(),
    },
  ],
  customer_ledger: [],
  supplier_ledger: [],
  suppliers: [],
  sales: [],
  sale_items: [],
  returns: [],
  return_items: [],
  purchases: [],
  purchase_items: [],
  purchase_returns: [],
  purchase_return_items: [],
  supplier_payments: [],
  stock_movements: [],
  trial_activations: [],
  trial_tracking_history: [],
  app_settings: [
    { key: 'INVOICE_PREFIX', value: 'INV-', category: 'billing', description: 'Default prefix for customer sales receipts and invoices', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'ACTIVE_EMAIL_PROVIDER', value: 'resend', category: 'email', description: 'Active email provider (resend or gmail)', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'RESEND_API_KEY', value: '', category: 'email', description: 'Resend API Key for transactional emails', is_secret: true, updated_at: new Date().toISOString() },
    { key: 'GMAIL_USER', value: 'sarbaazsoft@gmail.com', category: 'email', description: 'Gmail sender address for SMTP', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'GMAIL_FROM_NAME', value: 'superadmin', category: 'email', description: 'Display sender name for Gmail SMTP emails', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'GMAIL_APP_PASSWORD', value: '', category: 'email', description: 'Google App Password for Gmail SMTP', is_secret: true, updated_at: new Date().toISOString() },
    { key: 'RESEND_FROM', value: 'SarbaazSoft Shoe POS Security <onboarding@resend.dev>', category: 'email', description: 'Verified default sender address for Resend emails', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'RESEND_FROM_EMAIL', value: 'onboarding@resend.dev', category: 'email', description: 'Sender email address for Resend emails', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'EMAIL_WEBHOOK_URL', value: '', category: 'email', description: 'Custom webhook URL to receive outgoing email payloads', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'RESEND_WEBHOOK_URL', value: '', category: 'email', description: 'Resend delivery webhook URL', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'REQUIRE_EMAIL_VERIFICATION_FOR_FREE_TRIAL', value: 'true', category: 'email', description: 'Require email verification for new free trial registrations before access is activated', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'LOW_STOCK_EMAIL_ALERTS_ENABLED', value: 'true', category: 'notifications', description: 'Send consolidated email alerts to store owners when products cross low-stock threshold', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'LOW_STOCK_PUSH_ALERTS_ENABLED', value: 'true', category: 'notifications', description: 'Send consolidated FCM push alerts to store owners when products cross low-stock threshold', is_secret: false, updated_at: new Date().toISOString() },
    { key: 'DISABLE_HMR', value: 'false', category: 'system', description: 'Disable Vite Hot Module Reloading in sandbox environments', is_secret: false, updated_at: new Date().toISOString() },
  ],
  platform_notifications: [],
  platform_notification_reads: [],
  pos_notification_dismissals: [],
  notifications: [],
  fcm_tokens: [],
  email_verification_tokens: [],
  password_reset_codes: [],
  auth_resend_rate_limits: [],
};

let mockIdCounters: Record<string, number> = {
  tenants: 5,
  users: 6,
  company_settings: 5,
  categories: 5,
  products: 3,
  customers: 3,
  customer_ledger: 1,
  supplier_ledger: 1,
  suppliers: 1,
  sales: 1,
  sale_items: 1,
  returns: 1,
  return_items: 1,
  purchases: 1,
  purchase_items: 1,
  purchase_returns: 1,
  purchase_return_items: 1,
  supplier_payments: 1,
  stock_movements: 1,
  trial_activations: 1,
  trial_tracking_history: 1,
  platform_notifications: 1,
  platform_notification_reads: 1,
  pos_notification_dismissals: 1,
  notifications: 1,
  fcm_tokens: 1,
  email_verification_tokens: 1,
  password_reset_codes: 1,
  auth_resend_rate_limits: 1,
};

function nextMockId(table: string): number {
  const rows = mockStore[table];
  const maxExisting = Array.isArray(rows)
    ? rows.reduce((max, r) => Math.max(max, Number(r?.id) || 0), 0)
    : 0;
  const current = Math.max(mockIdCounters[table] || 1, maxExisting + 1);
  mockIdCounters[table] = current + 1;
  return current;
}

let mockTxSnapshot: { store: Record<string, any[]>; counters: Record<string, number> } | null = null;

function restoreMockStoreSnapshot(snapshot: { store: Record<string, any[]>; counters: Record<string, number> }) {
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key];
  }
  for (const [key, val] of Object.entries(snapshot.store)) {
    mockStore[key] = val;
  }
  for (const key of Object.keys(mockIdCounters)) {
    delete mockIdCounters[key];
  }
  for (const [key, val] of Object.entries(snapshot.counters)) {
    mockIdCounters[key] = val;
  }
}

async function executeMockQuery<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount?: number }> {
  const sql = text.trim();
  const upper = sql.toUpperCase();

  if (upper === 'BEGIN') {
    if (!mockTxSnapshot) {
      mockTxSnapshot = structuredClone({ store: mockStore, counters: mockIdCounters });
    }
    return { rows: [{ ok: 1 } as unknown as T], rowCount: 1 };
  }

  if (upper === 'COMMIT') {
    mockTxSnapshot = null;
    return { rows: [{ ok: 1 } as unknown as T], rowCount: 1 };
  }

  if (upper === 'ROLLBACK') {
    if (mockTxSnapshot) {
      restoreMockStoreSnapshot(mockTxSnapshot);
      mockTxSnapshot = null;
    }
    return { rows: [{ ok: 1 } as unknown as T], rowCount: 1 };
  }

  if (
    upper === 'SELECT 1' ||
    upper === 'SELECT 1 AS OK' ||
    upper.includes('PG_ADVISORY_XACT_LOCK')
  ) {
    return { rows: [{ ok: 1 } as unknown as T], rowCount: 1 };
  }

  if (upper.includes('TO_REGCLASS')) {
    if (upper.includes('UNNEST')) {
      const tables: string[] = Array.isArray(params[0]) ? params[0] : [];
      const rows = tables.map((table_name) => ({ table_name, present: true })) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    return { rows: [{ exists: true, ok: true } as unknown as T], rowCount: 1 };
  }

  // APP_SETTINGS table handling in in-memory mock store
  if (upper.includes('APP_SETTINGS')) {
    if (!mockStore.app_settings) mockStore.app_settings = [];

    if (upper.startsWith('INSERT INTO') || upper.includes('INSERT INTO PUBLIC.APP_SETTINGS')) {
      const key = String(params[0] || '').trim();
      if (!key) {
        return { rows: [], rowCount: 0 };
      }
      const value = String(params[1] !== undefined && params[1] !== null ? params[1] : '');
      const category = String(params[2] || 'system');
      const description = String(params[3] || '');
      const isSecret = Boolean(params[4]);

      const existingIdx = mockStore.app_settings.findIndex((s) => s.key.toUpperCase() === key.toUpperCase());
      const isDoNothing = upper.includes('DO NOTHING');

      if (existingIdx >= 0) {
        if (!isDoNothing) {
          mockStore.app_settings[existingIdx].value = value;
          mockStore.app_settings[existingIdx].updated_at = new Date().toISOString();
        }
        return { rows: [mockStore.app_settings[existingIdx] as unknown as T], rowCount: 1 };
      } else {
        const entry = {
          key,
          value,
          category,
          description,
          is_secret: isSecret,
          updated_at: new Date().toISOString(),
        };
        mockStore.app_settings.push(entry);
        return { rows: [entry as unknown as T], rowCount: 1 };
      }
    }

    if (upper.startsWith('SELECT')) {
      let list = [...mockStore.app_settings];
      if (upper.includes('WHERE KEY = $1') || upper.includes('WHERE UPPER(KEY) = $1') || upper.includes('WHERE UPPER(KEY) = UPPER($1)')) {
        const targetKey = String(params[0] || '').trim().toUpperCase();
        list = list.filter((s) => s.key.toUpperCase() === targetKey);
      } else if (upper.includes("WHERE UPPER(KEY) = 'RESEND_API_KEY'") || upper.includes("WHERE KEY = 'RESEND_API_KEY'")) {
        list = list.filter((s) => s.key.toUpperCase() === 'RESEND_API_KEY');
      } else if (upper.includes("WHERE KEY IN") || upper.includes("WHERE UPPER(KEY) IN")) {
        const match = upper.match(/IN\s*\(([^)]+)\)/i);
        if (match) {
          const keys = match[1].split(',').map((k) => k.replace(/['"\s]/g, '').toUpperCase());
          list = list.filter((s) => keys.includes(s.key.toUpperCase()));
        }
      }
      if (upper.includes('COUNT(*)')) {
        return { rows: [{ count: String(list.length) } as unknown as T], rowCount: 1 };
      }
      return { rows: list as unknown as T[], rowCount: list.length };
    }

    if (upper.startsWith('UPDATE')) {
      if (upper.includes('EMAIL_WEBHOOK_URL') && upper.includes('RESEND_WEBHOOK_URL')) {
        for (const s of mockStore.app_settings) {
          if (s.key === 'EMAIL_WEBHOOK_URL' || s.key === 'RESEND_WEBHOOK_URL') {
            if (s.value && !s.value.startsWith('http://') && !s.value.startsWith('https://')) {
              s.value = '';
            }
          }
        }
        return { rows: [], rowCount: 1 };
      }
      const targetKey = String(params[params.length - 1] || '').trim().toUpperCase();
      const entry = mockStore.app_settings.find((s) => s.key.toUpperCase() === targetKey);
      if (entry && params.length >= 2) {
        entry.value = String(params[0]);
        entry.updated_at = new Date().toISOString();
      }
      return { rows: entry ? ([entry] as unknown as T[]) : [], rowCount: entry ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  // 7-day sales series chart query (WITH days AS (... generate_series ...))
  if (upper.includes('GENERATE_SERIES') && upper.includes('WITH DAYS AS')) {
    const tenantFilter = params.length > 0 ? Number(params[0]) : null;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const rows: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      const label = dayNames[d.getDay()];
      const daySales = mockStore.sales.filter(
        (s) => s.sale_date === dateStr && (!tenantFilter || Number(s.tenant_id) === tenantFilter)
      );
      const amount = daySales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
      rows.push({
        date: dateStr,
        label,
        amount: String(amount),
        tx_count: String(daySales.length),
      });
    }
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  // Monthly sales series chart query (WITH months AS (... generate_series ...))
  if (upper.includes('GENERATE_SERIES') && upper.includes('WITH MONTHS AS')) {
    const tenantFilter = params.length > 0 ? Number(params[0]) : null;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const rows: any[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = monthNames[d.getMonth()];
      const yearLabel = String(d.getFullYear());
      const mSales = mockStore.sales.filter(
        (s) => String(s.sale_date || '').startsWith(monthKey) && (!tenantFilter || Number(s.tenant_id) === tenantFilter)
      );
      const amount = mSales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
      rows.push({
        month: monthKey,
        label,
        year_label: yearLabel,
        amount: String(amount),
        tx_count: String(mSales.length),
      });
    }
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  // Trial Tracking History ledger (must run BEFORE TRIAL_ACTIVATIONS check)
  if (upper.includes('TRIAL_TRACKING_HISTORY') && !upper.includes('WITH NEWLY_EXPIRED')) {
    if (!Array.isArray(mockStore.trial_tracking_history)) {
      mockStore.trial_tracking_history = [];
    }
    if (upper.startsWith('INSERT INTO')) {
      const colMatch = sql.match(/INSERT\s+INTO\s+(?:public\.)?trial_tracking_history\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:RETURNING|$)/i);
      const entry: Record<string, any> = {
        id: nextMockId('trial_tracking_history'),
        trial_id: null,
        tenant_id: null,
        user_id: null,
        event_type: 'EDITED',
        previous_status: null,
        new_status: 'ACTIVE',
        previous_end_date: null,
        new_end_date: null,
        actor_user_id: null,
        actor_email: '',
        actor_role: 'SYSTEM',
        owner_email: '',
        owner_name: '',
        store_name: '',
        notes: '',
        metadata: {},
        created_at: new Date().toISOString(),
      };
      if (colMatch) {
        const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
        const vals = colMatch[2].split(',').map((v) => v.trim());
        cols.forEach((col, idx) => {
          const expr = vals[idx];
          if (expr === undefined) return;
          const cleanExpr = expr.replace(/::\w+/g, '').trim();
          const pm = cleanExpr.match(/^\$(\d+)$/);
          let rawVal: any;
          if (pm) rawVal = params[Number(pm[1]) - 1];
          else if (/^null$/i.test(cleanExpr)) rawVal = null;
          else if (/^now\(\)$/i.test(cleanExpr)) rawVal = new Date().toISOString();
          else {
            const sm = cleanExpr.match(/^'([^']*)'$/);
            rawVal = sm ? sm[1] : cleanExpr;
          }
          if (col === 'metadata') {
            try {
              entry[col] = typeof rawVal === 'string' ? JSON.parse(rawVal || '{}') : (rawVal || {});
            } catch {
              entry[col] = {};
            }
          } else {
            entry[col] = rawVal;
          }
        });
      }
      mockStore.trial_tracking_history.unshift(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      let list = [...mockStore.trial_tracking_history];
      const whereClause = upper.split(/\bORDER\s+BY\b|\bLIMIT\b/)[0] || upper;
      if (whereClause.includes('TRIAL_ID = $1') && !whereClause.includes('COALESCE')) {
        const trialId = Number(params[0]);
        list = list.filter((h) => Number(h.trial_id) === trialId);
      } else if (whereClause.includes('TENANT_ID = $1')) {
        const tid = Number(params[0]);
        list = list.filter((h) => Number(h.tenant_id) === tid);
      } else {
        // General dynamic filtering used by GET /api/superadmin/free-trials/history
        let pIdx = 0;
        if (whereClause.includes('LIKE $')) {
          const needle = String(params[pIdx++] || '').replace(/%/g, '').toLowerCase();
          if (needle) {
            list = list.filter(
              (h) =>
                String(h.owner_email || '').toLowerCase().includes(needle) ||
                String(h.owner_name || '').toLowerCase().includes(needle) ||
                String(h.store_name || '').toLowerCase().includes(needle) ||
                String(h.notes || '').toLowerCase().includes(needle)
            );
          }
        }
        if (whereClause.includes('UPPER(EVENT_TYPE) =')) {
          const ev = String(params[pIdx++] || '').toUpperCase();
          if (ev) list = list.filter((h) => String(h.event_type || '').toUpperCase() === ev);
        } else if (whereClause.includes("EVENT_TYPE IN ('EXPIRED', 'CONVERTED', 'SUSPENDED')")) {
          list = list.filter((h) => ['EXPIRED', 'CONVERTED', 'SUSPENDED'].includes(String(h.event_type || '').toUpperCase()));
        }
        if (whereClause.includes('TRIAL_ID =')) {
          const tid = Number(params[pIdx++]);
          if (tid) list = list.filter((h) => Number(h.trial_id) === tid);
        }
        if (whereClause.includes('TENANT_ID =')) {
          const tid = Number(params[pIdx++]);
          if (tid) list = list.filter((h) => Number(h.tenant_id) === tid);
        }
      }
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || Number(b.id) - Number(a.id));
      return { rows: list as unknown as T[], rowCount: list.length };
    }
    if (upper.startsWith('DELETE FROM')) {
      const before = mockStore.trial_tracking_history.length;
      if (upper.includes('TENANT_ID = $1') && params.length === 1) {
        const tid = Number(params[0]);
        mockStore.trial_tracking_history = mockStore.trial_tracking_history.filter((h) => Number(h.tenant_id) !== tid);
      } else if (upper.includes('TRIAL_ID = $1') && params.length === 1) {
        const trialId = Number(params[0]);
        mockStore.trial_tracking_history = mockStore.trial_tracking_history.filter((h) => Number(h.trial_id) !== trialId);
      } else {
        const tid = params[0] !== null && params[0] !== undefined ? Number(params[0]) : null;
        const trialIds = Array.isArray(params[1]) ? params[1].map(Number) : [];
        const userIds = Array.isArray(params[2]) ? params[2].map(Number) : [];
        const emails = Array.isArray(params[3]) ? params[3].map((e: any) => String(e || '').trim().toLowerCase()) : [];
        mockStore.trial_tracking_history = mockStore.trial_tracking_history.filter((h) => {
          if (tid && Number(h.tenant_id) === tid) return false;
          if (h.trial_id && trialIds.includes(Number(h.trial_id))) return false;
          if (h.user_id && userIds.includes(Number(h.user_id))) return false;
          if (h.owner_email && emails.includes(String(h.owner_email).trim().toLowerCase())) return false;
          return true;
        });
      }
      return { rows: [], rowCount: before - mockStore.trial_tracking_history.length };
    }
    return { rows: [], rowCount: 0 };
  }

  // Trial Activations tracking & automatic expiration sync for Free Trial management
  if (upper.includes('TRIAL_ACTIVATIONS')) {
    if (!Array.isArray(mockStore.trial_activations)) {
      mockStore.trial_activations = [];
    }
    if (!Array.isArray(mockStore.trial_tracking_history)) {
      mockStore.trial_tracking_history = [];
    }

    if (upper.includes('WITH NEWLY_EXPIRED AS')) {
      const nowMs = Date.now();
      for (const ta of mockStore.trial_activations) {
        const tenant = ta.tenant_id ? mockStore.tenants.find((t) => Number(t.id) === Number(ta.tenant_id)) : null;
        const statusUpper = String(ta.status || '').toUpperCase();
        if (!['ACTIVE', 'PENDING'].includes(statusUpper)) continue;
        const endMs = ta.trial_end_date ? new Date(ta.trial_end_date).getTime() : 0;
        const tenantExpired = tenant && String(tenant.subscription_status || '').toUpperCase() === 'EXPIRED';
        if ((endMs > 0 && endMs <= nowMs) || tenantExpired) {
          ta.status = 'EXPIRED';
          ta.expired_at = ta.expired_at || new Date().toISOString();
          ta.updated_at = new Date().toISOString();
          const alreadyLogged = mockStore.trial_tracking_history.some(
            (h) =>
              Number(h.trial_id) === Number(ta.id) &&
              h.event_type === 'EXPIRED' &&
              h.new_status === 'EXPIRED' &&
              nowMs - new Date(h.created_at).getTime() < 300_000
          );
          if (!alreadyLogged) {
            mockStore.trial_tracking_history.unshift({
              id: nextMockId('trial_tracking_history'),
              trial_id: ta.id,
              tenant_id: ta.tenant_id,
              user_id: ta.user_id,
              event_type: 'EXPIRED',
              previous_status: statusUpper,
              new_status: 'EXPIRED',
              previous_end_date: ta.trial_end_date,
              new_end_date: ta.trial_end_date,
              actor_user_id: null,
              actor_email: '',
              actor_role: 'SYSTEM',
              owner_email: ta.email || '',
              owner_name: ta.user_name || '',
              store_name: ta.store_name || '',
              notes: 'Free trial period ended and status transitioned to EXPIRED automatically.',
              metadata: {},
              created_at: new Date().toISOString(),
            });
          }
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('INSERT INTO') || upper.includes('INSERT INTO PUBLIC.TRIAL_ACTIVATIONS')) {
      const nowIso = new Date().toISOString();
      const entry = {
        id: nextMockId('trial_activations'),
        user_id: params[0] !== undefined && params[0] !== null ? Number(params[0]) : null,
        tenant_id: params[1] !== undefined && params[1] !== null ? Number(params[1]) : null,
        email: String(params[2] || '').trim().toLowerCase(),
        user_name: String(params[3] || ''),
        phone: String(params[4] || ''),
        store_name: String(params[5] || ''),
        business_type: String(params[6] || 'RETAIL'),
        pricing_mode: String(params[7] || 'FIXED'),
        plan: String(params[8] || 'TRIAL'),
        trial_duration_days: Number(params[9] || 30),
        trial_start_date: params[10] ? new Date(params[10]).toISOString() : nowIso,
        trial_end_date: params[11] ? new Date(params[11]).toISOString() : new Date(Date.now() + 86400000 * 30).toISOString(),
        status: String(params[12] || 'ACTIVE'),
        converted_at: null,
        converted_plan: null,
        expired_at: null,
        suspended_at: null,
        reactivated_at: null,
        ip_address: String(params[13] || ''),
        user_agent: String(params[14] || ''),
        activated_at: nowIso,
        updated_at: nowIso,
        details: params[15] ? (typeof params[15] === 'string' ? JSON.parse(params[15]) : params[15]) : {},
      };
      mockStore.trial_activations.unshift(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      let list = [...mockStore.trial_activations];
      const isJoined = upper.includes('LEFT JOIN TENANTS');
      if (isJoined) {
        list = list.map((ta: any) => {
          const tenant = ta.tenant_id ? mockStore.tenants.find((t) => Number(t.id) === Number(ta.tenant_id)) : null;
          const owner = ta.user_id
            ? mockStore.users.find((u) => Number(u.id) === Number(ta.user_id))
            : ta.tenant_id
            ? mockStore.users.find((u) => Number(u.tenant_id) === Number(ta.tenant_id) && String(u.role).toUpperCase() === 'ADMIN')
            : null;
          const cs = ta.tenant_id ? mockStore.company_settings.find((c) => Number(c.tenant_id) === Number(ta.tenant_id)) : null;
          return {
            ...ta,
            live_tenant_name: tenant?.name || null,
            live_tenant_status: tenant?.status || null,
            live_subscription_status: tenant?.subscription_status || null,
            live_subscription_plan: tenant?.subscription_plan || null,
            live_subscription_end_date: tenant?.subscription_end_date || null,
            live_onboarding_completed: tenant?.onboarding_completed ?? null,
            live_owner_name: owner?.name || null,
            live_owner_email: owner?.email || null,
            live_owner_phone: owner?.phone || null,
            live_business_type: cs?.business_type || null,
            live_pricing_mode: cs?.pricing_mode || null,
          };
        });
      }
      if (upper.includes('COUNT(*)')) {
        return { rows: [{ count: String(list.length) } as unknown as T], rowCount: 1 };
      }
      const outerClauseSource = upper.includes('LEFT JOIN COMPANY_SETTINGS')
        ? upper.slice(upper.lastIndexOf('LEFT JOIN COMPANY_SETTINGS'))
        : upper.includes('FROM TRIAL_ACTIVATIONS')
        ? upper.slice(upper.lastIndexOf('FROM TRIAL_ACTIVATIONS'))
        : upper;
      const whereClause = outerClauseSource.split(/\bORDER\s+BY\b|\bLIMIT\b/)[0] || outerClauseSource;
      if (whereClause.includes('WHERE TA.ID = $1') || whereClause.includes('WHERE ID = $1')) {
        const targetId = Number(params[0]);
        list = list.filter((t: any) => Number(t.id) === targetId);
      } else if (whereClause.includes('WHERE TA.TENANT_ID = $1') || whereClause.includes('WHERE TENANT_ID = $1')) {
        const tid = Number(params[0]);
        list = list.filter((t: any) => Number(t.tenant_id) === tid);
      } else if (whereClause.includes('WHERE USER_ID = $1')) {
        const uid = Number(params[0]);
        list = list.filter((t: any) => Number(t.user_id) === uid);
      } else if (whereClause.includes('LOWER(BTRIM(EMAIL)) =') || whereClause.includes('EMAIL =')) {
        const targetEmail = String(params[0] || '').trim().toLowerCase();
        list = list.filter((t: any) => String(t.email || '').toLowerCase() === targetEmail);
      } else if (params.length > 0 && whereClause.includes('LIKE $1')) {
        const needle = String(params[0] || '').replace(/%/g, '').toLowerCase();
        if (needle) {
          list = list.filter(
            (t: any) =>
              String(t.email || '').toLowerCase().includes(needle) ||
              String(t.store_name || t.live_tenant_name || '').toLowerCase().includes(needle) ||
              String(t.user_name || t.live_owner_name || '').toLowerCase().includes(needle) ||
              String(t.phone || t.live_owner_phone || '').toLowerCase().includes(needle)
          );
        }
      }
      list.sort((a: any, b: any) => new Date(b.activated_at || 0).getTime() - new Date(a.activated_at || 0).getTime() || Number(b.id) - Number(a.id));
      return { rows: list as unknown as T[], rowCount: list.length };
    }
    if (upper.startsWith('UPDATE')) {
      const lastParam = params[params.length - 1];
      const matchesTarget = (t: any) => {
        if (upper.includes('WHERE USER_ID = $')) {
          return Number(t.user_id) === Number(lastParam) && (!upper.includes("STATUS = 'PENDING'") || t.status === 'PENDING');
        }
        if (upper.includes('WHERE TENANT_ID = $')) {
          return Number(t.tenant_id) === Number(lastParam);
        }
        return Number(t.id) === Number(lastParam);
      };
      const matched = mockStore.trial_activations.filter(matchesTarget);
      const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+/i);
      const nowIso = new Date().toISOString();
      for (const entry of matched) {
        if (setMatch) {
          const setBody = setMatch[1];
          const assignRegex = /([a-z_]+)\s*=\s*(?:COALESCE\([^)]*\$(\d+)[^)]*\)|COALESCE\([^)]*\)|\$(\d+)|'([^']*)'|NOW\(\)|([a-z_]+)\s*\+\s*\$(\d+))/gi;
          let m: RegExpExecArray | null;
          while ((m = assignRegex.exec(setBody)) !== null) {
            const col = m[1].toLowerCase();
            if (col === 'updated_at') {
              entry.updated_at = nowIso;
              continue;
            }
            if (m[6]) {
              const delta = Number(params[Number(m[6]) - 1] || 0);
              entry[col] = Number(entry[col] || 0) + delta;
              continue;
            }
            const pRef = m[2] || m[3];
            const val = pRef ? params[Number(pRef) - 1] : m[4] !== undefined ? m[4] : nowIso;
            if (val !== undefined) {
              entry[col] = val;
            }
          }
          if (setBody.includes("status = 'ACTIVE'") || setBody.toLowerCase().includes("status = 'active'")) entry.status = 'ACTIVE';
          if (setBody.includes("status = 'EXPIRED'") || setBody.toLowerCase().includes("status = 'expired'")) entry.status = 'EXPIRED';
          if (setBody.includes("status = 'SUSPENDED'") || setBody.toLowerCase().includes("status = 'suspended'")) entry.status = 'SUSPENDED';
          if (setBody.includes("status = 'CONVERTED'") || setBody.toLowerCase().includes("status = 'converted'")) entry.status = 'CONVERTED';
          if (setBody.toLowerCase().includes('converted_at = now()')) entry.converted_at = entry.converted_at || nowIso;
          if (setBody.toLowerCase().includes('expired_at = now()') || setBody.toLowerCase().includes('expired_at = coalesce')) entry.expired_at = nowIso;
          if (setBody.toLowerCase().includes('suspended_at = now()') || setBody.toLowerCase().includes('suspended_at = coalesce')) entry.suspended_at = nowIso;
          if (setBody.toLowerCase().includes('reactivated_at = now()') || setBody.toLowerCase().includes('reactivated_at = coalesce')) entry.reactivated_at = nowIso;
          entry.updated_at = nowIso;
        }
      }
      return { rows: matched as unknown as T[], rowCount: matched.length };
    }
    if (upper.startsWith('DELETE FROM')) {
      const before = mockStore.trial_activations.length;
      if (upper.includes('WHERE ID = $1') && params.length === 1) {
        const targetId = Number(params[0]);
        mockStore.trial_activations = mockStore.trial_activations.filter((t: any) => Number(t.id) !== targetId);
      } else if (upper.includes('WHERE TENANT_ID = $1') && params.length === 1) {
        const tid = Number(params[0]);
        mockStore.trial_activations = mockStore.trial_activations.filter((t: any) => Number(t.tenant_id) !== tid);
      } else {
        const tid = params[0] !== null && params[0] !== undefined ? Number(params[0]) : null;
        const trialId = params[1] !== null && params[1] !== undefined ? Number(params[1]) : null;
        const userIds = Array.isArray(params[2]) ? params[2].map(Number) : [];
        const emails = Array.isArray(params[3]) ? params[3].map((e: any) => String(e || '').trim().toLowerCase()) : [];
        mockStore.trial_activations = mockStore.trial_activations.filter((t: any) => {
          if (tid && Number(t.tenant_id) === tid) return false;
          if (trialId && Number(t.id) === trialId) return false;
          if (t.user_id && userIds.includes(Number(t.user_id))) return false;
          if (t.email && emails.includes(String(t.email).trim().toLowerCase())) return false;
          return true;
        });
      }
      return { rows: [], rowCount: before - mockStore.trial_activations.length };
    }
    return { rows: [], rowCount: 0 };
  }

  // Tenant-scoped operational notifications table (must be checked BEFORE PLATFORM_NOTIFICATIONS)
  if (/(?:INTO|FROM|UPDATE)\s+(?:PUBLIC\.)?NOTIFICATIONS\b/.test(upper)) {
    if (!mockStore.notifications) mockStore.notifications = [];

    if (upper.startsWith('INSERT INTO')) {
      const colMatch = sql.match(/INSERT\s+INTO\s+(?:public\.)?notifications\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT|RETURNING|$)/i);
      const entry: Record<string, any> = {
        id: nextMockId('notifications'),
        tenant_id: 1,
        target_role: 'ADMIN',
        type: 'LOW_STOCK',
        title: '',
        message: '',
        sale_id: null,
        invoice_number: '',
        action_url: '/?tab=inventory&lowStockOnly=true',
        items_json: [],
        event_id: null,
        is_read: false,
        read_at: null,
        created_at: new Date().toISOString(),
      };
      if (colMatch) {
        const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
        const vals = colMatch[2].split(',').map((v) => v.trim());
        cols.forEach((col, idx) => {
          const expr = vals[idx];
          if (expr === undefined) return;
          const cleanExpr = expr.replace(/::\w+/g, '').trim();
          const paramMatch = cleanExpr.match(/^\$(\d+)$/);
          let rawVal: any;
          if (paramMatch) {
            rawVal = params[Number(paramMatch[1]) - 1];
          } else if (/^null$/i.test(cleanExpr)) {
            rawVal = null;
          } else if (/^true$/i.test(cleanExpr)) {
            rawVal = true;
          } else if (/^false$/i.test(cleanExpr)) {
            rawVal = false;
          } else if (/^now\(\)$/i.test(cleanExpr)) {
            rawVal = new Date().toISOString();
          } else {
            const strMatch = cleanExpr.match(/^'([^']*)'$/);
            rawVal = strMatch ? strMatch[1] : cleanExpr;
          }
          if (col === 'items_json') {
            if (typeof rawVal === 'string') {
              try {
                entry[col] = JSON.parse(rawVal);
              } catch {
                entry[col] = [];
              }
            } else {
              entry[col] = Array.isArray(rawVal) ? rawVal : [];
            }
          } else {
            entry[col] = rawVal;
          }
        });
      }
      if (entry.event_id) {
        const dup = mockStore.notifications.find((n: any) => n.event_id && String(n.event_id) === String(entry.event_id));
        if (dup) {
          if (upper.includes('ON CONFLICT') && upper.includes('DO NOTHING')) {
            return { rows: [], rowCount: 0 };
          }
          const dupErr: any = new Error('duplicate key value violates unique constraint "notifications_event_id_unique_idx"');
          dupErr.code = '23505';
          throw dupErr;
        }
      }
      mockStore.notifications.unshift(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }

    if (upper.startsWith('SELECT')) {
      let list = [...(mockStore.notifications || [])];
      if (upper.includes('TENANT_ID = ANY($1')) {
        const tids = (Array.isArray(params[0]) ? params[0] : []).map(Number);
        list = list.filter((n: any) => tids.includes(Number(n.tenant_id || 1)));
      } else {
        const tid = params.length > 0 && params[0] !== null && params[0] !== undefined ? Number(params[0]) : 1;
        list = list.filter((n: any) => Number(n.tenant_id || 1) === tid);
      }
      if (upper.includes('IS_READ = FALSE') || upper.includes('COALESCE(IS_READ, FALSE) = FALSE') || upper.includes('COALESCE(N.IS_READ, FALSE) = FALSE')) {
        list = list.filter((n: any) => !n.is_read);
      }
      if (upper.includes("INTERVAL '48 HOURS'")) {
        const cutoff = Date.now() - 48 * 3600 * 1000;
        list = list.filter((n: any) => new Date(n.created_at).getTime() >= cutoff);
      }
      if (upper.includes('LIMIT $')) {
        const limitParam = params.find((_, idx) => upper.includes(`LIMIT $${idx + 1}`));
        if (limitParam && Number(limitParam) > 0) {
          list = list.slice(0, Number(limitParam));
        }
      }
      return { rows: list as unknown as T[], rowCount: list.length };
    }

    if (upper.startsWith('UPDATE')) {
      if (upper.includes('WHERE ID = $1') && upper.includes('TENANT_ID = $2')) {
        const id = Number(params[0]);
        const tid = Number(params[1]);
        const row = (mockStore.notifications || []).find((n: any) => Number(n.id) === id && Number(n.tenant_id || 1) === tid);
        if (row) {
          row.is_read = true;
          row.read_at = new Date().toISOString();
          return { rows: [row as unknown as T], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      const tid = Number(params[0] || 1);
      let updated = 0;
      for (const n of mockStore.notifications || []) {
        if (Number(n.tenant_id || 1) === tid && !n.is_read) {
          n.is_read = true;
          n.read_at = new Date().toISOString();
          updated++;
        }
      }
      return { rows: [], rowCount: updated };
    }

    if (upper.startsWith('DELETE FROM')) {
      if (upper.includes('WHERE TENANT_ID = $1')) {
        const tid = Number(params[0] || 1);
        const before = (mockStore.notifications || []).length;
        mockStore.notifications = (mockStore.notifications || []).filter(
          (n: any) => Number(n.tenant_id || 1) !== tid
        );
        return { rows: [], rowCount: before - mockStore.notifications.length };
      }
      const before = (mockStore.notifications || []).length;
      mockStore.notifications = [];
      return { rows: [], rowCount: before };
    }
    return { rows: [], rowCount: 0 };
  }

  // FCM_TOKENS tracking for background push delivery
  if (upper.includes('FCM_TOKENS')) {
    if (!mockStore.fcm_tokens) mockStore.fcm_tokens = [];
    if (upper.startsWith('INSERT INTO')) {
      const token = String(params[0] || '').trim();
      const tid = Number(params[1] || 1);
      const uid = Number(params[2] || 0);
      const role = String(params[3] || 'ADMIN').toUpperCase();
      const ua = String(params[4] || '');
      const deviceName = String(params[5] || '');
      const existing = mockStore.fcm_tokens.find((f: any) => f.token === token);
      if (existing) {
        existing.tenant_id = tid;
        existing.user_id = uid;
        existing.user_role = role;
        existing.user_agent = ua;
        existing.device_name = deviceName;
        existing.updated_at = new Date().toISOString();
        return { rows: [existing as unknown as T], rowCount: 1 };
      }
      const entry = {
        id: nextMockId('fcm_tokens'),
        token,
        tenant_id: tid,
        user_id: uid,
        user_role: role,
        user_agent: ua,
        device_name: deviceName,
        updated_at: new Date().toISOString(),
      };
      mockStore.fcm_tokens.push(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      let rows = [...mockStore.fcm_tokens];
      if (upper.includes('TENANT_ID = $1')) {
        const tid = Number(params[0] || 1);
        rows = rows.filter((f: any) => Number(f.tenant_id) === tid);
      }
      if (upper.includes("UPPER(USER_ROLE) IN ('ADMIN', 'OWNER')")) {
        rows = rows.filter((f: any) => ['ADMIN', 'OWNER'].includes(String(f.user_role || '').toUpperCase()));
      } else if (upper.includes("UPPER(USER_ROLE) = 'SUPERADMIN'")) {
        rows = rows.filter((f: any) => String(f.user_role || '').toUpperCase() === 'SUPERADMIN');
      }
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }
    if (upper.startsWith('DELETE FROM')) {
      if (upper.includes('DEVICE_NAME LIKE')) {
        const likePattern = String(params[upper.includes("UPPER(USER_ROLE) = 'SUPERADMIN'") ? 0 : 3] || '').replace(/%/g, '');
        const keepToken = String(params[upper.includes("UPPER(USER_ROLE) = 'SUPERADMIN'") ? 1 : 4] || '');
        mockStore.fcm_tokens = mockStore.fcm_tokens.filter((f: any) => {
          const matchesDevice = likePattern && String(f.device_name || '').includes(likePattern);
          if (!matchesDevice || f.token === keepToken) return true;
          if (upper.includes("UPPER(USER_ROLE) = 'SUPERADMIN'")) {
            return String(f.user_role || '').toUpperCase() !== 'SUPERADMIN';
          }
          return Number(f.tenant_id) !== Number(params[0] || 0);
        });
      } else if (upper.includes('WHERE TENANT_ID = $1')) {
        const tid = Number(params[0] || 0);
        mockStore.fcm_tokens = mockStore.fcm_tokens.filter((f: any) => Number(f.tenant_id) !== tid);
      } else if (Array.isArray(params[0])) {
        const delSet = new Set(params[0].map((x: any) => String(x)));
        mockStore.fcm_tokens = mockStore.fcm_tokens.filter((f: any) => !delSet.has(f.token));
      } else if (params[0]) {
        const tok = String(params[0]);
        mockStore.fcm_tokens = mockStore.fcm_tokens.filter((f: any) => f.token !== tok);
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // PLATFORM_NOTIFICATIONS tracking for Announcements & System Alerts
  if (upper.includes('PLATFORM_NOTIFICATIONS')) {
    if (!mockStore.platform_notifications) mockStore.platform_notifications = [];

    if (upper.startsWith('INSERT INTO') || upper.includes('INSERT INTO PUBLIC.PLATFORM_NOTIFICATIONS') || upper.includes('INSERT INTO PLATFORM_NOTIFICATIONS')) {
      let targetTenantId: number | null = null;
      let targetRole = 'ALL';
      let title = '';
      let message = '';
      let type = 'INFO';
      let actionUrl = '';
      let actionLabel = '';
      let createdBy: number | null = null;
      let expiresAt: string | null = null;
      let eventId: string | null = null;

      // Parse SQL column list and VALUES expressions dynamically so optional event_id works cleanly
      const colMatch = sql.match(/INSERT\s+INTO\s+(?:public\.)?platform_notifications\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (colMatch) {
        const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
        const vals = colMatch[2].split(',').map((v) => v.trim());
        const getColVal = (colName: string): any => {
          const idx = cols.indexOf(colName);
          if (idx === -1 || idx >= vals.length) return undefined;
          const expr = vals[idx];
          const paramMatch = expr.match(/^\$(\d+)$/);
          if (paramMatch) {
            return params[Number(paramMatch[1]) - 1];
          }
          if (/^null$/i.test(expr)) return null;
          const strMatch = expr.match(/^'([^']*)'$/);
          if (strMatch) return strMatch[1];
          return undefined;
        };

        const rawTid = getColVal('tenant_id');
        targetTenantId = rawTid !== undefined && rawTid !== null ? Number(rawTid) : null;
        targetRole = String(getColVal('target_role') || 'ALL').toUpperCase();
        title = String(getColVal('title') || '');
        message = String(getColVal('message') || '');
        type = String(getColVal('type') || 'INFO');
        actionUrl = String(getColVal('action_url') || '');
        actionLabel = String(getColVal('action_label') || '');
        const rawCreatedBy = getColVal('created_by');
        createdBy = rawCreatedBy !== undefined && rawCreatedBy !== null ? Number(rawCreatedBy) : null;
        const rawExp = getColVal('expires_at');
        expiresAt = rawExp ? String(rawExp) : null;
        const rawEventId = getColVal('event_id');
        eventId = rawEventId !== undefined && rawEventId !== null && String(rawEventId).trim() !== ''
          ? String(rawEventId).trim()
          : null;
      } else {
        targetTenantId = params[0] !== undefined && params[0] !== null ? Number(params[0]) : null;
        title = String(params[1] || '');
        message = String(params[2] || '');
        type = String(params[3] || 'INFO');
        actionUrl = String(params[4] || '');
        actionLabel = String(params[5] || '');
      }

      const titleLower = title.toLowerCase();
      const actionUrlLower = actionUrl.toLowerCase();
      if (
        titleLower.includes('new free trial') ||
        titleLower.includes('new renewal request') ||
        titleLower.includes('renewal request:') ||
        actionUrlLower.includes('/superadmin')
      ) {
        targetRole = 'SUPERADMIN';
        targetTenantId = null;
      }

      // Enforce atomic DB uniqueness on event_id when present
      if (eventId) {
        const existingByEventId = mockStore.platform_notifications.find(
          (pn: any) => pn.event_id && String(pn.event_id) === eventId
        );
        if (existingByEventId) {
          if (upper.includes('ON CONFLICT') && upper.includes('DO UPDATE')) {
            if (title) existingByEventId.title = title;
            if (message) existingByEventId.message = message;
            if (actionUrl) existingByEventId.action_url = actionUrl;
            if (actionLabel) existingByEventId.action_label = actionLabel;
            return { rows: [existingByEventId as unknown as T], rowCount: 1 };
          }
          if (upper.includes('ON CONFLICT') && upper.includes('DO NOTHING')) {
            return { rows: [], rowCount: 0 };
          }
          const dupErr: any = new Error('duplicate key value violates unique constraint "platform_notifications_event_id_unique_idx"');
          dupErr.code = '23505';
          throw dupErr;
        }
      }

      const isWelcomeNotif =
        titleLower.includes('welcome to sarbaazsoft') ||
        message.toLowerCase().includes('thank you for choosing sarbaazsoft');

      if (isWelcomeNotif) {
        // Prevent duplicate welcome notifications for the same tenant
        const existingWelcome = mockStore.platform_notifications.find(
          (pn: any) =>
            Number(pn.tenant_id) === Number(targetTenantId) &&
            ((pn.title || '').toLowerCase().includes('welcome to sarbaazsoft') ||
              (pn.message || '').toLowerCase().includes('thank you for choosing sarbaazsoft'))
        );
        if (existingWelcome) {
          existingWelcome.message = message;
          if (actionUrl) existingWelcome.action_url = actionUrl;
          if (actionLabel) existingWelcome.action_label = actionLabel;
          if (title) existingWelcome.title = title;
          if (eventId && !existingWelcome.event_id) existingWelcome.event_id = eventId;
          // Purge any stale duplicates and return the singular welcome notice
          mockStore.platform_notifications = mockStore.platform_notifications.filter(
            (pn: any) =>
              Number(pn.id) === Number(existingWelcome.id) ||
              Number(pn.tenant_id) !== Number(targetTenantId) ||
              (!((pn.title || '').toLowerCase().includes('welcome to sarbaazsoft')) &&
                !((pn.message || '').toLowerCase().includes('thank you for choosing sarbaazsoft')))
          );
          return { rows: [existingWelcome as unknown as T], rowCount: 1 };
        }
      }

      const entry = {
        id: nextMockId('platform_notifications'),
        tenant_id: targetTenantId,
        target_role: targetRole,
        title,
        message,
        type,
        action_url: actionUrl,
        action_label: actionLabel,
        created_by: createdBy,
        expires_at: expiresAt,
        event_id: eventId,
        created_at: new Date().toISOString(),
      };
      mockStore.platform_notifications.unshift(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }

    if (upper.startsWith('SELECT')) {
      if (upper.includes('WHERE EVENT_ID = $1')) {
        const needle = String(params[0] || '').trim();
        const found = (mockStore.platform_notifications || []).filter(
          (pn: any) => pn.event_id && String(pn.event_id) === needle
        );
        return { rows: found as unknown as T[], rowCount: found.length };
      }

      if (upper.includes('WHERE TENANT_ID = $1') && upper.includes('TITLE = $2')) {
        const tid = Number(params[0]);
        const targetTitle = String(params[1] || '');
        const adminOnly = upper.includes("TARGET_ROLE = 'ADMIN'");
        const found = (mockStore.platform_notifications || []).filter((pn: any) => {
          if (Number(pn.tenant_id) !== tid) return false;
          if (String(pn.title || '') !== targetTitle) return false;
          if (adminOnly && String(pn.target_role || '').toUpperCase() !== 'ADMIN') return false;
          return true;
        });
        return { rows: found as unknown as T[], rowCount: found.length };
      }

      if (upper.includes('EVENT_ID LIKE $1')) {
        const prefix = String(params[0] || '').replace(/%/g, '').toLowerCase();
        const msgNeedle = String(params[1] || '').replace(/%/g, '').toLowerCase();
        const nowMs = Date.now();
        const found = (mockStore.platform_notifications || []).filter((pn: any) => {
          if (pn.expires_at) {
            const expTime = new Date(pn.expires_at).getTime();
            if (!Number.isNaN(expTime) && expTime <= nowMs) return false;
          }
          if (String(pn.target_role || '').toUpperCase() !== 'SUPERADMIN') return false;
          const ev = String(pn.event_id || '').toLowerCase();
          const title = String(pn.title || '').toLowerCase();
          const msg = String(pn.message || '').toLowerCase();
          return (
            (prefix !== '' && ev.startsWith(prefix)) ||
            ((title.startsWith('new renewal request') || title.startsWith('renewal request:')) &&
              msgNeedle !== '' &&
              msg.includes(msgNeedle))
          );
        });
        return { rows: found.slice(0, 1) as unknown as T[], rowCount: Math.min(1, found.length) };
      }

      const tenantId = params.length > 0 && params[0] !== null && params[0] !== undefined ? Number(params[0]) : 1;
      const userId = params.length > 1 && params[1] !== null && params[1] !== undefined ? Number(params[1]) : 0;
      const role = params.length > 2 && params[2] !== null && params[2] !== undefined ? String(params[2]).toUpperCase() : 'ADMIN';

      if (
        upper.includes("TITLE ILIKE 'WELCOME TO SARBAAZSOFT%'") ||
        upper.includes("MESSAGE ILIKE '%THANK YOU FOR CHOOSING SARBAAZSOFT%'")
      ) {
        const welcomeRows = (mockStore.platform_notifications || []).filter((pn: any) => {
          if (tenantId && Number(pn.tenant_id) !== tenantId) return false;
          const t = (pn.title || '').toLowerCase();
          const m = (pn.message || '').toLowerCase();
          return t.includes('welcome to sarbaazsoft') || m.includes('thank you for choosing sarbaazsoft');
        });
        return { rows: welcomeRows as unknown as T[], rowCount: welcomeRows.length };
      }

      const reads = mockStore.platform_notification_reads || [];
      const nowMs = Date.now();
      const list = (mockStore.platform_notifications || []).filter((pn: any) => {
        // Expiry check
        if (pn.expires_at) {
          const expTime = new Date(pn.expires_at).getTime();
          if (!isNaN(expTime) && expTime <= nowMs) {
            return false;
          }
        }

        const notifRole = (pn.target_role || 'ALL').toUpperCase();
        const notifTitle = (pn.title || '').toLowerCase();
        const notifMsg = (pn.message || '').toLowerCase();
        const notifAction = (pn.action_url || '').toLowerCase();

        const isSuperAdminOnly =
          notifRole === 'SUPERADMIN' ||
          notifTitle.includes('new free trial') ||
          notifTitle.includes('new renewal request') ||
          notifTitle.includes('renewal request:') ||
          notifMsg.includes('free tier store registered') ||
          notifMsg.includes('requested subscription renewal') ||
          notifAction.includes('/superadmin');

        if (role === 'SUPERADMIN') {
          if (notifTitle.includes('welcome to sarbaazsoft')) return false;
          return true;
        }

        // NON-SUPERADMIN (Store Owners, Cashiers, Public) MUST NEVER SEE SUPERADMIN NOTIFICATIONS
        if (isSuperAdminOnly) return false;

        if (role === 'ADMIN') {
          if (pn.tenant_id !== null && Number(pn.tenant_id) !== tenantId) return false;
          if (notifRole === 'CASHIER' || notifMsg.includes('staff account (cashier)')) return false;
          return notifRole === 'ALL' || notifRole === 'ADMIN';
        }

        if (role === 'CASHIER') {
          if (notifTitle.includes('welcome to sarbaazsoft')) return false;
          if (pn.tenant_id !== null && Number(pn.tenant_id) !== tenantId) return false;
          return notifRole === 'ALL' || notifRole === 'CASHIER';
        }

        return notifRole === 'ALL';
      });

      let rows = list.map((pn: any) => {
        const isRead = reads.some((r: any) => Number(r.notification_id) === Number(pn.id) && (Number(r.tenant_id) === tenantId || Number(r.user_id) === userId));
        return {
          ...pn,
          is_read: isRead,
          created_by_name: 'Platform SuperAdmin',
          read_count: '0',
          store_name: pn.tenant_id ? (mockStore.tenants.find((t) => Number(t.id) === Number(pn.tenant_id))?.name || 'Store') : 'All Stores (Platform Broadcast)',
        };
      });

      // Filter out dismissed if queried with NOT EXISTS
      if (upper.includes('NOT EXISTS') && upper.includes('PLATFORM_NOTIFICATION_READS')) {
        rows = rows.filter((r) => !r.is_read);
      }

      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (upper.startsWith('DELETE FROM')) {
      if (upper.includes('ID != $2') || upper.includes('ID <> $2')) {
        const tId = Number(params[0]);
        const keepId = Number(params[1]);
        mockStore.platform_notifications = (mockStore.platform_notifications || []).filter((pn: any) => {
          if (Number(pn.tenant_id) === tId && Number(pn.id) !== keepId) {
            const t = (pn.title || '').toLowerCase();
            const m = (pn.message || '').toLowerCase();
            if (t.includes('welcome to sarbaazsoft') || m.includes('thank you for choosing sarbaazsoft')) {
              return false;
            }
          }
          return true;
        });
        return { rows: [], rowCount: 1 };
      }
      if (upper.includes('TENANT_ID = $1') && upper.includes('EVENT_ID LIKE')) {
        const tId = Number(params[0]);
        const emails = Array.isArray(params[1]) ? params[1].map((e: any) => String(e || '').trim().toLowerCase()) : [];
        const before = (mockStore.platform_notifications || []).length;
        mockStore.platform_notifications = (mockStore.platform_notifications || []).filter((pn: any) => {
          if (Number(pn.tenant_id) === tId) return false;
          const ev = String(pn.event_id || '').toLowerCase();
          const url = String(pn.action_url || '').toLowerCase();
          if (
            ev === `trial-activation-${tId}` ||
            ev.startsWith(`trial-activation-${tId}-`) ||
            ev.startsWith(`sub-expired-${tId}-`) ||
            ev.startsWith(`sa-sub-expired-${tId}-`) ||
            ev.startsWith(`sub-renewed-${tId}-`) ||
            ev.startsWith(`renewal-approved-${tId}-`) ||
            ev.startsWith(`renewal-request-${tId}-`) ||
            url.includes(`tenantid=${tId}`)
          ) {
            return false;
          }
          if (emails.some((em) => em && ev === `trial-activation-${em}`)) return false;
          return true;
        });
        return { rows: [], rowCount: before - mockStore.platform_notifications.length };
      }
      if (upper.includes('EVENT_ID = ANY($1)')) {
        const evs = new Set((Array.isArray(params[0]) ? params[0] : []).map((x: any) => String(x || '').toLowerCase()));
        const before = (mockStore.platform_notifications || []).length;
        mockStore.platform_notifications = (mockStore.platform_notifications || []).filter(
          (pn: any) => !evs.has(String(pn.event_id || '').toLowerCase())
        );
        return { rows: [], rowCount: before - mockStore.platform_notifications.length };
      }
      const targetId = Number(params[0]);
      mockStore.platform_notifications = (mockStore.platform_notifications || []).filter((pn: any) => Number(pn.id) !== targetId);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith('UPDATE')) {
      if (upper.includes('EXPIRES_AT = NOW()')) {
        const nowIso = new Date().toISOString();
        const targetTid = params.length > 0 && params[0] !== undefined ? Number(params[0]) : null;
        const targetStoreName =
          params.length > 1 && params[1]
            ? String(params[1]).toLowerCase()
            : targetTid
              ? String(mockStore.tenants.find((t) => Number(t.id) === targetTid)?.name || '').toLowerCase()
              : '';
        for (const pn of mockStore.platform_notifications || []) {
          const ev = String(pn.event_id || '').toLowerCase();
          const msg = String(pn.message || '').toLowerCase();
          const title = String(pn.title || '').toLowerCase();
          const matchesTenant =
            !targetTid ||
            Number(pn.tenant_id) === targetTid ||
            (pn.target_role === 'SUPERADMIN' &&
              (ev.startsWith(`renewal-request-${targetTid}-`) ||
                ev.startsWith(`sa-sub-expired-${targetTid}-`) ||
                (targetStoreName !== '' && msg.includes(targetStoreName))));
          if (matchesTenant) {
            if (
              title.includes('renewal') ||
              title.includes('subscription') ||
              title.includes('free trial') ||
              msg.includes('renewal') ||
              msg.includes('subscription')
            ) {
              pn.expires_at = nowIso;
            }
          }
        }
        return { rows: [], rowCount: 1 };
      }

      if (upper.includes('SET') && (upper.includes('MESSAGE') || upper.includes('TITLE') || upper.includes('ACTION_URL'))) {
        const targetId = Number(params[params.length - 1]);
        const entry = (mockStore.platform_notifications || []).find((pn: any) => Number(pn.id) === targetId);
        if (entry) {
          if (params.length >= 4) {
            entry.title = params[0];
            entry.message = params[1];
            entry.action_url = params[2];
            entry.action_label = params[3] || 'Open Store Portal';
          } else if (params.length >= 2) {
            entry.message = params[0];
            entry.action_url = params[1];
          }
        }
        return { rows: [], rowCount: 1 };
      }

      for (const pn of mockStore.platform_notifications || []) {
        const notifTitle = (pn.title || '').toLowerCase();
        if (
          notifTitle.includes('new free trial') ||
          notifTitle.includes('new renewal request') ||
          notifTitle.includes('renewal request:')
        ) {
          pn.target_role = 'SUPERADMIN';
          pn.tenant_id = null;
        }
      }
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  if (upper.includes('PLATFORM_NOTIFICATION_READS')) {
    if (!mockStore.platform_notification_reads) mockStore.platform_notification_reads = [];
    if (upper.startsWith('INSERT INTO')) {
      const notifId = Number(params[0] || 0);
      const tid = Number(params[1] || 1);
      const uid = Number(params[2] || 0);
      mockStore.platform_notification_reads.push({
        notification_id: notifId,
        tenant_id: tid,
        user_id: uid,
        read_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (upper.startsWith('DELETE FROM')) {
      if (upper.includes('TENANT_ID = $1')) {
        const tid = Number(params[0] || 0);
        const notifIds = new Set(
          (mockStore.platform_notifications || [])
            .filter((pn: any) => Number(pn.tenant_id) === tid)
            .map((pn: any) => Number(pn.id))
        );
        mockStore.platform_notification_reads = mockStore.platform_notification_reads.filter(
          (r) => Number(r.tenant_id) !== tid && !notifIds.has(Number(r.notification_id))
        );
      } else {
        const notifId = Number(params[0] || 0);
        mockStore.platform_notification_reads = mockStore.platform_notification_reads.filter(
          (r) => Number(r.notification_id) !== notifId
        );
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (
    upper.includes('POS_NOTIFICATION_DISMISSALS') &&
    !upper.includes('FROM SALES') &&
    !upper.includes('FROM RETURNS') &&
    !upper.includes('FROM PURCHASES')
  ) {
    if (!mockStore.pos_notification_dismissals) mockStore.pos_notification_dismissals = [];
    if (upper.startsWith('INSERT INTO')) {
      const tid = Number(params[0] || 1);
      const uid = Number(params[1] || 0);
      const itemType = String(params[2] || 'SALE');
      const itemId = Number(params[3] || 0);
      const existing = mockStore.pos_notification_dismissals.find(
        (d) => d.tenant_id === tid && d.user_id === uid && d.item_type === itemType && d.item_id === itemId
      );
      if (!existing) {
        mockStore.pos_notification_dismissals.push({
          id: nextMockId('pos_notification_dismissals'),
          tenant_id: tid,
          user_id: uid,
          item_type: itemType,
          item_id: itemId,
          dismissed_at: new Date().toISOString(),
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (upper.startsWith('SELECT')) {
      return { rows: (mockStore.pos_notification_dismissals || []) as unknown as T[], rowCount: mockStore.pos_notification_dismissals?.length || 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.includes('EMAIL_VERIFICATION_TOKENS')) {
    if (!mockStore.email_verification_tokens) mockStore.email_verification_tokens = [];
    if (upper.startsWith('INSERT INTO')) {
      const tid = Number(params[0] || 1);
      const uid = Number(params[1] || 0);
      const token = String(params[2] || '');
      const exp = params[3] ? new Date(params[3]).toISOString() : new Date(Date.now() + 86400000).toISOString();
      const entry = {
        id: nextMockId('email_verification_tokens'),
        tenant_id: tid,
        user_id: uid,
        token,
        attempts: 0,
        expires_at: exp,
        created_at: new Date().toISOString(),
      };
      mockStore.email_verification_tokens.push(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }
    if (upper.startsWith('UPDATE')) {
      const targetId = Number(params[0] || 0);
      let updated: any = null;
      mockStore.email_verification_tokens = mockStore.email_verification_tokens.map((t) => {
        if (Number(t.id) === targetId) {
          updated = { ...t, attempts: Number(t.attempts || 0) + 1 };
          return updated;
        }
        return t;
      });
      return { rows: updated ? [updated as unknown as T] : [], rowCount: updated ? 1 : 0 };
    }
    if (upper.startsWith('SELECT')) {
      const hasWhere = upper.includes('WHERE') && params.length > 0;
      const param0 = hasWhere ? String(params[0] || '').trim().toLowerCase() : '';
      let matches = [...mockStore.email_verification_tokens];
      if (hasWhere) {
        if (upper.includes('USER_ID = $1')) {
          const uid = Number(params[0] || 0);
          matches = matches.filter((t) => Number(t.user_id) === uid);
        } else if (upper.includes('U.EMAIL')) {
          matches = matches.filter((t) => {
            const u = mockStore.users.find((user) => Number(user.id) === Number(t.user_id));
            return u && String(u.email || '').trim().toLowerCase() === param0;
          });
        } else {
          matches = matches.filter((t) => String(t.token).trim().toLowerCase() === param0);
        }
      }
      if (upper.includes('ORDER BY') && upper.includes('DESC')) {
        matches = matches.sort((a, b) => Number(b.id) - Number(a.id));
      }
      if (upper.includes('LIMIT 1')) {
        matches = matches.slice(0, 1);
      }
      matches = matches.map((t) => ({ ...t, stored_code: t.token }));
      if (upper.includes('JOIN USERS')) {
        const joined = matches.map((t) => {
          const u = mockStore.users.find((user) => Number(user.id) === Number(t.user_id)) || {};
          const tenant = mockStore.tenants.find((tn) => Number(tn.id) === Number(u.tenant_id || t.tenant_id)) || {};
          return {
            ...t,
            user_id: u.id,
            tenant_id: u.tenant_id || t.tenant_id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            avatar_url: u.avatar_url,
            role: u.role,
            status: u.status,
            theme_color: u.theme_color,
            store_name: tenant.name,
            onboarding_completed: Boolean(tenant.onboarding_completed),
            subscription_status: tenant.subscription_status || 'ACTIVE',
          };
        });
        return { rows: joined as unknown as T[], rowCount: joined.length };
      }
      return { rows: matches as unknown as T[], rowCount: matches.length };
    }
    if (upper.startsWith('DELETE FROM')) {
      const idVal = Number(params[0] || 0);
      if (upper.includes('WHERE ID =')) {
        mockStore.email_verification_tokens = mockStore.email_verification_tokens.filter((t) => Number(t.id) !== idVal);
      } else {
        mockStore.email_verification_tokens = mockStore.email_verification_tokens.filter((t) => Number(t.user_id) !== idVal);
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.includes('PASSWORD_RESET_CODES')) {
    if (!mockStore.password_reset_codes) mockStore.password_reset_codes = [];
    if (upper.startsWith('INSERT INTO')) {
      const tid = Number(params[0] ?? 0);
      const uid = Number(params[1] || 0);
      const code = String(params[2] || '');
      const exp = params[3]
        ? new Date(params[3]).toISOString()
        : new Date(Date.now() + 900000).toISOString();
      const entry = {
        id: nextMockId('password_reset_codes'),
        tenant_id: tid,
        user_id: uid,
        code,
        attempts: 0,
        expires_at: exp,
        created_at: new Date().toISOString(),
      };
      mockStore.password_reset_codes.push(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }
    if (upper.startsWith('UPDATE')) {
      const targetId = Number(params[params.length - 1] || 0);
      let updated: any = null;
      mockStore.password_reset_codes = mockStore.password_reset_codes.map((c) => {
        if (Number(c.id) === targetId) {
          if (upper.includes('EXPIRES_AT')) {
            const nextExp = upper.includes('-')
              ? new Date(Date.now() - 120_000).toISOString()
              : params.length > 1
              ? new Date(params[0]).toISOString()
              : new Date(Date.now() + 900_000).toISOString();
            updated = { ...c, expires_at: nextExp };
          } else {
            updated = { ...c, attempts: Number(c.attempts || 0) + 1 };
          }
          return updated;
        }
        return c;
      });
      return { rows: updated ? [updated as unknown as T] : [], rowCount: updated ? 1 : 0 };
    }
    if (upper.startsWith('SELECT')) {
      const hasWhere = upper.includes('WHERE') && params.length > 0;
      let matches = [...mockStore.password_reset_codes];
      if (hasWhere) {
        if (upper.includes('USER_ID = $1')) {
          const uid = Number(params[0] || 0);
          matches = matches.filter((c) => Number(c.user_id) === uid);
        } else if (upper.includes('U.EMAIL')) {
          const emailParam = String(params[0] || '').trim().toLowerCase();
          matches = matches.filter((c) => {
            const u = mockStore.users.find((user) => Number(user.id) === Number(c.user_id));
            return u && String(u.email || '').trim().toLowerCase() === emailParam;
          });
        } else if (upper.includes('CODE')) {
          const codeParam = String(params[0] || '').trim();
          matches = matches.filter((c) => String(c.code).trim() === codeParam);
        }
      }
      if (upper.includes('ORDER BY') && upper.includes('DESC')) {
        matches = matches.sort((a, b) => Number(b.id) - Number(a.id));
      }
      if (upper.includes('LIMIT 1')) {
        matches = matches.slice(0, 1);
      }
      matches = matches.map((c) => ({ ...c, stored_code: c.code }));
      if (upper.includes('JOIN USERS')) {
        const joined = matches.map((c) => {
          const u = mockStore.users.find((user) => Number(user.id) === Number(c.user_id)) || {};
          return {
            ...c,
            user_id: u.id,
            tenant_id: c.tenant_id ?? u.tenant_id ?? 0,
            email: u.email,
            name: u.name,
            role: u.role,
          };
        });
        return { rows: joined as unknown as T[], rowCount: joined.length };
      }
      return { rows: matches as unknown as T[], rowCount: matches.length };
    }
    if (upper.startsWith('DELETE FROM')) {
      const val = Number(params[0] || 0);
      if (upper.includes('WHERE ID = $1')) {
        mockStore.password_reset_codes = mockStore.password_reset_codes.filter((c) => Number(c.id) !== val);
      } else if (upper.includes('WHERE USER_ID = $1')) {
        mockStore.password_reset_codes = mockStore.password_reset_codes.filter((c) => Number(c.user_id) !== val);
      } else if (upper.includes('TENANT_ID = $1')) {
        const tid = Number(params[0] || 0);
        const tenantUserIds = new Set(
          mockStore.users
            .filter((u) => Number(u.tenant_id) === tid && String(u.role || '').toUpperCase() !== 'SUPERADMIN')
            .map((u) => Number(u.id))
        );
        mockStore.password_reset_codes = mockStore.password_reset_codes.filter(
          (c) => Number(c.tenant_id) !== tid && !tenantUserIds.has(Number(c.user_id))
        );
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.includes('AUTH_RESEND_RATE_LIMITS')) {
    if (!mockStore.auth_resend_rate_limits) mockStore.auth_resend_rate_limits = [];
    if (upper.startsWith('SELECT')) {
      const flow = String(params[0] || '');
      const scopeType = String(params[1] || '');
      const scopeKey = String(params[2] || '');
      const matches = mockStore.auth_resend_rate_limits.filter(
        (r) => r.flow === flow && r.scope_type === scopeType && r.scope_key === scopeKey
      );
      return { rows: matches as unknown as T[], rowCount: matches.length };
    }
    if (upper.startsWith('INSERT INTO')) {
      const flow = String(params[0] || '');
      const scopeType = String(params[1] || '');
      const scopeKey = String(params[2] || '');
      const attemptCount = Number(params[3] || 0);
      const lastSentAt = params[4] ? new Date(params[4]).toISOString() : null;
      const cooldownUntil = params[5] ? new Date(params[5]).toISOString() : null;
      const windowStartAt = params[6] ? new Date(params[6]).toISOString() : null;
      const windowRequestCount = Number(params[7] || 0);
      const existingIdx = mockStore.auth_resend_rate_limits.findIndex(
        (r) => r.flow === flow && r.scope_type === scopeType && r.scope_key === scopeKey
      );
      const nowIso = new Date().toISOString();
      if (existingIdx !== -1) {
        mockStore.auth_resend_rate_limits[existingIdx] = {
          ...mockStore.auth_resend_rate_limits[existingIdx],
          attempt_count: attemptCount,
          last_sent_at: lastSentAt,
          cooldown_until: cooldownUntil,
          window_start_at: windowStartAt,
          window_request_count: windowRequestCount,
          updated_at: nowIso,
        };
        return { rows: [mockStore.auth_resend_rate_limits[existingIdx] as unknown as T], rowCount: 1 };
      }
      const entry = {
        id: nextMockId('auth_resend_rate_limits'),
        flow,
        scope_type: scopeType,
        scope_key: scopeKey,
        attempt_count: attemptCount,
        last_sent_at: lastSentAt,
        cooldown_until: cooldownUntil,
        window_start_at: windowStartAt,
        window_request_count: windowRequestCount,
        updated_at: nowIso,
      };
      mockStore.auth_resend_rate_limits.push(entry);
      return { rows: [entry as unknown as T], rowCount: 1 };
    }
    if (upper.startsWith('DELETE FROM')) {
      const flow = String(params[0] || '');
      const scopeType = String(params[1] || '');
      const scopeKey = String(params[2] || '');
      mockStore.auth_resend_rate_limits = mockStore.auth_resend_rate_limits.filter(
        (r) => !(r.flow === flow && r.scope_type === scopeType && r.scope_key === scopeKey)
      );
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // SuperAdmin & Store report queries joining products + tenants
  if (upper.startsWith('SELECT') && upper.includes('FROM PRODUCTS P') && upper.includes('JOIN TENANTS T')) {
    if (upper.includes('GROUP BY COALESCE(NULLIF(TRIM(P.CATEGORY)')) {
      const map = new Map<string, { name: string; product_count: number; total_stock: number; units_sold: number; total_revenue: number }>();
      for (const p of mockStore.products.filter((x) => x.active !== false)) {
        const key = (p.category || 'General').trim() || 'General';
        const cur = map.get(key) || { name: key, product_count: 0, total_stock: 0, units_sold: 0, total_revenue: 0 };
        cur.product_count += 1;
        cur.total_stock += Number(p.total_stock || 0);
        const items = mockStore.sale_items.filter((si) => Number(si.product_id) === Number(p.id));
        cur.units_sold += items.reduce((s, i) => s + Number(i.quantity || 0), 0);
        cur.total_revenue += items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
        map.set(key, cur);
      }
      const rows = Array.from(map.values()).map((c) => ({
        name: c.name,
        product_count: String(c.product_count),
        total_stock: String(c.total_stock),
        units_sold: String(c.units_sold),
        total_revenue: String(c.total_revenue),
      })) as unknown as T[];
      return { rows, rowCount: rows.length };
    }

    if (upper.includes('GROUP BY COALESCE(NULLIF(TRIM(P.BRAND)')) {
      const map = new Map<string, { name: string; product_count: number; total_stock: number; units_sold: number; total_revenue: number }>();
      for (const p of mockStore.products.filter((x) => x.active !== false)) {
        const key = (p.brand || 'Unbranded').trim() || 'Unbranded';
        const cur = map.get(key) || { name: key, product_count: 0, total_stock: 0, units_sold: 0, total_revenue: 0 };
        cur.product_count += 1;
        cur.total_stock += Number(p.total_stock || 0);
        const items = mockStore.sale_items.filter((si) => Number(si.product_id) === Number(p.id));
        cur.units_sold += items.reduce((s, i) => s + Number(i.quantity || 0), 0);
        cur.total_revenue += items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
        map.set(key, cur);
      }
      const rows = Array.from(map.values()).map((b) => ({
        name: b.name,
        product_count: String(b.product_count),
        total_stock: String(b.total_stock),
        units_sold: String(b.units_sold),
        total_revenue: String(b.total_revenue),
      })) as unknown as T[];
      return { rows, rowCount: rows.length };
    }

    const rows = mockStore.products
      .filter((p) => p.active !== false)
      .map((p) => {
        const t = mockStore.tenants.find((tn) => Number(tn.id) === Number(p.tenant_id)) || mockStore.tenants[0];
        const cs = mockStore.company_settings.find((c) => Number(c.tenant_id) === Number(p.tenant_id));
        const items = mockStore.sale_items.filter((si) => Number(si.product_id) === Number(p.id));
        const unitsSold = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
        const totalRev = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
        return {
          id: p.id,
          tenant_id: p.tenant_id,
          store_name: t?.name || 'Baloch Shoes',
          currency: cs?.currency || 'PKR',
          product_name: p.article || p.name || 'Shoe Item',
          name: p.name || 'Shoe Item',
          article: p.article || '',
          barcode: p.barcode || '',
          brand: p.brand || 'Unbranded',
          category: p.category || 'General',
          primary_image_url: p.primary_image_url || '',
          max_price: String(p.max_price || 0),
          cost_price: String(p.cost_price || 0),
          total_stock: String(p.total_stock || 0),
          low_stock_threshold: String(cs?.low_stock_threshold ?? 5),
          units_sold: String(unitsSold),
          total_revenue: String(totalRev),
          gross_revenue: String(totalRev),
          order_count: String(items.length),
        };
      }) as unknown as T[];
    return { rows, rowCount: rows.length };
  }

  // TENANTS queries (SELECT, INSERT, UPDATE, DELETE)
  if (upper.startsWith('SELECT') && upper.includes('FROM TENANTS')) {
    if (upper.includes('COUNT(*)::INT AS CNT') && upper.includes('MAX(ID)')) {
      const cnt = mockStore.tenants.length;
      const maxId = mockStore.tenants.reduce((m, t) => Math.max(m, Number(t.id || 0)), 0);
      return { rows: [{ cnt, max_id: maxId } as unknown as T], rowCount: 1 };
    }
    if (upper.includes('AS NEXT_ID') && upper.includes('LEFT JOIN TENANTS T2')) {
      const usedIds = new Set(mockStore.tenants.map((t) => Number(t.id)));
      let candidate = 1;
      while (usedIds.has(candidate)) {
        candidate++;
      }
      return { rows: [{ next_id: candidate } as unknown as T], rowCount: 1 };
    }

    const isJoinedStoreQuery =
      upper.includes('JOIN COMPANY_SETTINGS') ||
      upper.includes('PRODUCT_COUNT') ||
      upper.includes('INVENTORY_VALUE') ||
      upper.includes('TOTAL_STOCK_UNITS');

    let rows = mockStore.tenants.map((t) => {
      if (!isJoinedStoreQuery) {
        return { ...t };
      }

      const owner = mockStore.users.find((u) => Number(u.tenant_id) === Number(t.id) && u.role === 'ADMIN');
      const cs = mockStore.company_settings.find((c) => Number(c.tenant_id) === Number(t.id));
      const storeProducts = mockStore.products.filter((p) => Number(p.tenant_id) === Number(t.id) && p.active !== false);
      const storeSales = mockStore.sales.filter((s) => Number(s.tenant_id) === Number(t.id));
      const storeSaleItems = mockStore.sale_items.filter((si) => Number(si.tenant_id) === Number(t.id));
      const storeStaff = mockStore.users.filter((u) => Number(u.tenant_id) === Number(t.id) && u.role !== 'SUPERADMIN');
      const storeCashiers = mockStore.users.filter((u) => Number(u.tenant_id) === Number(t.id) && u.role === 'CASHIER');
      const storeCustomers = mockStore.customers.filter((c) => Number(c.tenant_id) === Number(t.id));
      const storeSuppliers = mockStore.suppliers.filter((sp) => Number(sp.tenant_id) === Number(t.id));

      const rowResult: any = {
        ...t,
        business_type: cs?.business_type || 'RETAIL',
        pricing_mode: cs?.pricing_mode || 'FIXED',
        name: t.name || cs?.name || 'Baloch Shoes',
        admin_user_id: owner?.id || null,
        owner_name: owner?.name || 'Store Owner',
        admin_name: owner?.name || 'Store Owner',
        owner_email: owner?.email || cs?.email || `admin+${t.id}@store.com`,
        admin_email: owner?.email || cs?.email || `admin+${t.id}@store.com`,
        owner_phone: owner?.phone || cs?.phone || '',
        admin_phone: owner?.phone || cs?.phone || '',
        logo_url: cs?.logo || t.logo_url || '/pwa-512x512.png',
        address: cs?.address || t.address || '',
        tax_id: cs?.tax_id || t.tax_id || '',
        currency: cs?.currency || t.currency || 'PKR',
        product_count: String(storeProducts.length),
        total_stock_units: String(storeProducts.reduce((sum, p) => sum + Number(p.total_stock || 0), 0)),
        sales_count: String(storeSales.length),
        total_sales_revenue: String(storeSales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0)),
        staff_count: String(storeStaff.length),
        cashier_count: storeCashiers.length,
        customer_count: String(storeCustomers.length),
        supplier_count: String(storeSuppliers.length),
        units_sold: String(storeSaleItems.reduce((sum, si) => sum + Number(si.quantity || 0), 0)),
        inventory_value: String(
          storeProducts.reduce((sum, p) => sum + Number(p.total_stock || 0) * Number(p.max_price || 0), 0)
        ),
      };

      if (upper.includes('ALLOW_HALF_CARTON') || upper.includes('CS.ALLOW_HALF_CARTON')) {
        rowResult.allow_half_carton = cs?.allow_half_carton !== undefined ? Boolean(cs.allow_half_carton) : true;
      }

      return rowResult;
    });

    if (upper.includes('WHERE ($1::INTEGER IS NOT NULL AND ID = $1)')) {
      rows = rows.filter(
        (r) =>
          (params[0] !== null && params[0] !== undefined && Number(r.id) === Number(params[0])) ||
          String(r.name).toLowerCase() === String(params[1] || '').toLowerCase()
      );
    } else if (upper.includes('WHERE ID = ANY($1')) {
      const ids: number[] = Array.isArray(params[0]) ? params[0].map(Number) : [];
      rows = rows.filter((r) => ids.includes(Number(r.id)));
    } else if (upper.includes("SUBSCRIPTION_STATUS::TEXT = 'EXPIRED'")) {
      rows = rows.filter(
        (r) =>
          Number(r.id) > 0 &&
          String(r.status || 'ACTIVE').toUpperCase() !== 'SUSPENDED' &&
          String(r.subscription_status || '').toUpperCase() === 'EXPIRED' &&
          Boolean(r.subscription_end_date)
      );
    } else if (upper.includes("SUBSCRIPTION_END_DATE <= NOW() + INTERVAL '7 DAYS'")) {
      const nowMs = Date.now();
      const sevenDaysMs = nowMs + 7 * 86_400_000;
      rows = rows.filter((r) => {
        if (Number(r.id) <= 0) return false;
        if (String(r.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return false;
        if (String(r.subscription_status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return false;
        if (!r.subscription_end_date) return false;
        const endMs = new Date(r.subscription_end_date).getTime();
        return !Number.isNaN(endMs) && endMs > nowMs && endMs <= sevenDaysMs;
      });
    } else if (upper.includes('WHERE T.ID = $1') || upper.includes('WHERE ID = $1')) {
      rows = rows.filter((r) => Number(r.id) === Number(params[0]));
    }
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  if (upper.startsWith('INSERT INTO TENANTS')) {
    const hasExplicitId = params.length >= 7;
    const usedIds = new Set(mockStore.tenants.map((t) => Number(t.id)));
    let recycledId = 1;
    while (usedIds.has(recycledId)) {
      recycledId++;
    }
    const tenantId = hasExplicitId ? Number(params[0]) || recycledId : recycledId;
    const tenantName = String((hasExplicitId ? params[1] : params[0]) || 'New Shoe Store').trim();
    let subPlan = 'YEARLY';
    let subStart = new Date().toISOString();
    let subEnd = new Date(Date.now() + 86400000 * 365).toISOString();
    let subStatus = 'ACTIVE';

    if (hasExplicitId) {
      if (upper.includes('SUBSCRIPTION_TYPE')) {
        const subType = String(params[2] || 'free_tier');
        subPlan = String(params[3] || subType || 'free_tier');
        subStart = params[4] || subStart;
        subEnd = params[5] || subEnd;
        subStatus = String(params[6] || 'ACTIVE');
      } else {
        subPlan = String(params[2] || 'YEARLY');
        subStart = params[3] || subStart;
        subEnd = params[4] || subEnd;
        subStatus = String(params[5] || 'ACTIVE');
      }
    }

    if (subPlan === 'TRIAL' && !params[5]) {
      subEnd = new Date(Date.now() + 86400000 * 30).toISOString();
    }

    const newTenant = {
      id: tenantId,
      name: tenantName,
      status: 'ACTIVE',
      subscription_type: subPlan === '6_MONTHS' ? '6_months' : subPlan === 'YEARLY' ? '1_year' : 'free_tier',
      subscription_plan: subPlan,
      subscription_start_date: subStart,
      subscription_end_date: subEnd,
      subscription_status: subStatus,
      logo_url: '/pwa-512x512.png',
      address: '',
      tax_id: '',
      currency: 'PKR',
      onboarding_completed: false,
      deleted_product_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockStore.tenants.push(newTenant);
    mockStore.tenants.sort((a, b) => Number(a.id) - Number(b.id));
    return { rows: [newTenant as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('UPDATE TENANTS')) {
    if (upper.includes('WHERE SUBSCRIPTION_END_DATE IS NOT NULL')) {
      for (const t of mockStore.tenants) {
        if (t.subscription_end_date && new Date(t.subscription_end_date).getTime() < Date.now() && t.subscription_status !== 'SUSPENDED') {
          t.subscription_status = 'EXPIRED';
        }
      }
      return { rows: [], rowCount: 0 };
    }
    const targetId = Number(params[params.length - 1]);
    const tenant = mockStore.tenants.find((t) => Number(t.id) === targetId);
    if (!tenant) return { rows: [], rowCount: 0 };

    if (upper.includes('ARRAY_REMOVE') && upper.includes('DELETED_PRODUCT_IDS')) {
      const usedNo = Number(params[0]);
      tenant.deleted_product_ids = (Array.isArray(tenant.deleted_product_ids) ? tenant.deleted_product_ids : []).filter(
        (n: number) => Number(n) !== usedNo
      );
      tenant.updated_at = new Date().toISOString();
      return { rows: [tenant as unknown as T], rowCount: 1 };
    }
    if (upper.includes('ARRAY_APPEND') && upper.includes('DELETED_PRODUCT_IDS')) {
      const deletedNo = Number(params[0]);
      if (Number.isInteger(deletedNo) && deletedNo >= 1) {
        const currentIds = Array.isArray(tenant.deleted_product_ids) ? tenant.deleted_product_ids.map(Number) : [];
        tenant.deleted_product_ids = [...new Set([...currentIds, deletedNo])]
          .filter((n) => Number.isInteger(n) && n >= 1)
          .sort((a, b) => a - b);
      }
      tenant.updated_at = new Date().toISOString();
      return { rows: [tenant as unknown as T], rowCount: 1 };
    }
    if (upper.includes('SET DELETED_PRODUCT_IDS = $1')) {
      const nextIds = Array.isArray(params[0]) ? params[0].map(Number).filter((n: number) => Number.isInteger(n) && n >= 1) : [];
      tenant.deleted_product_ids = [...new Set(nextIds)].sort((a, b) => a - b);
      tenant.updated_at = new Date().toISOString();
      return { rows: [tenant as unknown as T], rowCount: 1 };
    }

    if (upper.includes('SET NAME = $1') && upper.includes('SUBSCRIPTION_PLAN = $2') && upper.includes('SUBSCRIPTION_TYPE = $3') && params.length >= 8) {
      tenant.name = String(params[0] || tenant.name);
      tenant.subscription_plan = String(params[1] || tenant.subscription_plan);
      tenant.subscription_type = String(params[2] || (tenant.subscription_plan === '6_MONTHS' ? '6_months' : tenant.subscription_plan === 'YEARLY' ? '1_year' : 'free_tier'));
      tenant.subscription_start_date = params[3] || tenant.subscription_start_date;
      tenant.subscription_end_date = params[4] || tenant.subscription_end_date;
      tenant.subscription_status = String(params[5] || tenant.subscription_status);
      tenant.status = String(params[6] || tenant.status);
    } else if (upper.includes('SET NAME = $1') && upper.includes('SUBSCRIPTION_PLAN = $2') && params.length >= 7) {
      tenant.name = String(params[0] || tenant.name);
      tenant.subscription_plan = String(params[1] || tenant.subscription_plan);
      tenant.subscription_type =
        tenant.subscription_plan === '6_MONTHS' ? '6_months' : tenant.subscription_plan === 'YEARLY' ? '1_year' : 'free_tier';
      tenant.subscription_start_date = params[2] || tenant.subscription_start_date;
      tenant.subscription_end_date = params[3] || tenant.subscription_end_date;
      tenant.subscription_status = String(params[4] || tenant.subscription_status);
      tenant.status = String(params[5] || tenant.status);
    } else if (upper.includes('SET NAME = $1') && (upper.includes('ONBOARDING_COMPLETED = TRUE') || params.length === 2)) {
      tenant.name = String(params[0] || tenant.name);
      if (upper.includes('ONBOARDING_COMPLETED = TRUE')) {
        tenant.status = 'ACTIVE';
        tenant.onboarding_completed = true;
      }
    } else if (upper.includes('SET SUBSCRIPTION_PLAN = $1') && upper.includes('SUBSCRIPTION_TYPE = $2') && params.length >= 6) {
      tenant.subscription_plan = String(params[0] || tenant.subscription_plan);
      tenant.subscription_type = String(params[1] || (tenant.subscription_plan === '6_MONTHS' ? '6_months' : tenant.subscription_plan === 'YEARLY' ? '1_year' : 'free_tier'));
      tenant.subscription_start_date = params[2] || tenant.subscription_start_date;
      tenant.subscription_end_date = params[3] || tenant.subscription_end_date;
      tenant.subscription_status = String(params[4] || tenant.subscription_status);
    } else if (upper.includes('SET SUBSCRIPTION_PLAN = $1') && params.length === 5) {
      tenant.subscription_plan = String(params[0] || tenant.subscription_plan);
      tenant.subscription_type =
        tenant.subscription_plan === '6_MONTHS' ? '6_months' : tenant.subscription_plan === 'YEARLY' ? '1_year' : 'free_tier';
      tenant.subscription_start_date = params[1] || tenant.subscription_start_date;
      tenant.subscription_end_date = params[2] || tenant.subscription_end_date;
      tenant.subscription_status = String(params[3] || tenant.subscription_status);
    } else if (upper.includes('SET SUBSCRIPTION_PLAN = $1') && params.length === 4) {
      tenant.subscription_plan = String(params[0] || tenant.subscription_plan);
      tenant.subscription_type =
        tenant.subscription_plan === '6_MONTHS' ? '6_months' : tenant.subscription_plan === 'YEARLY' ? '1_year' : 'free_tier';
      tenant.subscription_start_date = params[1] || tenant.subscription_start_date;
      tenant.subscription_end_date = params[2] || tenant.subscription_end_date;
      tenant.subscription_status = 'ACTIVE';
      tenant.status = 'ACTIVE';
    } else if (upper.includes("SET SUBSCRIPTION_END_DATE = NOW() - INTERVAL '1 HOUR'")) {
      tenant.subscription_end_date = new Date(Date.now() - 3_600_000).toISOString();
    } else {
      const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+/i);
      if (setMatch) {
        const setBody = setMatch[1];
        const assignRegex = /([a-z_]+)\s*=\s*(?:\$(\d+)|'([^']*)'|\b(TRUE|FALSE)\b|NOW\(\))/gi;
        let m: RegExpExecArray | null;
        while ((m = assignRegex.exec(setBody)) !== null) {
          const col = m[1].toLowerCase();
          if (col === 'updated_at') continue;
          if (m[2]) {
            const val = params[Number(m[2]) - 1];
            if (val !== undefined) (tenant as any)[col] = val;
          } else if (m[3] !== undefined) {
            (tenant as any)[col] = m[3];
          } else if (m[4] !== undefined) {
            (tenant as any)[col] = m[4].toUpperCase() === 'TRUE';
          } else {
            (tenant as any)[col] = new Date().toISOString();
          }
        }
        if (setBody.toLowerCase().includes('subscription_plan') && !setBody.toLowerCase().includes('subscription_type')) {
          tenant.subscription_type =
            tenant.subscription_plan === '6_MONTHS' ? '6_months' : tenant.subscription_plan === 'YEARLY' ? '1_year' : 'free_tier';
        }
      }
    }
    tenant.updated_at = new Date().toISOString();
    return { rows: [tenant as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM TENANTS')) {
    const targetId = Number(params[0]);
    mockStore.tenants = mockStore.tenants.filter((t) => Number(t.id) !== targetId);
    return { rows: [], rowCount: 1 };
  }

  // USERS count queries (only when querying FROM USERS directly)
  if (upper.startsWith('SELECT') && upper.includes('FROM USERS') && upper.includes('COUNT(*)') && !upper.includes('FROM TENANTS')) {
    if (upper.includes("UPPER(ROLE) = 'SUPERADMIN'") || upper.includes("SUPERADMIN")) {
      const count = mockStore.users.filter((u) => String(u.role).toUpperCase() === 'SUPERADMIN' && u.active).length;
      return { rows: [{ count: String(count) } as unknown as T], rowCount: 1 };
    }
    const total = mockStore.users.length;
    const admins = mockStore.users.filter((u) => u.role === 'ADMIN' && u.status === 'APPROVED').length;
    return { rows: [{ total: String(total), admins: String(admins) } as unknown as T], rowCount: 1 };
  }

  // COMPANY_SETTINGS queries (SELECT, INSERT, UPDATE, DELETE)
  if (upper.startsWith('SELECT') && upper.includes('FROM COMPANY_SETTINGS') && !upper.includes('FROM PRODUCTS')) {
    let rows = mockStore.company_settings.map((cs) => ({
      ...cs,
      name: mockStore.tenants.find((t) => Number(t.id) === Number(cs.tenant_id))?.name || cs.name || 'Baloch Shoes',
    }));
    if (params.length > 0 && (upper.includes('TENANT_ID = $1') || upper.includes('COALESCE(TENANT_ID, 1) = $1'))) {
      rows = rows.filter((cs) => Number(cs.tenant_id) === Number(params[0]));
    }
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  if (upper.startsWith('INSERT INTO COMPANY_SETTINGS')) {
    const tid = Number(params[0]) || 1;
    const tenant = mockStore.tenants.find((t) => Number(t.id) === tid);

    let address = '';
    let phone = '';
    let email = '';
    let tax_id = '';
    let tax_rate = 0;
    let currency = 'PKR';
    let currency_symbol = 'Rs.';
    let invoice_footer = 'Thank you for shopping with us! Exchanges within 7 days with original receipt.';
    let pricing_mode = 'FIXED';
    let business_type = 'RETAIL';
    let allow_half_carton = true;
    let low_stock_threshold = 5;
    let notification_preferences: any = null;

    const colMatch = upper.match(/INSERT\s+INTO\s+COMPANY_SETTINGS\s*\(([^)]+)\)/i);
    const valMatch = upper.match(/VALUES\s*\(([^)]+)\)/i);

    if (colMatch && valMatch) {
      const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
      const valTokens = valMatch[1].split(',').map((v) => v.trim());
      let pIdx = 0;

      cols.forEach((col, idx) => {
        const token = valTokens[idx] || '';
        let v: any;
        const paramTokMatch = token.match(/^\$(\d+)/);
        if (paramTokMatch) {
          const explicitIdx = Number(paramTokMatch[1]) - 1;
          v = params[explicitIdx >= 0 ? explicitIdx : pIdx++];
        } else {
          v = token.replace(/^'|'$/g, '');
        }

        if (col === 'address') address = String(v || '');
        else if (col === 'phone') phone = String(v || '');
        else if (col === 'email') email = String(v || '');
        else if (col === 'tax_id') tax_id = String(v || '');
        else if (col === 'tax_rate') tax_rate = Number(v || 0);
        else if (col === 'currency') currency = String(v || 'PKR');
        else if (col === 'currency_symbol') currency_symbol = String(v || 'Rs.');
        else if (col === 'invoice_footer') invoice_footer = String(v || '');
        else if (col === 'pricing_mode') pricing_mode = String(v || 'FIXED');
        else if (col === 'business_type') business_type = String(v || 'RETAIL');
        else if (col === 'allow_half_carton') allow_half_carton = typeof v === 'string' ? v.trim().toLowerCase() === 'true' : Boolean(v);
        else if (col === 'low_stock_threshold') low_stock_threshold = Math.max(1, Number(v || 5));
        else if (col === 'notification_preferences') {
          try {
            notification_preferences = typeof v === 'string' ? JSON.parse(v) : v ?? null;
          } catch {
            notification_preferences = null;
          }
        }
      });
    }

    const newCs = {
      id: nextMockId('company_settings'),
      tenant_id: tid,
      name: tenant?.name || 'Shoe Store',
      logo: '/pwa-512x512.png',
      address,
      phone,
      email,
      website: '',
      strn: '',
      tax_id,
      tax_rate,
      currency,
      currency_name: currency === 'PKR' ? 'Pakistani Rupee' : currency === 'USD' ? 'US Dollar' : 'Currency',
      currency_symbol,
      invoice_footer,
      show_receipt_logo: false,
      receipt_logo: '',
      low_stock_threshold,
      pricing_mode,
      business_type,
      allow_half_carton,
      notification_preferences,
      updated_at: new Date().toISOString(),
    };
    mockStore.company_settings.push(newCs);
    return { rows: [newCs as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('UPDATE COMPANY_SETTINGS')) {
    const tid = Number(params[params.length - 1]) || 1;
    const cs = mockStore.company_settings.find((c) => Number(c.tenant_id) === tid);
    if (cs) {
      const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+/i);
      if (setMatch) {
        const setBody = setMatch[1];
        const assignRegex = /([a-z_]+)\s*=\s*(?:COALESCE\(NULLIF\(\$(\d+),\s*''\),\s*[a-z_]+\)|\$(\d+)(?:::[a-z]+)?)/gi;
        let m: RegExpExecArray | null;
        while ((m = assignRegex.exec(setBody)) !== null) {
          const col = m[1].toLowerCase();
          const pIdx = Number(m[2] || m[3]) - 1;
          const val = params[pIdx];
          if (m[2] && !val) continue;
          if (col === 'low_stock_threshold') {
            cs.low_stock_threshold = Math.max(1, Number(val || 5));
          } else if (col === 'allow_half_carton' || col === 'show_receipt_logo') {
            (cs as any)[col] = Boolean(val);
          } else if (col === 'tax_rate') {
            (cs as any)[col] = Number(val || 0);
          } else if (col === 'notification_preferences') {
            try {
              (cs as any).notification_preferences = typeof val === 'string' ? JSON.parse(val) : val;
            } catch {
              (cs as any).notification_preferences = val ?? null;
            }
          } else if (val !== undefined) {
            (cs as any)[col] = val;
          }
        }
      }
      cs.updated_at = new Date().toISOString();
      return { rows: [cs as unknown as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.startsWith('DELETE FROM COMPANY_SETTINGS')) {
    const tid = Number(params[0]);
    mockStore.company_settings = mockStore.company_settings.filter((c) => Number(c.tenant_id) !== tid);
    return { rows: [], rowCount: 1 };
  }

  // USERS queries (SELECT, INSERT, UPDATE, DELETE)
  if (upper.startsWith('SELECT') && upper.includes('FROM USERS')) {
    let rows = [...mockStore.users];
    const whereClause = upper.split(/\bORDER\s+BY\b|\bLIMIT\b/)[0] || upper;
    if (whereClause.includes('WHERE ID = $1')) {
      const targetId = Number(params[0]);
      const targetTenantId = params.length >= 2 ? Number(params[1]) : null;
      const requiresSuperAdmin =
        whereClause.includes("AND UPPER(ROLE::TEXT) = 'SUPERADMIN'") ||
        whereClause.includes("AND UPPER(ROLE) = 'SUPERADMIN'") ||
        whereClause.includes("AND ROLE = 'SUPERADMIN'");
      rows = rows.filter((u) => {
        if (Number(u.id) !== targetId) return false;
        if (requiresSuperAdmin && String(u.role).toUpperCase() !== 'SUPERADMIN') return false;
        if (targetTenantId !== null && (whereClause.includes('TENANT_ID = $2') || whereClause.includes('OR TENANT_ID = $2'))) {
          if (String(u.role).toUpperCase() !== 'SUPERADMIN' && Number(u.tenant_id) !== targetTenantId) {
            return false;
          }
        }
        return true;
      });
    } else if (
      whereClause.includes('COALESCE(TENANT_ID, 1) = $2') &&
      (whereClause.includes('LOWER(EMAIL) = LOWER($1)') ||
        whereClause.includes('LOWER(BTRIM(EMAIL)) = LOWER(BTRIM($1))') ||
        whereClause.includes('LOWER(BTRIM(U.EMAIL)) = LOWER(BTRIM($1))'))
    ) {
      const excludesSuperAdmin =
        whereClause.includes("<> 'SUPERADMIN'") || whereClause.includes("!= 'SUPERADMIN'");
      rows = rows.filter(
        (u) =>
          String(u.email).trim().toLowerCase() === String(params[0] || '').trim().toLowerCase() &&
          Number(u.tenant_id ?? 1) === Number(params[1]) &&
          (!excludesSuperAdmin || String(u.role || '').toUpperCase() !== 'SUPERADMIN')
      );
    } else if (
      (whereClause.includes("ROLE = 'ADMIN'") || whereClause.includes("UPPER(COALESCE(ROLE::TEXT, '')) IN ('ADMIN', 'OWNER')") || whereClause.includes("UPPER(ROLE::TEXT) IN ('ADMIN', 'OWNER')")) &&
      whereClause.includes('TENANT_ID = $1')
    ) {
      rows = rows.filter(
        (u) =>
          Number(u.tenant_id) === Number(params[0]) &&
          ['ADMIN', 'OWNER'].includes(String(u.role || '').toUpperCase()) &&
          (!whereClause.includes("STATUS = 'APPROVED'") || u.status === 'APPROVED') &&
          (!whereClause.includes('COALESCE(ACTIVE, TRUE) = TRUE') || u.active !== false)
      );
    } else if (whereClause.includes("ROLE = 'CASHIER'") && whereClause.includes('TENANT_ID = $1')) {
      rows = rows.filter(
        (u) =>
          Number(u.tenant_id) === Number(params[0]) &&
          u.role === 'CASHIER' &&
          (!whereClause.includes("STATUS = 'APPROVED'") || u.status === 'APPROVED') &&
          (!whereClause.includes('COALESCE(ACTIVE, TRUE) = TRUE') || u.active !== false)
      );
    } else if (whereClause.includes("ROLE = 'ADMIN'") || whereClause.includes("UPPER(ROLE::TEXT) = 'ADMIN'")) {
      rows = rows.filter((u) => String(u.role).toUpperCase() === 'ADMIN' && (!whereClause.includes("STATUS = 'APPROVED'") || u.status === 'APPROVED'));
    } else if (whereClause.includes("ROLE = 'CASHIER'") || whereClause.includes("UPPER(ROLE::TEXT) = 'CASHIER'")) {
      rows = rows.filter((u) => String(u.role).toUpperCase() === 'CASHIER' && (!whereClause.includes("STATUS = 'APPROVED'") || u.status === 'APPROVED'));
    } else if (
      (whereClause.includes("ROLE = 'SUPERADMIN'") ||
        whereClause.includes("UPPER(COALESCE(ROLE::TEXT, '')) = 'SUPERADMIN'") ||
        whereClause.includes("UPPER(ROLE::TEXT) = 'SUPERADMIN'")) &&
      (whereClause.includes('LOWER(EMAIL) = LOWER($1)') ||
        whereClause.includes('LOWER(BTRIM(EMAIL)) = LOWER(BTRIM($1))'))
    ) {
      rows = rows.filter(
        (u) =>
          String(u.role).toUpperCase() === 'SUPERADMIN' &&
          String(u.email).trim().toLowerCase() === String(params[0] || '').trim().toLowerCase()
      );
    } else if (whereClause.includes("ROLE = 'SUPERADMIN'")) {
      rows = rows.filter((u) => String(u.role).toUpperCase() === 'SUPERADMIN' && (!whereClause.includes("STATUS = 'APPROVED'") || u.status === 'APPROVED'));
    } else if (whereClause.includes('LOWER(BTRIM(EMAIL)) = LOWER(BTRIM($1))') && whereClause.includes('ID != COALESCE($2, 0)')) {
      rows = rows.filter(
        (u) =>
          String(u.email).trim().toLowerCase() === String(params[0] || '').trim().toLowerCase() &&
          Number(u.id) !== Number(params[1] || 0)
      );
    } else if (whereClause.includes('LOWER(EMAIL) = LOWER($1)') && params.length >= 2) {
      rows = rows.filter(
        (u) =>
          String(u.email).toLowerCase() === String(params[0] || '').toLowerCase() &&
          Number(u.tenant_id) === Number(params[1])
      );
    } else if (
      whereClause.includes('LOWER(EMAIL) = LOWER($1)') ||
      whereClause.includes('LOWER(BTRIM(EMAIL)) = $1') ||
      whereClause.includes('LOWER(BTRIM(EMAIL)) = LOWER(BTRIM($1))') ||
      whereClause.includes('LOWER(BTRIM(U.EMAIL)) = LOWER(BTRIM($1))')
    ) {
      const excludesSuperAdmin =
        whereClause.includes("<> 'SUPERADMIN'") || whereClause.includes("!= 'SUPERADMIN'");
      rows = rows.filter(
        (u) =>
          String(u.email).trim().toLowerCase() === String(params[0] || '').trim().toLowerCase() &&
          (!excludesSuperAdmin || String(u.role || '').toUpperCase() !== 'SUPERADMIN')
      );
    } else if (whereClause.includes('TENANT_ID = ANY($1')) {
      const tids = (Array.isArray(params[0]) ? params[0] : []).map(Number);
      rows = rows.filter(
        (u) => tids.includes(Number(u.tenant_id)) && (!whereClause.includes("ROLE <> 'SUPERADMIN'") || String(u.role).toUpperCase() !== 'SUPERADMIN')
      );
    } else if (
      (whereClause.includes("UPPER(ROLE) = 'SUPERADMIN'") ||
        (whereClause.includes('SUPERADMIN') && whereClause.includes('ROLE') && !whereClause.includes('<>') && !whereClause.includes('!=')))
    ) {
      rows = rows.filter((u) => String(u.role).toUpperCase() === 'SUPERADMIN');
    } else if (whereClause.includes('TENANT_ID = $1') || whereClause.includes('COALESCE(TENANT_ID, 1) = $1')) {
      rows = rows.filter((u) => Number(u.tenant_id) === Number(params[0]));
    }
    if (upper.includes('LEFT JOIN TENANTS')) {
      rows = rows.map((u) => {
        const tenant = mockStore.tenants.find((tn) => Number(tn.id) === Number(u.tenant_id));
        return { ...u, store_name: tenant?.name || 'SarbaazSoft Shoe POS' };
      });
    }
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }

  if (upper.startsWith('INSERT INTO USERS')) {
    const candidateEmail = String(params[2] || 'user@example.com').trim().toLowerCase();
    const duplicate = mockStore.users.find(
      (u) => String(u.email || '').trim().toLowerCase() === candidateEmail
    );
    if (duplicate) {
      if (upper.includes('ON CONFLICT')) {
        return { rows: [], rowCount: 0 };
      }
      const dupErr: any = new Error('duplicate key value violates unique constraint "users_email_key"');
      dupErr.code = '23505';
      dupErr.constraint = 'users_email_key';
      throw dupErr;
    }
    const newUser = {
      id: nextMockId('users'),
      tenant_id: Number(params[0]) || 1,
      name: String(params[1] || 'User').trim(),
      email: candidateEmail,
      phone: params.length > 4 ? String(params[3] || '').trim() : '',
      avatar_url: '',
      password_hash: params.length > 4 ? params[4] : params[2],
      quick_password: params.length > 5 ? params[5] : '',
      role: upper.includes("'SUPERADMIN'") ? 'SUPERADMIN' : upper.includes("'CASHIER'") ? 'CASHIER' : 'ADMIN',
      status: upper.includes("'PENDING'") ? 'PENDING' : 'APPROVED',
      active: true,
      theme_color: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockStore.users.push(newUser);
    return { rows: [newUser as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('UPDATE USERS')) {
    if (upper.includes('SET PASSWORD_HASH = $1, QUICK_PASSWORD = $2')) {
      const uid = Number(params[2]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        u.password_hash = params[0];
        u.quick_password = params[1];
        u.status = 'APPROVED';
        u.active = true;
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET QUICK_PASSWORD = $1')) {
      const uid = Number(params[1]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        u.quick_password = params[0];
        u.status = 'APPROVED';
        u.active = true;
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET EMAIL = CASE WHEN $1')) {
      const uid = Number(params[2]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        if (params[0]) {
          const nextEmail = String(params[0]).trim().toLowerCase();
          const dup = mockStore.users.find(
            (x) => Number(x.id) !== uid && String(x.email || '').trim().toLowerCase() === nextEmail
          );
          if (dup) {
            const dupErr: any = new Error('duplicate key value violates unique constraint "users_email_key"');
            dupErr.code = '23505';
            dupErr.constraint = 'users_email_key';
            throw dupErr;
          }
          u.email = nextEmail;
        }
        u.phone = String(params[1] ?? u.phone);
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET STATUS = $1')) {
      const statusVal = String(params[0] || 'APPROVED');
      const uid = Number(params[1]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        u.status = statusVal;
        u.updated_at = new Date().toISOString();
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET ROLE = $1')) {
      const roleVal = String(params[0] || 'CASHIER');
      const uid = Number(params[1]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        u.role = roleVal;
        u.updated_at = new Date().toISOString();
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET NAME = $1, PHONE = $2, AVATAR_URL = $3')) {
      const uid = Number(params[3]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        u.name = String(params[0]);
        u.phone = String(params[1]);
        u.avatar_url = String(params[2]);
        u.updated_at = new Date().toISOString();
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET NAME = $1, EMAIL = $2, PHONE = $3, ROLE = $4, STATUS = $5')) {
      const uid = Number(params[7]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        u.name = String(params[0]);
        u.email = String(params[1]).trim().toLowerCase();
        u.phone = String(params[2]);
        u.role = String(params[3]);
        u.status = String(params[4]);
        if (params[5]) u.password_hash = params[5];
        if (params[6]) u.quick_password = params[6];
        u.updated_at = new Date().toISOString();
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET NAME = $1 WHERE ID = $2')) {
      const u = mockStore.users.find((x) => Number(x.id) === Number(params[1]));
      if (u) u.name = String(params[0]);
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET EMAIL = $1 WHERE ID = $2')) {
      const uid = Number(params[1]);
      const u = mockStore.users.find((x) => Number(x.id) === uid);
      if (u) {
        const nextEmail = String(params[0] || '').trim().toLowerCase();
        const dup = mockStore.users.find(
          (x) => Number(x.id) !== uid && String(x.email || '').trim().toLowerCase() === nextEmail
        );
        if (dup) {
          const dupErr: any = new Error('duplicate key value violates unique constraint "users_email_key"');
          dupErr.code = '23505';
          dupErr.constraint = 'users_email_key';
          throw dupErr;
        }
        u.email = nextEmail;
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET PHONE = $1 WHERE ID = $2')) {
      const u = mockStore.users.find((x) => Number(x.id) === Number(params[1]));
      if (u) u.phone = String(params[0]);
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    if (upper.includes('SET THEME_COLOR = $1') && upper.includes("UPPER(ROLE) != 'SUPERADMIN'")) {
      const themeVal = String(params[0] ?? '');
      const nowIso = new Date().toISOString();
      let updatedRows: any[] = [];
      if (upper.includes('WHERE TENANT_ID = $2')) {
        const tid = Number(params[1]);
        updatedRows = mockStore.users.filter(
          (x) => Number(x.tenant_id) === tid && String(x.role || '').toUpperCase() !== 'SUPERADMIN'
        );
      } else if (upper.includes('OR ID = $3')) {
        const tid = Number(params[1]);
        const uid = Number(params[2]);
        updatedRows = mockStore.users.filter(
          (x) =>
            (Number(x.tenant_id) === tid && String(x.role || '').toUpperCase() !== 'SUPERADMIN') ||
            Number(x.id) === uid
        );
      } else if (upper.includes('OR ID = $2')) {
        const uid = Number(params[1]);
        updatedRows = mockStore.users.filter(
          (x) => String(x.role || '').toUpperCase() !== 'SUPERADMIN' || Number(x.id) === uid
        );
      }
      for (const u of updatedRows) {
        u.theme_color = themeVal;
        u.updated_at = nowIso;
      }
      return { rows: updatedRows as unknown as T[], rowCount: updatedRows.length };
    }
    if (upper.includes('SET THEME_COLOR = $1')) {
      const themeVal = String(params[0] ?? '');
      const uid = Number(params[1]);
      const tid = params.length >= 3 ? Number(params[2]) : null;
      const u = mockStore.users.find(
        (x) =>
          Number(x.id) === uid &&
          (tid === null || !upper.includes('TENANT_ID = $3') || Number(x.tenant_id) === tid)
      );
      if (u) {
        u.theme_color = themeVal;
        u.updated_at = new Date().toISOString();
      }
      return { rows: u ? ([u] as unknown as T[]) : [], rowCount: u ? 1 : 0 };
    }
    const uid = Number(params[params.length - 1]);
    const u = Number.isInteger(uid) ? mockStore.users.find((x) => Number(x.id) === uid) : undefined;
    const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+/i);
    if (u && setMatch) {
      const assignRegex = /([a-z_]+)\s*=\s*(?:\$(\d+)|'([^']*)'|\b(TRUE|FALSE)\b|NOW\(\))/gi;
      let m: RegExpExecArray | null;
      while ((m = assignRegex.exec(setMatch[1])) !== null) {
        const col = m[1].toLowerCase();
        if (col === 'updated_at') continue;
        if (m[2]) {
          const val = params[Number(m[2]) - 1];
          if (val !== undefined) {
            (u as any)[col] = col === 'email' ? String(val).trim().toLowerCase() : val;
          }
        } else if (m[3] !== undefined) {
          (u as any)[col] = m[3];
        } else if (m[4] !== undefined) {
          (u as any)[col] = m[4].toUpperCase() === 'TRUE';
        }
      }
      u.updated_at = new Date().toISOString();
      return { rows: [u as unknown as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.startsWith('DELETE FROM USERS')) {
    if (upper.includes("ROLE = 'CASHIER'")) {
      const tid = Number(params[0]);
      mockStore.users = mockStore.users.filter((u) => !(Number(u.tenant_id) === tid && u.role === 'CASHIER'));
    } else if (upper.includes("ROLE != 'SUPERADMIN'")) {
      const tid = Number(params[0]);
      mockStore.users = mockStore.users.filter((u) => !(Number(u.tenant_id) === tid && u.role !== 'SUPERADMIN'));
    } else if (params.length > 0) {
      const uid = Number(params[0]);
      mockStore.users = mockStore.users.filter((u) => Number(u.id) !== uid);
    }
    return { rows: [], rowCount: 1 };
  }

  // PRODUCTS queries
  if (upper.startsWith('SELECT') && upper.includes('FROM PRODUCTS')) {
    if (
      upper.includes('P.BARCODE = $1') ||
      upper.includes('LOWER(BARCODE) = LOWER($1)') ||
      upper.includes('LOWER(TRIM(BARCODE)) = LOWER(TRIM($1))') ||
      upper.includes('LOWER(TRIM(BARCODE)) = LOWER($1)') ||
      upper.includes('BARCODE = $1')
    ) {
      const bc = String(params[0] || '').trim().toLowerCase();
      // Determine tenantId parameter index (usually $2, or $3 if id != $2)
      const hasIdNotEqualSecond = upper.includes('ID != $2');
      const tFilter = Number(hasIdNotEqualSecond ? params[2] : params[1]) || 1;
      const excludeId = hasIdNotEqualSecond
        ? (params[1] ? Number(params[1]) : null)
        : (params[2] ? Number(params[2]) : null);
      const allowsArticleOrName = upper.includes('LOWER(COALESCE(P.ARTICLE') || upper.includes('LOWER(ARTICLE) = LOWER($1)');
      const requireActive = upper.includes('ACTIVE = TRUE');
      const matched = mockStore.products.filter(
        (p) =>
          Number(p.tenant_id || 1) === tFilter &&
          (!requireActive || p.active !== false) &&
          (
            String(p.barcode || '').trim().toLowerCase() === bc ||
            (allowsArticleOrName && (
              String(p.article || '').trim().toLowerCase() === bc ||
              String(p.name || '').trim().toLowerCase() === bc
            ))
          ) &&
          (!excludeId || Number(p.id) !== excludeId)
      );
      return { rows: matched as unknown as T[], rowCount: matched.length };
    }
    if (
      upper.includes('LOWER(TRIM(ARTICLE)) = LOWER(TRIM($1))') ||
      upper.includes('LOWER(TRIM(ARTICLE)) = LOWER($1)') ||
      upper.includes('LOWER(ARTICLE) = LOWER($1)')
    ) {
      const art = String(params[0] || '').trim().toLowerCase();
      const hasIdNotEqualSecond = upper.includes('ID != $2');
      const tFilter = Number(hasIdNotEqualSecond ? params[2] : params[1]) || 1;
      const excludeId = hasIdNotEqualSecond
        ? (params[1] ? Number(params[1]) : null)
        : (params[2] ? Number(params[2]) : null);
      const matched = mockStore.products.filter(
        (p) =>
          Number(p.tenant_id || 1) === tFilter &&
          String(p.article || '').trim().toLowerCase() === art &&
          (!excludeId || Number(p.id) !== excludeId)
      );
      return { rows: matched as unknown as T[], rowCount: matched.length };
    }
    if (
      (upper.includes('WHERE P.ID = $1') || upper.includes('WHERE ID = $1')) &&
      (upper.includes('TENANT_ID') || params.length >= 2)
    ) {
      const targetId = Number(params[0]);
      const tFilter = Number(params[1] || 1);
      const csRow = mockStore.company_settings.find((cs) => Number(cs.tenant_id) === tFilter);
      const matched = mockStore.products
        .filter((p) => Number(p.id) === targetId && Number(p.tenant_id || 1) === tFilter)
        .map((p) => ({
          ...p,
          pricing_mode: csRow?.pricing_mode ?? 'FIXED',
        }));
      return { rows: matched as unknown as T[], rowCount: matched.length };
    }

    if (upper.includes('WHERE TENANT_ID = ANY($1')) {
      const tids = (Array.isArray(params[0]) ? params[0] : []).map(Number);
      const matched = mockStore.products.filter((p) => tids.includes(Number(p.tenant_id || 1)));
      return { rows: matched as unknown as T[], rowCount: matched.length };
    }

    const tid = params.length > 0 && !Array.isArray(params[0]) ? Number(params[0]) : null;
    const storeProds = mockStore.products.filter(
      (p) => p.active !== false && (!tid || Number(p.tenant_id) === tid)
    );
    if (upper.includes('AS TOTAL_PRODUCTS') && upper.includes('AS OUT_OF_STOCK_COUNT')) {
      const storeThreshold = Number(
        mockStore.company_settings.find((c) => !tid || Number(c.tenant_id) === tid)?.low_stock_threshold ?? 5
      );
      return {
        rows: [
          {
            total_products: String(storeProds.length),
            total_stock_units: String(storeProds.reduce((s, p) => s + Number(p.total_stock || 0), 0)),
            low_stock_count: String(
              storeProds.filter((p) => Number(p.total_stock || 0) <= storeThreshold && Number(p.total_stock || 0) > 0).length
            ),
            out_of_stock_count: String(storeProds.filter((p) => Number(p.total_stock || 0) <= 0).length),
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }
    if (upper.includes('COUNT(*)::INT AS CNT') && upper.includes('MAX(TENANT_PRODUCT_NO)')) {
      const allTenantProds = mockStore.products.filter((p) => !tid || Number(p.tenant_id) === tid);
      const maxNo = allTenantProds.reduce((m, p) => Math.max(m, Number(p.tenant_product_no || p.id || 0)), 0);
      return { rows: [{ cnt: allTenantProds.length, max_no: maxNo } as unknown as T], rowCount: 1 };
    }
    if (upper.includes('TENANT_PRODUCT_NO = ANY($2')) {
      const candidates: number[] = Array.isArray(params[1]) ? params[1].map(Number) : [];
      const matched = mockStore.products
        .filter((p) => Number(p.tenant_id || 1) === Number(params[0] || 1) && candidates.includes(Number(p.tenant_product_no)))
        .map((p) => ({ tenant_product_no: p.tenant_product_no }));
      return { rows: matched as unknown as T[], rowCount: matched.length };
    }
    if (upper.includes('AS CATEGORY_NAME') && upper.includes('AS STOCK_UNITS')) {
      const catMap = new Map<string, { category_name: string; product_count: number; stock_units: number; units_sold: number; revenue: number }>();
      for (const p of storeProds) {
        const key = (p.category || '').trim() || 'Athletic & Sneakers';
        const cur = catMap.get(key) || { category_name: key, product_count: 0, stock_units: 0, units_sold: 0, revenue: 0 };
        cur.product_count += 1;
        cur.stock_units += Number(p.total_stock || 0);
        const items = mockStore.sale_items.filter((si) => Number(si.product_id) === Number(p.id) && (!tid || Number(si.tenant_id || 1) === tid));
        cur.units_sold += items.reduce((s, i) => s + Number(i.quantity || 0), 0);
        cur.revenue += items.reduce((s, i) => s + (Number(i.unit_price || 0) * Number(i.quantity || 0) - Number(i.discount || 0)), 0);
        catMap.set(key, cur);
      }
      const rows = Array.from(catMap.values())
        .sort((a, b) => b.units_sold - a.units_sold || b.stock_units - a.stock_units)
        .slice(0, 5)
        .map((c) => ({
          category_name: c.category_name,
          product_count: c.product_count,
          stock_units: c.stock_units,
          units_sold: c.units_sold,
          revenue: String(c.revenue),
        })) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    if (upper.includes('AS PRODUCT_ID') && upper.includes('AS UNITS_SOLD')) {
      const rows = storeProds.slice(0, 4).map((p) => ({
        product_id: p.id,
        name: p.article || p.name,
        category_name: p.category || '',
        stock: String(p.total_stock || 0),
        brand_name: p.brand || 'Unbranded',
        brand_logo: '',
        primary_image_url: p.primary_image_url || '',
        units_sold: 0,
      })) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    if (upper.includes('AS STOCK_COUNT') && upper.includes('GROUP BY P.BRAND')) {
      const rows = storeProds.map((p) => ({
        name: p.brand || 'Unbranded',
        stock_count: Number(p.total_stock || 0),
      })) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    if (upper.includes('COALESCE(P.LOW_STOCK_THRESHOLD') || upper.includes('COALESCE(LOW_STOCK_THRESHOLD')) {
      const lowOnly = upper.includes('TOTAL_STOCK <= COALESCE(');
      if (lowOnly) {
        const filtered = storeProds.filter((p) => {
          const thr = Number.isFinite(Number(p.low_stock_threshold)) && Number(p.low_stock_threshold) >= 0
            ? Math.trunc(Number(p.low_stock_threshold))
            : 5;
          return Number(p.total_stock || 0) <= thr;
        });
        return { rows: filtered as unknown as T[], rowCount: filtered.length };
      }
    }
    return { rows: storeProds as unknown as T[], rowCount: storeProds.length };
  }

  if (upper.startsWith('INSERT INTO PRODUCTS')) {
    const tid = Number(params[0]) || 1;
    const storeProds = mockStore.products.filter((p) => Number(p.tenant_id) === tid);
    const colMatch = sql.match(/INSERT\s+INTO\s+(?:public\.)?products\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:RETURNING|$)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
      const vals = colMatch[2].split(',').map((v) => v.trim());
      const newProd: Record<string, any> = {
        id: nextMockId('products'),
        tenant_id: tid,
        tenant_product_no: storeProds.length + 1,
        name: 'Shoe Product',
        brand: 'Unbranded',
        category: 'Men',
        article: 'SH-01',
        barcode: `BC-${Date.now()}`,
        primary_image_url: '',
        description: '',
        cost_price: 0,
        min_price: 0,
        max_price: 0,
        pairs_per_carton: 12,
        allow_half_carton: true,
        total_stock: 0,
        low_stock_threshold: 5,
        is_low_stock_alert_sent: false,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      cols.forEach((col, idx) => {
        const expr = vals[idx];
        if (expr === undefined) return;
        const cleanExpr = expr.replace(/::\w+/g, '').trim();
        const paramMatch = cleanExpr.match(/^\$(\d+)$/);
        let rawVal: any;
        if (paramMatch) {
          rawVal = params[Number(paramMatch[1]) - 1];
        } else if (/^true$/i.test(cleanExpr)) {
          rawVal = true;
        } else if (/^false$/i.test(cleanExpr)) {
          rawVal = false;
        } else if (/^null$/i.test(cleanExpr)) {
          rawVal = null;
        } else {
          const strMatch = cleanExpr.match(/^'([^']*)'$/);
          rawVal = strMatch ? strMatch[1] : Number(cleanExpr);
        }
        newProd[col] = rawVal;
      });
      if (!newProd.name && newProd.article) newProd.name = newProd.article;
      if (!newProd.article && newProd.name) newProd.article = newProd.name;
      const rawThr = Number(newProd.low_stock_threshold);
      newProd.low_stock_threshold = Number.isFinite(rawThr) && rawThr >= 0 ? Math.trunc(rawThr) : 5;
      newProd.is_low_stock_alert_sent = Boolean(newProd.is_low_stock_alert_sent);
      mockStore.products.push(newProd);
      return { rows: [newProd as unknown as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.startsWith('UPDATE PRODUCTS')) {
    if (upper.includes('SET ALLOW_HALF_CARTON = FALSE')) {
      const tid = params.length > 0 ? Number(params[0]) : null;
      for (const p of mockStore.products) {
        if (!tid || Number(p.tenant_id || 1) === tid) {
          p.allow_half_carton = false;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (upper.includes('SET ACTIVE = FALSE') && upper.includes('WHERE ID = $1')) {
      const targetId = Number(params[0]);
      const tid = Number(params[1]) || 1;
      const prod = mockStore.products.find((p) => Number(p.id) === targetId && Number(p.tenant_id || 1) === tid);
      if (prod) {
        prod.active = false;
        prod.updated_at = new Date().toISOString();
      }
      return { rows: prod ? ([prod] as unknown as T[]) : [], rowCount: prod ? 1 : 0 };
    }

    const whereMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)(?:\s+RETURNING\b|$)/i);
    if (whereMatch) {
      const setClause = whereMatch[1];
      const whereClause = whereMatch[2];
      const idParamMatch = whereClause.match(/\bid\s*=\s*\$(\d+)/i);
      const tidParamMatch = whereClause.match(/tenant_id(?:\s*,\s*1\s*\))?\s*=\s*\$(\d+)/i);
      const targetId = idParamMatch ? Number(params[Number(idParamMatch[1]) - 1]) : null;
      const tid = tidParamMatch ? Number(params[Number(tidParamMatch[1]) - 1]) : null;
      const prod = mockStore.products.find(
        (p) => (targetId === null || Number(p.id) === targetId) && (!tid || Number(p.tenant_id || 1) === tid)
      );
      if (!prod) return { rows: [], rowCount: 0 };

      const assignments = setClause.split(',');
      for (const assign of assignments) {
        const eqIdx = assign.indexOf('=');
        if (eqIdx === -1) continue;
        const col = assign.slice(0, eqIdx).trim().toLowerCase();
        const rhs = assign.slice(eqIdx + 1).trim();
        if (col === 'updated_at') {
          prod.updated_at = new Date().toISOString();
          continue;
        }
        const paramMatch = rhs.match(/^\$(\d+)$/);
        if (paramMatch) {
          prod[col] = params[Number(paramMatch[1]) - 1];
        } else if (/^true$/i.test(rhs)) {
          prod[col] = true;
        } else if (/^false$/i.test(rhs)) {
          prod[col] = false;
        } else if (/^null$/i.test(rhs)) {
          prod[col] = null;
        }
      }
      prod.updated_at = new Date().toISOString();
      return { rows: [prod as unknown as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (upper.startsWith('DELETE FROM PRODUCTS')) {
    if (upper.includes('WHERE TENANT_ID = $1') && !/\bID\s*=\s*\$1\b/.test(upper)) {
      const tid = Number(params[0]);
      const before = mockStore.products.length;
      mockStore.products = mockStore.products.filter((p) => Number(p.tenant_id || 1) !== tid);
      return { rows: [], rowCount: before - mockStore.products.length };
    }
    const targetId = Number(params[0]);
    const tid = params.length > 1 ? Number(params[1]) : null;
    mockStore.products = mockStore.products.filter(
      (p) => !(Number(p.id) === targetId && (!tid || Number(p.tenant_id || 1) === tid))
    );
    return { rows: [], rowCount: 1 };
  }

  // Sales / Dashboard aggregates & lookups
  if (upper.startsWith('SELECT') && upper.includes('FROM SALES')) {
    const enrichSale = (s: any) => {
      const c = s.customer_id ? mockStore.customers.find((cust) => Number(cust.id) === Number(s.customer_id)) : null;
      const u = s.created_by ? mockStore.users.find((usr) => Number(usr.id) === Number(s.created_by)) : null;
      const saleItemsForSale = (mockStore.sale_items || []).filter((si) => Number(si.sale_id) === Number(s.id));
      const totalQty = saleItemsForSale.reduce((sum, si) => sum + Number(si.quantity || 0), 0);
      const saleItemIdSet = new Set(saleItemsForSale.map((si) => Number(si.id)));
      const exchangeLinkedReturnNumbers = new Set<string>();
      for (const otherSale of mockStore.sales || []) {
        const otherNotes = String(otherSale.notes || '');
        if (
          otherNotes.includes('Direct Shoe Exchange') ||
          otherNotes.includes('[Standalone: EXCHANGE]') ||
          otherNotes.includes('[Combined: SALE_EXCHANGE]')
        ) {
          const matches = otherNotes.matchAll(/(?:Return\s+#?)([A-Z0-9-]+)/gi);
          for (const m of matches) {
            if (m[1]) exchangeLinkedReturnNumbers.add(m[1].trim().toUpperCase());
          }
        }
      }
      const pureReturnIdsForSale = new Set(
        (mockStore.returns || [])
          .filter((r) => {
            if (Number(r.original_sale_id) !== Number(s.id)) return false;
            const retNo = String(r.return_number || '').trim().toUpperCase();
            return !retNo || !exchangeLinkedReturnNumbers.has(retNo);
          })
          .map((r) => Number(r.id))
      );
      const exchangeReturnIdSet = new Set(
        (mockStore.returns || [])
          .filter((r) => {
            const retNo = String(r.return_number || '').trim().toUpperCase();
            return Boolean(retNo && exchangeLinkedReturnNumbers.has(retNo));
          })
          .map((r) => Number(r.id))
      );
      const returnedQty = (mockStore.return_items || [])
        .filter((ri) => {
          if (exchangeReturnIdSet.has(Number(ri.return_id))) return false;
          return pureReturnIdsForSale.has(Number(ri.return_id)) || saleItemIdSet.has(Number(ri.sale_item_id));
        })
        .reduce((sum, ri) => sum + Number(ri.quantity || 0), 0);
      const dismissals = mockStore.pos_notification_dismissals || [];
      const uid = params.length >= 2 ? Number(params[1]) : 0;
      const isDismissed = dismissals.some(
        (d: any) =>
          d.item_type === 'SALE' &&
          Number(d.item_id) === Number(s.id) &&
          (Number(d.user_id) === uid || Number(d.user_id) === 0)
      );
      return {
        ...s,
        customer_name: c?.name || s.customer_name || null,
        customer_phone: c?.phone || s.customer_phone || null,
        customer_shop_name: c?.shop_name || null,
        customer_city: c?.city || null,
        customer_market_name: c?.market_name || null,
        customer_type: c?.customer_type || null,
        customer_ntn: c?.ntn_number || null,
        customer_outstanding_balance: c ? Number(c.outstanding_balance ?? c.current_balance ?? 0) : 0,
        customer_current_balance: c ? Number(c.current_balance ?? c.outstanding_balance ?? 0) : 0,
        cashier_name: u?.name || s.cashier_name || null,
        total_quantity: totalQty,
        returned_quantity: returnedQty,
        is_dismissed: isDismissed,
      };
    };

    if (upper.includes('AS TOTAL_SALES') && upper.includes('AS TOTAL_DISCOUNT')) {
      const tid = Number(params[0] || 1);
      const targetDate = String(params[1] || new Date().toISOString().split('T')[0]);
      const todaySales = mockStore.sales.filter(
        (s) => Number(s.tenant_id || 1) === tid && String(s.sale_date || '') === targetDate
      );
      const totalSales = todaySales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
      const totalDiscount = todaySales.reduce((sum, s) => sum + Number(s.discount || 0), 0);
      return {
        rows: [
          {
            count: String(todaySales.length),
            total_sales: String(totalSales),
            total_discount: String(totalDiscount),
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }

    if (upper.includes('AS TOTAL_REVENUE') && upper.includes('AS TOTAL_PROFIT')) {
      const tid = Number(params[0] || 1);
      const tSales = mockStore.sales.filter((s) => Number(s.tenant_id || 1) === tid);
      const tItems = mockStore.sale_items.filter((si) => Number(si.tenant_id || 1) === tid);
      const totalRevenue = tSales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
      const totalProfit = tItems.reduce(
        (sum, si) =>
          sum +
          (Number(si.unit_price || 0) * Number(si.quantity || 0) -
            Number(si.discount || 0) -
            Number(si.purchase_price || 0) * Number(si.quantity || 0)),
        0
      );
      return {
        rows: [
          {
            total_revenue: String(totalRevenue),
            total_profit: String(totalProfit),
            total_sales_count: String(tSales.length),
          } as unknown as T,
        ],
        rowCount: 1,
      };
    }

    let sList = [...mockStore.sales];
    if (upper.includes('CLIENT_TX_ID = $2')) {
      const tid = Number(params[0] || 1);
      const txId = String(params[1] || '').trim();
      const needle = params[2] ? String(params[2]).replace(/%/g, '').toLowerCase() : '';
      sList = sList.filter(
        (s) =>
          Number(s.tenant_id || 1) === tid &&
          ((s.client_tx_id && String(s.client_tx_id) === txId) ||
            (needle && String(s.notes || '').toLowerCase().includes(needle)))
      );
    } else if (upper.includes('NOTES LIKE $2')) {
      const tid = Number(params[0] || 1);
      const needle = String(params[1] || '').replace(/%/g, '').toLowerCase();
      sList = sList.filter(
        (s) => Number(s.tenant_id || 1) === tid && String(s.notes || '').toLowerCase().includes(needle)
      );
    } else if (upper.includes('INVOICE_NUMBER LIKE $2')) {
      const tid = Number(params[0] || 1);
      const prefix = String(params[1] || '').replace(/%$/, '').toLowerCase();
      sList = sList
        .filter((s) => Number(s.tenant_id || 1) === tid && String(s.invoice_number || '').toLowerCase().startsWith(prefix))
        .sort((a, b) => Number(b.id) - Number(a.id));
    } else if (upper.includes('UPPER(S.INVOICE_NUMBER) = UPPER($1)')) {
      const inv = String(params[0] || '').trim().toUpperCase();
      const tid = Number(params[1] || 1);
      sList = sList.filter(
        (s) => Number(s.tenant_id || 1) === tid && String(s.invoice_number || '').trim().toUpperCase() === inv
      );
    } else if (upper.includes('WHERE S.ID = $1') || upper.includes('WHERE ID = $1')) {
      const targetId = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      sList = sList.filter(
        (s) => Number(s.id) === targetId && (!tid || Number(s.tenant_id || 1) === tid)
      );
    } else {
      const tid = params.length > 0 && params[0] !== undefined ? Number(params[0]) : null;
      if (tid && (upper.includes('TENANT_ID = $1') || upper.includes('S.TENANT_ID = $1'))) {
        sList = sList.filter((s: any) => Number(s.tenant_id) === tid);
      }
      const roleParam = params.find((p) => typeof p === 'string' && (p === 'CASHIER' || p === 'ADMIN' || p === 'SUPERADMIN'));
      if (roleParam === 'CASHIER') {
        const uid = params.length >= 2 && params[1] !== undefined ? Number(params[1]) : 0;
        if (uid > 0) {
          sList = sList.filter((s: any) => Number(s.created_by) === uid);
        }
      }
      if (upper.includes("INTERVAL '48 HOURS'")) {
        const cutoff = Date.now() - 48 * 3600 * 1000;
        sList = sList.filter((s: any) => new Date(s.created_at || s.sale_date).getTime() >= cutoff);
      }
      if (upper.includes('NOT EXISTS') && upper.includes('POS_NOTIFICATION_DISMISSALS')) {
        const dismissals = mockStore.pos_notification_dismissals || [];
        const uid = params.length >= 2 ? Number(params[1]) : 0;
        sList = sList.filter((s: any) => !dismissals.some((d: any) => d.item_type === 'SALE' && Number(d.item_id) === Number(s.id) && (Number(d.user_id) === uid || Number(d.user_id) === 0)));
      }
    }
    const enriched = sList.map(enrichSale);
    return { rows: enriched as unknown as T[], rowCount: enriched.length };
  }

  if (upper.startsWith('INSERT INTO SALES')) {
    const cleanTenantId = Number(params[0] || 1);
    const clientTxId = params[20] !== undefined && params[20] !== null && String(params[20]).trim() !== ''
      ? String(params[20]).trim()
      : null;
    if (clientTxId) {
      const dupSale = mockStore.sales.find(
        (s) => Number(s.tenant_id || 1) === cleanTenantId && s.client_tx_id && String(s.client_tx_id) === clientTxId
      );
      if (dupSale) {
        const dupErr: any = new Error('duplicate key value violates unique constraint "sales_tenant_client_tx_id_unique_idx"');
        dupErr.code = '23505';
        throw dupErr;
      }
    }
    const newSale = {
      id: nextMockId('sales'),
      tenant_id: cleanTenantId,
      invoice_number: String(params[1] || 'INV-000001'),
      sale_type: String(params[2] || 'RETAIL'),
      customer_id: params[3] ? Number(params[3]) : null,
      subtotal: Number(params[4] || 0),
      discount: Number(params[5] || 0),
      total_amount: Number(params[6] || 0),
      total_cartons: Number(params[7] || 0),
      previous_balance: Number(params[8] || 0),
      paid_amount: Number(params[9] || 0),
      remaining_balance: Number(params[10] || 0),
      payment_method: String(params[11] || 'CASH'),
      cash_received: Number(params[12] || 0),
      change_given: Number(params[13] || 0),
      created_by: Number(params[14] || 1),
      is_min_price_overridden: Boolean(params[15]),
      overridden_by: params[16] ? Number(params[16]) : null,
      notes: String(params[17] || ''),
      sale_date: params[18] ? String(params[18]) : new Date().toISOString().slice(0, 10),
      transaction_id: params[19] ? String(params[19]) : '',
      client_tx_id: clientTxId,
      created_at: new Date().toISOString(),
    };
    mockStore.sales.unshift(newSale);
    return { rows: [{ id: newSale.id } as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO SALE_ITEMS')) {
    const newItem = {
      id: nextMockId('sale_items'),
      tenant_id: Number(params[0] || 1),
      sale_id: Number(params[1]),
      product_id: Number(params[2]),
      product_name: String(params[3]),
      packing_type: String(params[4] || 'PAIR'),
      carton_quantity: Number(params[5] || 0),
      pairs_per_carton: Number(params[6] || 1),
      quantity: Number(params[7]),
      unit_price: Number(params[8]),
      discount: Number(params[9] || 0),
      subtotal: Number(params[10]),
      purchase_price: Number(params[11] || 0),
    };
    mockStore.sale_items.push(newItem);
    return { rows: [newItem as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM SALE_ITEMS')) {
    if (upper.includes('AS PROFIT') && upper.includes('AS COST')) {
      const tid = Number(params[0] || 1);
      const targetDate = String(params[1] || new Date().toISOString().split('T')[0]);
      const matchingSaleIds = new Set(
        mockStore.sales
          .filter((s) => Number(s.tenant_id || 1) === tid && String(s.sale_date || '') === targetDate)
          .map((s) => Number(s.id))
      );
      const items = mockStore.sale_items.filter((si) => matchingSaleIds.has(Number(si.sale_id)));
      const profit = items.reduce(
        (sum, si) =>
          sum +
          (Number(si.unit_price || 0) * Number(si.quantity || 0) -
            Number(si.discount || 0) -
            Number(si.purchase_price || 0) * Number(si.quantity || 0)),
        0
      );
      const cost = items.reduce((sum, si) => sum + Number(si.purchase_price || 0) * Number(si.quantity || 0), 0);
      return { rows: [{ profit: String(profit), cost: String(cost) } as unknown as T], rowCount: 1 };
    }

    const enrichSaleItem = (si: any) => {
      const p = mockStore.products.find((prod) => Number(prod.id) === Number(si.product_id));
      const returnedQty = (mockStore.return_items || [])
        .filter((ri) => Number(ri.sale_item_id) === Number(si.id))
        .reduce((sum, ri) => sum + Number(ri.quantity || 0), 0);
      return {
        ...si,
        article: p?.article || si.product_name,
        product_name: p?.article || si.product_name,
        barcode: p?.barcode || '',
        pairs_per_carton: p?.pairs_per_carton ?? si.pairs_per_carton ?? 12,
        allow_half_carton: p?.allow_half_carton ?? true,
        already_returned_quantity: returnedQty,
      };
    };

    if (upper.includes('WHERE ID = $1') && upper.includes('SALE_ID = $2')) {
      const itemId = Number(params[0]);
      const sid = Number(params[1]);
      const tid = params.length >= 3 ? Number(params[2]) : null;
      const items = mockStore.sale_items
        .filter(
          (i) =>
            Number(i.id) === itemId &&
            Number(i.sale_id) === sid &&
            (!tid || Number(i.tenant_id || 1) === tid)
        )
        .map(enrichSaleItem);
      return { rows: items as unknown as T[], rowCount: items.length };
    }

    if (upper.includes('WHERE SI.SALE_ID = $1') || upper.includes('WHERE SALE_ID = $1')) {
      const sid = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      const items = mockStore.sale_items
        .filter((i) => Number(i.sale_id) === sid && (!tid || Number(i.tenant_id || 1) === tid))
        .map(enrichSaleItem);
      return { rows: items as unknown as T[], rowCount: items.length };
    }

    const allEnriched = mockStore.sale_items.map(enrichSaleItem);
    return { rows: allEnriched as unknown as T[], rowCount: allEnriched.length };
  }

  // CUSTOMERS
  if (upper.startsWith('SELECT') && upper.includes('FROM CUSTOMERS')) {
    if (upper.includes('COUNT(*)')) {
      const tid = params.length > 0 && upper.includes('TENANT_ID = $1') ? Number(params[0]) : null;
      const list = tid ? mockStore.customers.filter((c) => Number(c.tenant_id || 1) === tid) : mockStore.customers;
      return { rows: [{ count: String(list.length) } as unknown as T], rowCount: 1 };
    }
    let cList = [...mockStore.customers];
    if (upper.includes('WHERE C.ID = $1') || upper.includes('WHERE ID = $1')) {
      const cid = Number(params[0]);
      const tid = params.length >= 2 && upper.includes('TENANT_ID = $2') ? Number(params[1]) : null;
      cList = cList.filter((c) => Number(c.id) === cid && (!tid || Number(c.tenant_id || 1) === tid));
    } else if (upper.includes('WHERE C.TENANT_ID = $1') || upper.includes('WHERE TENANT_ID = $1')) {
      const tid = Number(params[0] || 1);
      cList = cList.filter((c) => Number(c.tenant_id || 1) === tid);
    }
    return { rows: cList as unknown as T[], rowCount: cList.length };
  }

  if (upper.startsWith('INSERT INTO CUSTOMERS')) {
    const newCust = {
      id: nextMockId('customers'),
      tenant_id: Number(params[0] || 1),
      name: String(params[1] || ''),
      phone: String(params[2] || ''),
      shop_name: String(params[3] || ''),
      market_name: String(params[4] || ''),
      city: String(params[5] || ''),
      email: String(params[6] || ''),
      address: String(params[7] || ''),
      notes: String(params[8] || ''),
      credit_limit: Number(params[9] || 0),
      current_balance: Number(params[10] || 0),
      outstanding_balance: Number(params[11] ?? params[10] ?? 0),
      ntn_number: String(params[12] || ''),
      customer_type: String(params[13] || 'RETAILER'),
      created_at: new Date().toISOString(),
    };
    mockStore.customers.unshift(newCust);
    return { rows: [newCust as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('UPDATE CUSTOMERS')) {
    if (upper.includes('SET OUTSTANDING_BALANCE = $1') || upper.includes('SET CURRENT_BALANCE = $1')) {
      const newBal = Number(params[0]);
      const cid = Number(params[1]);
      const tid = params.length >= 3 ? Number(params[2]) : null;
      const cust = mockStore.customers.find(
        (c) => Number(c.id) === cid && (!tid || Number(c.tenant_id || 1) === tid)
      );
      if (cust) {
        cust.outstanding_balance = newBal;
        cust.current_balance = newBal;
      }
      return { rows: cust ? [cust as unknown as T] : [], rowCount: cust ? 1 : 0 };
    }
    const cid = Number(params[params.length - 2]);
    const cust = mockStore.customers.find((c) => Number(c.id) === cid);
    if (cust) {
      cust.name = String(params[0] ?? cust.name);
      cust.phone = String(params[1] ?? cust.phone);
      cust.shop_name = String(params[2] ?? cust.shop_name);
      cust.market_name = String(params[3] ?? cust.market_name);
      cust.city = String(params[4] ?? cust.city);
      cust.email = String(params[5] ?? cust.email);
      cust.address = String(params[6] ?? cust.address);
      cust.notes = String(params[7] ?? cust.notes);
      cust.credit_limit = Number(params[8] ?? cust.credit_limit);
      cust.current_balance = Number(params[9] ?? cust.current_balance);
      cust.outstanding_balance = Number(params[10] ?? cust.outstanding_balance);
      cust.ntn_number = String(params[11] ?? cust.ntn_number);
      return { rows: [cust as unknown as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // CUSTOMER_LEDGER
  if (upper.startsWith('SELECT') && upper.includes('FROM CUSTOMER_LEDGER')) {
    let kList = [...mockStore.customer_ledger];
    if (upper.includes('WHERE CUSTOMER_ID = $1')) {
      const cid = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      kList = kList.filter((k) => Number(k.customer_id) === cid && (!tid || Number(k.tenant_id || 1) === tid));
    }
    return { rows: kList as unknown as T[], rowCount: kList.length };
  }

  if (upper.startsWith('INSERT INTO CUSTOMER_LEDGER')) {
    const newEntry = {
      id: nextMockId('customer_ledger'),
      tenant_id: Number(params[0] || 1),
      customer_id: Number(params[1]),
      transaction_date: String(params[2] || new Date().toISOString().slice(0, 10)),
      invoice_id: params[3] ? Number(params[3]) : null,
      invoice_number: String(params[4] || ''),
      total_bill: Number(params[5] || 0),
      amount_paid: Number(params[6] || 0),
      balance_change: Number(params[7] || 0),
      running_balance: Number(params[8] || 0),
      payment_method: String(params[9] || 'KHATA'),
      notes: String(params[10] || ''),
      created_at: new Date().toISOString(),
    };
    mockStore.customer_ledger.unshift(newEntry);
    return { rows: [newEntry as unknown as T], rowCount: 1 };
  }

  // STOCK_MOVEMENTS
  if (upper.startsWith('INSERT INTO STOCK_MOVEMENTS')) {
    if (!mockStore.stock_movements) mockStore.stock_movements = [];
    const colMatch = sql.match(/INSERT\s+INTO\s+stock_movements\s*\(([^)]+)\)/i);
    const valMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
    const entry: Record<string, any> = {
      id: nextMockId('stock_movements'),
      created_at: new Date().toISOString(),
    };
    if (colMatch && valMatch) {
      const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
      const valTokens = valMatch[1].split(',').map((v) => v.trim());
      cols.forEach((col, idx) => {
        const token = valTokens[idx] || '';
        if (token.startsWith('$')) {
          const pIdx = parseInt(token.slice(1), 10) - 1;
          entry[col] = params[pIdx];
        } else {
          entry[col] = token.replace(/^'|'$/g, '');
        }
      });
    }
    mockStore.stock_movements.unshift(entry);
    return { rows: [entry as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM STOCK_MOVEMENTS')) {
    let smList = [...(mockStore.stock_movements || [])];
    const tid = params.length > 0 ? Number(params[0] || 1) : 1;
    smList = smList.filter((sm) => Number(sm.tenant_id || 1) === tid);
    if (upper.includes('SM.PRODUCT_ID = $2')) {
      const pid = Number(params[1]);
      smList = smList.filter((sm) => Number(sm.product_id) === pid);
    }
    if (upper.includes('SM.MOVEMENT_TYPE =')) {
      const typeIdx = upper.includes('SM.PRODUCT_ID = $2') ? 2 : 1;
      const mType = String(params[typeIdx] || '').toUpperCase();
      smList = smList.filter((sm) => String(sm.movement_type || '').toUpperCase() === mType);
    }
    const enriched = smList.map((sm) => {
      const p = mockStore.products.find((prod) => Number(prod.id) === Number(sm.product_id));
      const u = mockStore.users.find((usr) => Number(usr.id) === Number(sm.user_id));
      return {
        ...sm,
        article: p?.article || p?.name || '',
        product_name: p?.article || p?.name || '',
        barcode: p?.barcode || '',
        user_name: u?.name || 'System',
      };
    });
    return { rows: enriched as unknown as T[], rowCount: enriched.length };
  }

  // RETURNS & RETURN_ITEMS
  if (upper.startsWith('INSERT INTO RETURNS')) {
    if (!mockStore.returns) mockStore.returns = [];
    const newRet = {
      id: nextMockId('returns'),
      tenant_id: Number(params[0] || 1),
      return_number: String(params[1] || 'RET-000001'),
      original_sale_id: params[2] ? Number(params[2]) : null,
      customer_id: params[3] ? Number(params[3]) : null,
      return_date: new Date().toISOString().slice(0, 10),
      total_refund_amount: Number(params[4] || 0),
      reason: String(params[5] || ''),
      created_by: Number(params[6] || 1),
      payment_method: params[7] !== undefined && params[7] !== null ? String(params[7]) : null,
      customer_name: params[8] !== undefined && params[8] !== null ? String(params[8]) : null,
      created_at: new Date().toISOString(),
    };
    mockStore.returns.unshift(newRet);
    return { rows: [{ id: newRet.id } as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO RETURN_ITEMS')) {
    if (!mockStore.return_items) mockStore.return_items = [];
    const colMatch = sql.match(/INSERT\s+INTO\s+return_items\s*\(([^)]+)\)/i);
    const valMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
    const entry: Record<string, any> = {
      id: nextMockId('return_items'),
    };
    if (colMatch && valMatch) {
      const cols = colMatch[1].split(',').map((c) => c.trim().toLowerCase());
      const valTokens = valMatch[1].split(',').map((v) => v.trim());
      cols.forEach((col, idx) => {
        const token = valTokens[idx] || '';
        if (token.startsWith('$')) {
          const pIdx = parseInt(token.slice(1), 10) - 1;
          entry[col] = params[pIdx];
        } else if (token.toUpperCase() === 'NULL') {
          entry[col] = null;
        } else {
          entry[col] = token.replace(/^'|'$/g, '');
        }
      });
    }
    mockStore.return_items.push(entry);
    return { rows: [entry as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM RETURN_ITEMS') && !upper.includes('FROM RETURNS')) {
    let riList = [...(mockStore.return_items || [])];
    if (upper.includes('WHERE SALE_ITEM_ID = $1')) {
      const saleItemId = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      riList = riList.filter(
        (ri) => Number(ri.sale_item_id) === saleItemId && (!tid || Number(ri.tenant_id || 1) === tid)
      );
      if (upper.includes('AS TOTAL_RETURNED')) {
        const sumQty = riList.reduce((sum, ri) => sum + Number(ri.quantity || 0), 0);
        return { rows: [{ total_returned: String(sumQty) } as unknown as T], rowCount: 1 };
      }
      return { rows: riList as unknown as T[], rowCount: riList.length };
    }
    if (upper.includes('WHERE RI.RETURN_ID = $1')) {
      const rid = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      riList = riList
        .filter((ri) => Number(ri.return_id) === rid && (!tid || Number(ri.tenant_id || 1) === tid))
        .map((ri) => {
          const p = mockStore.products.find((prod) => Number(prod.id) === Number(ri.product_id));
          return {
            ...ri,
            article: p?.article || p?.name || '',
            product_name: p?.article || p?.name || '',
            barcode: p?.barcode || '',
          };
        });
      return { rows: riList as unknown as T[], rowCount: riList.length };
    }
    return { rows: riList as unknown as T[], rowCount: riList.length };
  }

  // PURCHASE_RETURNS & PURCHASE_RETURN_ITEMS (check before PURCHASES due to JOIN purchases)
  if (upper.startsWith('INSERT INTO PURCHASE_RETURNS')) {
    if (!mockStore.purchase_returns) mockStore.purchase_returns = [];
    const newRet = {
      id: nextMockId('purchase_returns'),
      tenant_id: Number(params[0] || 1),
      return_number: String(params[1] || 'PR-000001'),
      purchase_id: params[2] ? Number(params[2]) : null,
      supplier_id: params[3] ? Number(params[3]) : null,
      supplier_name: String(params[4] || ''),
      return_date: String(params[5] || new Date().toISOString().slice(0, 10)),
      total_debit_amount: Number(params[6] || 0),
      reason: String(params[7] || ''),
      notes: params[8] ?? null,
      created_by: Number(params[9] || 1),
      created_at: new Date().toISOString(),
    };
    mockStore.purchase_returns.unshift(newRet);
    return { rows: [{ id: newRet.id } as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO PURCHASE_RETURN_ITEMS')) {
    if (!mockStore.purchase_return_items) mockStore.purchase_return_items = [];
    const newItem = {
      id: nextMockId('purchase_return_items'),
      tenant_id: Number(params[0] || 1),
      purchase_return_id: Number(params[1]),
      product_id: Number(params[2]),
      quantity: Number(params[3]),
      unit_purchase_price: Number(params[4]),
      subtotal: Number(params[5]),
      defect_type: String(params[6] || 'MANUFACTURING_DEFECT'),
    };
    mockStore.purchase_return_items.push(newItem);
    return { rows: [newItem as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM PURCHASE_RETURNS')) {
    const tid = params.length > 0 ? Number(params[0] || 1) : 1;
    let prList = (mockStore.purchase_returns || []).filter((r: any) => Number(r.tenant_id || 1) === tid);
    if (upper.includes('RETURN_NUMBER LIKE $2')) {
      const prefix = String(params[1] || '').replace(/%$/, '').toLowerCase();
      prList = prList
        .filter((r: any) => String(r.return_number || '').toLowerCase().startsWith(prefix))
        .sort((a: any, b: any) => Number(b.id) - Number(a.id));
    }
    return { rows: prList as unknown as T[], rowCount: prList.length };
  }

  // PURCHASES & PURCHASE_ITEMS
  if (upper.startsWith('INSERT INTO PURCHASES')) {
    if (!mockStore.purchases) mockStore.purchases = [];
    const newPur = {
      id: nextMockId('purchases'),
      tenant_id: Number(params[0] || 1),
      purchase_number: String(params[1] || 'PUR-000001'),
      supplier_id: params[2] ? Number(params[2]) : null,
      supplier_name: String(params[3] || ''),
      purchase_date: String(params[4] || new Date().toISOString().slice(0, 10)),
      total_amount: Number(params[5] || 0),
      paid_amount: Number(params[6] || 0),
      payment_status: String(params[7] || 'UNPAID'),
      payment_method: String(params[8] || 'CASH'),
      notes: params[9] ?? null,
      created_by: Number(params[10] || 1),
      created_at: new Date().toISOString(),
    };
    mockStore.purchases.unshift(newPur);
    return { rows: [{ id: newPur.id } as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO PURCHASE_ITEMS')) {
    if (!mockStore.purchase_items) mockStore.purchase_items = [];
    const newItem = {
      id: nextMockId('purchase_items'),
      tenant_id: Number(params[0] || 1),
      purchase_id: Number(params[1]),
      product_id: Number(params[2]),
      quantity: Number(params[3]),
      unit_purchase_price: Number(params[4]),
      subtotal: Number(params[5]),
    };
    mockStore.purchase_items.push(newItem);
    return { rows: [newItem as unknown as T], rowCount: 1 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM PURCHASES')) {
    if (upper.includes('COUNT(*)') && !upper.includes('PURCHASE_ITEMS')) {
      return { rows: [{ count: String(mockStore.purchases.length), total: '0' } as unknown as T], rowCount: 1 };
    }
    const tid = params.length > 0 ? Number(params[0] || 1) : 1;
    let pList = mockStore.purchases.filter((p: any) => Number(p.tenant_id || 1) === tid);
    if (upper.includes('WHERE P.ID = $1') || upper.includes('WHERE ID = $1')) {
      const pid = Number(params[0]);
      const pTid = params.length >= 2 ? Number(params[1]) : null;
      pList = mockStore.purchases.filter(
        (p: any) => Number(p.id) === pid && (!pTid || Number(p.tenant_id || 1) === pTid)
      );
    } else if (upper.includes('PURCHASE_NUMBER LIKE $2')) {
      const prefix = String(params[1] || '').replace(/%$/, '').toLowerCase();
      pList = pList
        .filter((p: any) => String(p.purchase_number || '').toLowerCase().startsWith(prefix))
        .sort((a: any, b: any) => Number(b.id) - Number(a.id));
    } else {
      if (upper.includes("INTERVAL '48 HOURS'")) {
        const cutoff = Date.now() - 48 * 3600 * 1000;
        pList = pList.filter((p: any) => new Date(p.created_at || p.purchase_date).getTime() >= cutoff);
      }
      if (upper.includes('NOT EXISTS') && upper.includes('POS_NOTIFICATION_DISMISSALS')) {
        const dismissals = mockStore.pos_notification_dismissals || [];
        const uid = params.length >= 2 ? Number(params[1]) : 0;
        pList = pList.filter(
          (p: any) =>
            !dismissals.some(
              (d: any) =>
                d.item_type === 'PURCHASE' &&
                Number(d.item_id) === Number(p.id) &&
                (Number(d.user_id) === uid || Number(d.user_id) === 0)
            )
        );
      }
    }
    const uid = params.length >= 2 ? Number(params[1]) : 0;
    const dismissals = mockStore.pos_notification_dismissals || [];
    const enrichedPurchases = pList.map((p: any) => {
      const sup = p.supplier_id
        ? (mockStore.suppliers || []).find((s: any) => Number(s.id) === Number(p.supplier_id))
        : null;
      const usr = p.created_by
        ? (mockStore.users || []).find((u: any) => Number(u.id) === Number(p.created_by))
        : null;
      const pItems = (mockStore.purchase_items || []).filter((pi: any) => Number(pi.purchase_id) === Number(p.id));
      const totalQty = pItems.reduce((sum: number, pi: any) => sum + Number(pi.quantity || 0), 0);
      const isDismissed = dismissals.some(
        (d: any) =>
          d.item_type === 'PURCHASE' &&
          Number(d.item_id) === Number(p.id) &&
          (Number(d.user_id) === uid || Number(d.user_id) === 0)
      );
      return {
        ...p,
        supplier_official_name: sup?.name || p.supplier_name || null,
        supplier_phone: sup?.phone || null,
        supplier_email: sup?.email || null,
        created_by_name: usr?.name || 'Admin',
        item_count: pItems.length,
        total_quantity: totalQty,
        balance_due: Math.max(0, Number(p.total_amount || 0) - Number(p.paid_amount || 0)),
        is_dismissed: isDismissed,
      };
    });
    return { rows: enrichedPurchases as unknown as T[], rowCount: enrichedPurchases.length };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM CATEGORIES')) {
    return { rows: mockStore.categories as unknown as T[], rowCount: mockStore.categories.length };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM RETURNS')) {
    let rList = [...(mockStore.returns || [])];
    if (upper.includes('WHERE R.ORIGINAL_SALE_ID = $1') || upper.includes('WHERE ORIGINAL_SALE_ID = $1')) {
      const origSaleId = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      rList = rList.filter(
        (r: any) => Number(r.original_sale_id) === origSaleId && (!tid || Number(r.tenant_id || 1) === tid)
      );
    } else if (upper.includes('WHERE R.ID = $1')) {
      const rid = Number(params[0]);
      const tid = params.length >= 2 ? Number(params[1]) : null;
      rList = rList.filter((r: any) => Number(r.id) === rid && (!tid || Number(r.tenant_id || 1) === tid));
    } else {
      const tid = params.length > 0 && params[0] !== undefined ? Number(params[0]) : null;
      if (tid && (upper.includes('TENANT_ID = $1') || upper.includes('R.TENANT_ID = $1'))) {
        rList = rList.filter((r: any) => Number(r.tenant_id) === tid);
      }
      if (upper.includes("RETURN_NUMBER LIKE 'RET-%'")) {
        rList = rList
          .filter((r: any) => String(r.return_number || '').startsWith('RET-'))
          .sort((a: any, b: any) => Number(b.id) - Number(a.id));
      }
      const roleParam = params.find((p) => typeof p === 'string' && (p === 'CASHIER' || p === 'ADMIN' || p === 'SUPERADMIN'));
      if (roleParam === 'CASHIER') {
        const uid = params.length >= 2 && params[1] !== undefined ? Number(params[1]) : 0;
        if (uid > 0) {
          rList = rList.filter((r: any) => Number(r.created_by) === uid);
        }
      }
      if (upper.includes("INTERVAL '48 HOURS'")) {
        const cutoff = Date.now() - 48 * 3600 * 1000;
        rList = rList.filter((r: any) => new Date(r.created_at || r.return_date).getTime() >= cutoff);
      }
      if (upper.includes('NOT EXISTS') && upper.includes('POS_NOTIFICATION_DISMISSALS')) {
        const dismissals = mockStore.pos_notification_dismissals || [];
        const uid = params.length >= 2 ? Number(params[1]) : 0;
        rList = rList.filter((r: any) => !dismissals.some((d: any) => d.item_type === 'RETURN' && Number(d.item_id) === Number(r.id) && (Number(d.user_id) === uid || Number(d.user_id) === 0)));
      }
    }
    const uid = params.length >= 2 ? Number(params[1]) : 0;
    const dismissals = mockStore.pos_notification_dismissals || [];
    const enriched = rList.map((r: any) => {
      const s = r.original_sale_id
        ? mockStore.sales.find((sale) => Number(sale.id) === Number(r.original_sale_id))
        : null;
      const c = r.customer_id ? mockStore.customers.find((cust) => Number(cust.id) === Number(r.customer_id)) : null;
      const u = r.created_by ? mockStore.users.find((usr) => Number(usr.id) === Number(r.created_by)) : null;
      const totalQty = (mockStore.return_items || [])
        .filter((ri) => Number(ri.return_id) === Number(r.id))
        .reduce((sum, ri) => sum + Number(ri.quantity || 0), 0);
      const isDismissed = dismissals.some(
        (d: any) =>
          d.item_type === 'RETURN' &&
          Number(d.item_id) === Number(r.id) &&
          (Number(d.user_id) === uid || Number(d.user_id) === 0)
      );
      return {
        ...r,
        invoice_number: s?.invoice_number || null,
        payment_method: s?.payment_method || r.payment_method || null,
        customer_name: c?.name || r.customer_name || null,
        cashier_name: u?.name || null,
        total_quantity: totalQty,
        is_dismissed: isDismissed,
      };
    });
    return { rows: enriched as unknown as T[], rowCount: enriched.length };
  }

  // Generic tenant-scoped DELETE cleanup fallback for store cascade deletion in mockStore
  if (upper.startsWith('DELETE FROM ')) {
    const tblMatch = upper.match(/^DELETE\s+FROM\s+(?:PUBLIC\.)?([A-Z0-9_]+)/);
    const tbl = tblMatch ? tblMatch[1].toLowerCase() : '';
    if (tbl && Array.isArray(mockStore[tbl]) && params.length > 0 && upper.includes('TENANT_ID = $1')) {
      const tid = Number(params[0]);
      const before = mockStore[tbl].length;
      mockStore[tbl] = mockStore[tbl].filter((row: any) => Number(row.tenant_id) !== tid);
      return { rows: [], rowCount: before - mockStore[tbl].length };
    }
  }

  return { rows: [], rowCount: 0 };
}

function createDbInfo(url: string): DbConnectionInfo {
  let maskedUrl = 'postgresql://[in-memory-mock]';
  let host = 'in-memory-mock';
  let port = 5432;
  let database = 'postgres';
  let user = 'postgres';

  if (url) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname || 'localhost';
      port = parsed.port ? parseInt(parsed.port, 10) : 5432;
      database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'postgres';
      user = parsed.username || 'postgres';
      maskedUrl = `${parsed.protocol}//${user}:****@${host}:${port}/${database}`;
    } catch (_) {
      // Keep credentials masked if DATABASE_URL cannot be parsed.
    }
  }

  return {
    type: 'PostgreSQL Server',
    isStandardPostgres: true,
    host,
    port,
    database,
    user,
    ssl: true,
    maskedUrl,
    connected: false,
  };
}

function isValidDatabaseUrl(urlStr: string | undefined): boolean {
  if (!urlStr) return false;
  const trimmed = urlStr.trim();
  if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.endsWith('-') || host.endsWith('.') || host.startsWith('-') || host.startsWith('.')) return false;
    const parts = host.split('.');
    if (parts.length < 2) return false;
    if (parts.some((p) => !p || p.startsWith('-') || p.endsWith('-'))) return false;
    return true;
  } catch {
    return false;
  }
}

if (!isValidDatabaseUrl(rawDatabaseUrl)) {
  console.log('ℹ️ Running in in-memory PostgreSQL store mode.');
  useMock = true;
  dbInfo = createDbInfo('');
  dbInfo.connected = true;
} else {
  dbInfo = createDbInfo(rawDatabaseUrl!);
  try {
    rawPool = new Pool({
      connectionString: rawDatabaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    rawPool.on('connect', (client) => {
      client.query("SET client_encoding TO 'UTF8'").catch(() => {});
    });

    rawPool.on('error', (err: any) => {
      if (useMock) return;
      const msg = err?.message || String(err);
      if (
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('ECONNRESET') ||
        msg.includes('connection reset') ||
        msg.includes('client has been closed') ||
        err?.code === '57P01'
      ) {
        return;
      }
      if (
        msg.includes('ENOTFOUND') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('EHOSTUNREACH')
      ) {
        useMock = true;
        if (rawPool) {
          try {
            rawPool.removeAllListeners();
            rawPool.on('error', () => {});
            rawPool.end().catch(() => {});
          } catch {}
          rawPool = null;
        }
        return;
      }
      dbInfo.lastError = msg;
    });
  } catch {
    useMock = true;
    dbInfo.connected = true;
  }
}

let readinessPromise: Promise<void> | null = null;

async function waitForDatabaseReady(): Promise<void> {
  if (useMock || dbInfo.connected) return;
  if (!rawPool) {
    useMock = true;
    dbInfo.connected = true;
    return;
  }
  if (!readinessPromise) {
    readinessPromise = (async () => {
      try {
        await rawPool!.query('SELECT 1');
        console.log(`✅ Connected to PostgreSQL Server (${dbInfo.host}:${dbInfo.port}/${dbInfo.database})`);
        dbInfo.connected = true;
        dbInfo.lastError = undefined;
        return;
      } catch (err: any) {
        console.log(`ℹ️ External PostgreSQL database unreachable — using in-memory mock store.`);
        useMock = true;
        dbInfo.connected = true;
        dbInfo.lastError = undefined;
        if (rawPool) {
          try {
            rawPool.removeAllListeners();
            rawPool.on('error', () => {});
            rawPool.end().catch(() => {});
          } catch {}
          rawPool = null;
        }
      }
    })().finally(() => {
      readinessPromise = null;
    });
  }
  return readinessPromise!;
}


// Unified PostgreSQL client interface used throughout the application.
export const pgClient = {
  get waitReady() {
    return waitForDatabaseReady();
  },

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number }> {
    await waitForDatabaseReady();
    if (useMock || !rawPool) {
      return executeMockQuery<T>(text, params);
    }

    const store = txStorage.getStore();
    const trimmed = text.trim().toUpperCase();

    const isTransientConnectionError = (err: any): boolean => {
      const msg = (err?.message || String(err)).toLowerCase();
      const code = err?.code;
      return (
        msg.includes('connection terminated') ||
        msg.includes('econnreset') ||
        msg.includes('connection reset') ||
        msg.includes('client was closed') ||
        msg.includes('socket hang up') ||
        msg.includes('terminating connection') ||
        msg.includes('closed the connection unexpectedly') ||
        code === '57P01' ||
        code === 'ECONNRESET' ||
        code === 'EPIPE'
      );
    };

    const formatRes = (res: any) => {
      if (Array.isArray(res)) {
        const last = res[res.length - 1] || {};
        return { rows: (last.rows || []) as T[], rowCount: last.rowCount ?? last.rows?.length ?? 0 };
      }
      return { rows: (res?.rows || []) as T[], rowCount: res?.rowCount ?? res?.rows?.length ?? 0 };
    };

    if (trimmed === 'BEGIN') {
      if (store) {
        if (!store.client) store.client = await rawPool.connect();
        const res = await store.client.query(text);
        return formatRes(res);
      }
      const client = await rawPool.connect();
      try {
        const res = await client.query(text);
        return formatRes(res);
      } finally {
        client.release();
      }
    }

    if (trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      if (store?.client) {
        const client = store.client;
        store.client = null;
        try {
          const res = await client.query(text);
          client.release();
          return formatRes(res);
        } catch (txErr) {
          try { client.release(true); } catch (_) {}
          throw txErr;
        }
      }
      const res = await rawPool.query(text);
      return formatRes(res);
    }

    if (store?.client) {
      try {
        const res = await store.client.query(text, params);
        return formatRes(res);
      } catch (err: any) {
        if (isTransientConnectionError(err)) {
          try { store.client.release(true); } catch (_) {}
          store.client = null;
        }
        throw err;
      }
    }

    let lastErr: any;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await rawPool.query(text, params);
        return formatRes(res);
      } catch (err: any) {
        lastErr = err;
        if (attempt === 1 && isTransientConnectionError(err)) {
          console.warn(`⚠️ PostgreSQL connection reset during query (${err?.message || err}). Retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  },

  async exec(sql: string): Promise<void> {
    await waitForDatabaseReady();
    if (useMock || !rawPool) {
      return;
    }
    await rawPool.query(sql);
  },

  async executeRawSql(sqlText: string): Promise<RawSqlExecutionResult> {
    await waitForDatabaseReady();
    const startedAt = Date.now();
    const trimmedSql = String(sqlText || '').trim();
    if (!trimmedSql) {
      const err: any = new Error('SQL query cannot be empty.');
      err.code = '42601';
      throw err;
    }

    const MAX_PREVIEW_ROWS = 500;

    if (useMock || !rawPool) {
      return executeMockRawSql(trimmedSql, startedAt, MAX_PREVIEW_ROWS);
    }

    const client = await rawPool.connect();
    const upperNoComments = stripSqlComments(trimmedSql).toUpperCase();
    const containsExplicitTxControl =
      /\b(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE|CREATE\s+INDEX\s+CONCURRENTLY)\b/i.test(
        upperNoComments
      );

    try {
      if (!containsExplicitTxControl) {
        await client.query('BEGIN');
      }
      const rawRes = await client.query(trimmedSql);
      if (!containsExplicitTxControl) {
        await client.query('COMMIT');
      }

      const resultArray: any[] = Array.isArray(rawRes) ? rawRes : [rawRes];
      const validResults = resultArray.filter(Boolean);
      const lastWithRows = [...validResults].reverse().find((r) => Array.isArray(r.rows) && r.rows.length > 0);
      const targetRes = lastWithRows || validResults[validResults.length - 1] || {};

      const allRows: Record<string, any>[] = Array.isArray(targetRes.rows) ? targetRes.rows : [];
      const columns: string[] =
        Array.isArray(targetRes.fields) && targetRes.fields.length > 0
          ? targetRes.fields.map((f: any) => String(f.name))
          : allRows.length > 0
          ? Object.keys(allRows[0])
          : [];

      const truncated = allRows.length > MAX_PREVIEW_ROWS;
      const previewRows = truncated ? allRows.slice(0, MAX_PREVIEW_ROWS) : allRows;

      const commands = validResults.map((r) => String(r.command || '').trim()).filter(Boolean);
      const command =
        commands.length > 1
          ? commands.slice(-3).join(', ')
          : String(targetRes.command || 'OK');

      const totalAffected =
        allRows.length > 0
          ? Number(targetRes.rowCount ?? allRows.length)
          : validResults.reduce((sum, r) => sum + Math.max(0, Number(r?.rowCount ?? 0)), 0);

      return {
        command,
        rowCount: Number.isFinite(totalAffected) ? totalAffected : allRows.length,
        columns,
        rows: previewRows,
        totalRowsReturned: allRows.length,
        truncated,
        statementCount: Math.max(1, validResults.length),
        durationMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (err: any) {
      if (!containsExplicitTxControl) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  },
};

export interface RawSqlExecutionResult {
  command: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, any>[];
  totalRowsReturned: number;
  truncated: boolean;
  statementCount: number;
  durationMs: number;
}

function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        out += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    }
    out += ch;
    i++;
  }
  return out;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      const startIdx = i;
      i += 2;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        const err: any = new Error(`Unterminated /* comment at position ${startIdx + 1}`);
        err.code = '42601';
        err.position = String(startIdx + 1);
        throw err;
      }
      current += ' ';
      continue;
    }

    if (ch === "'" && !inDouble) {
      current += ch;
      if (inSingle && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle) {
      current += ch;
      inDouble = !inDouble;
      i++;
      continue;
    }

    if (!inSingle && !inDouble && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (inSingle) {
    const err: any = new Error('Unterminated quoted string constant');
    err.code = '42601';
    throw err;
  }
  if (inDouble) {
    const err: any = new Error('Unterminated quoted identifier');
    err.code = '42601';
    throw err;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function parseSqlLiteral(rawToken: string): any {
  const token = rawToken.trim();
  const upper = token.toUpperCase();
  if (upper === 'NULL') return null;
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  if (upper === 'NOW()' || upper === 'CURRENT_TIMESTAMP') return new Date().toISOString();
  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return Number(token);
  }
  return token;
}

function splitTopLevelComma(expr: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    const next = expr[i + 1];
    if (ch === "'" && !inDouble) {
      current += ch;
      if (inSingle && next === "'") {
        current += next;
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      current += ch;
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function evaluateMockWhere(row: Record<string, any>, whereClause: string): boolean {
  const trimmed = whereClause.trim();
  if (!trimmed) return true;

  // Handle OR groups only outside parentheses/quotes
  const orParts = splitLogicalKeyword(trimmed, 'OR');
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateMockWhere(row, part));
  }

  const andParts = splitLogicalKeyword(trimmed, 'AND');
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateMockWhere(row, part));
  }

  let cond = trimmed;
  if (cond.startsWith('(') && cond.endsWith(')')) {
    cond = cond.slice(1, -1).trim();
  }

  const isNullMatch = cond.match(/^"?([a-zA-Z0-9_]+)"?\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNullMatch) {
    const col = isNullMatch[1];
    const isNot = Boolean(isNullMatch[2]);
    const val = row[col];
    return isNot ? val !== null && val !== undefined : val === null || val === undefined;
  }

  const inMatch = cond.match(/^"?([a-zA-Z0-9_]+)"?\s+(NOT\s+)?IN\s*\((.+)\)$/i);
  if (inMatch) {
    const col = inMatch[1];
    const isNot = Boolean(inMatch[2]);
    const vals = splitTopLevelComma(inMatch[3]).map(parseSqlLiteral);
    const matched = vals.some((v) => String(row[col]) === String(v));
    return isNot ? !matched : matched;
  }

  const opMatch = cond.match(/^"?([a-zA-Z0-9_]+)"?\s*(=|!=|<>|>=|<=|>|<|ILIKE|LIKE)\s*(.+)$/i);
  if (opMatch) {
    const col = opMatch[1];
    const op = opMatch[2].toUpperCase();
    const expected = parseSqlLiteral(opMatch[3]);
    const actual = row[col];

    if (op === 'LIKE' || op === 'ILIKE') {
      const patternStr = String(expected ?? '');
      const regex = new RegExp(
        '^' + patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
        op === 'ILIKE' ? 'i' : ''
      );
      return regex.test(String(actual ?? ''));
    }

    if (op === '=') {
      if (typeof actual === 'number' && typeof expected === 'number') return actual === expected;
      if (typeof actual === 'boolean' && typeof expected === 'boolean') return actual === expected;
      return String(actual ?? '') === String(expected ?? '');
    }
    if (op === '!=' || op === '<>') {
      if (typeof actual === 'number' && typeof expected === 'number') return actual !== expected;
      return String(actual ?? '') !== String(expected ?? '');
    }
    const numA = Number(actual);
    const numB = Number(expected);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      if (op === '>') return numA > numB;
      if (op === '>=') return numA >= numB;
      if (op === '<') return numA < numB;
      if (op === '<=') return numA <= numB;
    }
    const strA = String(actual ?? '');
    const strB = String(expected ?? '');
    if (op === '>') return strA > strB;
    if (op === '>=') return strA >= strB;
    if (op === '<') return strA < strB;
    if (op === '<=') return strA <= strB;
  }

  const err: any = new Error(`Unsupported or invalid WHERE condition: "${cond}"`);
  err.code = '42601';
  throw err;
}

function splitLogicalKeyword(expr: string, keyword: 'AND' | 'OR'): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  const kwLen = keyword.length;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    const next = expr[i + 1];
    if (ch === "'" && !inDouble) {
      current += ch;
      if (inSingle && next === "'") {
        current += next;
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      current += ch;
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const prevChar = i > 0 ? expr[i - 1] : ' ';
        const slice = expr.slice(i, i + kwLen);
        const afterChar = expr[i + kwLen] ?? ' ';
        if (
          /\s/.test(prevChar) &&
          slice.toUpperCase() === keyword &&
          /\s/.test(afterChar)
        ) {
          parts.push(current.trim());
          current = '';
          i += kwLen - 1;
          continue;
        }
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function normalizeMockTableName(rawTable: string): string {
  return rawTable
    .trim()
    .replace(/^public\./i, '')
    .replace(/^"([^"]+)"$/, '$1')
    .toLowerCase();
}

async function executeMockRawSql(
  sqlText: string,
  startedAt: number,
  maxPreviewRows: number
): Promise<RawSqlExecutionResult> {
  const snapshot = structuredClone({ store: mockStore, counters: mockIdCounters });
  const statements = splitSqlStatements(sqlText);
  if (statements.length === 0) {
    const err: any = new Error('SQL query contains no executable statements.');
    err.code = '42601';
    throw err;
  }

  let lastCommand = 'OK';
  let lastRows: Record<string, any>[] = [];
  let lastColumns: string[] = [];
  let totalAffected = 0;

  try {
    for (const stmt of statements) {
      const cleanStmt = stmt.trim();
      const upperStmt = cleanStmt.toUpperCase();

      if (upperStmt === 'BEGIN' || upperStmt === 'START TRANSACTION') {
        lastCommand = 'BEGIN';
        continue;
      }
      if (upperStmt === 'COMMIT') {
        lastCommand = 'COMMIT';
        continue;
      }
      if (upperStmt === 'ROLLBACK') {
        restoreMockStoreSnapshot(snapshot);
        lastCommand = 'ROLLBACK';
        lastRows = [];
        lastColumns = [];
        continue;
      }

      // CREATE TABLE [IF NOT EXISTS] tbl ...
      const createTblMatch = cleanStmt.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i);
      if (createTblMatch) {
        const tbl = normalizeMockTableName(createTblMatch[1]);
        if (!mockStore[tbl]) {
          mockStore[tbl] = [];
          mockIdCounters[tbl] = 1;
        }
        lastCommand = 'CREATE';
        continue;
      }

      // DROP TABLE [IF EXISTS] tbl
      const dropTblMatch = cleanStmt.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/i);
      if (dropTblMatch) {
        const tbl = normalizeMockTableName(dropTblMatch[1]);
        if (!mockStore[tbl] && !/IF\s+EXISTS/i.test(cleanStmt)) {
          const err: any = new Error(`table "${tbl}" does not exist`);
          err.code = '42P01';
          throw err;
        }
        delete mockStore[tbl];
        lastCommand = 'DROP';
        continue;
      }

      // TRUNCATE [TABLE] tbl
      const truncMatch = cleanStmt.match(/^TRUNCATE\s+(?:TABLE\s+)?([^\s;]+)/i);
      if (truncMatch) {
        const tbl = normalizeMockTableName(truncMatch[1]);
        if (!Array.isArray(mockStore[tbl])) {
          const err: any = new Error(`relation "${tbl}" does not exist`);
          err.code = '42P01';
          throw err;
        }
        const count = mockStore[tbl].length;
        mockStore[tbl] = [];
        totalAffected += count;
        lastCommand = 'TRUNCATE';
        lastRows = [];
        lastColumns = [];
        continue;
      }

      // SELECT without FROM (e.g. SELECT 1, SELECT NOW(), SELECT version())
      if (/^SELECT\b/i.test(cleanStmt) && !/\bFROM\b/i.test(cleanStmt)) {
        const selectBody = cleanStmt.replace(/^SELECT\s+/i, '').trim();
        const exprs = splitTopLevelComma(selectBody);
        const row: Record<string, any> = {};
        const cols: string[] = [];
        exprs.forEach((expr, idx) => {
          const aliasMatch = expr.match(/^(.+?)\s+AS\s+"?([a-zA-Z0-9_]+)"?$/i);
          const rawExpr = aliasMatch ? aliasMatch[1].trim() : expr.trim();
          const upperExpr = rawExpr.toUpperCase();
          let val: any;
          let colName = aliasMatch ? aliasMatch[2] : `column_${idx + 1}`;
          if (upperExpr === 'NOW()' || upperExpr === 'CURRENT_TIMESTAMP') {
            val = new Date().toISOString();
            if (!aliasMatch) colName = 'now';
          } else if (upperExpr === 'VERSION()') {
            val = 'PostgreSQL 16.0 (AI Studio In-Memory Store)';
            if (!aliasMatch) colName = 'version';
          } else if (upperExpr === 'CURRENT_DATABASE()') {
            val = dbInfo.database || 'postgres';
            if (!aliasMatch) colName = 'current_database';
          } else {
            val = parseSqlLiteral(rawExpr);
            if (!aliasMatch && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawExpr)) colName = rawExpr;
            else if (!aliasMatch && /^-?\d+(\.\d+)?$/.test(rawExpr)) colName = '?column?';
          }
          row[colName] = val;
          cols.push(colName);
        });
        lastCommand = 'SELECT';
        lastRows = [row];
        lastColumns = cols;
        totalAffected = 1;
        continue;
      }

      // SELECT ... FROM ...
      if (/^SELECT\b/i.test(cleanStmt)) {
        const selectMatch = cleanStmt.match(
          /^SELECT\s+([\s\S]+?)\s+FROM\s+([^\s;]+)([\s\S]*)$/i
        );
        if (!selectMatch) {
          const err: any = new Error(`Syntax error near "${cleanStmt.slice(0, 48)}"`);
          err.code = '42601';
          throw err;
        }
        const projectionRaw = selectMatch[1].trim();
        const tblRaw = selectMatch[2].trim();
        const maybeWhereOrderLimit = (selectMatch[3] || '').trim();

        const tbl = normalizeMockTableName(tblRaw);
        let sourceRows: Record<string, any>[];
        if (tbl === 'information_schema.tables') {
          sourceRows = Object.keys(mockStore).map((t) => ({
            table_schema: 'public',
            table_name: t,
            table_type: 'BASE TABLE',
          }));
        } else if (Array.isArray(mockStore[tbl])) {
          sourceRows = mockStore[tbl].map((r) => ({ ...r }));
        } else {
          const err: any = new Error(`relation "${tbl}" does not exist`);
          err.code = '42P01';
          throw err;
        }

        // Parse WHERE / ORDER BY / LIMIT / OFFSET accurately
        const whereClauseMatch = maybeWhereOrderLimit.match(
          /\bWHERE\s+([\s\S]+?)(?=\s+ORDER\s+BY\b|\s+LIMIT\b|\s+OFFSET\b|$)/i
        );
        const orderMatch = maybeWhereOrderLimit.match(/\bORDER\s+BY\s+([\s\S]+?)(?=\s+LIMIT\b|\s+OFFSET\b|$)/i);
        const limitMatch = maybeWhereOrderLimit.match(/\bLIMIT\s+(\d+)/i);
        const offsetMatch = maybeWhereOrderLimit.match(/\bOFFSET\s+(\d+)/i);

        let filtered = whereClauseMatch
          ? sourceRows.filter((r) => evaluateMockWhere(r, whereClauseMatch[1]))
          : sourceRows;

        if (/^COUNT\s*\(\s*\*\s*\)(?:\s+AS\s+"?([a-zA-Z0-9_]+)"?)?$/i.test(projectionRaw)) {
          const aliasMatch = projectionRaw.match(/\bAS\s+"?([a-zA-Z0-9_]+)"?$/i);
          const col = aliasMatch ? aliasMatch[1] : 'count';
          lastCommand = 'SELECT';
          lastRows = [{ [col]: String(filtered.length) }];
          lastColumns = [col];
          totalAffected = 1;
          continue;
        }

        if (orderMatch) {
          const orderParts = orderMatch[1].trim().split(',')[0].trim().split(/\s+/);
          const orderCol = orderParts[0].replace(/^"|"$/g, '');
          const desc = (orderParts[1] || '').toUpperCase() === 'DESC';
          filtered = [...filtered].sort((a, b) => {
            const va = a[orderCol];
            const vb = b[orderCol];
            if (typeof va === 'number' && typeof vb === 'number') return desc ? vb - va : va - vb;
            return desc
              ? String(vb ?? '').localeCompare(String(va ?? ''))
              : String(va ?? '').localeCompare(String(vb ?? ''));
          });
        }

        const offsetVal = offsetMatch ? Math.max(0, parseInt(offsetMatch[1], 10)) : 0;
        const limitVal = limitMatch ? Math.max(0, parseInt(limitMatch[1], 10)) : null;
        if (offsetVal > 0 || limitVal !== null) {
          filtered = filtered.slice(offsetVal, limitVal !== null ? offsetVal + limitVal : undefined);
        }

        if (projectionRaw === '*') {
          const cols = filtered.length > 0 ? Object.keys(filtered[0]) : [];
          lastRows = filtered;
          lastColumns = cols;
        } else {
          const colsList = splitTopLevelComma(projectionRaw);
          const resolvedCols: string[] = [];
          const projected = filtered.map((row, rIdx) => {
            const out: Record<string, any> = {};
            colsList.forEach((colExpr) => {
              const aliasM = colExpr.match(/^(.+?)\s+AS\s+"?([a-zA-Z0-9_]+)"?$/i);
              const srcCol = (aliasM ? aliasM[1] : colExpr).trim().replace(/^[a-zA-Z0-9_]+\./, '').replace(/^"|"$/g, '');
              const outCol = aliasM ? aliasM[2] : srcCol;
              if (rIdx === 0) resolvedCols.push(outCol);
              out[outCol] = row[srcCol] !== undefined ? row[srcCol] : null;
            });
            return out;
          });
          if (projected.length === 0) {
            colsList.forEach((colExpr) => {
              const aliasM = colExpr.match(/^(.+?)\s+AS\s+"?([a-zA-Z0-9_]+)"?$/i);
              const srcCol = (aliasM ? aliasM[1] : colExpr).trim().replace(/^[a-zA-Z0-9_]+\./, '').replace(/^"|"$/g, '');
              resolvedCols.push(aliasM ? aliasM[2] : srcCol);
            });
          }
          lastRows = projected;
          lastColumns = resolvedCols;
        }
        lastCommand = 'SELECT';
        totalAffected = lastRows.length;
        continue;
      }

      // INSERT INTO tbl [(cols)] VALUES (...) [ON CONFLICT ...] [RETURNING ...]
      if (/^INSERT\s+INTO\b/i.test(cleanStmt)) {
        const insMatch = cleanStmt.match(
          /^INSERT\s+INTO\s+([^\s(]+)\s*(?:\(([^)]+)\))?\s*VALUES\s*([\s\S]+?)(?:\s+ON\s+CONFLICT[\s\S]*?)?(?:\s+RETURNING\s+([\s\S]+))?$/i
        );
        if (!insMatch) {
          const err: any = new Error(`Syntax error in INSERT statement near "${cleanStmt.slice(0, 48)}"`);
          err.code = '42601';
          throw err;
        }
        const tbl = normalizeMockTableName(insMatch[1]);
        if (!Array.isArray(mockStore[tbl])) {
          const err: any = new Error(`relation "${tbl}" does not exist`);
          err.code = '42P01';
          throw err;
        }
        const cols = insMatch[2]
          ? insMatch[2].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
          : null;
        const valuesBody = insMatch[3].trim();
        const returningClause = insMatch[4]?.trim();

        // Parse tuple "(v1, v2), (v3, v4)"
        const tupleMatches: string[] = [];
        let depth = 0;
        let inS = false;
        let buf = '';
        for (let i = 0; i < valuesBody.length; i++) {
          const ch = valuesBody[i];
          const nxt = valuesBody[i + 1];
          if (ch === "'") {
            buf += ch;
            if (inS && nxt === "'") {
              buf += nxt;
              i++;
              continue;
            }
            inS = !inS;
            continue;
          }
          if (!inS) {
            if (ch === '(') {
              if (depth === 0) buf = '';
              else buf += ch;
              depth++;
              continue;
            }
            if (ch === ')') {
              depth--;
              if (depth === 0) {
                tupleMatches.push(buf);
                buf = '';
                continue;
              }
            }
          }
          if (depth > 0) buf += ch;
        }

        if (tupleMatches.length === 0) {
          const err: any = new Error('INSERT VALUES clause contains no tuples.');
          err.code = '42601';
          throw err;
        }

        const insertedRows: Record<string, any>[] = [];
        for (const tupleStr of tupleMatches) {
          const rawVals = splitTopLevelComma(tupleStr);
          const parsedVals = rawVals.map(parseSqlLiteral);
          const newRow: Record<string, any> = {};
          if (cols) {
            if (cols.length !== parsedVals.length) {
              const err: any = new Error('INSERT has more target columns than expressions or vice versa.');
              err.code = '42601';
              throw err;
            }
            cols.forEach((c, idx) => {
              newRow[c] = parsedVals[idx];
            });
          } else {
            parsedVals.forEach((v, idx) => {
              newRow[`col_${idx + 1}`] = v;
            });
          }
          if (newRow.id === undefined && tbl !== 'app_settings') {
            newRow.id = nextMockId(tbl);
          }
          if (newRow.created_at === undefined) newRow.created_at = new Date().toISOString();
          if (newRow.updated_at === undefined) newRow.updated_at = new Date().toISOString();
          mockStore[tbl].push(newRow);
          insertedRows.push({ ...newRow });
        }

        lastCommand = 'INSERT';
        totalAffected += insertedRows.length;
        if (returningClause) {
          lastRows = returningClause === '*' ? insertedRows : insertedRows;
          lastColumns = lastRows.length > 0 ? Object.keys(lastRows[0]) : [];
        } else {
          lastRows = [];
          lastColumns = [];
        }
        continue;
      }

      // UPDATE tbl SET ... [WHERE ...] [RETURNING ...]
      if (/^UPDATE\b/i.test(cleanStmt)) {
        const updMatch = cleanStmt.match(
          /^UPDATE\s+([^\s]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+RETURNING\s+([\s\S]+))?$/i
        );
        if (!updMatch) {
          const err: any = new Error(`Syntax error in UPDATE statement near "${cleanStmt.slice(0, 48)}"`);
          err.code = '42601';
          throw err;
        }
        const tbl = normalizeMockTableName(updMatch[1]);
        if (!Array.isArray(mockStore[tbl])) {
          const err: any = new Error(`relation "${tbl}" does not exist`);
          err.code = '42P01';
          throw err;
        }
        const assignments = splitTopLevelComma(updMatch[2]);
        const updates: Array<[string, any]> = assignments.map((part) => {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) {
            const err: any = new Error(`Invalid SET assignment "${part}"`);
            err.code = '42601';
            throw err;
          }
          const col = part.slice(0, eqIdx).trim().replace(/^"|"$/g, '');
          const val = parseSqlLiteral(part.slice(eqIdx + 1));
          return [col, val];
        });
        const whereClause = updMatch[3]?.trim() || '';
        const returningClause = updMatch[4]?.trim();

        const updatedRows: Record<string, any>[] = [];
        for (const row of mockStore[tbl]) {
          if (!whereClause || evaluateMockWhere(row, whereClause)) {
            for (const [col, val] of updates) {
              row[col] = val;
            }
            updatedRows.push({ ...row });
          }
        }
        lastCommand = 'UPDATE';
        totalAffected += updatedRows.length;
        if (returningClause) {
          lastRows = updatedRows;
          lastColumns = updatedRows.length > 0 ? Object.keys(updatedRows[0]) : [];
        } else {
          lastRows = [];
          lastColumns = [];
        }
        continue;
      }

      // DELETE FROM tbl [WHERE ...] [RETURNING ...]
      if (/^DELETE\s+FROM\b/i.test(cleanStmt)) {
        const delMatch = cleanStmt.match(
          /^DELETE\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+RETURNING\s+([\s\S]+))?$/i
        );
        if (!delMatch) {
          const err: any = new Error(`Syntax error in DELETE statement near "${cleanStmt.slice(0, 48)}"`);
          err.code = '42601';
          throw err;
        }
        const tbl = normalizeMockTableName(delMatch[1]);
        if (!Array.isArray(mockStore[tbl])) {
          const err: any = new Error(`relation "${tbl}" does not exist`);
          err.code = '42P01';
          throw err;
        }
        const whereClause = delMatch[2]?.trim() || '';
        const returningClause = delMatch[3]?.trim();

        const deletedRows: Record<string, any>[] = [];
        const keptRows: Record<string, any>[] = [];
        for (const row of mockStore[tbl]) {
          if (!whereClause || evaluateMockWhere(row, whereClause)) {
            deletedRows.push({ ...row });
          } else {
            keptRows.push(row);
          }
        }
        mockStore[tbl] = keptRows;
        lastCommand = 'DELETE';
        totalAffected += deletedRows.length;
        if (returningClause) {
          lastRows = deletedRows;
          lastColumns = deletedRows.length > 0 ? Object.keys(deletedRows[0]) : [];
        } else {
          lastRows = [];
          lastColumns = [];
        }
        continue;
      }

      const firstToken = cleanStmt.split(/\s+/)[0] || '';
      const err: any = new Error(`syntax error at or near "${firstToken}"`);
      err.code = '42601';
      throw err;
    }

    const truncated = lastRows.length > maxPreviewRows;
    const previewRows = truncated ? lastRows.slice(0, maxPreviewRows) : lastRows;

    return {
      command: lastCommand,
      rowCount: lastRows.length > 0 ? lastRows.length : totalAffected,
      columns: lastColumns,
      rows: previewRows,
      totalRowsReturned: lastRows.length,
      truncated,
      statementCount: statements.length,
      durationMs: Math.max(1, Date.now() - startedAt),
    };
  } catch (err) {
    restoreMockStoreSnapshot(snapshot);
    throw err;
  }
}

export { dbInfo, rawPool };
