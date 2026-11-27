import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Lock, Mail, AlertCircle, CheckCircle2, Eye, EyeOff, Store, ArrowRight, Clock } from 'lucide-react';
import { api, setAuthSession } from '../../services/api.ts';
import { ShoeIcon } from '../common/ShoeIcon.tsx';
import { ShowroomBackground } from '../common/ShowroomBackground.tsx';
import { PublicHeader } from '../common/PublicHeader.tsx';
import { PublicFooter } from '../common/PublicFooter.tsx';
import { BodyLayoutWrapper } from '../common/BodyLayoutWrapper.tsx';
import { resolveRouteLayoutMetadata, type RouteLayoutMetadata } from '../../config/routeLayoutMetadata.ts';
import { getRememberedEmail, saveRememberedEmail, forgetRememberedEmail } from '../../utils/rememberedAccount.ts';
import { useTheme } from '../../context/ThemeContext.tsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.ts';
import { getStandardDocumentTitle, PLATFORM_DOCUMENT_NAME } from '../../utils/documentTitle.ts';
import { FreeTrialOnboardingModal } from '../saas/FreeTrialOnboardingModal.tsx';
import { usePasswordReset } from '../../hooks/usePasswordReset.ts';
import { PasswordResetFlow } from './PasswordResetFlow.tsx';
import { AnimatedTabPanel, useTabDirection } from '../common/AnimatedTabPanel.tsx';
import { ActiveTenantScopeBanner } from '../common/ActiveTenantScopeBanner.tsx';

interface AuthModalProps {
  onSuccess: (user: any) => void;
  companySettings: any;
  onBack?: () => void;
  onClearTenantScope?: () => void;
  onStoreCreated?: (tenantId: number, loginUrl: string, user?: any, token?: string) => void;
  onTenantResolved?: (tenant: any) => void;
  sessionNotice?: string | null;
  tenantNotice?: string | null;
  layoutMeta?: Partial<RouteLayoutMetadata>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onSuccess,
  companySettings,
  onBack,
  onClearTenantScope,
  onStoreCreated,
  onTenantResolved,
  sessionNotice,
  tenantNotice,
  layoutMeta: layoutMetaOverride,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [tab, setTab] = useState<'login' | 'reset'>('login');
  const authTabDirection = useTabDirection(tab, ['login', 'reset'] as const);
  const [showFreeTrialModal, setShowFreeTrialModal] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Check GET payload query parameters (?tenantId=... or ?storeId=...) or path segments
  const queryTenantNum = (() => {
    if (typeof window === 'undefined') return null;
    try {
      const sp = new URLSearchParams(window.location.search);
      const pathMatch = window.location.pathname.match(/^\/(?:store|stores|tenant|t|directory|auth|login)\/([a-zA-Z0-9_-]+)/i);
      const val = (
        sp.get('tenantId') ||
        sp.get('storeId') ||
        sp.get('tenant_id') ||
        sp.get('store_id') ||
        (pathMatch ? pathMatch[1] : '') ||
        ''
      ).trim();
      if (!val) return null;
      const num = Number(val);
      return Number.isSafeInteger(num) && num >= 0 ? num : null;
    } catch {
      return null;
    }
  })();

  const propTenantRaw =
    companySettings?.tenant_id ??
    companySettings?.tenantId ??
    companySettings?.id;
  const propTenantNum =
    propTenantRaw !== undefined && propTenantRaw !== null && String(propTenantRaw).trim() !== ''
      ? Number(propTenantRaw)
      : null;

  const resolvedScopeTenantId =
    propTenantNum !== null && Number.isSafeInteger(propTenantNum) && propTenantNum >= 0
      ? propTenantNum
      : queryTenantNum;

  const isSuperAdminScope = resolvedScopeTenantId === 0;
  const activeTenantId =
    resolvedScopeTenantId !== null && resolvedScopeTenantId > 0 ? resolvedScopeTenantId : null;
  const hasActiveTenantScope = isSuperAdminScope || Boolean(activeTenantId);
  const rememberScope = isSuperAdminScope ? 'platform' : 'store';

