import React, { Suspense, lazy, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LogIn,
  ArrowRight,
  ChevronRight,
  Sparkles,
  Sun,
  Moon,
  Monitor,
  Home,
  Tag,
  Info,
  Mail,
  X,
  Menu,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoeIcon, TinyShoeIcon } from '../common/ShoeIcon.tsx';
import { ShowroomBackground } from '../common/ShowroomBackground.tsx';
import { ThemeDropdown } from '../common/ThemeDropdown.tsx';
import { renderBrandName } from '../common/PublicHeader.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { usePWAInstall, resolveDetectedInstallPlatform } from '../../hooks/usePWAInstall.ts';
import { APP_VERSION } from '../../version.ts';

const InstallAppModal = lazy(() =>
  import('../common/InstallAppModal.tsx').then((m) => ({ default: m.InstallAppModal }))
);

export interface NavItem {
  key: string;
  label: string;
  section: string;
}

export interface NavbarProps {
  storeName?: string;
  subtitle?: string;
  mobileSubtitle?: string;
  badgeText?: string;
  badgeVariant?: 'online' | 'wizard' | 'connecting' | 'locked';
  activeNav?: string;
  navItems?: readonly NavItem[] | NavItem[];
  onNavigate?: (section: string, navKey: any) => void;
  onLogin?: () => void;
  onStartFreeTrial?: () => void;
  landingTheme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', section: 'top' },
  { key: 'features', label: 'Features', section: 'features' },
  { key: 'pricing', label: 'Pricing', section: 'pricing' },
  { key: 'stores', label: 'Stores', section: 'stores' },
  { key: 'about', label: 'About', section: 'about' },
];

interface MobileSidebarSection {
  header: string;
  items: Array<{
    key: 'home' | 'features' | 'pricing' | 'about' | 'contact';
    label: string;
    anchor: string;
    icon: React.ElementType;
  }>;
}

const MOBILE_SIDEBAR_SECTIONS: MobileSidebarSection[] = [
  {
    header: 'EXPLORE',
    items: [
      { key: 'home', label: 'Home', anchor: 'home', icon: Home },
      { key: 'features', label: 'Features', anchor: 'features', icon: Sparkles },
      { key: 'pricing', label: 'Pricing', anchor: 'pricing', icon: Tag },
    ],
  },
  {
    header: 'COMPANY',
    items: [
      { key: 'about', label: 'About', anchor: 'about', icon: Info },
      { key: 'contact', label: 'Contact', anchor: 'contact', icon: Mail },
    ],
  },
];

function resolveMobileSubtitle(fullSubtitle: string, explicitMobileSubtitle?: string): string {
  if (explicitMobileSubtitle && explicitMobileSubtitle.trim()) {
    return explicitMobileSubtitle.trim();
  }
  const clean = String(fullSubtitle || '').trim();
  if (!clean) return 'Footwear POS';
  if (/retail\s*&\s*wholesale/i.test(clean) && /dual/i.test(clean)) {
    return 'Dual-Engine POS';
  }
  if (/retail\s*&\s*wholesale\s*footwear\s*pos/i.test(clean)) {
    return 'Footwear POS';
  }
  const bulletParts = clean.split(/[•|·]/).map((s) => s.trim()).filter(Boolean);
  if (bulletParts.length > 1) {
    return bulletParts[0];
  }
  return clean.length > 22 ? `${clean.slice(0, 20).trim()}…` : clean;
}

