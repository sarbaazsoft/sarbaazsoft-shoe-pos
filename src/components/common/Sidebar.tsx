import React, { Suspense, lazy, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutDashboard, ShoppingCart, Boxes, Truck, RotateCcw, Users, TrendingUp, Settings, Printer, BookOpen, X, Building2, Check, Cloud, Keyboard, Sun, Moon, Download, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { UserAvatar } from './UserAvatar.tsx';
import { ShoeIcon } from './ShoeIcon.tsx';
import { ShowroomBackground } from './ShowroomBackground.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { APP_VERSION } from '../../version.ts';

const InstallAppModal = lazy(() =>
  import('./InstallAppModal.tsx').then((m) => ({ default: m.InstallAppModal }))
);

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  currentUser: any;
  companySettings: any;
  onLogout?: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenProfile?: () => void;
  /** Configurable expanded sidebar width in px (defaults to 256) */
  expandedWidth?: number;
  /** Configurable collapsed sidebar width in px (defaults to 72) */
  collapsedWidth?: number;
  /** Dock cleanly below the top header inside BodyLayoutWrapper */
  embeddedInBodyLayout?: boolean;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
}

interface NavSection {
  header: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  currentUser,
  companySettings,
  onLogout: _onLogout,
  mobileOpen,
  onCloseMobile,
  onOpenProfile,
  expandedWidth = 256,
  collapsedWidth = 72,
  embeddedInBodyLayout = false,
}) => {
  const { theme, toggleTheme, backdropStyle } = useTheme();
  const isDarkMode = theme === 'dark';
  const isSolidBackdrop = backdropStyle === 'solid';
  const isSolidLight = isSolidBackdrop && !isDarkMode;
  const navGlassAlpha = 0.5;
  const headerGlassAlpha = 0.5;
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pos_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pos_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCollapse]);

  const storeName =
    companySettings?.name ||
    companySettings?.company_name ||
    companySettings?.companyName ||
    'DWU Shoes';

  const userRole = (currentUser?.role || '').toLowerCase();
  const isCashier = userRole === 'cashier';
  const isPlatformOwner = (currentUser?.role || '').toUpperCase() === 'SUPERADMIN';
  const isStoreAdmin = (currentUser?.role || '').toUpperCase() === 'ADMIN';

  const isWholesaleStore =
    String(companySettings?.businessType || companySettings?.business_type || '').toUpperCase() === 'WHOLESALE';

  const sections: NavSection[] = useMemo(() => {
    const rawSections: NavSection[] = [
      {
        header: 'COUNTER & INVENTORY',
        items: [
          { id: 'pos', label: 'POS Terminal', icon: ShoppingCart, shortcut: 'F1' },
          { id: 'inventory', label: 'Shoe Catalog', icon: Boxes, shortcut: 'F2' },
          { id: 'ledger', label: 'Stock Ledger', icon: BookOpen },
        ],
      },
      {
        header: 'SALES & PURCHASES',
        items: [
          { id: 'purchases', label: 'Purchases', icon: Truck, shortcut: 'F3' },
          { id: 'suppliers', label: 'Suppliers', icon: Building2 },
          { id: 'returns', label: 'Returns', icon: RotateCcw, shortcut: 'F4' },
          { id: 'customers', label: 'Customers', icon: Users, shortcut: 'F5' },
        ],
      },
      {
        header: (isPlatformOwner || isStoreAdmin || isCashier)
          ? (isCashier ? 'SETTINGS & HARDWARE' : 'ADMINISTRATION')
          : 'REPORTS & ANALYTICS',
        items: [
          { id: 'reports', label: 'Reports', icon: TrendingUp, shortcut: 'F6' },
          ...(isPlatformOwner || isStoreAdmin
            ? [
                {
                  id: 'settings',
                  label: isPlatformOwner ? 'System Settings' : 'Settings',
                  icon: Settings,
                  shortcut: 'F7',
                },
              ]
            : isCashier
            ? [
                {
                  id: 'settings',
                  label: 'Printer Settings',
                  icon: Printer,
                  shortcut: 'F7',
                },
              ]
            : []),
        ],
      },
      {
        header: 'HELP & SUPPORT',
        items: [
          { id: 'assistant', label: 'Sammi AI Assistant', icon: Sparkles },
        ],
      },
    ];

    return rawSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (isCashier && item.id === 'purchases') {
            return false;
          }
          // Wholesale stores process returns directly on the current invoice; hide Returns/Exchange navigation link
          if (isWholesaleStore && (item.id === 'returns' || item.id === 'exchange')) {
            return false;
          }
          return true;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [isPlatformOwner, isStoreAdmin, isCashier, isWholesaleStore]);

  const handleItemClick = (tabId: string) => {
    onTabChange(tabId);
    onCloseMobile();
  };

  const renderSidebar = (isMobile: boolean = false) => {
    const collapsed = !isMobile && isCollapsed;

    return (
      <div
        data-backdrop-style={backdropStyle}
        className={`sidebar-showroom-shell relative w-full h-full ${embeddedInBodyLayout ? 'min-h-0' : 'max-h-screen'} flex flex-col select-none shadow-lg rounded-none overflow-hidden transition-colors ${
          isSolidLight
            ? 'bg-white text-slate-900 border-r border-slate-200'
            : isSolidBackdrop
            ? 'bg-[#0A0E1A] text-slate-100 border-r border-[#1A263D]'
            : 'bg-[#080A2A] text-slate-100 border-r border-indigo-400/25'
        }`}
      >
        <ShowroomBackground contained={true} intensity="portal" scope="sidebar" />
        {/* TOP: Pinned Store Brand Header aligned with top Header bar (exact h-[3.6rem] with matching border-b) */}
        <div
          style={
            !isSolidBackdrop
              ? { backgroundColor: `rgba(8, 10, 42, ${headerGlassAlpha})` }
              : undefined
          }
          className={`relative z-20 h-[3.6rem] flex items-center shrink-0 transition-colors ${
            isSolidLight
              ? 'border-b border-slate-200 bg-white'
              : isSolidBackdrop
              ? 'border-b border-[#1A263D] bg-[#0A0E1A]'
              : 'border-b border-indigo-400/20 backdrop-blur-md'
          } ${collapsed ? 'px-1 justify-center gap-1' : 'px-3.5 sm:px-4 justify-between gap-2'}`}
        >
          {/* Brand Banner */}
          <div className={`flex items-center min-w-0 ${collapsed ? 'justify-center' : 'gap-2.5 flex-1'}`}>
            <div className={`${collapsed ? 'w-8 h-8 rounded-lg' : 'w-9 h-9 rounded-xl'} bg-white dark:bg-slate-900 border shrink-0 shadow-xs flex items-center justify-center overflow-hidden ${
              isSolidLight ? 'border-slate-200' : 'border-indigo-400/30'
            }`}>
              <ShoeIcon
                src={companySettings?.logo || '/pwa-192x192.png'}
                alt={`${storeName} Logo`}
                className={`w-full h-full object-cover ${collapsed ? 'rounded-lg' : 'rounded-xl'}`}
              />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <h1 className={`text-xs font-bold truncate tracking-tight leading-tight ${
                  isSolidLight ? 'text-slate-900' : 'text-white'
                }`}>
                  {storeName}
                </h1>
                <p className={`text-[10px] font-medium truncate mt-0.5 ${
                  isSolidLight ? 'text-slate-500' : 'text-indigo-200/80'
                }`}>
                  SarbaazSoft Shoe POS
                </p>
              </div>
            )}
          </div>

          {/* Mobile Close Button */}
          {isMobile && (
            <button
              id="sidebar-close-mobile-btn"
              type="button"
              onClick={onCloseMobile}
              className={`w-10 h-10 flex items-center justify-center rounded-lg transition cursor-pointer shrink-0 ${
                isSolidLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
              aria-label="Close Mobile Navigation"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          )}

          {/* Desktop Collapse / Expand Toggle Button */}
          {!isMobile && !collapsed && (
            <button
              id="sidebar-collapse-toggle-btn"
              type="button"
              onClick={toggleCollapse}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isSolidLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
              title="Collapse sidebar (Ctrl+B)"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}

          {/* Collapsed Expand Toggle Button */}
          {!isMobile && collapsed && (
            <button
              id="sidebar-expand-toggle-btn"
              type="button"
              onClick={toggleCollapse}
              className={`p-1 rounded-lg transition cursor-pointer ${
                isSolidLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* SCROLLABLE NAVIGATION CONTAINER */}
        <div
          className={`relative z-10 flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden sidebar-scrollbar ${
            collapsed ? 'px-2' : ''
          }`}
        >
        {/* MAIN MENU: Dashboard + Navigation Sections */}
        <div
          style={
            !isSolidBackdrop
              ? { backgroundColor: `rgba(8, 10, 42, ${navGlassAlpha})` }
              : undefined
          }
          className={`flex-1 transition-colors ${
            isSolidLight
              ? 'bg-white'
              : isSolidBackdrop
              ? 'bg-[#0A0E1A]'
              : 'backdrop-blur-md'
          }`}
        >
        {/* TOP ITEM: Dashboard Quick Navigation */}
        <div className={`pt-2.5 pb-1 ${collapsed ? 'px-1' : 'px-3'}`}>
          <div className="relative">
            <motion.button
              type="button"
              id="sidebar-nav-dashboard"
              onClick={() => handleItemClick('dashboard')}
              whileTap={{ scale: 0.98 }}
              className={`relative w-full flex items-center ${
                collapsed
                  ? 'justify-center p-2.5'
                  : isMobile
                  ? 'justify-between px-3 py-2.5 min-h-[42px]'
                  : 'justify-between px-3 py-2'
              } rounded-xl text-xs font-semibold cursor-pointer group transition-colors duration-150 ${
                currentTab === 'dashboard'
                  ? 'text-white font-bold'
                  : isSolidLight
                  ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-100 hover:text-white hover:bg-white/10 [text-shadow:0_1px_6px_rgba(5,7,27,0.85)]'
              }`}
            >
              {/* Animated Floating Active Pill */}
              {currentTab === 'dashboard' && (
                <motion.div
                  layoutId="activeNavPill"
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 dark:from-purple-600 dark:to-indigo-600 border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 dark:shadow-[0_0_16px_rgba(var(--primary-rgb,147,51,234),)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}

              <div className="relative z-10 flex items-center gap-3">
                <LayoutDashboard
                  className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                    currentTab === 'dashboard'
                      ? 'text-white'
                      : isSolidLight
                      ? 'text-slate-500 group-hover:text-slate-900 group-hover:scale-110'
                      : 'text-indigo-200/90 group-hover:text-white group-hover:scale-110'
                  }`}
                />
                {!collapsed && <span>Dashboard</span>}
              </div>

              {/* Floating Tooltip in Collapsed Mode */}
              {collapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold whitespace-nowrap shadow-xl z-50 pointer-events-none border border-slate-700/50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 flex items-center gap-1.5">
                  <span>Dashboard</span>
                  <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 border-l border-b border-slate-700/50" />
                </div>
              )}
            </motion.button>
          </div>
        </div>

        {/* MIDDLE: Navigation Sections */}
        <div className={`py-1 pb-2.5 space-y-2.5 ${collapsed ? 'px-1' : 'px-3'}`}>
          {sections.map((section) => (
            <div key={section.header} className="space-y-1">
              {!collapsed ? (
                <div className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                  isSolidLight
                    ? 'text-slate-400'
                    : 'text-indigo-200/80 [text-shadow:0_1px_6px_rgba(5,7,27,0.9)]'
                }`}>
                  {section.header}
                </div>
              ) : (
                <div className={`w-8 h-px mx-auto my-2 ${isSolidLight ? 'bg-slate-200' : 'bg-indigo-400/25'}`} />
              )}

              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  const isActive = currentTab === item.id;

                  return (
                    <div key={item.id} className="relative">
                      <motion.button
                        type="button"
                        id={`sidebar-nav-${item.id}`}
                        onClick={() => handleItemClick(item.id)}
                        whileTap={{ scale: 0.98 }}
                        className={`relative w-full flex items-center ${
                          collapsed
                            ? 'justify-center p-2.5'
                            : isMobile
                            ? 'justify-between px-3 py-2.5 min-h-[42px]'
                            : 'justify-between px-3 py-2'
                        } rounded-xl text-xs font-medium cursor-pointer group transition-colors duration-150 ${
                          isActive
                            ? 'text-white font-bold'
                            : isSolidLight
                            ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                            : 'text-slate-100 hover:text-white hover:bg-white/10 [text-shadow:0_1px_6px_rgba(5,7,27,0.85)]'
                        }`}
                      >
                        {/* Animated Floating Active Pill */}
                        {isActive && (
                          <motion.div
                            layoutId="activeNavPill"
                            className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 dark:from-purple-600 dark:to-indigo-600 border border-purple-400/40 dark:border-purple-400/50 shadow-md shadow-purple-600/25 dark:shadow-[0_0_16px_rgba(var(--primary-rgb,147,51,234),)]"
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
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </div>

                        {!isMobile && !collapsed && item.shortcut && (
                          <kbd
                            className={`hidden lg:inline-flex relative z-10 text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded-md transition ${
                              isActive
                                ? 'bg-white/20 text-white border border-white/30'
                                : isSolidLight
                                ? 'bg-slate-100 text-slate-600 border border-slate-200'
                                : 'bg-white/10 text-slate-200 border border-indigo-400/25'
                            }`}
                          >
                            {item.shortcut}
                          </kbd>
                        )}

                        {/* Floating Tooltip in Collapsed Mode */}
                        {collapsed && (
                          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold whitespace-nowrap shadow-xl z-50 pointer-events-none border border-slate-700/50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 flex items-center gap-2">
                            <span>{item.label}</span>
                            {item.shortcut && (
                              <span className="text-[10px] font-mono bg-white/20 px-1 py-0.5 rounded text-white font-bold">
                                {item.shortcut}
                              </span>
                            )}
                            <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 border-l border-b border-slate-700/50" />
                          </div>
                        )}
                      </motion.button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        </div>

        {/* BOTTOM: User Profile, Database Status, Shortcuts & App Version */}
        <div
          style={
            !isSolidBackdrop
              ? { backgroundColor: `rgba(8, 10, 42, ${navGlassAlpha})` }
              : undefined
          }
          className={`space-y-2 mt-auto transition-colors ${
            isSolidLight
              ? 'border-t border-slate-200 bg-slate-50/90'
              : isSolidBackdrop
              ? 'border-t border-[#1A263D] bg-[#0A0E1A]'
              : 'border-t border-indigo-400/20 backdrop-blur-md'
          } ${collapsed ? 'p-2 pt-3' : 'p-3.5 pt-3'}`}
        >
          {/* User Card */}
          <div
            id="sidebar-user-card"
            onClick={() => {
              onOpenProfile?.();
              if (isMobile) onCloseMobile();
            }}
            className={`flex items-center rounded-xl border cursor-pointer transition group shadow-xs ${
              isSolidLight
                ? 'bg-white hover:bg-slate-100 border-slate-200'
                : 'bg-white/10 hover:bg-white/16 border-indigo-400/25'
            } ${collapsed ? 'justify-center p-2 relative' : 'justify-between p-2'}`}
            title={collapsed ? `${currentUser?.name || 'Admin'} • Profile` : 'Click to view & edit your profile'}
          >
            <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'justify-center' : ''}`}>
              <div className="relative shrink-0">
                <UserAvatar
                  name={currentUser?.name}
                  avatarUrl={currentUser?.avatarUrl || currentUser?.avatar_url}
                  role={currentUser?.role}
                  size="sm"
                />
                <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-2 ${
                  isSolidLight ? 'ring-white' : 'ring-[#080A2A]'
                }`} />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className={`text-xs font-bold truncate transition ${
                    isSolidLight
                      ? 'text-slate-900 group-hover:text-purple-700'
                      : 'text-white group-hover:text-purple-200'
                  }`}>
                    {currentUser?.name || 'Admin'}
                  </div>
                  <div className={`text-[10px] truncate ${
                    isSolidLight ? 'text-slate-500' : 'text-indigo-200/80'
                  }`}>
                    {(() => {
                      const roleUpper = (currentUser?.role || '').toUpperCase();
                      if (roleUpper === 'SUPERADMIN') return 'Platform Owner';
                      if (roleUpper === 'ADMIN') return 'Administrator';
                      return 'Staff Cashier';
                    })()}
                  </div>
                </div>
              )}
            </div>

            {!collapsed && (
              <div className={isSolidLight ? 'text-slate-400 group-hover:text-slate-700 transition' : 'text-slate-300 group-hover:text-white transition'}>
                <Check className="w-4 h-4 text-emerald-500" />
              </div>
            )}

            {collapsed && (
              <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold whitespace-nowrap shadow-xl z-50 pointer-events-none border border-slate-700/50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 flex items-center gap-1.5">
                <span>{currentUser?.name || 'Admin'} (Profile)</span>
                <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 border-l border-b border-slate-700/50" />
              </div>
            )}
          </div>

          {/* Install Button under User Profile */}
          <button
            id="sidebar-install-app-btn"
            type="button"
            onClick={() => setIsInstallModalOpen(true)}
            className={`w-full flex items-center rounded-xl border transition cursor-pointer group shadow-xs ${
              isSolidLight
                ? 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-800'
                : 'bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-400/30 text-indigo-100'
            } ${
              collapsed
                ? 'justify-center p-2 relative'
                : isMobile
                ? 'justify-between px-2.5 py-2 min-h-[40px]'
                : 'justify-between px-2.5 py-1.5'
            }`}
            title="Install Android APK, iOS Safari PWA, or Windows .EXE"
          >
            <div className="flex items-center gap-2">
              <Download className={`w-3.5 h-3.5 group-hover:scale-110 transition shrink-0 ${
                isSolidLight ? 'text-purple-600' : 'text-indigo-200'
              }`} />
              {!collapsed && <span className="text-[11px] font-bold">Install App (APK / PWA)</span>}
            </div>
            {!collapsed && (
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
                isSolidLight
                  ? 'bg-white text-purple-700 border-purple-200'
                  : 'bg-white/15 text-indigo-100 border-indigo-300/30'
              }`}>
                APK • iOS • PC
              </span>
            )}
            {collapsed && (
              <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold whitespace-nowrap shadow-xl z-50 pointer-events-none border border-slate-700/50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 flex items-center gap-1.5">
                <span>Install App (APK / PWA)</span>
                <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 border-l border-b border-slate-700/50" />
              </div>
            )}
          </button>

          {/* Database Status & Shortcuts Bar */}
          <div className="space-y-1.5 pt-1">
            {/* Quick Theme Toggle Button */}
            <button
              id="sidebar-theme-toggle-btn"
              type="button"
              onClick={toggleTheme}
              className={`w-full flex items-center rounded-lg border text-[11px] transition cursor-pointer ${
                isSolidLight
                  ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-800'
                  : 'bg-white/10 hover:bg-white/16 border-indigo-400/25 text-slate-100'
              } ${
                collapsed
                  ? 'justify-center p-2 relative group'
                  : isMobile
                  ? 'justify-between px-2.5 py-2 min-h-[38px]'
                  : 'justify-between px-2 py-1.5'
              }`}
              title={`Current theme: ${theme}. Click to toggle`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {theme === 'dark' ? (
                  <Moon className={`w-3 h-3 shrink-0 stroke-[2] ${isSolidLight ? 'text-purple-600' : 'text-purple-300'}`} />
                ) : (
                  <Sun className={`w-3 h-3 shrink-0 stroke-[2] ${isSolidLight ? 'text-purple-600' : 'text-purple-300'}`} />
                )}
                {!collapsed && <span>Theme</span>}
              </div>
              {!collapsed && (
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
                  isSolidLight
                    ? 'bg-slate-100 text-purple-700 border-slate-200'
                    : 'bg-white/15 text-cyan-200 border-indigo-400/25'
                }`}>
                  {theme === 'dark' ? 'Dark' : 'Light'}
                </span>
              )}
              {collapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold whitespace-nowrap shadow-xl z-50 pointer-events-none border border-slate-700/50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 flex items-center gap-1.5">
                  <span>Theme ({theme === 'dark' ? 'Dark' : 'Light'})</span>
                  <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 border-l border-b border-slate-700/50" />
                </div>
              )}
            </button>

            {/* System Online Status */}
            <div
              className={`flex items-center rounded-lg border text-[10.5px] ${
                isSolidLight
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-emerald-500/15 border-emerald-400/30'
              } ${collapsed ? 'justify-center p-2 relative group' : 'justify-between px-2 py-1'}`}
            >
              <div className={`flex items-center gap-1.5 font-semibold ${
                isSolidLight ? 'text-emerald-700' : 'text-emerald-300'
              }`}>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                {!collapsed && (
                  <span className="flex items-center gap-1 truncate">
                    <Cloud className="w-3 h-3 shrink-0" />
                    System: Online
                  </span>
                )}
              </div>
              {!collapsed && (
                <span className={`text-[9.5px] font-medium ${isSolidLight ? 'text-emerald-700' : 'text-emerald-300'}`}>Connected</span>
              )}
              {collapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 text-white text-xs font-semibold whitespace-nowrap shadow-xl z-50 pointer-events-none border border-slate-700/50 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 flex items-center gap-1.5">
                  <span>System Online</span>
                  <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 rotate-45 border-l border-b border-slate-700/50" />
                </div>
              )}
            </div>

            {/* Shortcuts Info (Desktop only) */}
            {!isMobile && !collapsed && (
              <div className={`hidden lg:flex items-center justify-between px-2 py-0.5 text-[10px] ${
                isSolidLight ? 'text-slate-500' : 'text-slate-300/90'
              }`}>
                <div className="flex items-center gap-1.5">
                  <Keyboard className={`w-3 h-3 ${isSolidLight ? 'text-slate-400' : 'text-indigo-300'}`} />
                  <span>Shortcuts:</span>
                </div>
                <span className={`font-mono font-semibold ${isSolidLight ? 'text-slate-700' : 'text-slate-100'}`}>F1 - F7 • Ctrl+B</span>
              </div>
            )}

            {/* Version */}
            {!collapsed && (
              <div className={`px-2 pt-1 border-t flex items-center justify-between text-[9.5px] ${
                isSolidLight
                  ? 'border-slate-200 text-slate-500'
                  : 'border-indigo-400/20 text-slate-300/80'
              }`}>
                <span>SarbaazSoft Shoe POS</span>
                <span className="font-mono">{APP_VERSION}</span>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* DESKTOP FIXED SIDEBAR WITH SMOOTH SPRING WIDTH TRANSITION */}
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? collapsedWidth : expandedWidth }}
        transition={{ type: 'spring', stiffness: 350, damping: 32 }}
        className={`hidden lg:flex shrink-0 z-30 no-print overflow-hidden rounded-none shadow-lg border-r border-indigo-500/20 ${
          embeddedInBodyLayout
            ? 'h-[calc(100dvh-3.6rem)] max-h-[calc(100dvh-3.6rem)] sticky top-[3.6rem]'
            : 'h-screen sticky top-0'
        }`}
      >
        {renderSidebar(false)}
      </motion.aside>

      {/* MOBILE DRAWER WITH FLUID ANIMATEPRESENCE ENTRY & EXIT (Portaled above sticky header) */}
      {(() => {
        const mobileDrawer = (
          <AnimatePresence>
            {mobileOpen && (
              <div className="fixed inset-0 z-[60] lg:hidden flex no-print">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
                  onClick={onCloseMobile}
                />
                <motion.div
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                  className="relative w-72 max-w-[85vw] h-full max-h-screen shadow-2xl z-10 overflow-hidden rounded-none border-r border-indigo-500/20"
                >
                  {renderSidebar(true)}
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        );

        if (typeof document !== 'undefined' && document.body) {
          return createPortal(mobileDrawer, document.body);
        }
        return mobileDrawer;
      })()}

      {/* PWA & EXE INSTALLATION MODAL */}
      {isInstallModalOpen && (
        <Suspense fallback={null}>
          <InstallAppModal
            isOpen={isInstallModalOpen}
            onClose={() => setIsInstallModalOpen(false)}
            isAdmin={isPlatformOwner}
            role={currentUser?.role}
          />
        </Suspense>
      )}
    </>
  );
};
