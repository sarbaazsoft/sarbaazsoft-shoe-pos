-- =============================================================================
-- SarbaazSoft Shoe POS — Fresh Standalone PostgreSQL Database Schema
-- =============================================================================
-- Executable directly on a completely empty PostgreSQL database.
-- Contains only fresh CREATE TYPE, CREATE FUNCTION, CREATE TABLE, and CREATE INDEX
-- statements in topological dependency order (no ALTER TABLE or migration patches).
-- Uses consistent snake_case identifiers and excludes product size/color variants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Custom ENUM Types
-- -----------------------------------------------------------------------------
DO $$
BEGIN
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
END $$;

-- -----------------------------------------------------------------------------
-- 2. Enum Text Helper Functions (for case-insensitive queries on ENUM columns)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION upper(val user_role_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION btrim(val user_role_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val user_role_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val user_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION btrim(val user_status_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val user_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val business_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION btrim(val business_type_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val business_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val pricing_mode_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION btrim(val pricing_mode_enum) RETURNS text AS $$ SELECT btrim(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val pricing_mode_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val tenant_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val tenant_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val subscription_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val subscription_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val subscription_plan_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val subscription_plan_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val sale_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val sale_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val packing_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val packing_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val movement_type_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val movement_type_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION upper(val purchase_payment_status_enum) RETURNS text AS $$ SELECT upper(val::text); $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION lower(val purchase_payment_status_enum) RETURNS text AS $$ SELECT lower(val::text); $$ LANGUAGE sql IMMUTABLE;

-- -----------------------------------------------------------------------------
-- 3. Core Tables (Topological Dependency Order)
-- -----------------------------------------------------------------------------

-- 3.1 Multi-tenant store organizations
CREATE TABLE IF NOT EXISTS tenants (
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
);

-- 3.2 Platform SuperAdmin (tenant_id = 0) and Store Staff Accounts
CREATE TABLE IF NOT EXISTS users (
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
);

-- 3.3 Centralized 6-digit password reset verification codes (Store Owner, Cashier, Super Admin)
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 0 CHECK (tenant_id >= 0),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3.4 Email verification tokens for store onboarding
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3.5 Resend rate-limiting state for auth emails
CREATE TABLE IF NOT EXISTS auth_resend_rate_limits (
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
);

-- 3.6 Per-store configuration, pricing mode, business type & receipt preferences
CREATE TABLE IF NOT EXISTS company_settings (
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
);

-- 3.7 Global shoe categories (shared across all stores)
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3.8 Product catalog (clean article-level schema, no size/color variants)
CREATE TABLE IF NOT EXISTS products (
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
);

-- 3.9 Customers & wholesale dealers
CREATE TABLE IF NOT EXISTS customers (
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
);

-- 3.10 Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3.11 Purchases (stock receiving invoices)
CREATE TABLE IF NOT EXISTS purchases (
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
);

-- 3.12 Purchase line items
CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_purchase_price NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL
);

-- 3.13 Supplier payments
CREATE TABLE IF NOT EXISTS supplier_payments (
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
);

-- 3.14 Purchase returns (supplier debit notes)
CREATE TABLE IF NOT EXISTS purchase_returns (
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
);

-- 3.15 Purchase return line items
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_purchase_price NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  defect_type TEXT NOT NULL DEFAULT 'MANUFACTURING_DEFECT'
);

-- 3.16 POS sales & invoices
CREATE TABLE IF NOT EXISTS sales (
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
);

-- 3.17 POS sale line items
CREATE TABLE IF NOT EXISTS sale_items (
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
);

-- 3.18 Sales returns & exchanges
CREATE TABLE IF NOT EXISTS returns (
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
);

-- 3.19 Sales return line items
CREATE TABLE IF NOT EXISTS return_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id) ON DELETE CASCADE,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_refund_price NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL
);

-- 3.20 Stock movement audit ledger
CREATE TABLE IF NOT EXISTS stock_movements (
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
);

-- 3.21 Customer Khata / receivable ledger
CREATE TABLE IF NOT EXISTS customer_ledger (
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
);

-- 3.22 Supplier ledger (opening balances & manual adjustments)
CREATE TABLE IF NOT EXISTS supplier_ledger (
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
);

-- 3.23 Free trial activation audit log
CREATE TABLE IF NOT EXISTS trial_activations (
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
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  activated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 3.24 Platform-level settings & appearance defaults
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT 'system',
  description TEXT NOT NULL DEFAULT '',
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 3.25 Platform announcements & subscription notifications
CREATE TABLE IF NOT EXISTS platform_notifications (
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
);

-- 3.26 Per-user read markers for platform notifications
CREATE TABLE IF NOT EXISTS platform_notification_reads (
  id SERIAL PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES platform_notifications(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
  user_id INTEGER NOT NULL DEFAULT 0 CHECK (user_id >= 0),
  read_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_notification_reads_unique UNIQUE (notification_id, tenant_id, user_id)
);

-- 3.27 Per-user dismissal tracking for POS feed notifications
CREATE TABLE IF NOT EXISTS pos_notification_dismissals (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
  user_id INTEGER NOT NULL DEFAULT 0 CHECK (user_id >= 0),
  item_type TEXT NOT NULL DEFAULT 'SALE',
  item_id INTEGER NOT NULL,
  dismissed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT pos_notification_dismissals_unique UNIQUE (tenant_id, user_id, item_type, item_id)
);

-- 3.28 Tenant-scoped operational notifications (POS & Low Stock)
CREATE TABLE IF NOT EXISTS notifications (
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
);

-- 3.29 Firebase Cloud Messaging device tokens
CREATE TABLE IF NOT EXISTS fcm_tokens (
  token TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 CHECK (tenant_id >= 0),
  user_id INTEGER NOT NULL DEFAULT 0 CHECK (user_id >= 0),
  user_role TEXT NOT NULL DEFAULT 'ADMIN',
  user_agent TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status);
CREATE INDEX IF NOT EXISTS tenants_subscription_status_idx ON tenants(subscription_status);

CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx ON users (LOWER(BTRIM(email)));

CREATE INDEX IF NOT EXISTS password_reset_codes_user_idx ON password_reset_codes(user_id);
CREATE INDEX IF NOT EXISTS password_reset_codes_code_idx ON password_reset_codes(code);

CREATE INDEX IF NOT EXISTS email_verification_tokens_token_idx ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS auth_resend_rate_limits_lookup_idx ON auth_resend_rate_limits(flow, scope_type, scope_key);

CREATE INDEX IF NOT EXISTS company_settings_tenant_idx ON company_settings(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_unique_idx ON categories (LOWER(BTRIM(name)));

CREATE INDEX IF NOT EXISTS products_tenant_idx ON products(tenant_id);
CREATE INDEX IF NOT EXISTS products_tenant_product_no_idx ON products(tenant_id, tenant_product_no);
CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode);
CREATE INDEX IF NOT EXISTS products_article_idx ON products(article);
CREATE INDEX IF NOT EXISTS products_tenant_article_idx ON products(tenant_id, article);
CREATE INDEX IF NOT EXISTS products_tenant_barcode_idx ON products(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS products_active_idx ON products(active);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode_unique_idx ON products (COALESCE(tenant_id, 1), LOWER(BTRIM(barcode))) WHERE barcode IS NOT NULL AND BTRIM(barcode) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_article_unique_idx ON products (COALESCE(tenant_id, 1), LOWER(BTRIM(article))) WHERE article IS NOT NULL AND BTRIM(article) <> '';

CREATE INDEX IF NOT EXISTS customers_tenant_idx ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers(tenant_id);

CREATE INDEX IF NOT EXISTS purchases_tenant_idx ON purchases(tenant_id);
CREATE INDEX IF NOT EXISTS purchases_tenant_supplier_idx ON purchases(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON purchase_items(purchase_id);

CREATE INDEX IF NOT EXISTS supplier_payments_tenant_idx ON supplier_payments(tenant_id);
CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS supplier_payments_date_idx ON supplier_payments(payment_date);
CREATE INDEX IF NOT EXISTS supplier_payments_number_idx ON supplier_payments(payment_number);

CREATE INDEX IF NOT EXISTS purchase_returns_tenant_idx ON purchase_returns(tenant_id);
CREATE INDEX IF NOT EXISTS purchase_returns_number_idx ON purchase_returns(return_number);
CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_return_idx ON purchase_return_items(purchase_return_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_product_idx ON purchase_return_items(product_id);

CREATE INDEX IF NOT EXISTS sales_tenant_idx ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS sales_tenant_date_idx ON sales(tenant_id, sale_date);
CREATE INDEX IF NOT EXISTS sales_invoice_idx ON sales(invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_client_tx_id_unique_idx ON sales(COALESCE(tenant_id, 1), client_tx_id) WHERE client_tx_id IS NOT NULL AND BTRIM(client_tx_id) <> '';

CREATE INDEX IF NOT EXISTS sale_items_tenant_sale_idx ON sale_items(tenant_id, sale_id);

CREATE INDEX IF NOT EXISTS returns_tenant_idx ON returns(tenant_id);
CREATE INDEX IF NOT EXISTS returns_tenant_sale_idx ON returns(tenant_id, original_sale_id);
CREATE INDEX IF NOT EXISTS return_items_return_idx ON return_items(return_id);

CREATE INDEX IF NOT EXISTS stock_movements_tenant_idx ON stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS stock_movements_created_at_idx ON stock_movements(created_at);

CREATE INDEX IF NOT EXISTS customer_ledger_tenant_cust_idx ON customer_ledger(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS customer_ledger_date_idx ON customer_ledger(transaction_date);
CREATE INDEX IF NOT EXISTS customer_ledger_invoice_idx ON customer_ledger(invoice_id);

CREATE INDEX IF NOT EXISTS supplier_ledger_supplier_idx ON supplier_ledger(tenant_id, supplier_id);

CREATE INDEX IF NOT EXISTS trial_activations_email_idx ON trial_activations(LOWER(BTRIM(email)));
CREATE INDEX IF NOT EXISTS trial_activations_tenant_idx ON trial_activations(tenant_id);
CREATE INDEX IF NOT EXISTS trial_activations_status_idx ON trial_activations(status);

CREATE INDEX IF NOT EXISTS app_settings_category_idx ON app_settings(category);

CREATE INDEX IF NOT EXISTS platform_notifications_tenant_idx ON platform_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS platform_notifications_target_role_idx ON platform_notifications(target_role);
CREATE INDEX IF NOT EXISTS platform_notifications_created_at_idx ON platform_notifications(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS platform_notifications_event_id_unique_idx ON platform_notifications(event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS platform_notification_reads_notif_idx ON platform_notification_reads(notification_id);
CREATE INDEX IF NOT EXISTS platform_notification_reads_tenant_idx ON platform_notification_reads(tenant_id);

CREATE INDEX IF NOT EXISTS pos_notification_dismissals_idx ON pos_notification_dismissals(tenant_id, user_id, item_type);

CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx ON notifications(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(tenant_id, is_read);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_id_unique_idx ON notifications(event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fcm_tokens_tenant_idx ON fcm_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS fcm_tokens_user_role_idx ON fcm_tokens(user_role);
CREATE INDEX IF NOT EXISTS fcm_tokens_user_id_idx ON fcm_tokens(user_id);
