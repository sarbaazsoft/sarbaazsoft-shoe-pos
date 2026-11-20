-- =============================================================================
-- SarbaazSoft Shoe POS — Drop All PostgreSQL Tables & Custom ENUM Types
-- =============================================================================
-- WARNING: Destructive reset script! Permanently deletes all tables and data.
-- Run this ONLY when resetting a database before re-running schema.sql and seed.sql.
-- =============================================================================

DROP TABLE IF EXISTS
  public.fcm_tokens,
  public.notifications,
  public.pos_notification_dismissals,
  public.platform_notification_reads,
  public.platform_notifications,
  public.app_settings,
  public.trial_activations,
  public.customer_ledger,
  public.supplier_ledger,
  public.email_verification_tokens,
  public.password_reset_tokens,
  public.auth_resend_rate_limits,
  public.stock_movements,
  public.return_items,
  public.returns,
  public.sale_items,
  public.sales,
  public.purchase_return_items,
  public.purchase_returns,
  public.supplier_payments,
  public.purchase_items,
  public.purchases,
  public.products,
  public.customers,
  public.suppliers,
  public.categories,
  public.company_settings,
  public.users,
  public.tenants
CASCADE;

DROP TYPE IF EXISTS
  public.business_type_enum,
  public.pricing_mode_enum,
  public.movement_type_enum,
  public.packing_type_enum,
  public.sale_type_enum,
  public.user_role_enum,
  public.user_status_enum,
  public.tenant_status_enum,
  public.subscription_status_enum,
  public.subscription_plan_enum,
  public.subscription_type_enum,
  public.purchase_payment_status_enum
CASCADE;