  // Form states with email retrieval from localStorage
  const [email, setEmail] = useState(() => getRememberedEmail(rememberScope) ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => Boolean(getRememberedEmail(rememberScope)));
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [loginPasteBlocked, setLoginPasteBlocked] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [matchingStores, setMatchingStores] = useState<Array<{ tenantId: number; name: string }>>([]);

  const passwordReset = usePasswordReset({
    email,
    onEmailChange: setEmail,
    tenantId: activeTenantId,
    roleScope: isSuperAdminScope ? 'SUPERADMIN' : activeTenantId ? 'STORE' : 'ALL',
    enabled: tab === 'reset',
    onResetSuccess: (message, resetEmail) => {
      setErrorMessage(null);
      setInfoMessage(message);
      setEmail(resetEmail);
      setPassword('');
      setTab('login');
    },
  });

  const initialStoreTitle = (() => {
    if (isSuperAdminScope) return '';
    const raw = companySettings?.name || companySettings?.company_name || companySettings?.companyName || '';
    if (raw && raw !== 'SarbaazSoft Shoe POS' && raw !== 'Shoe POS & Inventory' && raw !== 'SuperAdmin Control Panel') {
      return raw;
    }
    return '';
  })();

  const [storeTitle, setStoreTitle] = useState<string>(initialStoreTitle);

