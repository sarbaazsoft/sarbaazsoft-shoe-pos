import React, { useEffect, useRef, useState } from 'react';
import { ShoppingCart, Package, Truck, Printer, Users, BarChart3, ShieldCheck, Settings, ArrowRight, Check, Calendar, Store, DollarSign, Sparkles, Search, Zap, WifiOff, Layers, LayoutDashboard, Tag, LogIn, ChevronLeft, ChevronRight, Bell, Smartphone, Mail, Phone } from 'lucide-react';
import shoeStoreBg from '../../assets/images/shoe_store_blurred_bg_1790706924465.jpg';
import { api } from '../../services/api';
import { useSaasDirectoryQuery } from '../../hooks/useLiveData';
import type { TenantInfo } from '../../types';
import { FreeTrialOnboardingModal } from './FreeTrialOnboardingModal';
import { useTheme } from '../../context/ThemeContext';
import { APP_VERSION } from '../../version.ts';
import { Navbar } from './Navbar';
import { BodyLayoutWrapper } from '../common/BodyLayoutWrapper';
import { resolveRouteLayoutMetadata, type RouteLayoutMetadata } from '../../config/routeLayoutMetadata';
import { LuxuryBadge } from '../common/Badge';
import type { LuxuryBadgeTone } from '../../utils/badgeStyles';
import { LicenseAgreementModal } from '../common/LicenseAgreementModal';
import { ActiveTenantScopeBanner } from '../common/ActiveTenantScopeBanner';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Autoplay, Pagination } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

interface PublicStats {
  stores: number;
  products: number;
  invoicesToday: number;
  platformRevenue: number;
  superAdminEmail?: string;
  superAdminPhone?: string;
}

const AnimatedCounter: React.FC<{
  target: number;
  startTime: number | null;
  prefix?: string;
  suffix?: string;
}> = ({ target, startTime, prefix = '', suffix = '+' }) => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (startTime === null) return;

    const duration = 1600;
    let animationFrame = 0;
    const animate = (timestamp: number) => {
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(target * easedProgress));
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [startTime, target]);

  return <>{prefix}{value.toLocaleString('en-US')}{suffix}</>;
};

const HERO_HIGHLIGHT_WORDS = [
  'smarter',
  'faster',
  'sharper',
  'effortless',
  'safer',
  'stronger',
] as const;

const HERO_HIGHLIGHT_INTERVAL_MS = 2400;

