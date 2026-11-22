-- =============================================================================
-- SarbaazSoft Shoe POS — Idempotent PostgreSQL Application Settings Seed
-- =============================================================================
-- Safe to run after schema.sql on a fresh database OR on an existing database.
-- Uses ON CONFLICT (key) DO NOTHING so existing live values and secrets are
-- never overwritten.
--
-- Secret keys (RESEND_API_KEY, GMAIL_APP_PASSWORD, FCM_CLIENT_EMAIL,
-- FCM_PRIVATE_KEY, GEMINI_API_KEY, FCM_VAPID_KEY) intentionally default to ''
-- here; configure them in SuperAdmin -> App Config after seeding.
-- =============================================================================

INSERT INTO public.app_settings (key, value, category, description, is_secret, updated_at)
VALUES
  -- 1. Billing
  ('INVOICE_PREFIX', 'INV-', 'billing', 'Default prefix for customer sales receipts and invoices', false, NOW()),
  ('PURCHASE_PREFIX', 'PUR-', 'billing', 'Default prefix for supplier purchase orders and stock receipts', false, NOW()),

  -- 2. Email Provider & Templates
  ('ACTIVE_EMAIL_PROVIDER', 'gmail', 'email', 'Active transactional email provider (resend or gmail)', false, NOW()),
  ('GMAIL_USER', 'sarbaazsoft@gmail.com', 'email', 'Gmail sender address for SMTP', false, NOW()),
  ('GMAIL_FROM_NAME', 'SarbaazSoft Shoe POS', 'email', 'Display sender name for Gmail SMTP emails', false, NOW()),
  ('GMAIL_APP_PASSWORD', '', 'email', 'Google App Password for Gmail SMTP (configure in SuperAdmin App Config)', true, NOW()),
  ('RESEND_API_KEY', '', 'email', 'Resend API Key for transactional emails (configure in SuperAdmin App Config)', true, NOW()),
  ('RESEND_FROM', 'SarbaazSoft Shoe POS Security <onboarding@resend.dev>', 'email', 'Default verified sender address for Resend emails', false, NOW()),
  ('RESEND_FROM_EMAIL', 'onboarding@resend.dev', 'email', 'Sender email address for Resend transactional emails', false, NOW()),
  ('RESEND_REPLY_TO', 'noreply@sarbaazsoft.com', 'email', 'Reply-To email address for Resend transactional emails', false, NOW()),
  ('EMAIL_WEBHOOK_URL', '', 'email', 'Optional backup webhook URL to receive outgoing email payloads', false, NOW()),
  ('RESEND_WEBHOOK_URL', '', 'email', 'Optional Resend delivery webhook URL', false, NOW()),
  ('REQUIRE_EMAIL_VERIFICATION_FOR_FREE_TRIAL', 'true', 'email', 'Require email verification for new free trial registrations before access is activated', false, NOW()),
  ('EMAIL_POS_ALERTS_ENABLED', 'true', 'email', 'Send instant transaction receipts and invoice alerts to store owner email', false, NOW()),
  ('EMAIL_SUPERADMIN_ON_SALES', 'false', 'email', 'Send copy of all cashier store sales to SuperAdmin Gmail address', false, NOW()),

  -- 3. Notifications & Firebase Cloud Messaging (FCM)
  ('FCM_PROJECT_ID', 'sarbaazsoft-shoe-pos', 'notifications', 'Firebase Project ID', false, NOW()),
  ('FCM_CLIENT_EMAIL', '', 'notifications', 'Firebase Admin SDK Service Account Client Email (configure in SuperAdmin App Config)', false, NOW()),
  ('FCM_PRIVATE_KEY', '', 'notifications', 'Firebase Admin SDK Service Account Private Key (PEM format)', true, NOW()),
  ('FCM_API_KEY', '', 'notifications', 'Firebase Web API Key for frontend client push notification initialization', false, NOW()),
  ('FCM_MESSAGING_SENDER_ID', '900875095665', 'notifications', 'Firebase Cloud Messaging Sender ID', false, NOW()),
  ('FCM_APP_ID', '1:900875095665:web:2050a569fe0b7eded995d0', 'notifications', 'Firebase Web App ID', false, NOW()),
  ('FCM_MEASUREMENT_ID', 'G-YNR6ETB365', 'notifications', 'Optional Firebase Analytics Measurement ID', false, NOW()),
  ('FCM_VAPID_KEY', '', 'notifications', 'Firebase Web Push Certificate Public Key', false, NOW()),
  ('LOW_STOCK_EMAIL_ALERTS_ENABLED', 'true', 'notifications', 'Send consolidated batched email alerts to store owners/admins when sold items cross below low stock threshold', false, NOW()),
  ('LOW_STOCK_PUSH_ALERTS_ENABLED', 'true', 'notifications', 'Send consolidated batched push and real-time dashboard alerts to store owners/admins on low stock threshold crossing', false, NOW()),
  ('SUPERADMIN_PUSH_ON_NEW_TRIAL', 'true', 'notifications', 'Trigger native push notifications for new 30-day Free Trial store registrations', false, NOW()),
  ('SUPERADMIN_PUSH_ON_RENEWAL', 'true', 'notifications', 'Trigger native push notifications for subscription renewals and tier upgrade requests', false, NOW()),
  ('SUPERADMIN_PUSH_ON_EXPIRED_STORE', 'true', 'notifications', 'Trigger native push notifications when a store subscription expires', false, NOW()),
  ('SUPERADMIN_PUSH_ON_SECURITY_ALERT', 'false', 'notifications', 'Trigger native push notifications for platform security events, backups, and critical system logs', false, NOW()),
  ('SUPERADMIN_PUSH_ON_SALES', 'false', 'notifications', 'Trigger native push notifications to SuperAdmin for high-value store sales or platform auditing', false, NOW()),

  -- 4. System, PWA & Unified Screen Backdrop
  ('DISABLE_HMR', 'true', 'system', 'Disable Vite Hot Module Reloading in sandbox environments', false, NOW()),
  ('GEMINI_API_KEY', '', 'system', 'Google Gemini API Key for Sammi AI assistant (configure in SuperAdmin App Config)', true, NOW()),
  ('PUBLIC_APP_URL', '', 'system', 'Public HTTPS application URL embedded in desktop installers', false, NOW()),
  ('TWA_PACKAGE_NAME', 'com.sarbaazsoft.shoepos', 'system', 'Android Trusted Web Activity package identifier', false, NOW()),
  ('ASSETLINKS_SHA256', '', 'system', 'Comma-separated SHA-256 certificate fingerprints for Android Digital Asset Links', false, NOW()),
  ('SCREEN_BG_BACKDROP', 'https://images.unsplash.com/photo-1672840005700-fd8e4159a8df?auto=format&fit=crop&w=1600&q=80', 'system', 'Unified custom backdrop image URL shared across all routes and screens', false, NOW()),
  ('SCREEN_BG_LOGIN', 'https://images.unsplash.com/photo-1672840005700-fd8e4159a8df?auto=format&fit=crop&w=1600&q=80', 'system', 'Legacy alias synced to unified screen backdrop image', false, NOW()),
  ('SCREEN_BG_REGISTRATION', 'https://images.unsplash.com/photo-1672840005700-fd8e4159a8df?auto=format&fit=crop&w=1600&q=80', 'system', 'Legacy alias synced to unified screen backdrop image', false, NOW()),
  ('SCREEN_BG_AUTH', 'https://images.unsplash.com/photo-1672840005700-fd8e4159a8df?auto=format&fit=crop&w=1600&q=80', 'system', 'Legacy alias synced to unified screen backdrop image', false, NOW()),
  ('SCREEN_BG_LOADING', 'https://images.unsplash.com/photo-1672840005700-fd8e4159a8df?auto=format&fit=crop&w=1600&q=80', 'system', 'Legacy alias synced to unified screen backdrop image', false, NOW()),

  -- 5. Fresh Schema Markers (prevents legacy migration re-runs on schema.sql DBs)
  ('__schema_v15_platform_notifications__', 'true', 'system', 'Schema migration dropping store_requests table and ensuring notifications', false, NOW()),
  ('__schema_v16_low_stock_threshold__', 'true', 'system', 'Schema migration removing product-level low_stock_limit and using company_settings.low_stock_threshold', false, NOW()),
  ('__schema_v17_product_low_stock_alerts__', 'true', 'system', 'Schema migration adding products.low_stock_threshold, products.is_low_stock_alert_sent, and notifications table', false, NOW())
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Platform SuperAdmin Account Seed (tenant_id = 0)
-- Email: sarbaazsoft@gmail.com | Name: Khalid Dashti | Phone: +92-321-2257340
-- Password: hashed ('admin123') via bcryptjs (10 rounds)
-- =============================================================================
INSERT INTO public.users (
  tenant_id,
  name,
  email,
  phone,
  password_hash,
  role,
  status,
  active,
  created_at,
  updated_at
)
SELECT
  0,
  'Khalid Dashti',
  'sarbaazsoft@gmail.com',
  '+92-321-2257340',
  '$2a$10$d52.cV9Z9lU1Jd93lrooWeRLCTdqm6XGMktg7UnML8fYGm8wAZN3K',
  'SUPERADMIN',
  'APPROVED',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.users
  WHERE LOWER(BTRIM(email)) = 'sarbaazsoft@gmail.com'
);

-- Optional cleanup for older databases containing redundant lowercase email keys:
-- DELETE FROM public.app_settings
-- WHERE key IN ('active_email_provider', 'gmail_app_password', 'gmail_from_name', 'gmail_user', 'resend_api_key');