  // If activeTenantId is present from GET payload or props, resolve store name
  useEffect(() => {
    let isMounted = true;
    if (isSuperAdminScope || !activeTenantId) {
      setStoreTitle('');
      return () => {
        isMounted = false;
      };
    }

    const provided = companySettings?.name || companySettings?.company_name || companySettings?.companyName;
    if (provided && provided !== 'SarbaazSoft Shoe POS' && provided !== 'Shoe POS & Inventory' && provided !== 'SuperAdmin Control Panel') {
      setStoreTitle(provided);
      return;
    }

    api.saas.resolve(activeTenantId).then((res) => {
      if (!isMounted) return;
      const target = res?.availableTenants?.find((t: any) => Number(t.id) === activeTenantId);
      const resolved =
        target ||
        (res?.resolution?.tenant && Number(res.resolution.tenant.id) === activeTenantId
          ? res.resolution.tenant
          : null);
      if (resolved?.name) {
        setStoreTitle(resolved.name);
        onTenantResolved?.(resolved);
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [activeTenantId, isSuperAdminScope, companySettings, onTenantResolved]);

  const effectiveStoreName = isSuperAdminScope
    ? 'SuperAdmin Control Panel'
    : (
        storeTitle ||
        (companySettings?.name && companySettings.name !== 'SarbaazSoft Shoe POS' && companySettings.name !== 'Shoe POS & Inventory' ? companySettings.name : '') ||
        (activeTenantId ? `Store #${activeTenantId}` : 'SarbaazSoft Shoe POS')
      );

  const isStoreSpecific = !isSuperAdminScope && Boolean(activeTenantId || storeTitle);
  const storeName = effectiveStoreName;

  useDocumentTitle(
    () =>
      getStandardDocumentTitle({
        saasMode: 'AUTH',
        isSuperAdmin: isSuperAdminScope,
        platformName: isSuperAdminScope ? 'SuperAdmin Control Panel' : PLATFORM_DOCUMENT_NAME,
        isAuthModalOpen: true,
        authSubTab:
          tab === 'login'
            ? 'login'
            : passwordReset.step === 'request'
            ? 'forgot'
            : 'reset',
        storeName,
      }),
    [tab, passwordReset.step, storeName, isSuperAdminScope]
  );

  // Hidden by default for a few ms, then fades in smoothly
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const urlEmail = (searchParams.get('email') || '').trim();
    const isVerifiedRedirect =
      searchParams.get('verified') === '1' || searchParams.get('verified') === 'true';

    const savedEmail = getRememberedEmail(rememberScope) ?? '';
    const initialLoginEmail = urlEmail || savedEmail;
    setEmail(initialLoginEmail);
    setRememberMe(Boolean(savedEmail || urlEmail));
    setPassword('');
    setErrorMessage(null);
    setInfoMessage(
      isVerifiedRedirect
        ? 'Your email has been confirmed! Sign in below to continue to your store.'
        : null
    );
    setMatchingStores([]);

    if (initialLoginEmail) {
      requestAnimationFrame(() => {
        passwordInputRef.current?.focus({ preventScroll: true });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId, isSuperAdminScope]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setMatchingStores([]);
    try {
      const loginEmail = email.trim();
      const res = await api.auth.login({
        email: loginEmail,
        password,
        tenantId: activeTenantId,
        tenant_id: activeTenantId,
      });
      setAuthSession(res.token, res.user);

      // Save or remove remembered email according to Remember Me checkbox
      const loginRoleUpper = String(res.user?.originalRole || res.user?.role || '').toUpperCase();
      const targetRememberScope = loginRoleUpper === 'SUPERADMIN' ? 'platform' : rememberScope;
      if (rememberMe) {
        saveRememberedEmail(res.user?.email || loginEmail, targetRememberScope);
      } else {
        forgetRememberedEmail(targetRememberScope);
      }

      onSuccess(res.user);
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please verify your store credentials.');
      if (err.code === 'MULTIPLE_STORE_ACCOUNTS' && Array.isArray(err.stores)) {
        setMatchingStores(err.stores);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStoreChoice = async (store: { tenantId: number; name: string }) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loginEmail = email.trim();
      const res = await api.auth.login({
        email: loginEmail,
        password,
        tenantId: store.tenantId,
        tenant_id: store.tenantId,
      });
      setAuthSession(res.token, res.user);

      // Save or remove remembered email according to Remember Me checkbox
      if (rememberMe) {
        saveRememberedEmail(res.user?.email || loginEmail, 'store');
      } else {
        forgetRememberedEmail('store');
      }

      onSuccess(res.user);
    } catch (err: any) {
      setErrorMessage(err.message || `Login failed for ${store.name}.`);
    } finally {
      setIsLoading(false);
    }
  };

  const authLayoutMeta = resolveRouteLayoutMetadata('AUTH', {
    overrides: layoutMetaOverride,
  });

  const handleResetTenantScope = () => {
    try {
      sessionStorage.removeItem('pos_unauth_scoped_tenant_id');
      localStorage.removeItem('pos_unauth_scoped_tenant_id');
    } catch {}
    onClearTenantScope?.();
  };

  return (
    <BodyLayoutWrapper
      layoutMeta={authLayoutMeta}
      style={{
        backgroundColor: isDark ? '#0A0E1A' : '#E2E8F0',
      }}
      className={`bg-slate-200 dark:bg-[#0A0E1A] ${
        isDark ? 'dark text-slate-100' : 'light text-slate-900'
      } font-sans selection:bg-purple-600 selection:text-white transition-colors duration-200`}
      backdrop={<ShowroomBackground />}
      header={
        <PublicHeader
          isSuperAdmin={isSuperAdminScope}
          storeName={isSuperAdminScope ? 'SuperAdmin Control Panel' : storeName}
          subtitle={isSuperAdminScope ? 'SuperAdmin Control Plane' : undefined}
          logoSrc={isSuperAdminScope ? '/admin/pwa-192x192.png' : (companySettings?.logo || companySettings?.logo_url || '/pwa-192x192.png')}
          actionText={!hasActiveTenantScope && onBack ? 'Store Directory' : undefined}
          actionIcon={!hasActiveTenantScope && onBack ? <Store className="w-3.5 h-3.5" /> : undefined}
          onActionClick={!hasActiveTenantScope ? onBack : undefined}
        />
      }
      topBanner={
        hasActiveTenantScope ? (
          <ActiveTenantScopeBanner
            id="auth-tenant-scope-banner"
            variant="auth"
            isSuperAdminScope={isSuperAdminScope}
            tenantId={isSuperAdminScope ? 0 : (activeTenantId ?? 0)}
            scopeLabel={effectiveStoreName}
            primaryActionLabel={onBack ? (isSuperAdminScope ? 'Store Directory' : 'Change Store') : undefined}
            onPrimaryAction={onBack}
            clearActionLabel={isSuperAdminScope ? 'Clear Scope' : 'Clear Store Scope'}
            clearActionTitle={
              isSuperAdminScope
                ? 'Reset scope to null and sign in without system lock'
                : 'Clear tenant scope and sign in without a store lock'
            }
            onClearScope={handleResetTenantScope}
          />
        ) : null
      }
      footer={<PublicFooter storeName={storeName} />}
      mainClassName="relative z-10 w-full p-4 sm:p-6 md:p-8 overflow-y-auto"
    >
        <div className="w-full max-w-md sm:max-w-lg lg:max-w-xl mx-auto my-auto">
          {tenantNotice && (
            <div
              role="alert"
              className="mb-3 rounded-xl border border-rose-300 bg-rose-50/95 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-rose-800 shadow-sm backdrop-blur-md dark:border-rose-800 dark:bg-rose-950/80 dark:text-rose-200"
            >
              {tenantNotice}
            </div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.985, filter: 'blur(6px)' }}
            animate={isVisible
              ? { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
              : { opacity: 0, y: 18, scale: 0.985, filter: 'blur(6px)' }}
            transition={{
              duration: 0.48,
              delay: 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="w-full"
          >
            <div
              id="auth-card"
              style={{
                backgroundColor: isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.94)',
                backgroundImage: isDark
                  ? 'linear-gradient(to bottom, rgba(15,23,42,0.92), rgba(30,27,75,0.86), rgba(15,23,42,0.92))'
                  : 'none',
              }}
              className={`w-full backdrop-blur-xl border rounded-2xl sm:rounded-3xl p-5 sm:p-8 md:p-10 transition-all duration-200 ${
                isDark
                  ? 'border-purple-800/80 shadow-[0_10px_35px_rgba(15,23,42,0.8),0_0_25px_rgba(var(--primary-rgb,147,51,234),)] text-slate-100'
                  : 'bg-white border-purple-200/90 shadow-2xl shadow-purple-950/10 text-slate-800'
              }`}
            >
              {/* Brand / Store Icon Header */}
              <div className="text-center mb-3.5 sm:mb-5">
                <div className="w-14 h-14 sm:w-20 sm:h-20 mx-auto mb-2.5 sm:mb-3 rounded-2xl bg-white dark:bg-slate-900 flex items-center justify-center shadow-lg shadow-purple-600/20 dark:shadow-[0_0_20px_rgba(var(--primary-rgb,147,51,234),)] border border-indigo-500/25 overflow-hidden">
                  {isSuperAdminScope ? (
                    <img
                      src="/admin/pwa-192x192.png"
                      alt="SuperAdmin Control Panel Logo"
                      className="w-full h-full object-contain rounded-2xl p-1.5"
                    />
                  ) : (
                    <ShoeIcon
                      src={isStoreSpecific ? (companySettings?.logo || companySettings?.logo_url || '/pwa-192x192.png') : '/pwa-192x192.png'}
                      alt={`${effectiveStoreName} Logo`}
                      className="w-full h-full object-cover rounded-2xl"
                    />
                  )}
                </div>
                {isSuperAdminScope ? (
                  <>
                    <div
                      id="auth-card-heading"
                      className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 mb-0.5 sm:mb-1"
                    >
                      SarbaazSoft AdminPOS
                    </div>
                    <h2 id="auth-store-name" className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                      SuperAdmin Control Panel
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-purple-200/80 mt-0.5 sm:mt-1 font-medium">
                      Sign in to continue to SuperAdmin Control Panel
                    </p>
                  </>
                ) : isStoreSpecific ? (
                  <>
                    <div
                      id="auth-card-heading"
                      className="text-[11px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-0.5 sm:mb-1"
                    >
                      SarbaazSoft Shoe POS
                    </div>
                    <h2 id="auth-store-name" className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                      {effectiveStoreName}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-purple-200/80 mt-0.5 sm:mt-1 font-medium">
                      Sign in to continue to {effectiveStoreName}
                    </p>
                  </>
                ) : (
                  <>
                    <h2
                      id="auth-card-heading"
                      className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight"
                    >
                      SarbaazSoft Shoe POS
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-purple-200/80 mt-0.5 sm:mt-1 font-medium">
                      Sign in to continue to store terminal
                    </p>
                  </>
                )}
              </div>

              {/* Login Alerts */}
              {tab === 'login' && errorMessage && (
                <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex flex-col gap-2">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <span className="leading-relaxed font-medium">{errorMessage}</span>
                  </div>
                  {(errorMessage.toLowerCase().includes('verification') || errorMessage.toLowerCase().includes('activate your store')) && (
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('auth:require-email-verification', {
                            detail: {
                              email: email.trim(),
                              tenantId: activeTenantId,
                              storeName: effectiveStoreName,
                            },
                          })
                        );
                      }}
                      className="mt-1 self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] shadow-xs transition-colors cursor-pointer"
                    >
                      Verify Email &amp; Activate Account &rarr;
                    </button>
                  )}
                </div>
              )}

              {tab === 'login' && matchingStores.length > 0 && (
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
                  <p className="mb-2 text-xs font-bold text-blue-900 dark:text-blue-100">
                    Choose which store to sign in to:
                  </p>
                  <div className="flex flex-col gap-2">
                    {matchingStores.map((store) => (
                      <button
                        key={store.tenantId}
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleStoreChoice(store)}
                        className="flex items-center justify-between rounded-lg border border-blue-400 bg-blue-50/70 hover:bg-blue-100 px-3 py-2 text-left text-xs font-semibold text-blue-700 shadow-sm hover:shadow-md hover:border-blue-500 transition-all cursor-pointer disabled:opacity-60 dark:border-blue-600 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 dark:text-blue-200"
                      >
                        <span>{store.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'login' && sessionNotice && !errorMessage && !infoMessage && (
                <div role="status" className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed font-medium">{sessionNotice}</span>
                </div>
              )}

              {tab === 'login' && infoMessage && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed font-medium">{infoMessage}</span>
                </div>
              )}

              <AnimatedTabPanel activeKey={tab} direction={authTabDirection}>
              {/* TAB 1: LOGIN FORM */}
              {tab === 'login' && (
                <form onSubmit={handleLogin} className="space-y-3 sm:space-y-4">
                  <div>
                    <label
                      htmlFor="login-email-input"
                      className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Email or Terminal ID
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-purple-600 dark:text-purple-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        id="login-email-input"
                        name="email"
                        type="email"
                        required
                        autoComplete="username"
                        placeholder="admin@shoepos.com"
                        value={email}
                        disabled={isLoading}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setMatchingStores([]);
                        }}
                        className="app-input email-focus-pulse w-full bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-purple-800/60 focus:bg-white dark:focus:bg-slate-900 focus:border-purple-600 dark:focus:border-purple-400 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 rounded-xl text-xs sm:text-sm font-medium py-2.5 pl-[2.125rem] pr-4 transition outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="login-password-input"
                        className="block text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Counter PIN / Password
                      </label>
                      <button
                        id="forgot-password-link"
                        type="button"
                        onClick={() => {
                          passwordReset.resetFlow('request');
                          setTab('reset');
                          setErrorMessage(null);
                          setInfoMessage(null);
                        }}
                        className="text-xs font-semibold text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200 hover:underline transition cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>

                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-purple-600 dark:text-purple-400">
                        <Lock className="w-4 h-4" />
                      </div>

                      <input
                        ref={passwordInputRef}
                        id="login-password-input"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        placeholder="••••••••"
                        value={password}
                        onPaste={(e) => {
                          e.preventDefault();
                          setLoginPasteBlocked(true);
                          setTimeout(() => setLoginPasteBlocked(false), 3500);
                        }}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setMatchingStores([]);
                          if (loginPasteBlocked) setLoginPasteBlocked(false);
                        }}
                        className="app-input w-full bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-purple-800/60 focus:bg-white dark:focus:bg-slate-900 focus:border-purple-600 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 rounded-xl text-xs sm:text-sm font-sans py-2.5 pl-[2.125rem] pr-12 transition outline-none"
                      />

                      <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="p-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200 transition cursor-pointer"
                          title={showPassword ? 'Hide password' : 'Show password'}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Paste Blocked Security Notice */}
                    {loginPasteBlocked && (
                      <div className="mt-1.5 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 text-[11px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>Pasting is disabled for security verification. Please type your password manually.</span>
                      </div>
                    )}
                  </div>

                  {/* Beneath Password Field: Remember Me & Keep me logged in on a single line (Left-and-Right Split) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-slate-600 dark:text-purple-200/80 font-medium select-none">
                    <label
                      htmlFor="remember-me-checkbox"
                      className="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-purple-100 transition-colors"
                    >
                      <input
                        id="remember-me-checkbox"
                        name="rememberMe"
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded-full border-purple-300 dark:border-purple-600 dark:bg-[#0E1628] text-purple-600 accent-purple-600 focus:ring-0 cursor-pointer"
                      />
                      <span>Remember Me</span>
                    </label>

                    <label
                      htmlFor="keep-logged-in-checkbox"
                      className="flex items-center gap-2 cursor-pointer hover:text-slate-900 dark:hover:text-purple-100 transition-colors"
                    >
                      <input
                        id="keep-logged-in-checkbox"
                        name="keepLoggedIn"
                        type="checkbox"
                        checked={keepLoggedIn}
                        onChange={(e) => setKeepLoggedIn(e.target.checked)}
                        className="w-4 h-4 rounded-full border-purple-300 dark:border-purple-600 dark:bg-[#0E1628] text-purple-600 accent-purple-600 focus:ring-0 cursor-pointer"
                      />
                      <span>Keep me logged in</span>
                    </label>
                  </div>

                  <button
                    id="login-submit-btn"
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 dark:from-purple-600 dark:to-indigo-600 dark:hover:from-purple-500 dark:hover:to-indigo-500 text-white border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 dark:shadow-[0_0_16px_rgba(var(--primary-rgb,147,51,234),)] font-bold text-xs sm:text-sm transition active:scale-[0.99] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Verifying Credentials...</span>
                      </>
                    ) : (
                      <>
                        <span>{isSuperAdminScope ? 'Sign In to Control Panel' : 'Sign In to Terminal'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="pt-3 mt-1 border-t border-slate-200/80 dark:border-purple-800/50 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs">
                    {!hasActiveTenantScope ? (
                      <>
                        <span className="text-slate-500 dark:text-purple-200/75 font-medium">
                          Don&apos;t have a store account yet?
                        </span>
                        <button
                          id="auth-register-free-trial-link"
                          type="button"
                          disabled={isLoading}
                          onClick={() => setShowFreeTrialModal(true)}
                          className="inline-flex items-center gap-1 font-bold text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200 underline decoration-purple-400/60 underline-offset-2 hover:decoration-purple-600 dark:hover:decoration-purple-300 transition cursor-pointer disabled:opacity-50"
                        >
                          <span>Start 30-Day Free Trial</span>
                        </button>
                      </>
                    ) : (
                      <button
                        id="auth-sign-in-different-store-link"
                        type="button"
                        disabled={isLoading}
                        onClick={handleResetTenantScope}
                        className="inline-flex items-center gap-1 font-bold text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200 underline decoration-purple-400/60 underline-offset-2 hover:decoration-purple-600 dark:hover:decoration-purple-300 transition cursor-pointer disabled:opacity-50"
                      >
                        <span>Sign in with different store</span>
                      </button>
                    )}
                  </div>
                </form>
              )}

              {/* TAB 2: CENTRALIZED 6-DIGIT PASSWORD RESET FLOW */}
              {tab === 'reset' && (
                <PasswordResetFlow
                  idPrefix="store-auth"
                  controller={passwordReset}
                  roleScope={isSuperAdminScope ? 'SUPERADMIN' : activeTenantId ? 'STORE' : 'ALL'}
                  onBackToLogin={() => {
                    passwordReset.resetFlow('request');
                    setTab('login');
                    setErrorMessage(null);
                  }}
                />
              )}
              </AnimatedTabPanel>
            </div>
          </motion.div>
        </div>

        {showFreeTrialModal && (
          <FreeTrialOnboardingModal
            isOpen={showFreeTrialModal}
            onClose={() => setShowFreeTrialModal(false)}
            initialPlan="TRIAL"
            onStoreCreated={(tenantId, loginUrl, user, token) => {
              setShowFreeTrialModal(false);
              if (onStoreCreated) {
                onStoreCreated(tenantId, loginUrl, user, token);
              } else if (token && user) {
                onSuccess(user);
              }
            }}
          />
        )}
    </BodyLayoutWrapper>
  );
};