export const Navbar: React.FC<NavbarProps> = ({
  storeName = 'SarbaazSoft Shoe POS',
  subtitle = 'Retail & Wholesale Footwear POS',
  mobileSubtitle,
  activeNav = 'home',
  navItems = DEFAULT_NAV_ITEMS,
  onNavigate,
  onLogin,
  onStartFreeTrial,
  landingTheme,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const { theme, themeMode, setThemeMode, accentPalette, backdropStyle } = useTheme();
  const { isAndroid, isIOS, isIOSSafari, isSafari, isWindows, isInstalled } = usePWAInstall();
  const detectedInstall = resolveDetectedInstallPlatform({
    isAndroid,
    isIOS,
    isIOSSafari,
    isSafari,
    isWindows,
  });
  const compactSubtitle = resolveMobileSubtitle(subtitle, mobileSubtitle);

  // Determine effective theme mode (light vs dark) and backdrop mode
  const isDark = (landingTheme ?? theme) === 'dark';
  const isSolidBackdrop = backdropStyle === 'solid';
  const isSolidLight = isSolidBackdrop && !isDark;
  const navGlassAlpha = 0.5;
  const headerGlassAlpha = 0.5;

  // Close tablet drawer on desktop (>= lg) or mobile (< sm) resize, and close mobile sidebar on >= sm
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024 || window.innerWidth < 640) {
        setMobileMenuOpen(false);
      }
      if (window.innerWidth >= 640) {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close active drawer/sidebar on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileSidebarOpen) setMobileSidebarOpen(false);
        if (mobileMenuOpen) setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen, mobileSidebarOpen]);

  // Lock body scroll when tablet drawer or mobile sidebar is open
  useEffect(() => {
    if (mobileMenuOpen || mobileSidebarOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [mobileMenuOpen, mobileSidebarOpen]);

  const handleNavClick = (section: string, key: string) => {
    setMobileMenuOpen(false);
    setMobileSidebarOpen(false);
    onNavigate?.(section, key);
  };

  const handleMobileSidebarAnchorClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    anchor: string,
    key: string
  ) => {
    e.preventDefault();
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
    setMobileSidebarOpen(false);
    onNavigate?.(anchor, key);
  };

  const renderMobileSidebar = () => {
    const drawer = (
      <AnimatePresence>
        {mobileSidebarOpen && (
          <div
            id="landing-mobile-sidebar"
            className="fixed inset-0 z-[60] sm:hidden flex no-print"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation Sidebar"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
              aria-hidden="true"
            />

            {/* Full-Height Store & SuperAdmin-Inspired Sidebar Drawer */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="relative w-72 max-w-[85vw] h-full max-h-dvh shadow-2xl z-10 overflow-hidden rounded-none border-r border-indigo-500/20"
            >
              <div
                data-backdrop-style={backdropStyle}
                className={`sidebar-showroom-shell relative w-full h-full max-h-dvh flex flex-col select-none shadow-lg rounded-none overflow-hidden transition-colors ${
                  isSolidLight
                    ? 'bg-white text-slate-900 border-r border-slate-200'
                    : isSolidBackdrop
                    ? 'bg-[#0A0E1A] text-slate-100 border-r border-[#1A263D]'
                    : 'bg-[#080A2A] text-slate-100 border-r border-indigo-400/25'
                }`}
              >
                <ShowroomBackground contained={true} intensity="portal" scope="sidebar" />

                <div className="relative z-10 flex-1 min-h-0 flex flex-col">
                  {/* TOP: Compact Brand Header aligned with Store & SuperAdmin sidebars (h-[3.6rem]) */}
                  <div
                    style={
                      !isSolidBackdrop
                        ? { backgroundColor: `rgba(8, 10, 42, ${headerGlassAlpha})` }
                        : undefined
                    }
                    className={`h-[3.6rem] flex items-center justify-between gap-2 px-3.5 shrink-0 transition-colors ${
                      isSolidLight
                        ? 'border-b border-slate-200 bg-white'
                        : isSolidBackdrop
                        ? 'border-b border-[#1A263D] bg-[#0A0E1A]'
                        : 'border-b border-indigo-400/20 backdrop-blur-md'
                    }`}
                  >
                    <a
                      href="#home"
                      onClick={(e) => handleMobileSidebarAnchorClick(e, 'home', 'home')}
                      className="flex items-center gap-2.5 min-w-0 flex-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                    >
                      <div
                        className={`w-9 h-9 rounded-xl bg-white dark:bg-slate-900 border shrink-0 shadow-xs flex items-center justify-center overflow-hidden ${
                          isSolidLight ? 'border-slate-200' : 'border-indigo-400/30'
                        }`}
                      >
                        <ShoeIcon
                          src="/pwa-192x192.png"
                          alt={`${storeName} Logo`}
                          className="w-full h-full object-cover rounded-xl"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs font-bold truncate tracking-tight leading-tight ${
                            isSolidLight ? 'text-slate-900' : 'text-white'
                          }`}
                        >
                          {storeName}
                        </div>
                        <div
                          className={`text-[10px] font-medium truncate mt-0.5 flex items-center gap-1 ${
                            isSolidLight ? 'text-slate-500' : 'text-indigo-200/80'
                          }`}
                        >
                          <TinyShoeIcon className="w-3 h-3 shrink-0 text-purple-400" />
                          <span className="truncate">{compactSubtitle}</span>
                        </div>
                      </div>
                    </a>

                    <button
                      id="landing-mobile-sidebar-close-btn"
                      type="button"
                      onClick={() => setMobileSidebarOpen(false)}
                      className={`w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                        isSolidLight
                          ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                          : 'text-slate-300 hover:text-white hover:bg-white/10'
                      }`}
                      aria-label="Close Mobile Navigation"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* MIDDLE: Organized Anchor Links (Home, Features, Pricing, About, Contact) */}
                  <nav
                    aria-label="Mobile Landing Navigation"
                    style={
                      !isSolidBackdrop
                        ? { backgroundColor: `rgba(8, 10, 42, ${navGlassAlpha})` }
                        : undefined
                    }
                    className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden sidebar-scrollbar py-3 px-3 space-y-4 transition-colors ${
                      isSolidLight
                        ? 'bg-white'
                        : isSolidBackdrop
                        ? 'bg-[#0A0E1A]'
                        : 'backdrop-blur-md'
                    }`}
                  >
                    {MOBILE_SIDEBAR_SECTIONS.map((section) => (
                      <div key={section.header} className="space-y-1">
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                            isSolidLight
                              ? 'text-slate-400'
                              : 'text-indigo-200/80 [text-shadow:0_1px_6px_rgba(5,7,27,0.9)]'
                          }`}
                        >
                          {section.header}
                        </div>

                        <div className="space-y-1">
                          {section.items.map((item) => {
                            const ItemIcon = item.icon;
                            const isActive = activeNav === item.key;

                            return (
                              <a
                                key={item.key}
                                id={`landing-mobile-nav-${item.key}`}
                                href={`#${item.anchor}`}
                                onClick={(e) => handleMobileSidebarAnchorClick(e, item.anchor, item.key)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`relative w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-xl text-xs font-medium cursor-pointer group transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                                  isActive
                                    ? 'text-white font-bold'
                                    : isSolidLight
                                    ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                                    : 'text-slate-100 hover:text-white hover:bg-white/10 [text-shadow:0_1px_6px_rgba(5,7,27,0.85)]'
                                }`}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="landingMobileActiveNavPill"
                                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 border border-purple-400/45 shadow-md shadow-purple-600/25"
                                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                  />
                                )}

                                <div className="relative z-10 flex items-center gap-3 truncate">
                                  <ItemIcon
                                    className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                                      isActive
                                        ? 'text-white'
                                        : isSolidLight
                                        ? 'text-slate-500 group-hover:text-slate-900 group-hover:translate-x-0.5'
                                        : 'text-indigo-200/90 group-hover:text-white group-hover:translate-x-0.5'
                                    }`}
                                  />
                                  <span className="truncate">{item.label}</span>
                                </div>

                                <ChevronRight
                                  className={`relative z-10 w-4 h-4 shrink-0 transition-opacity ${
                                    isActive
                                      ? 'text-white opacity-95'
                                      : isSolidLight
                                      ? 'text-slate-400 opacity-70 group-hover:opacity-100'
                                      : 'text-indigo-200/70 opacity-60 group-hover:opacity-100'
                                  }`}
                                />
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </nav>

                  {/* BOTTOM: Prominent CTAs, Theme & Color Selector, App Version */}
                  <div
                    style={
                      !isSolidBackdrop
                        ? { backgroundColor: `rgba(8, 10, 42, ${navGlassAlpha})` }
                        : undefined
                    }
                    className={`mt-auto shrink-0 p-3.5 pt-3 space-y-2.5 transition-colors ${
                      isSolidLight
                        ? 'border-t border-slate-200 bg-slate-50/95'
                        : isSolidBackdrop
                        ? 'border-t border-[#1A263D] bg-[#0A0E1A]'
                        : 'border-t border-indigo-400/20 backdrop-blur-md'
                    }`}
                  >
                    {/* Register Free Trial & Login Action Buttons */}
                    <div className="space-y-2">
                      {onStartFreeTrial && (
                        <button
                          id="landing-mobile-sidebar-trial-btn"
                          type="button"
                          onClick={() => {
                            if (typeof document !== 'undefined') {
                              document.body.style.overflow = '';
                            }
                            setMobileSidebarOpen(false);
                            onStartFreeTrial();
                          }}
                          className="w-full min-h-[44px] px-3 py-2.5 text-xs font-semibold tracking-normal flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white border border-purple-400/40 shadow-md shadow-purple-600/30 transition-all cursor-pointer active:scale-[0.98]"
                        >
                          <Sparkles className="w-4 h-4 text-purple-200 shrink-0" />
                          <span>Register Free Trial</span>
                          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      )}

                      {onLogin && (
                        <button
                          id="landing-mobile-sidebar-login-btn"
                          type="button"
                          onClick={() => {
                            if (typeof document !== 'undefined') {
                              document.body.style.overflow = '';
                            }
                            setMobileSidebarOpen(false);
                            onLogin();
                          }}
                          className={`w-full min-h-[44px] px-3 py-2.5 text-xs font-semibold tracking-normal flex items-center justify-center gap-2 rounded-xl border shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98] ${
                            isSolidLight
                              ? 'border-indigo-400 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 hover:border-indigo-600'
                              : 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25 hover:text-white hover:border-purple-400'
                          }`}
                        >
                          <LogIn className="w-4 h-4 shrink-0" />
                          <span>Login</span>
                        </button>
                      )}
                    </div>

                    {/* Dynamic Install App Trigger (mirrors Store Sidebar UI, filtered to runtime platform) */}
                    <button
                      id="landing-mobile-sidebar-install-btn"
                      type="button"
                      data-pwa-manual-install="true"
                      onClick={() => {
                        if (typeof document !== 'undefined') {
                          document.body.style.overflow = '';
                        }
                        setMobileSidebarOpen(false);
                        setIsInstallModalOpen(true);
                      }}
                      className={`w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl border transition cursor-pointer group shadow-xs ${
                        isSolidLight
                          ? 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-800'
                          : 'bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-400/30 text-indigo-100'
                      }`}
                      title={detectedInstall.tooltip}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Download
                          className={`w-3.5 h-3.5 group-hover:scale-110 transition shrink-0 ${
                            isSolidLight ? 'text-purple-600' : 'text-indigo-200'
                          }`}
                        />
                        <span className="text-[11px] font-bold truncate">{detectedInstall.buttonLabel}</span>
                      </div>
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                          isSolidLight
                            ? 'bg-white text-purple-700 border-purple-200'
                            : 'bg-white/15 text-indigo-100 border-indigo-300/30'
                        }`}
                      >
                        {isInstalled ? 'Installed' : detectedInstall.badgeLabel}
                      </span>
                    </button>

                    {/* Existing Theme & Color Selection Menu (opens cleanly upward inside sidebar) */}
                    <div className="pt-0.5">
                      <ThemeDropdown
                        id="landing-mobile-sidebar-theme-dropdown"
                        dropdownAlign="left"
                        dropdownDirection="up"
                        showLabel={true}
                        alwaysShowLabel={true}
                        fullWidth={true}
                        menuClassName="w-full min-w-0 max-w-full"
                        triggerClassName={(open) =>
                          `w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                            open
                              ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white border-purple-400/50 shadow-md shadow-purple-600/25'
                              : isSolidLight
                              ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-800'
                              : 'bg-white/10 hover:bg-white/16 border-indigo-400/25 text-slate-100'
                          }`
                        }
                      />
                    </div>

                    {/* Footer Attribution matching Store & SuperAdmin sidebars */}
                    <div
                      className={`px-1 pt-1.5 border-t flex items-center justify-between text-[9.5px] ${
                        isSolidLight
                          ? 'border-slate-200 text-slate-500'
                          : 'border-indigo-400/20 text-slate-300/80'
                      }`}
                    >
                      <span>SarbaazSoft Shoe POS</span>
                      <span className="font-mono">{APP_VERSION}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    );

    if (typeof document !== 'undefined' && document.body) {
      return createPortal(drawer, document.body);
    }
    return drawer;
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full backdrop-blur-md select-none transition-colors duration-200 border-b ${
        isDark
          ? 'bg-[#070A24]/95 border-indigo-500/20 text-[#f8fafc] shadow-lg shadow-black/20'
          : 'bg-white/95 border-indigo-500/20 text-slate-900 shadow-xs'
      }`}
      aria-label="Main Navigation"
    >
      {/* ========================================================
          MOBILE-ONLY (< sm): Compact Top Bar + Store/SuperAdmin-Style Sidebar
         ======================================================== */}
      <div className="sm:hidden px-3 h-14 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            id="landing-mobile-sidebar-toggle"
            onClick={() => setMobileSidebarOpen(true)}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-all cursor-pointer border shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
              isDark
                ? 'bg-slate-800/80 text-slate-200 hover:text-white border-slate-700/60'
                : 'bg-slate-100 text-slate-800 hover:text-slate-900 border-slate-200'
            }`}
            aria-expanded={mobileSidebarOpen}
            aria-controls="landing-mobile-sidebar"
            aria-label="Open navigation sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <a
            href="#home"
            onClick={(e) => handleMobileSidebarAnchorClick(e, 'home', 'home')}
            className="flex items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-lg py-0.5 px-0.5 cursor-pointer min-w-0 flex-1"
            aria-label={`${storeName} Home`}
          >
            <div className="w-8.5 h-8.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-500/25 shrink-0 shadow-xs flex items-center justify-center overflow-hidden">
              <ShoeIcon
                src="/pwa-192x192.png"
                alt={`${storeName} Logo`}
                className="w-full h-full object-cover rounded-xl"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-900 dark:text-white text-[13px] min-[375px]:text-sm tracking-tight leading-tight truncate block">
                {storeName}
              </div>
              <div className="text-[10.5px] text-slate-500 dark:text-indigo-200/70 font-medium flex items-center gap-1 min-w-0 mt-0.5">
                <TinyShoeIcon className="w-3 h-3 shrink-0 text-purple-600 dark:text-purple-400" />
                <span className="truncate">{compactSubtitle}</span>
              </div>
            </div>
          </a>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="relative font-courgette font-courgate theme-dropdown-courgette"
            style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
          >
            <ThemeDropdown
              id="landing-mobile-navbar-theme-dropdown"
              dropdownAlign="right"
              dropdownDirection="down"
              showLabel={true}
              font="courgette"
              className="font-courgette font-courgate theme-dropdown-courgette"
              triggerClassName={(open) =>
                `h-11 min-w-[44px] flex items-center justify-center gap-1.5 px-2.5 rounded-xl border text-xs font-semibold tracking-normal transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] ${
                  open
                    ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white border-purple-400/50 shadow-md shadow-purple-600/25 ring-2 ring-purple-400/40'
                    : isDark
                    ? 'border-slate-700/80 bg-slate-800/50 hover:bg-slate-800 text-slate-100 hover:text-white hover:border-purple-500/50'
                    : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-900 hover:border-purple-300'
                }`
              }
            />
          </div>
        </div>
      </div>

      {/* ========================================================
          TABLET & DESKTOP (>= sm): Existing Header Preserved Unchanged
         ======================================================== */}
      <div className="hidden sm:block">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between min-h-[3.75rem] sm:min-h-[4rem] py-2 gap-2.5 sm:gap-4">
          
          {/* ========================================================
              LEFT: HAMBURGER + BRANDING (Shrink-safe on mobile/tablet)
             ======================================================== */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 lg:flex-initial lg:shrink-0">
            {/* Mobile & Tablet Hamburger Button (Screens < lg) */}
            <div className="flex lg:hidden shrink-0">
              <button
                type="button"
                id="landing-mobile-menu-toggle"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl transition-all cursor-pointer border focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                  isDark
                    ? 'bg-slate-800/80 text-slate-200 hover:text-white border-slate-700/60'
                    : 'bg-slate-100 text-slate-800 hover:text-slate-900 border-slate-200'
                }`}
                aria-expanded={mobileMenuOpen}
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              >
                {/* Morphing hamburger lines */}
                <div className="w-4.5 h-3.5 sm:w-5 sm:h-4 relative flex flex-col justify-between items-center" aria-hidden="true">
                  <span
                    className={`block h-0.5 w-full rounded-full transition-all duration-300 ease-out origin-center ${
                      mobileMenuOpen
                        ? 'rotate-45 translate-y-[6px] sm:translate-y-[7px] bg-purple-600 dark:bg-purple-400'
                        : isDark ? 'bg-slate-200' : 'bg-slate-800'
                    }`}
                  />
                  <span
                    className={`block h-0.5 w-full rounded-full transition-all duration-200 ease-out ${
                      mobileMenuOpen ? 'opacity-0 scale-x-0' : isDark ? 'bg-slate-200' : 'bg-slate-800'
                    }`}
                  />
                  <span
                    className={`block h-0.5 w-full rounded-full transition-all duration-300 ease-out origin-center ${
                      mobileMenuOpen
                        ? '-rotate-45 -translate-y-[6px] sm:-translate-y-[7px] bg-purple-600 dark:bg-purple-400'
                        : isDark ? 'bg-slate-200' : 'bg-slate-800'
                    }`}
                  />
                </div>
              </button>
            </div>

            {/* Brand identity & titles matching PublicHeader without badge */}
            <button
              type="button"
              onClick={() => handleNavClick('top', 'home')}
              className="flex items-center gap-2 sm:gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-lg py-0.5 px-0.5 sm:p-1 cursor-pointer min-w-0 max-w-full hover:opacity-90 transition-opacity"
              aria-label={`${storeName} Home`}
            >
              {/* Brand Emblem matching PublicHeader and store sidebars */}
              <div className="w-8.5 h-8.5 sm:w-10 sm:h-10 rounded-xl bg-white dark:bg-slate-900 border border-indigo-500/25 shrink-0 shadow-xs flex items-center justify-center overflow-hidden">
                <ShoeIcon src="/pwa-192x192.png" alt={`${storeName} Logo`} className="w-full h-full object-cover rounded-xl" />
              </div>

              {/* Brand Typography aligned with PublicHeader */}
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900 dark:text-white text-[13px] min-[375px]:text-sm sm:text-base tracking-tight leading-tight truncate block">
                  {renderBrandName(storeName)}
                </div>
                <div className="text-[10.5px] sm:text-xs text-slate-500 dark:text-indigo-200/70 font-medium flex items-center gap-1 sm:gap-1.5 min-w-0 mt-0.5 tracking-normal">
                  <TinyShoeIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-purple-600 dark:text-purple-400" />
                  <span className="sm:hidden truncate">{compactSubtitle}</span>
                  <span className="hidden sm:inline truncate lg:max-w-[180px] xl:max-w-none">{subtitle}</span>
                </div>
              </div>
            </button>
          </div>

          {/* ========================================================
              CENTER: NAVIGATION LINKS (Courgette / Courgate Font, Desktop >= lg)
              Clean, medium-weight links with app purple/indigo accent
             ======================================================== */}
          <nav className="hidden lg:flex items-center gap-0.5 xl:gap-2 shrink-0 font-courgette font-courgate nav-link-courgette">
            {navItems.map((item) => {
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleNavClick(item.section, item.key)}
                  style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                  className={`nav-link relative px-2.5 xl:px-3.5 py-2 text-[15px] xl:text-lg font-normal tracking-wide transition-colors duration-200 rounded-lg cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 font-courgette font-courgate nav-link-courgette ${
                    isActive
                      ? isDark
                        ? 'text-white font-bold'
                        : 'text-purple-700 font-bold'
                      : isDark
                      ? 'text-slate-200 hover:text-white'
                      : 'text-black hover:text-purple-600'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                    className="nav-link relative z-10 transition-colors duration-200 group-hover:text-purple-600 dark:group-hover:text-purple-400 font-courgette font-courgate nav-link-courgette"
                  >
                    {item.label}
                  </span>

                  {/* Active / Hover underline accent in app's Purple/Indigo brand color */}
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 shadow-[0_2px_8px_rgba(var(--primary-rgb,147,51,234),)]"
                      aria-hidden="true"
                    />
                  )}
                  {!isActive && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-center"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* ========================================================
              RIGHT: 3-WAY THEME DROPDOWN + CTAs
              (Symmetric outer margin matching mobile hamburger)
             ======================================================== */}
          <div className="flex items-center gap-2 lg:gap-2.5 shrink-0">
            {/* 3-Way Theme Dropdown Menu (Light, Dark, System) */}
            <div
              className="relative font-courgette font-courgate theme-dropdown-courgette"
              style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
            >
              <ThemeDropdown
                id="landing-navbar-theme-dropdown"
                dropdownAlign="right"
                showLabel={true}
                font="courgette"
                className="font-courgette font-courgate theme-dropdown-courgette"
                triggerClassName={(open) =>
                  `h-9 sm:h-10 lg:h-9.5 min-w-[44px] sm:min-w-0 flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 xl:px-3.5 rounded-xl border text-xs lg:text-sm font-semibold tracking-normal transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] ${
                    open
                      ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 text-white border-purple-400/50 shadow-md shadow-purple-600/25 ring-2 ring-purple-400/40'
                      : isDark
                      ? 'border-slate-700/80 bg-slate-800/50 hover:bg-slate-800 text-slate-100 hover:text-white hover:border-purple-500/50'
                      : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-900 hover:border-purple-300'
                  }`
                }
              />
            </div>

            {/* Desktop Action Buttons (>= lg) */}
            <div className="hidden lg:flex items-center gap-2 xl:gap-2.5 font-courgette">
              {onLogin && (
                <button
                  type="button"
                  onClick={onLogin}
                  className={`inline-flex items-center justify-center gap-1.5 xl:gap-2 rounded-xl h-9.5 px-3 xl:px-4 text-xs xl:text-sm font-semibold tracking-normal transition-all cursor-pointer whitespace-nowrap border shadow-sm hover:shadow-md active:scale-[0.98] font-courgette ${
                    isDark
                      ? 'border-indigo-400/70 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200 hover:text-white hover:border-purple-400 shadow-indigo-950/30 hover:shadow-purple-500/20'
                      : 'border-indigo-400 bg-indigo-50/75 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-800 hover:border-indigo-600 shadow-indigo-900/10 hover:shadow-indigo-900/15'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5 xl:w-4 xl:h-4 shrink-0" />
                  <span>Login</span>
                </button>
              )}

              {onStartFreeTrial && (
                <button
                  type="button"
                  onClick={onStartFreeTrial}
                  className="inline-flex items-center justify-center gap-1.5 xl:gap-2 rounded-xl h-9.5 px-3 xl:px-4 text-xs xl:text-sm font-semibold tracking-normal bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:via-indigo-700 hover:to-purple-800 active:from-purple-800 active:to-indigo-800 text-white border border-purple-400/40 shadow-md shadow-purple-600/25 transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] font-courgette"
                >
                  <span>Free Trial</span>
                  <ArrowRight className="w-3.5 h-3.5 xl:w-4 xl:h-4 shrink-0" />
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ========================================================
          MOBILE & TABLET VIEWPORT: Responsive Animated Drawer & Backdrop
         ======================================================== */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop overlay to dismiss menu on tap */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-x-0 top-[3.75rem] sm:top-[4rem] bottom-0 bg-black/60 backdrop-blur-xs z-30 lg:hidden"
              aria-hidden="true"
            />

            {/* Slide-down mobile & tablet drawer */}
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`absolute top-full left-0 right-0 z-40 lg:hidden border-b shadow-2xl px-4 sm:px-6 pt-3.5 pb-6 space-y-4 max-h-[calc(100dvh-4.5rem)] overflow-y-auto font-courgette ${
                isDark
                  ? 'bg-[#070A24] border-indigo-950/70 text-[#f8fafc]'
                  : 'bg-white border-slate-200 text-black'
              }`}
            >
              {/* Navigation links */}
              <nav className="flex flex-col space-y-1 font-courgette font-courgate nav-link-courgette">
                <div
                  className={`px-2 pb-1.5 text-xs font-semibold tracking-wider uppercase font-courgette font-courgate ${
                    isDark ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  Menu Navigation
                </div>
                {navItems.map((item) => {
                  const isActive = activeNav === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleNavClick(item.section, item.key)}
                      style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                      className={`nav-link w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-lg font-normal transition-all cursor-pointer font-courgette font-courgate nav-link-courgette ${
                        isActive
                          ? isDark
                            ? 'bg-slate-800/90 text-white font-bold border-l-4 border-purple-500'
                            : 'bg-purple-50 text-purple-700 font-bold border-l-4 border-purple-600'
                          : isDark
                          ? 'text-slate-200 hover:bg-slate-800/50 hover:text-white'
                          : 'text-black hover:bg-slate-100 hover:text-purple-600'
                      }`}
                    >
                      <span
                        style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                        className="nav-link flex items-center gap-2 font-courgette font-courgate nav-link-courgette"
                      >
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-600 dark:bg-purple-400 shadow-[0_0_6px_rgba(var(--primary-rgb,147,51,234),)]" />
                        )}
                        <span style={{ fontFamily: "'Courgette', cursive, sans-serif" }} className="nav-link font-courgette font-courgate nav-link-courgette">
                          {item.label}
                        </span>
                      </span>
                      <ChevronRight
                        className={`w-4 h-4 opacity-50 ${
                          isActive ? 'text-purple-600 dark:text-purple-400 opacity-100' : ''
                        }`}
                      />
                    </button>
                  );
                })}
              </nav>

              {/* Mobile Quick Action CTAs */}
              <div
                className={`pt-2 border-t flex flex-col gap-2.5 font-courgette ${
                  isDark ? 'border-indigo-950/70' : 'border-slate-200'
                }`}
              >
                {onStartFreeTrial && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onStartFreeTrial();
                    }}
                    className="w-full h-11 text-sm font-semibold tracking-normal flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-600/30 transition-all cursor-pointer active:scale-[0.98] font-courgette"
                  >
                    <Sparkles className="w-4 h-4 text-purple-200 shrink-0" />
                    <span>Start 30-Day Free Trial</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                )}

                {onLogin && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onLogin();
                    }}
                    className={`w-full h-11 text-sm font-semibold tracking-normal flex items-center justify-center gap-2 rounded-xl border shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98] font-courgette ${
                      isDark
                        ? 'border-indigo-400/70 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 hover:text-white hover:border-purple-400 shadow-indigo-950/30'
                        : 'border-indigo-400 bg-indigo-50/75 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 hover:border-indigo-600 shadow-indigo-900/10'
                    }`}
                  >
                    <LogIn className="w-4 h-4 shrink-0" />
                    <span>Store Login &amp; Cashier Sign In</span>
                  </button>
                )}

                <button
                  id="landing-tablet-drawer-install-btn"
                  type="button"
                  data-pwa-manual-install="true"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setIsInstallModalOpen(true);
                  }}
                  className={`w-full h-11 px-3.5 rounded-xl border flex items-center justify-between transition cursor-pointer group shadow-xs font-sans ${
                    isSolidLight
                      ? 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-800'
                      : 'bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-400/30 text-indigo-100'
                  }`}
                  title={detectedInstall.tooltip}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Download
                      className={`w-4 h-4 group-hover:scale-110 transition shrink-0 ${
                        isSolidLight ? 'text-purple-600' : 'text-indigo-200'
                      }`}
                    />
                    <span className="text-xs font-bold truncate">{detectedInstall.buttonLabel}</span>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${
                      isSolidLight
                        ? 'bg-white text-purple-700 border-purple-200'
                        : 'bg-white/15 text-indigo-100 border-indigo-300/30'
                    }`}
                  >
                    {isInstalled ? 'Installed' : detectedInstall.badgeLabel}
                  </span>
                </button>
              </div>

              {/* Mobile 3-Way Theme Mode Quick Switcher */}
              <div
                className={`pt-2 border-t font-courgette font-courgate ${
                  isDark ? 'border-indigo-950/70' : 'border-slate-200'
                }`}
                style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
              >
                <div className="flex items-center justify-between px-1 mb-2">
                  <span
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                    className={`text-xs font-bold uppercase tracking-wider font-courgette font-courgate ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    Theme Mode
                  </span>
                  <span
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                    className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-400/30 capitalize font-courgette font-courgate"
                  >
                    {themeMode}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setThemeMode('light')}
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                    className={`flex items-center justify-center gap-1.5 py-2 px-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border font-courgette font-courgate ${
                      themeMode === 'light'
                        ? 'bg-purple-50 text-purple-700 border-purple-400 font-bold shadow-xs'
                        : isDark
                        ? 'bg-slate-800/40 text-slate-300 border-slate-700/60 hover:text-white'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:text-black'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    {themeMode === 'light' && (
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/15 dark:ring-white/30"
                        style={{ backgroundColor: accentPalette.baseHex }}
                      />
                    )}
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeMode('dark')}
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                    className={`flex items-center justify-center gap-1.5 py-2 px-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border font-courgette font-courgate ${
                      themeMode === 'dark'
                        ? 'bg-purple-950/60 text-purple-300 border-purple-500 font-bold shadow-xs'
                        : isDark
                        ? 'bg-slate-800/40 text-slate-300 border-slate-700/60 hover:text-white'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:text-black'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5 text-purple-400" />
                    {themeMode === 'dark' && (
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/15 dark:ring-white/30"
                        style={{ backgroundColor: accentPalette.baseHex }}
                      />
                    )}
                    <span>Dark</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeMode('system')}
                    style={{ fontFamily: "'Courgette', cursive, sans-serif" }}
                    className={`flex items-center justify-center gap-1.5 py-2 px-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border font-courgette font-courgate ${
                      themeMode === 'system'
                        ? 'bg-purple-600 text-white border-purple-500 font-bold shadow-xs'
                        : isDark
                        ? 'bg-slate-800/40 text-slate-300 border-slate-700/60 hover:text-white'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:text-black'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5 text-indigo-400" />
                    {themeMode === 'system' && (
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full shrink-0 ring-1 ring-white/80"
                        style={{ backgroundColor: accentPalette.baseHex }}
                      />
                    )}
                    <span>System</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </div>
      {renderMobileSidebar()}
      {isInstallModalOpen && (
        <Suspense fallback={null}>
          <InstallAppModal
            isOpen={isInstallModalOpen}
            onClose={() => setIsInstallModalOpen(false)}
            isAdmin={false}
            role="PUBLIC"
            restrictToDetectedPlatform={true}
          />
        </Suspense>
      )}
    </header>
  );
};