function useRotatingHeroWord(
  words: readonly string[],
  intervalMs: number = HERO_HIGHLIGHT_INTERVAL_MS
) {
  const [state, setState] = useState<{ index: number; prevIndex: number | null }>({
    index: 0,
    prevIndex: null,
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    setPrefersReducedMotion(mq.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener?.(onChange);
    return () => mq.removeListener?.(onChange);
  }, []);

  useEffect(() => {
    if (words.length <= 1) return;
    const timer = window.setInterval(() => {
      setState((curr) => ({
        index: (curr.index + 1) % words.length,
        prevIndex: prefersReducedMotion ? null : curr.index,
      }));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [words.length, intervalMs, prefersReducedMotion]);

  return {
    activeWord: words[state.index] ?? words[0],
    previousWord:
      !prefersReducedMotion && state.prevIndex !== null ? words[state.prevIndex] : null,
    activeIndex: state.index,
    prefersReducedMotion,
  };
}

const AnimatedHeroHighlight: React.FC = () => {
  const { activeWord, previousWord, activeIndex, prefersReducedMotion } = useRotatingHeroWord(
    HERO_HIGHLIGHT_WORDS,
    HERO_HIGHLIGHT_INTERVAL_MS
  );

  return (
    <span
      id="hero-animated-highlight"
      className="relative font-courgette font-normal tracking-normal inline-grid align-bottom overflow-hidden pt-[0.06em] pb-[0.22em] -mt-[0.06em] -mb-[0.14em] px-[0.08em] -mx-[0.08em] text-primary-400 lt:text-primary"
      style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
    >
      {HERO_HIGHLIGHT_WORDS.map((word) => (
        <span
          key={`sizer-${word}`}
          aria-hidden="true"
          className="col-start-1 row-start-1 invisible select-none pointer-events-none whitespace-nowrap"
        >
          {word}
        </span>
      ))}
      {previousWord && (
        <span
          key={`exit-${activeIndex}`}
          aria-hidden="true"
          className="col-start-1 row-start-1 justify-self-start whitespace-nowrap pointer-events-none select-none hero-word-exit"
        >
          <span className="relative inline-block">
            <span className="hero-highlight-gradient">{previousWord}</span>
            <span
              aria-hidden="true"
              className="pointer-events-none select-none absolute -bottom-[0.05em] left-0 right-0 h-[3px] sm:h-[4px] rounded-full hero-underline-bar hero-underline-bar--exit"
            />
          </span>
        </span>
      )}
      <span
        key={prefersReducedMotion ? 'reduced-active' : `enter-${activeIndex}`}
        data-active-word={activeWord}
        className={`col-start-1 row-start-1 justify-self-start whitespace-nowrap ${
          previousWord && !prefersReducedMotion ? 'hero-word-enter' : ''
        }`}
      >
        <span className="relative inline-block">
          <span className="hero-highlight-gradient">{activeWord}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none select-none absolute -bottom-[0.05em] left-0 right-0 h-[3px] sm:h-[4px] rounded-full hero-underline-bar"
          />
        </span>
      </span>
    </span>
  );
};

const SneakerGlyph: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg viewBox="0 0 120 70" className={className} aria-hidden="true">
    <path d="M8 50c0-6 4-10 10-12l22-8c6-2 11-8 15-15 2-3 6-3 8 0 4 6 10 10 17 12l22 6c7 2 12 8 12 15 0 4-3 7-7 7H15c-4 0-7-2-7-5z" fill="#F4F3FF" />
    <path d="M8 52h104c3 0 5 2 5 5s-2 5-5 5H14c-4 0-6-4-6-10z" fill="var(--color-purple-200, #E9D5FF)" />
    <path d="M40 30l6 4m-10 2l6 4m-10 2l6 4" stroke="var(--primary, #9333EA)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M22 46c14-2 28-8 42-18" stroke="var(--primary-400, #C084FC)" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);

const DashboardMockup: React.FC = () => {
  const kpis = [
    { label: 'Total sales', value: 'Rs. 48,750', delta: '+12% from last week', icon: DollarSign },
    { label: 'Total orders', value: '142', delta: '+18% from last week', icon: ShoppingCart },
    { label: 'Total products', value: '1,248', delta: '+6% from last week', icon: Package },
  ];
  const popular = [
    { name: 'Classic runner', meta: 'Rs. 8,500 · 42 sold', tone: 'from-rose-300 to-rose-500' },
    { name: 'Court sneaker', meta: 'Rs. 7,200 · 36 sold', tone: 'from-slate-200 to-sky-300' },
    { name: 'Street low-top', meta: 'Rs. 6,900 · 28 sold', tone: 'from-sky-300 to-indigo-500' },
    { name: 'Canvas high-top', meta: 'Rs. 5,500 · 24 sold', tone: 'from-slate-500 to-slate-800' },
  ];
  const menu = [
    { label: 'Dashboard', icon: LayoutDashboard },
    { label: 'Sales', icon: ShoppingCart },
    { label: 'Products', icon: Tag },
    { label: 'Inventory', icon: Package },
    { label: 'Customers', icon: Users },
    { label: 'Reports', icon: BarChart3 },
    { label: 'Settings', icon: Settings },
  ];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="relative" role="img" aria-label="Interactive preview of the SarbaazSoft Shoe POS dashboard showing daily sales, orders, inventory KPIs, a 7-day sales chart, and top-selling footwear">
      <div className="absolute -inset-4 rounded-[2rem] bg-purple-600/25 blur-3xl pointer-events-none" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-[20px] border-2 border-indigo-400/50 bg-[#0A0C2E] shadow-[0_0_0_1px_rgba(var(--primary-rgb,147,51,234),0.22),0_30px_90px_-20px_rgba(var(--brand-companion-rgb,79,70,229),0.65)]" aria-hidden="true">
        {/* top bar */}
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-white">
            <svg viewBox="0 0 64 42" className="h-4 w-6"><path d="M6 31c0-3 2-5 5-6l12-5c3-1.5 6-4.5 8-8 1-1.5 2.8-1.5 3.8 0 1.8 2.8 4.5 5 8.2 5.8l11 2.4c3.5.8 6 3.8 6 7.3 0 2.5-2 4.5-4.5 4.5H10.5C8 37 6 34.5 6 31z" fill="var(--primary-400, #C084FC)" /></svg>
            SarbaazSoft Shoe POS
          </span>
          <span className="hidden sm:flex flex-1 max-w-[260px] items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1 text-[9px] text-slate-500"><Search className="h-2.5 w-2.5" />Search article, barcode, customer…</span>
          <span className="ml-auto flex items-center gap-2 text-[9px] text-slate-300">
            <span className="h-4 w-4 rounded-full bg-purple-500/40 ring-1 ring-purple-300/40" />
            <span className="leading-tight">Flagship Store<br /><span className="text-slate-500">Store Owner</span></span>
          </span>
        </div>
        <div className="flex">
          <ul className="hidden sm:block w-[118px] shrink-0 space-y-0.5 border-r border-white/5 p-2.5">
            {menu.map(({ label, icon: Icon }, i) => (
              <li key={label} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[9px] ${i === 0 ? 'bg-purple-500/25 text-white font-semibold' : 'text-slate-400'}`}>
                <Icon className="h-3 w-3" />{label}
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 p-3 sm:p-4">
            <div className="mb-2.5 text-sm font-bold text-white">Dashboard</div>
            <div className="grid grid-cols-3 gap-2">
              {kpis.map(({ label, value, delta, icon: Icon }) => (
                <div key={label} className="rounded-lg border border-indigo-400/25 bg-gradient-to-b from-indigo-500/15 to-transparent p-2">
                  <div className="flex items-center gap-1.5 text-[8px] text-slate-300"><Icon className="h-3 w-3 text-purple-300" />{label}</div>
                  <div className="mt-1 text-[13px] sm:text-base font-extrabold text-white tabular-nums">{value}</div>
                  <div className="text-[7px] text-emerald-400">{delta}</div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1.55fr_1fr]">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-white">Sales overview</span>
                  <span className="rounded border border-white/10 px-1.5 py-0.5 text-[7px] text-slate-400">Last 7 days ▾</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="flex h-24 flex-col justify-between pb-3 text-[7px] text-slate-500"><span>4K</span><span>3K</span><span>2K</span><span>1K</span><span>0</span></div>
                  <div className="min-w-0 flex-1">
                    <svg viewBox="0 0 300 110" className="h-24 w-full" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="dm-area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary-400, #C084FC)" stopOpacity="0.55" />
                          <stop offset="100%" stopColor="var(--primary-400, #C084FC)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[15, 40, 65, 90].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />)}
                      <path d="M0 98 L45 90 L90 62 L130 68 L175 50 L215 46 L255 30 L300 12 L300 110 L0 110 Z" fill="url(#dm-area)" />
                      <path d="M0 98 L45 90 L90 62 L130 68 L175 50 L215 46 L255 30 L300 12" fill="none" stroke="var(--color-purple-300, #D8B4FE)" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                    <div className="mt-0.5 flex justify-between text-[7px] text-slate-500">{days.map((d) => <span key={d}>{d}</span>)}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                <div className="mb-1.5 text-[9px] font-semibold text-white">Popular products</div>
                <ul className="space-y-1.5">
                  {popular.map((p) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span className={`h-7 w-7 shrink-0 rounded bg-gradient-to-br ${p.tone}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-[9px] font-semibold text-white">{p.name}</span>
                        <span className="block truncate text-[7px] text-slate-400">{p.meta}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Floating product card */}
      <div className="absolute -bottom-10 left-3 sm:-left-8 w-44 rounded-xl border-2 border-indigo-400/50 bg-[#0B0E36] p-3 shadow-[0_20px_50px_-10px_rgba(var(--brand-companion-rgb,79,70,229),0.7)]" aria-hidden="true">
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white"><ShoppingCart className="h-3 w-3" /></span>
        <div className="mx-auto h-16 w-28"><SneakerGlyph /></div>
        <div className="mt-1 text-[10px] font-semibold text-white">Classic runner</div>
        <div className="text-[11px] font-bold text-white">Rs. 8,500</div>
        <div className="mt-2 rounded-md bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 py-1.5 text-center text-[9px] font-bold text-white shadow-xs">Add to cart</div>
      </div>
    </div>
  );
};


/**
 * Interface representing a store displayed in the JS slider.
 * Includes isRegistered flag to distinguish real SaaS stores from partner showcase stores.
 */
export interface StoreSliderItem extends TenantInfo {
  isRegistered?: boolean;
}


/**
 * Returns the first and second letter of the store name as the fallback badge initials.
 */
function getStoreInitials(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return 'SP';
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = words[0].replace(/[^a-zA-Z0-9]/g, '')[0] || '';
    const second = words[1].replace(/[^a-zA-Z0-9]/g, '')[0] || '';
    if (first && second) return (first + second).toUpperCase();
  }
  const alphaChars = clean.replace(/[^a-zA-Z0-9]/g, '');
  if (alphaChars.length >= 2) {
    return alphaChars.slice(0, 2).toUpperCase();
  }
  if (alphaChars.length === 1) {
    return alphaChars.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

const STORE_CARD_GRADIENTS = [
  'from-purple-600 via-indigo-600 to-purple-800 border-purple-400/40 text-white shadow-purple-600/30',
  'from-blue-600 via-indigo-600 to-cyan-600 border-blue-400/40 text-white shadow-blue-600/30',
  'from-emerald-600 via-teal-600 to-cyan-700 border-emerald-400/40 text-white shadow-emerald-600/30',
  'from-rose-600 via-pink-600 to-purple-700 border-rose-400/40 text-white shadow-rose-600/30',
  'from-amber-600 via-orange-600 to-rose-700 border-amber-400/40 text-white shadow-amber-600/30',
  'from-violet-600 via-purple-600 to-fuchsia-700 border-violet-400/40 text-white shadow-violet-600/30',
];

/**
 * Card bearing store logo, or store name first and second letter as fallback.
 */
const StoreLogoBadge: React.FC<{
  tenant: StoreSliderItem;
  index: number;
}> = ({ tenant, index }) => {
  const [imgError, setImgError] = useState(false);
  const initials = getStoreInitials(tenant.name);
  const hasStoreLogo =
    Boolean(tenant.logoUrl) &&
    !tenant.logoUrl?.endsWith('/pwa-512x512.png') &&
    !tenant.logoUrl?.endsWith('/favicon.png') &&
    !imgError;

  const gradientClass = STORE_CARD_GRADIENTS[index % STORE_CARD_GRADIENTS.length];

  return (
    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center p-1.5 relative shrink-0 transition-transform duration-200 group-hover:scale-105">
      {hasStoreLogo ? (
        <img
          src={tenant.logoUrl}
          alt={`${tenant.name} logo`}
          className="max-h-11 max-w-full object-contain rounded-xl drop-shadow-sm"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div
          className={`w-full h-full rounded-2xl bg-gradient-to-br ${gradientClass} border flex items-center justify-center shadow-md font-black text-xl sm:text-2xl tracking-wider select-none`}
          aria-hidden="true"
        >
          {initials}
        </div>
      )}
    </div>
  );
};

/**
 * Store Card: Proportional card bearing store logo or 1st & 2nd letter fallback, with store name below logo.
 * Strictly uses plain <div> tags with no anchor <a> tags or header <h*> tags.
 * Exclusively displays actual provisioned and registered stores in our SaaS database.
 */
const StoreSliderCard: React.FC<{
  tenant: StoreSliderItem;
  index: number;
  onSelect?: (tenant: TenantInfo) => void;
}> = ({ tenant, index, onSelect }) => {
  // Resolve specific business type (e.g., B2C, B2B, or Wholesale & Retail)
  const rawType = String(tenant.businessType || '').toUpperCase().trim();
  const nameLower = (tenant.name || '').toLowerCase();

  let businessTypeLabel = 'B2C Retail';
  let businessTone: LuxuryBadgeTone = 'emerald';

  if (
    rawType === 'WHOLESALE' ||
    nameLower.includes('wholesale') ||
    nameLower.includes('distributor') ||
    nameLower.includes('bulk')
  ) {
    businessTypeLabel = 'B2B Wholesale';
    businessTone = 'indigo';
  } else if (
    rawType === 'HYBRID' ||
    (nameLower.includes('wholesale') && nameLower.includes('retail'))
  ) {
    businessTypeLabel = 'Wholesale & Retail';
    businessTone = 'purple';
  } else if (
    rawType === 'RETAIL' ||
    nameLower.includes('retail') ||
    nameLower.includes('shoes') ||
    nameLower.includes('store') ||
    nameLower.includes('footwear')
  ) {
    businessTypeLabel = 'B2C Retail';
    businessTone = 'emerald';
  } else if (index % 3 === 1) {
    businessTypeLabel = 'B2B Wholesale';
    businessTone = 'indigo';
  } else if (index % 3 === 2) {
    businessTypeLabel = 'Wholesale & Retail';
    businessTone = 'purple';
  }

  // Resolve pricing policy (Fixed Price vs Negotiable Price)
  const rawPolicy = String(tenant.pricingMode || '').toUpperCase().trim();
  let pricingPolicyLabel = 'Fixed Price';
  let pricingTone: LuxuryBadgeTone = 'purple';

  if (rawPolicy === 'NEGOTIABLE' || (!rawPolicy && nameLower.includes('bargain'))) {
    pricingPolicyLabel = 'Negotiable Price';
    pricingTone = 'amber';
  } else {
    pricingPolicyLabel = 'Fixed Price';
    pricingTone = 'purple';
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(tenant)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(tenant);
        }
      }}
      aria-label={`${tenant.name} store — click to sign in`}
      className="group relative flex flex-col items-center justify-between rounded-2xl border border-indigo-400/25 lt:border-indigo-200/80 bg-gradient-to-b from-[#12154A]/80 lt:from-white to-[#0A0C2E]/90 lt:to-[#F8FAFF] p-4 sm:p-5 text-center shadow-[0_12px_28px_-12px_rgba(var(--brand-companion-rgb,79,70,229),0.4)] lt:shadow-sm hover:border-purple-400/80 lt:hover:border-purple-400/80 hover:shadow-2xl hover:shadow-purple-600/30 dark:hover:shadow-indigo-500/35 lt:hover:shadow-[0_22px_45px_-12px_rgba(var(--brand-companion-rgb,79,70,229),0.28)] hover:scale-[1.045] hover:-translate-y-1 active:scale-[0.985] active:translate-y-0 cursor-pointer transition-all duration-300 ease-out transform-gpu will-change-transform select-none w-full min-h-[220px] sm:min-h-[235px] h-full"
    >
      {/* 1. Store Logo OR Store Name First and Second Letter as Fallback */}
      <StoreLogoBadge tenant={tenant} index={index} />

      {/* Subtle Divider */}
      <div className="w-3/4 my-2 border-t border-white/10 lt:border-slate-200" aria-hidden="true" />

      {/* 2. Store Name Below Logo (plain div, no anchor or h-tag) */}
      <div className="w-full flex-1 flex flex-col items-center justify-center min-w-0 px-1">
        <div
          className="w-full text-sm sm:text-base font-bold text-white lt:text-slate-900 truncate group-hover:text-purple-300 lt:group-hover:text-purple-600 transition-colors"
          title={tenant.name}
        >
          {tenant.name}
        </div>

        {/* 3. Business Type & Pricing Policy Badges */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 w-full">
          <LuxuryBadge tone={businessTone} size="xs" font="roboto">
            {businessTypeLabel}
          </LuxuryBadge>

          <LuxuryBadge tone={pricingTone} size="xs" font="roboto">
            {pricingPolicyLabel}
          </LuxuryBadge>
        </div>

        {/* 4. Registered Store Status */}
        <div className="mt-2 flex items-center justify-center gap-1 text-[11px] font-medium">
          <div className="font-courgette flex items-center gap-1 text-emerald-400 lt:text-emerald-600" style={{ fontFamily: "'Courgette', cursive, sans-serif" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-[10px]">Registered Store</span>
          </div>
        </div>
      </div>
    </div>
  );
};


interface SaasLandingPageProps {
  availableTenants: TenantInfo[];
  unauthTenantId?: string | number | null;
  onClearTenantScope?: () => void;
  onGlobalLogin: () => void;
  onOpenSuperAdmin: () => void;
  onStoreCreated?: (tenantId: number, loginUrl: string, user?: any, token?: string) => void;
  onSelectStore?: (tenant: TenantInfo) => void;
  layoutMeta?: Partial<RouteLayoutMetadata>;
}

export const SaasLandingPage: React.FC<SaasLandingPageProps> = ({
  availableTenants,
  unauthTenantId,
  onClearTenantScope,
  onGlobalLogin,
  onOpenSuperAdmin,
  onStoreCreated,
  onSelectStore,
  layoutMeta: layoutMetaOverride,
}) => {
  const [activeNav, setActiveNav] = useState<'home' | 'features' | 'stores' | 'pricing' | 'about' | 'contact'>('home');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);
  const [platformOwnerEmail, setPlatformOwnerEmail] = useState<string>('');
  const [platformOwnerPhone, setPlatformOwnerPhone] = useState<string>('');
  const [storeDirectory, setStoreDirectory] = useState<TenantInfo[]>(availableTenants);
  const [statsInView, setStatsInView] = useState(false);
  const [statsAnimationStartTime, setStatsAnimationStartTime] = useState<number | null>(null);
  const statsSectionRef = useRef<HTMLElement>(null);
  const swiperRef = useRef<SwiperType | null>(null);
  const { theme, setThemeMode, effectiveBackdropImage } = useTheme();
  const [ctaBackdropFailed, setCtaBackdropFailed] = useState(false);
  const landingTheme = theme;

  useEffect(() => {
    setCtaBackdropFailed(false);
  }, [effectiveBackdropImage]);

  const toggleLandingTheme = () => {
    const nextMode = theme === 'dark' ? 'light' : 'dark';
    try {
      setThemeMode(nextMode);
    } catch {}
  };

  useEffect(() => {
    let isMounted = true;
    api.saas.getPublicStats()
      .then((stats) => {
        if (!isMounted) return;
        setPublicStats(stats);
        if (stats.superAdminEmail) {
          setPlatformOwnerEmail(stats.superAdminEmail);
        }
        if (stats.superAdminPhone) {
          setPlatformOwnerPhone(stats.superAdminPhone);
        }
        if (!stats.superAdminEmail || !stats.superAdminPhone) {
          api.saas.getPlatformOwner()
            .then((owner) => {
              if (isMounted) {
                if (owner?.email) setPlatformOwnerEmail(owner.email);
                if (owner?.phone) setPlatformOwnerPhone(owner.phone);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        // Keep the counters blank when live totals cannot be loaded; never show invented figures.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (availableTenants && availableTenants.length > 0) {
      setStoreDirectory(availableTenants);
    }
  }, [availableTenants]);

  const hasInitialTenants = Array.isArray(availableTenants) && availableTenants.length > 0;
  const saasDirectoryQuery = useSaasDirectoryQuery(undefined, {
    enabled: !hasInitialTenants,
  });

  useEffect(() => {
    const tenants = saasDirectoryQuery.data?.availableTenants;
    if (Array.isArray(tenants) && tenants.length > 0) {
      setStoreDirectory(tenants as TenantInfo[]);
    }
  }, [saasDirectoryQuery.data]);

  // Exclusively display actual stores provisioned and registered in our SaaS database (zero mockups)
  const mergedStores = React.useMemo<StoreSliderItem[]>(() => {
    const registeredList: StoreSliderItem[] = [];
    const seen = new Set<string>();

    // 1. Registered stores from live directory and availableTenants
    const registeredSources = [
      ...(Array.isArray(storeDirectory) ? storeDirectory : []),
      ...(Array.isArray(availableTenants) ? availableTenants : []),
    ];

    for (const t of registeredSources) {
      const tid = Number(t?.id);
      const key = (t.name || '').toLowerCase().trim();
      if (Number.isSafeInteger(tid) && tid > 0 && key && !seen.has(key)) {
        registeredList.push({
          ...t,
          isRegistered: true,
        });
        seen.add(key);
      }
    }

    // 2. Also check any newly registered stores saved in localStorage
    try {
      const cached = localStorage.getItem('pos_registered_stores_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          for (const t of parsed) {
            const tid = Number(t?.id);
            const key = (t.name || '').toLowerCase().trim();
            if (Number.isSafeInteger(tid) && tid > 0 && key && !seen.has(key)) {
              registeredList.push({
                ...t,
                isRegistered: true,
              });
              seen.add(key);
            }
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }

    return registeredList;
  }, [storeDirectory, availableTenants]);

  // Ensure sufficient slides for smooth infinite loop in Swiper while exclusively displaying actual registered stores
  const storesForSlider = React.useMemo<StoreSliderItem[]>(() => {
    if (mergedStores.length === 0) return [];
    // Cycle only real registered stores up to minimum slides needed for smooth Swiper infinite loop
    const minSlides = Math.max(mergedStores.length, 12);
    const result: StoreSliderItem[] = [];
    while (result.length < minSlides) {
      for (const s of mergedStores) {
        result.push(s);
        if (result.length >= minSlides) break;
      }
    }
    return result;
  }, [mergedStores]);

  useEffect(() => {
    const section = statsSectionRef.current;
    if (!section || statsInView) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setStatsInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(section);
    return () => observer.disconnect();
  }, [statsInView]);

  useEffect(() => {
    if (statsInView && publicStats && statsAnimationStartTime === null) {
      setStatsAnimationStartTime(performance.now());
    }
  }, [statsInView, publicStats, statsAnimationStartTime]);

  const handlePrevSlide = () => {
    swiperRef.current?.slidePrev();
  };

  const handleNextSlide = () => {
    swiperRef.current?.slideNext();
  };

  const [plan, setPlan] = useState('TRIAL');
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);

  const openGetStartedWithPlan = (selectedPlan: string) => {
    setPlan(selectedPlan);
    setShowRequestModal(true);
  };


  const scrollToSection = (id: string, navKey: 'home' | 'features' | 'stores' | 'pricing' | 'about' | 'contact') => {
    setActiveNav(navKey);
    const cleanId = id.replace(/^#/, '');
    const searchParams = new URLSearchParams(window.location.search);
    const rawCurrentTid = String(searchParams.get('tenantId') || searchParams.get('storeId') || unauthTenantId || '').trim();
    const numCurrentTid = rawCurrentTid !== '' ? Number(rawCurrentTid) : NaN;
    const currentTid = Number.isSafeInteger(numCurrentTid) && numCurrentTid >= 0 ? String(numCurrentTid) : '';
    const isTopTarget = cleanId === 'top' || cleanId === 'home';
    const hash = isTopTarget ? '' : `#${cleanId}`;
    if (currentTid !== '') {
      window.history.replaceState({}, '', `/?tenantId=${encodeURIComponent(currentTid)}${hash}`);
    } else if (hash) {
      window.history.replaceState({}, '', `/${hash}`);
    } else {
      window.history.replaceState({}, '', '/');
    }

    const executeScroll = () => {
      if (isTopTarget) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const el = document.getElementById(cleanId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => executeScroll());
    } else {
      executeScroll();
    }
  };

  // Track visible landing section smoothly for desktop underline and mobile sidebar active pill
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const trackedSections: Array<{ id: string; key: 'home' | 'features' | 'stores' | 'pricing' | 'about' | 'contact' }> = [
      { id: 'home', key: 'home' },
      { id: 'features', key: 'features' },
      { id: 'stores', key: 'stores' },
      { id: 'pricing', key: 'pricing' },
      { id: 'about', key: 'about' },
      { id: 'contact', key: 'contact' },
    ];

    const handleScroll = () => {
      if (window.scrollY < 100) {
        setActiveNav('home');
        return;
      }
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;
      if (nearBottom) {
        setActiveNav('contact');
        return;
      }
      let currentKey: 'home' | 'features' | 'stores' | 'pricing' | 'about' | 'contact' = 'home';
      for (const item of trackedSections) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= 160) {
          currentKey = item.key;
        }
      }
      setActiveNav(currentKey);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const featureItems = [
    {
      title: 'High-Speed POS & Offline Billing',
      desc: 'Scan barcodes continuously or search by article and brand. Accept cash, card, bank transfer, or khata split payments with instant change math—and keep billing offline with automatic IndexedDB background sync.',
      icon: ShoppingCart,
    },
    {
      title: 'Footwear Catalog & Stock Ledger',
      desc: 'Track individual pairs and wholesale cartons (12/16-pair packs, half-carton rules, and minimum quantities). Bulk-import via CSV, protect margins with floor-price guards, and audit every movement in the Stock Ledger.',
      icon: Package,
    },
    {
      title: 'Purchases & Supplier Khata',
      desc: 'Receive incoming footwear stock rapidly with Quick Receive chips, log supplier bills and partial payments, monitor outstanding payables, and process supplier returns cleanly.',
      icon: Truck,
    },
    {
      title: 'Direct Thermal & Barcode Printing',
      desc: 'Pair ESC/POS thermal receipt printers (50/58/80mm) and TSPL label printers via WebUSB or local print agent. Generate Code-128 stickers, A4 24-up sheets, and 3"×4" box rack labels.',
      icon: Printer,
    },
    {
      title: 'Customer Khata, Returns & Exchanges',
      desc: 'Maintain customer profiles, credit limits, and running khata balances. Process standalone sales returns or instant in-POS shoe size and article exchanges with automatic balance reconciliation.',
      icon: Users,
    },
    {
      title: 'Sales, Profit & Low-Stock Reports',
      desc: 'Monitor daily revenue, gross Profit & Loss across custom date ranges, top-selling articles, and live inventory valuation—complete with printable Financial Summaries and automated low-stock alerts.',
      icon: BarChart3,
    },
    {
      title: 'Multi-Role Security & Backups',
      desc: 'Protect multi-tenant store workspaces with Owner and Cashier role permissions, idle cashier lock prompts, verified account onboarding, and one-click JSON/SQL store backup and restore.',
      icon: ShieldCheck,
    },
    {
      title: 'Store Branding, Receipts & 11 Themes',
      desc: 'Customize shop logos, invoice layouts, and 50/58/80mm thermal receipt templates. Switch effortlessly between Light, Dark, and System modes with 11 curated brand color palettes.',
      icon: Settings,
    },
    {
      title: 'Push Notifications & Email Alerts',
      desc: 'Receive live Web Push alerts on desktop or mobile PWA plus formatted owner emails with smart fallback when offline. Monitor sales, returns, exchanges, low-stock thresholds, and trial renewals with Recommended or Custom presets.',
      icon: Bell,
    },
    {
      title: 'Sammi AI Assistant & Smart Catalog',
      desc: 'Get real-time answers on store stock, footwear care, and retail trends from the built-in Sammi AI Assistant, plus AI-assisted catalog suggestions when adding new footwear articles.',
      icon: Sparkles,
    },
    {
      title: 'Installable PWA for Android, iOS & Windows',
      desc: 'Install SarbaazSoft Shoe POS as a standalone app with offline caching and dedicated icons—supporting Android Chrome WebAPK & signed .APK/.AAB, Apple iOS & iPadOS Safari Add to Home Screen, and Windows 64-bit Desktop PWA, .EXE, and MSIX/APPX packages.',
      icon: Smartphone,
    },
  ];

  const operationalBenefits = [
    {
      title: 'Faster Counter Workflows',
      desc: 'Continuous scanner mode, audio feedback chimes, and zero-lag offline checkout keep queues moving even during peak rushes.',
    },
    {
      title: 'Complete Financial & Khata Clarity',
      desc: 'Reconcile cash, card, bank transfers, customer khata dues, and supplier payables in real time with zero manual spreadsheets.',
    },
    {
      title: 'Live Owner Alerts & Stock Protection',
      desc: 'Floor-price guards protect margins, the Stock Ledger audits every pair, and Web Push + Email alerts keep owners notified on every sale, return, and low-stock item.',
    },
    {
      title: 'Android, iOS & Windows App Ready',
      desc: 'Install seamlessly as a standalone PWA or native launcher on Android (WebAPK & APK), Apple iPhone/iPad (Safari), and Windows PC (.EXE & MSIX) with isolated multi-store data.',
    },
  ];

  const landingNavItems = [
    { key: 'home', label: 'Home', section: 'top' },
    { key: 'features', label: 'Features', section: 'features' },
    { key: 'pricing', label: 'Pricing', section: 'pricing' },
    { key: 'stores', label: 'Stores', section: 'stores' },
    { key: 'about', label: 'About', section: 'about' },
  ] as const;

  const planFeatures = [
    'Full Retail & Wholesale Dual-Engine POS',
    'Unlimited Products, Cartons & Customer Khata',
    'Offline Billing Sync & Direct WebUSB Printing',
    'Web Push Notifications & Owner Email Alerts',
    'Android, iOS & Windows PWA + Sammi AI Assistant',
  ];

  const primaryBtn =
    'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 active:from-purple-800 active:to-indigo-800 dark:from-purple-600 dark:to-indigo-600 dark:hover:from-purple-500 dark:hover:to-indigo-500 text-white font-semibold border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 dark:shadow-[0_0_18px_rgba(var(--primary-rgb,147,51,234),0.35)] transition-all cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 active:scale-[0.98]';
  const outlineBtn =
    'inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-400/75 hover:border-purple-400 lt:border-indigo-400 lt:hover:border-indigo-600 bg-indigo-500/10 hover:bg-indigo-500/20 lt:bg-indigo-50/75 lt:hover:bg-indigo-100/80 text-indigo-200 hover:text-white lt:text-indigo-700 lt:hover:text-indigo-800 font-semibold shadow-md shadow-indigo-950/35 hover:shadow-lg hover:shadow-purple-500/25 lt:shadow-md lt:shadow-indigo-900/10 lt:hover:shadow-indigo-900/15 transition-all cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 active:scale-[0.98]';

  const handleStoreCreated = (tenantId: number, loginUrl: string, user?: any, token?: string) => {
    const createdStoreName = user?.storeName || 'New Registered Store';
    const newStore: TenantInfo = {
      id: tenantId,
      name: createdStoreName,
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      businessType: 'RETAIL',
      pricingMode: 'FIXED',
      logoUrl: '',
      currency: 'PKR',
      onboardingCompleted: Boolean(user?.onboardingCompleted),
      appPath: `/?tenantId=${tenantId}`,
    };
    try {
      const existingRaw = localStorage.getItem('pos_registered_stores_cache');
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const updated = [newStore, ...existing.filter((s: any) => s.id !== tenantId)];
      localStorage.setItem('pos_registered_stores_cache', JSON.stringify(updated));
    } catch {}
    setStoreDirectory((prev) => [newStore, ...prev.filter((t) => t.id !== tenantId)]);
    onStoreCreated?.(tenantId, loginUrl, user, token);
  };

  const hasExplicitUnauthScope =
    unauthTenantId !== null && unauthTenantId !== undefined && String(unauthTenantId).trim() !== '';
  const numericUnauthTid = hasExplicitUnauthScope ? Number(unauthTenantId) : NaN;
  const isSuperAdminUnauthScope = Number.isSafeInteger(numericUnauthTid) && numericUnauthTid === 0;
  const validUnauthTenantId =
    Number.isSafeInteger(numericUnauthTid) && numericUnauthTid > 0 ? numericUnauthTid : null;
  const hasActiveTenantScope = isSuperAdminUnauthScope || Boolean(validUnauthTenantId);

  const matchedScopedStore = React.useMemo(() => {
    if (!validUnauthTenantId) return null;
    const all = [...(storeDirectory || []), ...(availableTenants || [])];
    return all.find((t) => Number(t.id) === validUnauthTenantId) || null;
  }, [validUnauthTenantId, storeDirectory, availableTenants]);

  const landingLayoutMeta = resolveRouteLayoutMetadata('LANDING', {
    overrides: layoutMetaOverride,
  });

  return (
    <BodyLayoutWrapper
      layoutMeta={landingLayoutMeta}
      data-landing-theme={landingTheme}
      style={{ colorScheme: landingTheme }}
      className="bg-[#070A24] lt:bg-[#F7F8FF] text-slate-100 lt:text-slate-800 font-sans selection:bg-violet-500 selection:text-white"
      header={
        <Navbar
          activeNav={activeNav}
          navItems={landingNavItems}
          onNavigate={scrollToSection}
          onLogin={onGlobalLogin}
          onStartFreeTrial={() => openGetStartedWithPlan('TRIAL')}
          landingTheme={landingTheme}
          onToggleTheme={toggleLandingTheme}
        />
      }
      topBanner={
        hasActiveTenantScope ? (
          <ActiveTenantScopeBanner
            id="unauth-tenant-scope-banner"
            variant="landing"
            isSuperAdminScope={isSuperAdminUnauthScope}
            tenantId={isSuperAdminUnauthScope ? 0 : (validUnauthTenantId ?? 0)}
            scopeLabel={matchedScopedStore?.name || `Store #${validUnauthTenantId}`}
            primaryActionLabel={
              isSuperAdminUnauthScope
                ? 'Sign In to Control Panel'
                : `Sign In to ${matchedScopedStore?.name || 'Store'}`
            }
            onPrimaryAction={onGlobalLogin}
            clearActionLabel={isSuperAdminUnauthScope ? 'Clear Scope' : 'Clear Store Scope'}
            clearActionTitle={
              isSuperAdminUnauthScope
                ? 'Reset scope to null and view all stores'
                : 'Clear tenant scope and view all stores'
            }
            onClearScope={onClearTenantScope}
          />
        ) : null
      }
      footer={
        <footer id="global-public-footer" className="border-t border-white/10 lt:border-slate-200 bg-[#080A2A] lt:bg-[#F1F3FF] px-4 sm:px-8 py-4 text-xs text-slate-300 lt:text-slate-600">
          <div id="contact" className="scroll-mt-16 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4 text-center sm:text-left">
            <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
              <strong
                id="sarbaazsoft-credit-text"
                className="font-bold text-white lt:text-slate-900 tracking-wide"
              >
                SarbaazSoft Shoe POS
              </strong>
              <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-white/10 lt:bg-slate-200 text-indigo-300 lt:text-indigo-700 border border-white/10 lt:border-slate-300">
                {APP_VERSION}
              </span>
              {(platformOwnerEmail || platformOwnerPhone) ? (
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1 text-[11px] text-slate-300 lt:text-slate-600 sm:ml-2 sm:pl-3 sm:border-l sm:border-white/15 lt:sm:border-slate-300">
                  {platformOwnerEmail && (
                    <a
                      href={`mailto:${platformOwnerEmail}`}
                      className="inline-flex items-center gap-1 hover:text-white lt:hover:text-slate-900 transition-colors underline-offset-2 hover:underline"
                    >
                      <Mail className="w-3 h-3 shrink-0 text-purple-300 lt:text-purple-600" aria-hidden="true" />
                      <span>{platformOwnerEmail}</span>
                    </a>
                  )}
                  {platformOwnerPhone && (
                    <a
                      href={`tel:${platformOwnerPhone.replace(/\s+/g, '')}`}
                      className="inline-flex items-center gap-1 hover:text-white lt:hover:text-slate-900 transition-colors underline-offset-2 hover:underline"
                    >
                      <Phone className="w-3 h-3 shrink-0 text-purple-300 lt:text-purple-600" aria-hidden="true" />
                      <span>{platformOwnerPhone}</span>
                    </a>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openGetStartedWithPlan('TRIAL')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 lt:text-indigo-700 hover:text-white lt:hover:text-slate-900 sm:ml-2 sm:pl-3 sm:border-l sm:border-white/15 lt:sm:border-slate-300 transition-colors cursor-pointer"
                >
                  <Mail className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>Contact Support</span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-2.5 gap-y-1 text-[11px] sm:text-xs text-slate-400 lt:text-slate-500">
              <button
                type="button"
                onClick={() => setIsLicenseModalOpen(true)}
                className="hover:text-white lt:hover:text-slate-900 underline-offset-2 hover:underline transition-colors cursor-pointer whitespace-nowrap"
              >
                Software License
              </button>
              <span aria-hidden="true">·</span>
              <span>&copy; {new Date().getFullYear()} SarbaazSoft Shoe POS. All rights reserved.</span>
              <button
                type="button"
                onClick={onOpenSuperAdmin}
                className="text-slate-500 hover:text-white lt:text-slate-400 lt:hover:text-slate-800 transition cursor-pointer text-[10px] opacity-30 hover:opacity-100"
                title="SuperAdmin"
                aria-label="SuperAdmin"
              >
                &bull;
              </button>
            </div>
          </div>
        </footer>
      }
    >

      {/* 2. HERO */}
      <section id="home" className="relative overflow-hidden scroll-mt-14 sm:scroll-mt-16 bg-[linear-gradient(180deg,#0B0C38_0%,#080A2C_60%,#070A24_100%)] lt:bg-[linear-gradient(180deg,#EEF0FF_0%,#F7F8FF_100%)]">
        <div className="pointer-events-none absolute -top-24 right-[-6%] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(var(--primary-rgb,147,51,234),0.5),rgba(var(--brand-companion-rgb,79,70,229),0.1)_60%,transparent_70%)] lt:opacity-40 blur-2xl" aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 sm:pt-10 sm:pb-20 lg:pt-14 lg:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-[0.82fr_1.18fr] gap-12 sm:gap-14 lg:gap-6 items-center">
            <div>
              <div
                className="font-roboto brand-subtitle-roboto inline-flex items-center gap-2 rounded-full border border-indigo-400/40 lt:border-indigo-200 bg-indigo-500/10 lt:bg-indigo-50 px-3 sm:px-3.5 py-1 sm:py-1.5 text-[11px] sm:text-xs text-purple-100 lt:text-indigo-700"
                style={{ fontFamily: "'Roboto', system-ui, -apple-system, sans-serif" }}
              >
                <Zap className="w-3.5 h-3.5 shrink-0 text-purple-300 lt:text-purple-600" aria-hidden="true" />
                Retail &amp; Wholesale Footwear POS &middot; Offline-First &amp; WebUSB Ready
              </div>
              <h1 className="mt-5 text-[32px] sm:text-5xl lg:text-[54px] font-extrabold tracking-tight leading-[1.12] text-white lt:text-slate-900 text-balance">
                Running every Shoe stores{' '}
                <AnimatedHeroHighlight />
              </h1>
              <p className="mt-6 max-w-lg text-[15px] sm:text-base leading-relaxed text-slate-200 lt:text-slate-700">
                SarbaazSoft Shoe POS brings high-speed barcode checkout, carton-and-pair stock control, customer &amp; supplier khata ledgers, direct thermal receipt &amp; label printing, real-time push &amp; email alerts, and resilient offline billing—installable across Android, Apple iOS, and Windows.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3.5 sm:gap-4">
                <button
                  type="button"
                  onClick={() => openGetStartedWithPlan('TRIAL')}
                  className={`${primaryBtn} h-11 sm:h-12 px-6 sm:px-7 text-sm sm:text-base font-semibold tracking-normal`}
                >
                  <span>Start 30-Day Free Trial</span>
                  <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onGlobalLogin}
                  className={`${outlineBtn} h-11 sm:h-12 px-6 sm:px-7 text-sm sm:text-base font-semibold tracking-normal`}
                >
                  <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Store Login</span>
                </button>
              </div>
              <ul className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-5">
                {[
                  { icon: WifiOff, title: 'Offline-First Billing', desc: 'Queue sales offline; auto-sync online' },
                  { icon: Layers, title: 'Carton & Pair Engine', desc: 'Retail pairs, 12/16-pair packs & floor prices' },
                  { icon: Printer, title: 'Direct USB Printing', desc: 'ESC/POS receipts & TSPL barcode labels' },
                ].map(({ icon: Icon, title, desc }) => (
                  <li key={title} className="flex items-start gap-2.5">
                    <Icon className="w-5 h-5 mt-0.5 shrink-0 text-purple-300 lt:text-purple-600" aria-hidden="true" />
                    <span>
                      <span className="block text-xs font-semibold text-purple-300 lt:text-purple-600">{title}</span>
                      <span className="block text-[11px] leading-snug text-slate-400 lt:text-slate-600">{desc}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="pb-10 lg:pl-6">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* 3. FEATURES & OPERATIONAL BENEFITS */}
      <section id="features" className="scroll-mt-14 sm:scroll-mt-16 bg-[#080A2A] lt:bg-[#F1F3FF] py-12 sm:py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          <div className="lg:col-span-5">
            <div
              className="font-courgette inline-flex items-center gap-2 rounded-full border border-indigo-400/40 lt:border-indigo-200 bg-indigo-500/10 lt:bg-indigo-50 px-3.5 py-1.5 text-xs text-violet-200 lt:text-indigo-700"
              style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Built for Footwear Operations
            </div>
            <h2 className="mt-5 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-[1.15] text-white lt:text-slate-900">
              Complete control over sales, stock, khata, and store profit
            </h2>
            <p className="mt-4 max-w-md text-sm sm:text-base leading-relaxed text-slate-300 lt:text-slate-600">
              Whether you run a single-pair retail showroom, a carton wholesale warehouse, or a hybrid footwear business, every counter bill, return, supplier payment, and profit report stays synchronized automatically.
            </p>

            {/* Operational Benefits Highlights */}
            <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              {operationalBenefits.map((benefit) => (
                <li
                  key={benefit.title}
                  className="flex items-start gap-2.5 rounded-xl border border-indigo-400/20 lt:border-indigo-200/90 bg-white/[0.03] lt:bg-white/80 px-3.5 py-2.5"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-xs">
                    <Check className="w-3 h-3 stroke-[3]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white lt:text-slate-900">{benefit.title}</div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400 lt:text-slate-600">{benefit.desc}</p>
                  </div>
                </li>
              ))}
            </ul>

            {/* keep-dark:start */}
            <div className="mt-7 grid grid-cols-3 gap-3" aria-hidden="true">
              {/* Executive dashboard */}
              <div className="text-center">
                <div className="flex h-28 flex-col justify-between rounded-xl border border-indigo-400/25 bg-gradient-to-b from-[#12154A]/70 to-[#0A0C2E]/80 p-2 text-left">
                    <div className="flex items-center justify-between rounded bg-indigo-500/15 px-1.5 py-0.5 text-[7px] font-bold text-white">
                    <span>SarbaazSoft</span><span className="text-purple-300">KPIs</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="rounded border border-indigo-400/20 bg-[#080A2A] p-1">
                      <div className="text-[6px] text-slate-400">Today&apos;s sales</div>
                      <div className="text-[8px] font-extrabold text-white">Rs. 48,750</div>
                      <div className="text-[6px] font-bold text-emerald-400">+12%</div>
                    </div>
                    <div className="rounded border border-indigo-400/20 bg-[#080A2A] p-1">
                      <div className="text-[6px] text-slate-400">Orders</div>
                      <div className="text-[8px] font-extrabold text-white">36</div>
                      <div className="text-[6px] font-bold text-emerald-400">+8%</div>
                    </div>
                  </div>
                  <div className="flex h-7 items-end gap-1 px-1">
                    {['h-2 bg-purple-300/70', 'h-3 bg-purple-300', 'h-4 bg-purple-400', 'h-5 bg-purple-500', 'h-6 bg-indigo-500', 'h-7 bg-purple-600'].map((c) => <span key={c} className={`flex-1 rounded-t ${c}`} />)}
                  </div>
                </div>
                <div className="mt-2 text-xs font-semibold text-white lt:text-slate-800">Executive analytics</div>
              </div>

              {/* POS counter */}
              <div className="text-center">
                <div className="flex h-28 flex-col justify-between rounded-xl border border-indigo-400/25 bg-gradient-to-b from-[#12154A]/70 to-[#0A0C2E]/80 p-2 text-left">
                  <div className="flex items-center justify-between rounded bg-indigo-500/15 px-1.5 py-0.5 text-[7px] font-bold text-white">
                    <span>POS terminal</span><span className="hidden lg:inline text-emerald-400">F9</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <div key={n} className="flex h-6 items-center justify-center rounded border border-indigo-400/20 bg-[#080A2A] p-0.5"><SneakerGlyph /></div>
                    ))}
                  </div>
                  <div className="rounded bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 py-0.5 text-center text-[7px] font-bold text-white shadow-xs">Checkout · Rs. 16,699</div>
                </div>
                <div className="mt-2 text-xs font-semibold text-white lt:text-slate-800">POS counter</div>
              </div>

              {/* Barcode labels */}
              <div className="text-center">
                <div className="flex h-28 items-center justify-center rounded-xl border border-indigo-400/25 bg-gradient-to-b from-[#12154A]/70 to-[#0A0C2E]/80 p-2">
                  <div className="w-full rounded bg-slate-50 p-1.5 text-center">
                    <div className="text-[7px] font-extrabold text-slate-900">Shoe store</div>
                    <div className="text-[8px] font-black text-slate-900">HS-1021</div>
                    <div className="my-0.5 h-4 bg-[repeating-linear-gradient(90deg,#0f172a,#0f172a_1px,transparent_1px,transparent_3px)]" />
                    <div className="font-mono text-[6px] text-slate-600">0108923000012</div>
                  </div>
                </div>
                <div className="mt-2 text-xs font-semibold text-white lt:text-slate-800">Barcode labels</div>
              </div>
            </div>
            {/* keep-dark:end */}
          </div>

          <ul className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {featureItems.map((feat, index) => {
              const Icon = feat.icon;
              const spansRow = featureItems.length % 2 === 1 && index === featureItems.length - 1;
              return (
                <li
                  key={feat.title}
                  className={`flex items-start gap-3.5 rounded-2xl border border-indigo-400/25 lt:border-indigo-200 bg-gradient-to-b from-[#12154A]/70 lt:from-white to-[#0A0C2E]/80 lt:to-[#F3F4FF] p-4 shadow-[0_0_20px_rgba(var(--primary-rgb,147,51,234),0.08)] transition-colors hover:border-purple-400/60 ${spansRow ? 'sm:col-span-2' : ''}`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-400/30 lt:border-indigo-200 bg-indigo-500/15 lt:bg-indigo-100 text-purple-300 lt:text-purple-600">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <h3 className="text-sm font-bold text-white lt:text-slate-900">{feat.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400 lt:text-slate-500">{feat.desc}</p>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* 4. TRUST + STATS */}
      <section id="stores" ref={statsSectionRef} className="scroll-mt-14 sm:scroll-mt-16 bg-gradient-to-b from-[#0B0D38] lt:from-[#EEF0FF] to-[#080A2A] lt:to-[#F7F8FF] py-12 sm:py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex flex-col items-center">
            <div
              className="font-courgette inline-flex items-center gap-2 rounded-full border border-indigo-400/40 lt:border-indigo-200 bg-indigo-500/10 lt:bg-indigo-50 px-3.5 py-1.5 text-xs text-violet-200 lt:text-indigo-700"
              style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
            >
              <Store className="w-3.5 h-3.5" aria-hidden="true" /> Trusted by Footwear Retailers &amp; Wholesalers
            </div>
            <h2 className="mt-5 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight text-white lt:text-slate-900">
              Powering live shoe stores across retail and wholesale
            </h2>
            <p className="mt-4 max-w-2xl text-sm sm:text-base leading-relaxed text-slate-300 lt:text-slate-600">
              Boutique footwear counters, wholesale carton distributors, and hybrid showrooms rely on SarbaazSoft Shoe POS to bill faster, eliminate stock discrepancies, and keep every ledger up to date.
            </p>
            <dl className="mt-8 sm:mt-9 grid w-full max-w-3xl grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-5 sm:gap-x-0 sm:gap-y-6 px-2 sm:px-0">
              {[
                { label: 'Active stores', value: publicStats?.stores, prefix: '', suffix: '+' },
                { label: 'Footwear SKUs tracked', value: publicStats?.products, prefix: '', suffix: '+' },
                { label: 'Invoices today', value: publicStats?.invoicesToday, prefix: '', suffix: '+' },
                { label: 'Platform volume', value: publicStats?.platformRevenue, prefix: 'Rs. ', suffix: '' },
              ].map(({ label, value, prefix, suffix }, i) => (
                <div key={label} className={`sm:pr-4 ${i > 0 ? 'sm:pl-5 sm:border-l sm:border-white/10 lt:sm:border-slate-200' : ''}`}>
                  <dd className="order-1 text-xl sm:text-2xl font-extrabold tabular-nums text-purple-300 lt:text-purple-600">
                    {typeof value === 'number'
                      ? <AnimatedCounter target={value} startTime={statsAnimationStartTime} prefix={prefix} suffix={suffix} />
                      : <span aria-label="Loading statistic">—</span>}
                  </dd>
                  <dt className="mt-1 text-xs text-slate-400 lt:text-slate-500">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* 4b. SHOPS USING SARBAAZSOFT SHOE POS */}
      <section id="shops" className="bg-[#0B0D38] lt:bg-[#EEF0FF] border-y border-white/10 lt:border-slate-200 py-10 sm:py-12 lg:py-14 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <div
                className="font-courgette inline-flex items-center gap-2 rounded-full border border-indigo-400/40 lt:border-indigo-200 bg-indigo-500/10 lt:bg-indigo-50 px-3 py-1 text-xs text-violet-200 lt:text-indigo-700 font-semibold mb-2"
                style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
              >
                <Store className="w-3.5 h-3.5" aria-hidden="true" /> Live Store Directory
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white lt:text-slate-900">
                Footwear stores running on SarbaazSoft Shoe POS
              </h2>
              <p className="mt-1 text-sm text-slate-300 lt:text-slate-600">
                Select any registered retail or wholesale store below to open its dedicated counter sign-in portal.
              </p>
            </div>

            {/* JS Slider Navigation Buttons */}
            {storesForSlider.length > 0 && (
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <button
                  id="prevBtn"
                  type="button"
                  onClick={handlePrevSlide}
                  aria-label="Previous store"
                  className="w-10 h-10 rounded-xl border border-indigo-400/65 lt:border-indigo-400 bg-indigo-500/10 lt:bg-indigo-50/75 text-indigo-200 lt:text-indigo-700 hover:bg-purple-600 hover:text-white lt:hover:bg-purple-600 lt:hover:text-white hover:border-purple-400 lt:hover:border-purple-500 flex items-center justify-center transition-all cursor-pointer shadow-md shadow-indigo-950/30 lt:shadow-indigo-900/10 hover:shadow-lg hover:shadow-purple-500/25 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  id="nextBtn"
                  type="button"
                  onClick={handleNextSlide}
                  aria-label="Next store"
                  className="w-10 h-10 rounded-xl border border-indigo-400/65 lt:border-indigo-400 bg-indigo-500/10 lt:bg-indigo-50/75 text-indigo-200 lt:text-indigo-700 hover:bg-purple-600 hover:text-white lt:hover:bg-purple-600 lt:hover:text-white hover:border-purple-400 lt:hover:border-purple-500 flex items-center justify-center transition-all cursor-pointer shadow-md shadow-indigo-950/30 lt:shadow-indigo-900/10 hover:shadow-lg hover:shadow-purple-500/25 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Swiper Slider Container */}
          {storesForSlider.length > 0 ? (
            <div className="w-full relative pb-4 select-none">
              <Swiper
                onSwiper={(swiper) => {
                  swiperRef.current = swiper;
                }}
                modules={[Navigation, Autoplay, Pagination]}
                navigation={{
                  prevEl: '#prevBtn',
                  nextEl: '#nextBtn',
                }}
                autoplay={{
                  delay: 3500,
                  disableOnInteraction: false,
                  pauseOnMouseEnter: true,
                }}
                loop={storesForSlider.length >= 5}
                grabCursor={true}
                slidesPerView={1.2}
                spaceBetween={12}
                breakpoints={{
                  420: { slidesPerView: 1.8, spaceBetween: 14 },
                  560: { slidesPerView: 2.3, spaceBetween: 16 },
                  768: { slidesPerView: 3.1, spaceBetween: 18 },
                  1024: { slidesPerView: 4, spaceBetween: 20 },
                  1280: { slidesPerView: 5, spaceBetween: 22 },
                }}
                className="w-full !overflow-hidden py-3"
                aria-label="Retail stores currently registered in SarbaazSoft POS"
              >
                {storesForSlider.map((tenant, index) => (
                  <SwiperSlide
                    key={`${tenant.id || tenant.name}-${index}`}
                    className="!h-auto flex"
                  >
                    <StoreSliderCard
                      tenant={tenant}
                      index={index}
                      onSelect={onSelectStore}
                    />
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-indigo-400/30 lt:border-indigo-200/80 bg-white/5 lt:bg-white p-8 text-center text-slate-300 lt:text-slate-600">
              <Store className="w-8 h-8 mx-auto mb-2 text-indigo-400 opacity-70" />
              <div className="font-semibold text-base text-white lt:text-slate-800">No registered stores yet</div>
              <p className="mt-1 text-sm text-slate-400 lt:text-slate-500 max-w-md mx-auto">
                Be the first to register and have your shoe store featured in our live network!
              </p>
              <button
                type="button"
                onClick={() => setShowRequestModal(true)}
                className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
              >
                Register Your Store
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 5. PRICING */}
      <section id="pricing" className="scroll-mt-14 sm:scroll-mt-16 bg-[#080A2A] lt:bg-[#F1F3FF] py-12 sm:py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div
              className="font-courgette inline-flex rounded-full border border-indigo-400/40 lt:border-indigo-200 bg-indigo-500/10 lt:bg-indigo-50 px-3.5 py-1.5 text-xs text-violet-200 lt:text-indigo-700"
              style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
            >
              Simple, Transparent Pricing
            </div>
            <h2 className="mt-4 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white lt:text-slate-900">Choose the plan that fits your shoe store</h2>
            <p className="mt-2 max-w-2xl mx-auto text-sm sm:text-base text-slate-300 lt:text-slate-600">Start with a full-featured 30-day free trial—no credit card required. Every plan includes full POS, inventory, khata, printing, and reporting access.</p>
          </div>

          <div className="mx-auto mt-8 sm:mt-12 grid max-w-5xl grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 items-stretch">
            {[
              { id: 'TRIAL', name: '30-Day Free Trial', price: 'Free', cta: 'Start 30-Day Free Trial', note: 'Instant store setup with full features for 30 days. No credit card required.', popular: true },
              { id: '6_MONTHS_RS_10000', name: '6-Month Plan', price: 'Rs. 10,000', cta: 'Start 6-Month Plan', note: 'Flexible semi-annual billing for seasonal stores and growing counters.', popular: false },
              { id: '1_YEAR_RS_18000', name: 'Annual Plan', price: 'Rs. 18,000', cta: 'Start Annual Plan', note: 'Best value—save Rs. 2,000 per year with uninterrupted store operations.', popular: false },
            ].map((p) => (
              <div
                key={p.id}
                className={`relative flex flex-col rounded-2xl p-5 sm:p-7 ${p.popular
                  ? 'border-2 border-purple-400 bg-gradient-to-b from-[#1A1A66]/70 lt:from-purple-50 to-[#0A0C2E] lt:to-white shadow-[0_24px_70px_-20px_rgba(var(--primary-rgb,147,51,234),0.6)]'
                  : 'border border-indigo-400/25 lt:border-indigo-200 bg-gradient-to-b from-[#12154A]/60 lt:from-white to-[#0A0C2E] lt:to-white'}`}
              >
                {p.popular && (
                  <span
                    className="font-courgette absolute -top-3 left-1/2 -translate-x-1/2 rounded-md bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 px-3 py-0.5 text-[11px] font-bold text-white shadow-xs border border-purple-400/30 whitespace-nowrap"
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                  >
                    30 Days Free Access
                  </span>
                )}
                <h3 className="flex items-center gap-2 text-lg font-bold text-white lt:text-slate-900">
                  <Calendar className="w-5 h-5 text-purple-300 lt:text-purple-600" aria-hidden="true" /> {p.name}
                </h3>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-3xl sm:text-4xl font-extrabold tabular-nums text-white lt:text-slate-900">{p.price}</span>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-slate-200 lt:text-slate-700">
                  {planFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-xs"><Check className="w-3 h-3 stroke-[3]" aria-hidden="true" /></span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <button
                    type="button"
                    onClick={() => openGetStartedWithPlan(p.id)}
                    className={`${p.popular ? primaryBtn : outlineBtn} w-full py-3 text-sm`}
                  >
                    {p.cta}
                  </button>
                  <p className="mt-3 text-center text-xs leading-relaxed text-slate-400 lt:text-slate-500">{p.note}</p>
                  <div className="mt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setIsLicenseModalOpen(true)}
                      className="text-[11px] font-medium text-indigo-300 lt:text-indigo-600 hover:text-white lt:hover:text-indigo-800 underline underline-offset-2 transition-colors cursor-pointer"
                    >
                      View Software License
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-3xl mx-auto text-center text-[11px] sm:text-xs text-slate-400 lt:text-slate-500 leading-relaxed">
            Displayed paid plan rates are introductory promotional prices subject to change without prior notice under the{' '}
            <button
              type="button"
              onClick={() => setIsLicenseModalOpen(true)}
              className="text-indigo-300 lt:text-indigo-600 hover:underline underline-offset-2 font-medium cursor-pointer"
            >
              Software License Agreement
            </button>
            .
          </p>
        </div>
      </section>

      {/* 6. ABOUT / CTA BANNER */}
      <section
        id="about"
        className="relative overflow-hidden scroll-mt-14 sm:scroll-mt-16 border-y border-indigo-400/20 lt:border-indigo-300/60 bg-[#080A2A] py-10 sm:py-12"
      >
        {/* Full-width darkened showroom background */}
        <div className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <img
            src={effectiveBackdropImage && !ctaBackdropFailed ? effectiveBackdropImage : shoeStoreBg}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => {
              if (effectiveBackdropImage && !ctaBackdropFailed) {
                setCtaBackdropFailed(true);
              }
            }}
            className="w-full h-full object-cover object-center opacity-70 lt:opacity-75"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#080A2A]/65 via-[#080A2A]/40 to-[#080A2A]/55" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(var(--primary-rgb,147,51,234),0.14),transparent_60%)] opacity-60" aria-hidden="true" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left max-w-2xl">
            <h2
              className="font-courgette text-xl sm:text-2xl lg:text-[28px] lt:text-2xl lt:sm:text-3xl lt:lg:text-4xl font-extrabold tracking-tight text-white [text-shadow:0_2px_14px_rgba(5,7,27,0.95)]"
              style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
            >
              Modernize your shoe counter, stockroom, and khata today
            </h2>
            <p className="mt-2 text-xs sm:text-sm font-medium leading-relaxed text-slate-200 [text-shadow:0_1px_10px_rgba(5,7,27,0.9)]">
              Create your dedicated store workspace in minutes—install on Android, Apple iOS, or Windows, bill offline or online, print barcode labels and thermal receipts, and track every pair, carton, and rupee in real time.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openGetStartedWithPlan('TRIAL')}
            className={`${primaryBtn} px-7 py-3.5 text-sm shrink-0`}
          >
            Start Your 30-Day Free Trial <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* STEP-BY-STEP FREE TRIAL ONBOARDING WIZARD */}
      <FreeTrialOnboardingModal
        isOpen={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        initialPlan={plan}
        storeDirectory={storeDirectory}
        platformOwnerEmail={platformOwnerEmail}
        platformOwnerPhone={platformOwnerPhone}
        onStoreCreated={handleStoreCreated}
        theme={landingTheme}
        onToggleTheme={toggleLandingTheme}
      />

      <LicenseAgreementModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
        theme={landingTheme}
      />

    </BodyLayoutWrapper>
  );
};
