import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { motion } from 'motion/react';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Info,
  ShoppingBag,
  ArrowLeftRight,
  Search,
  CheckCheck,
  RefreshCw,
  Clock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Store,
  Globe,
  X,
  Calendar,
  Layers,
  Sparkles,
  Truck,
} from 'lucide-react';
import { api } from '../../services/api.ts';
import type { AllNotificationsResponse, HistoricalNotificationItem } from '../../types.ts';
import { ClickableMessage } from '../common/ClickableMessage.tsx';
const NotificationAlertProvidersSettings = lazy(() =>
  import('../settings/NotificationAlertProvidersSettings.tsx').then((m) => ({ default: m.NotificationAlertProvidersSettings }))
);
import { useRouteActivity } from '../../context/RouteLifecycleContext.tsx';
import { FeedLedgerSkeleton } from '../common/RouteSkeletons.tsx';
import { useAllNotificationsQuery } from '../../hooks/useLiveData.ts';
import { emitDataSync } from '../../utils/dataSyncBus.ts';
import {
  resolveNotificationActions,
  navigateToNotificationUrl,
  type NotificationActionDescriptor,
} from '../../utils/notificationActions.ts';
import { NotificationHeaderTitle } from './NotificationHeaderTitle.tsx';
import { AnimatedTabPanel, useTabDirection } from '../common/AnimatedTabPanel.tsx';
import { useScrollActiveTab } from '../../hooks/useScrollActiveTab.ts';

interface NotificationsViewProps {
  currentUser?: any;
  companySettings?: any;
  onNavigateTab: (tab: string) => void;
}

type TabCategory = 'all' | 'announcements' | 'notices' | 'operational' | 'sales' | 'returns' | 'urgent';

type SlideEnterPhase = 'enter' | 'active' | 'settled';

interface NotificationBadgeMeta {
  label: string;
  badgeClass: string;
  cardBg: string;
  icon: React.ReactNode;
}

interface NotificationFeedItemProps {
  item: HistoricalNotificationItem;
  index: number;
  badge: NotificationBadgeMeta;
  actions: NotificationActionDescriptor[];
  onActionButtonClick: (item: HistoricalNotificationItem, action: NotificationActionDescriptor) => void;
  formatTimestamp: (dateStr?: string | null) => string;
  formatFullDate: (dateStr?: string | null) => string;
}

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const NotificationFeedItem: React.FC<NotificationFeedItemProps> = ({
  item,
  index,
  badge,
  actions,
  onActionButtonClick,
  formatTimestamp,
  formatFullDate,
}) => {
  const [enterPhase, setEnterPhase] = useState<SlideEnterPhase>(() =>
    prefersReducedMotion() ? 'settled' : 'enter'
  );
  const initialDelayBucketRef = useRef<number>(Math.min(Math.max(index, 0), 8));

  useEffect(() => {
    if (enterPhase !== 'enter') {
      return;
    }
    if (typeof requestAnimationFrame === 'undefined') {
      setEnterPhase('settled');
      return;
    }

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setEnterPhase('active');
      });
    });

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [enterPhase]);

  useEffect(() => {
    if (enterPhase !== 'active') {
      return;
    }
    const settleDelayMs = 420 + initialDelayBucketRef.current * 35;
    const timer = window.setTimeout(() => {
      setEnterPhase('settled');
    }, settleDelayMs);
    return () => window.clearTimeout(timer);
  }, [enterPhase]);

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'transform') {
      setEnterPhase('settled');
    }
  };

  const isUnread = !item.isRead;
  const slideStateClass =
    enterPhase === 'enter'
      ? `notif-slide-enter notif-slide-delay-${initialDelayBucketRef.current}`
      : enterPhase === 'active'
      ? `notif-slide-enter-active notif-slide-delay-${initialDelayBucketRef.current}`
      : 'notif-slide-settled';

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className={`p-3.5 sm:p-4 rounded-2xl border notif-slide-item ${slideStateClass} ${
        isUnread
          ? `shadow-xs ${badge.cardBg} ring-1 ring-purple-400/20`
          : 'bg-white/80 dark:bg-[var(--brand-dark-surface,#120726)]/40 border-slate-200/80 dark:border-purple-900/30 opacity-85 hover:opacity-100 hover:bg-white dark:hover:bg-[#120726]/60'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {/* Left Column: Badges, Title, Message */}
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 border ${badge.badgeClass}`}
            >
              {badge.icon}
              <span>{badge.label}</span>
            </span>

            {/* Scope Badge */}
            {item.kind === 'NOTICE' ? (
              <span className="text-[10px] font-medium text-slate-500 dark:text-purple-300/80 flex items-center gap-1">
                {!item.tenantId ? (
                  <>
                    <Globe className="w-3 h-3 text-slate-400 dark:text-purple-400" />
                    <span>Platform Announcement</span>
                  </>
                ) : (
                  <>
                    <Store className="w-3 h-3 text-indigo-500" />
                    <span>Direct Store Alert</span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-slate-500 dark:text-purple-300/80 flex items-center gap-1">
                <Store className="w-3 h-3 text-emerald-500" />
                <span>Counter Register Activity</span>
              </span>
            )}

            {/* Unread indicator */}
            {isUnread && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.5 rounded-full border border-rose-200 dark:border-rose-900">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                <span>Unread</span>
              </span>
            )}
          </div>

          <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug font-heading">
            <NotificationHeaderTitle
              title={item.title}
              type={item.type}
              itemType={item.itemType}
              kind={item.kind}
            />
          </h4>

          <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
            <ClickableMessage text={item.message} />
          </div>

          {/* Metadata line: Timestamp & Expiry */}
          <div className="flex items-center gap-3 pt-1 text-[10px] text-slate-400 dark:text-slate-500 flex-wrap">
            <span className="flex items-center gap-1" title={formatFullDate(item.createdAt)}>
              <Clock className="w-3 h-3" />
              <span>{formatTimestamp(item.createdAt)}</span>
              <span className="opacity-60">({formatFullDate(item.createdAt)})</span>
            </span>

            {item.expiresAt && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Calendar className="w-3 h-3" />
                <span>Expires: {formatTimestamp(item.expiresAt)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Right Column / Footer: Dynamic Primary Action + Persistent Open POS (Max 2, no Dismiss/Unsubscribe) */}
        <div className="flex flex-wrap items-center sm:flex-col gap-2 shrink-0 self-start sm:self-end">
          {actions.map((btn) => {
            const isPrimary = btn.action !== 'open_pos';
            return (
              <button
                key={btn.action}
                type="button"
                onClick={() => onActionButtonClick(item, btn)}
                className={
                  isPrimary
                    ? 'px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition cursor-pointer flex items-center gap-1 shadow-xs whitespace-nowrap'
                    : 'px-3 py-1.5 rounded-xl bg-white dark:bg-purple-950/50 hover:bg-slate-100 dark:hover:bg-purple-900/50 text-slate-700 dark:text-purple-200 border border-slate-200 dark:border-purple-700/70 text-xs font-semibold transition cursor-pointer flex items-center gap-1 shadow-2xs whitespace-nowrap'
                }
              >
                <span>{btn.label}</span>
                {isPrimary && <ExternalLink className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  currentUser,
  companySettings: _companySettings,
  onNavigateTab: _onNavigateTab,
}) => {
  const { isActive } = useRouteActivity();
  const hasLoadedOnceRef = useRef(false);
  const searchInitRef = useRef(true);
  const currentUserRole = String(currentUser?.role || currentUser?.originalRole || '').toUpperCase();
  const isSuperAdmin = currentUserRole === 'SUPERADMIN';
  const [activeTab, setActiveTab] = useState<TabCategory>('all');
  const normalizedTab = activeTab === 'notices' ? 'announcements' : activeTab;
  const tabDirection = useTabDirection(
    normalizedTab,
    ['all', 'announcements', 'operational', 'sales', 'returns', 'urgent'] as const
  );
  const { containerRef: notifTabContainerRef } = useScrollActiveTab<HTMLDivElement>(normalizedTab, {
    padding: 16,
    behavior: 'smooth',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<HistoricalNotificationItem | null>(null);
  const [pendingAnnouncementId, setPendingAnnouncementId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const m = window.location.pathname.match(/^\/announcements\/([^/?#]+)/i);
    if (m && m[1]) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
    return null;
  });
  const searchTimeoutRef = useRef<any>(null);

  const queryParams = useMemo(
    () => ({
      page,
      limit,
      tab: activeTab,
      search: debouncedSearchQuery,
      sortOrder,
      unreadOnly,
    }),
    [page, limit, activeTab, debouncedSearchQuery, sortOrder, unreadOnly]
  );

  const allNotificationsQuery = useAllNotificationsQuery(queryParams, {
    enabled: isActive,
  });

  if (allNotificationsQuery.data) {
    hasLoadedOnceRef.current = true;
  }

  const items = allNotificationsQuery.data?.items || [];
  const pagination = allNotificationsQuery.data?.pagination || {
    page,
    limit,
    total: 0,
    totalPages: 1,
  };
  const stats = allNotificationsQuery.data?.stats || {
    totalNotices: 0,
    totalOperational: 0,
    unreadNotices: 0,
    unreadOperational: 0,
  };
  const loading = allNotificationsQuery.isFetching;

  const fetchHistory = async () => {
    await allNotificationsQuery.refetch();
  };

  // Always default to 'all' so every notification (sales, returns, exchanges, system notices) displays chronologically as individual messages.

  useEffect(() => {
    if (searchInitRef.current) {
      searchInitRef.current = false;
      return;
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedSearchQuery(searchQuery);
    }, 280);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  const markItemReadSilently = async (item: HistoricalNotificationItem) => {
    if (item.isRead) return;
    try {
      allNotificationsQuery.setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: (prev.items || []).map((i) => (i.id === item.id ? { ...i, isRead: true } : i)),
          stats: prev.stats
            ? {
                ...prev.stats,
                unreadNotices:
                  item.kind === 'NOTICE'
                    ? Math.max(0, prev.stats.unreadNotices - 1)
                    : prev.stats.unreadNotices,
                unreadOperational:
                  item.kind === 'OPERATIONAL'
                    ? Math.max(0, prev.stats.unreadOperational - 1)
                    : prev.stats.unreadOperational,
              }
            : prev.stats,
        };
      });

      await api.notifications.dismiss(item.id, item.itemType);
      emitDataSync(['notifications'], { source: 'notifications-view' });
    } catch (err) {
      console.warn('Failed to mark notification as read:', err);
    }
  };

  // Listen for /announcements/:id deep-links and sync URL on tab activation
  useEffect(() => {
    const extractAnnouncementPathId = () => {
      try {
        const m = window.location.pathname.match(/^\/announcements\/([^/?#]+)/i);
        return m && m[1] ? decodeURIComponent(m[1]) : '';
      } catch {
        return '';
      }
    };

    const handleOpenAnnouncement = (event: any) => {
      const targetId = String(event?.detail?.announcementId || extractAnnouncementPathId() || '').trim();
      if (targetId) {
        setSelectedAnnouncement(null);
        setPendingAnnouncementId(targetId);
      }
    };

    window.addEventListener('pos:open-announcement', handleOpenAnnouncement);
    const pathId = extractAnnouncementPathId();
    if (isActive && pathId && !selectedAnnouncement) {
      setPendingAnnouncementId(pathId);
    }
    return () => window.removeEventListener('pos:open-announcement', handleOpenAnnouncement);
  }, [isActive]);

  useEffect(() => {
    if (!pendingAnnouncementId) return;
    const match = items.find(
      (i) =>
        i.kind === 'NOTICE' &&
        (String(i.rawId) === pendingAnnouncementId ||
          String(i.id) === pendingAnnouncementId ||
          String(i.id) === `notice-${pendingAnnouncementId}`)
    );
    if (match) {
      setSelectedAnnouncement(match);
      setPendingAnnouncementId(null);
      return;
    }
    if (!allNotificationsQuery.isPending) {
      let cancelled = false;
      api.notifications
        .all({ tab: 'announcements', limit: 100 })
        .then((res: AllNotificationsResponse) => {
          if (cancelled) return;
          const found = (res?.items || []).find(
            (i: HistoricalNotificationItem) =>
              String(i.rawId) === pendingAnnouncementId ||
              String(i.id) === pendingAnnouncementId ||
              String(i.id) === `notice-${pendingAnnouncementId}`
          );
          if (found) {
            setSelectedAnnouncement(found);
          }
          setPendingAnnouncementId(null);
        })
        .catch(() => {
          if (!cancelled) setPendingAnnouncementId(null);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [pendingAnnouncementId, items, allNotificationsQuery.isPending]);

  const handleMarkAllRead = async () => {
    try {
      setIsMarkingAll(true);
      allNotificationsQuery.setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: (prev.items || []).map((i) => ({ ...i, isRead: true })),
          stats: prev.stats
            ? {
                ...prev.stats,
                unreadNotices: 0,
                unreadOperational: 0,
              }
            : prev.stats,
        };
      });

      await api.notifications.markAllRead();
      emitDataSync(['notifications'], { source: 'notifications-view' });
      await fetchHistory();
    } catch (err) {
      console.warn('Failed to mark all as read:', err);
      await allNotificationsQuery.refetch();
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleActionButtonClick = (
    item: HistoricalNotificationItem,
    btn: NotificationActionDescriptor
  ) => {
    void markItemReadSilently(item);

    if (btn.action === 'read_more') {
      setSelectedAnnouncement(item);
      if (btn.url.startsWith('/announcements/')) {
        try {
          window.history.pushState({}, '', btn.url);
        } catch {}
      }
      return;
    }

    navigateToNotificationUrl(btn.url, {
      ...item,
      action: btn.action,
      invoiceId: item.invoiceNumber || (item.itemType === 'SALE' ? item.rawId : undefined),
    });
  };

  const formatTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const diffMs = Date.now() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const formatFullDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const getTypeBadge = (item: HistoricalNotificationItem) => {
    const t = String(item.type || '').toUpperCase();
    if (item.kind === 'NOTICE') {
      switch (t) {
        case 'URGENT':
          return {
            label: 'Urgent Announcement',
            badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300 border-rose-300 dark:border-rose-700',
            cardBg: 'border-rose-300 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20',
            icon: <Flame className="w-3 h-3 text-rose-600 dark:text-rose-400" />,
          };
        case 'WARNING':
          return {
            label: 'Advisory Warning',
            badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-300 dark:border-amber-700',
            cardBg: 'border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20',
            icon: <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />,
          };
        case 'SUCCESS':
          return {
            label: 'Announcement',
            badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
            cardBg: 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/15',
            icon: <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />,
          };
        default:
          return {
            label: 'System Announcement',
            badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-purple-900/60 dark:text-purple-300 border-indigo-300 dark:border-purple-700',
            cardBg: 'border-indigo-200 dark:border-purple-900/40 bg-indigo-50/30 dark:bg-purple-950/20',
            icon: <Info className="w-3 h-3 text-indigo-600 dark:text-purple-400" />,
          };
      }
    } else {
      if (item.itemType === 'LOW_STOCK' || t === 'STOCK') {
        return {
          label: 'Low Stock Alert',
          badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-300 dark:border-amber-700',
          cardBg: 'border-amber-300/80 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/15',
          icon: <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />,
        };
      }
      if (item.itemType === 'SALE_RETURN' || t === 'SALE_RETURN') {
        return {
          label: 'Sale & Return',
          badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
          cardBg: 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/10',
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />,
        };
      }
      if (item.itemType === 'SALE_EXCHANGE' || t === 'SALE_EXCHANGE') {
        return {
          label: 'Sale & Exchange',
          badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
          cardBg: 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/10',
          icon: <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />,
        };
      }
      if (item.itemType === 'PURCHASE' || t === 'PURCHASE') {
        return {
          label: 'Purchase',
          badgeClass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700',
          cardBg: 'border-cyan-200 dark:border-cyan-900/40 bg-cyan-50/20 dark:bg-cyan-950/10',
          icon: <Truck className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />,
        };
      }
      if (item.itemType === 'SALE') {
        return {
          label: 'POS Sale',
          badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
          cardBg: 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/10',
          icon: <ShoppingBag className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />,
        };
      }
      if (item.itemType === 'EXCHANGE' || t === 'EXCHANGE') {
        return {
          label: 'Exchange',
          badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700',
          cardBg: 'border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/20 dark:bg-indigo-950/10',
          icon: <ArrowLeftRight className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />,
        };
      }
      if (item.itemType === 'RETURN') {
        return {
          label: 'Customer Return',
          badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300 border-rose-300 dark:border-rose-700',
          cardBg: 'border-rose-200 dark:border-rose-900/40 bg-rose-50/20 dark:bg-rose-950/10',
          icon: <ArrowLeftRight className="w-3 h-3 text-rose-600 dark:text-rose-400" />,
        };
      }
      return {
        label: 'Counter Event',
        badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300 border-purple-300 dark:border-purple-700',
        cardBg: 'border-purple-200 dark:border-purple-900/40 bg-purple-50/20 dark:bg-purple-950/10',
        icon: <Bell className="w-3 h-3 text-purple-600 dark:text-purple-400" />,
      };
    }
  };

  const totalUnreadCount = stats.unreadNotices + stats.unreadOperational;

  if (!hasLoadedOnceRef.current && allNotificationsQuery.isPending) {
    return <FeedLedgerSkeleton />;
  }

  return (
    <div className="p-2.5 sm:p-6 lg:p-7 space-y-4 sm:space-y-5 max-w-7xl mx-auto select-none bg-[#F8FAFC] dark:bg-[#0A0E1A] min-h-screen text-slate-800 dark:text-slate-100 transition-colors">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4 pb-2 border-b border-slate-200/80 dark:border-purple-900/30">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-purple-800 flex items-center justify-center text-white shadow-md shadow-purple-600/20 shrink-0">
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2]" />
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-heading flex flex-wrap items-center gap-2">
                <span>Notification History & Activity Logs</span>
                {totalUnreadCount > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border border-purple-300 dark:border-purple-700">
                    {totalUnreadCount} Unread
                  </span>
                )}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Complete audit trail of SuperAdmin announcements, subscription alerts, and POS counter transactions.
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setShowProviderSettings((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl font-semibold text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer ${
                showProviderSettings
                  ? 'bg-purple-600 text-white shadow-purple-600/30'
                  : 'bg-white dark:bg-[var(--brand-dark-surface,#120726)] border border-slate-200/90 dark:border-purple-800/40 text-slate-700 dark:text-purple-200 hover:text-purple-600 dark:hover:text-white'
              }`}
              title="Configure Firebase Cloud Messaging (FCM) credentials and test push alerts"
            >
              <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span>{showProviderSettings ? 'Close FCM Settings' : 'Firebase FCM Push Settings'}</span>
            </button>
          )}

          {totalUnreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isMarkingAll || loading}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>{isMarkingAll ? 'Marking All...' : 'Mark All as Read'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchHistory}
            disabled={loading}
            className="p-2 rounded-xl bg-white dark:bg-[var(--brand-dark-surface,#120726)] border border-slate-200/90 dark:border-purple-800/40 text-slate-700 dark:text-purple-200 hover:text-purple-600 dark:hover:text-white shadow-2xs transition cursor-pointer disabled:opacity-50"
            title="Refresh Notification Feed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-purple-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* ALERT PROVIDER CONFIGURATION PANEL - SUPERADMIN EXCLUSIVE */}
      {isSuperAdmin && showProviderSettings && (
        <div className="transition-all duration-200 animate-in fade-in">
          <Suspense fallback={null}>
            <NotificationAlertProvidersSettings
              onClose={() => setShowProviderSettings(false)}
            />
          </Suspense>
        </div>
      )}

      {/* STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="p-2.5 sm:p-3.5 rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)]/60 border border-slate-200/80 dark:border-purple-900/40 shadow-xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500 dark:text-purple-300/70 mb-1">
            <span className="font-medium truncate">Total Alerts</span>
            <Layers className="w-3.5 h-3.5 text-purple-500 shrink-0" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-heading">
            {stats.totalNotices + stats.totalOperational}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">All captured events</div>
        </div>

        <div className="p-2.5 sm:p-3.5 rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)]/60 border border-slate-200/80 dark:border-purple-900/40 shadow-xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500 dark:text-purple-300/70 mb-1">
            <span className="font-medium truncate">Announcements</span>
            <Globe className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-heading">
            {stats.totalNotices}
          </div>
          <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5 font-medium truncate">
            {stats.unreadNotices} unread
          </div>
        </div>

        <div className="p-2.5 sm:p-3.5 rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)]/60 border border-slate-200/80 dark:border-purple-900/40 shadow-xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500 dark:text-purple-300/70 mb-1">
            <span className="font-medium truncate">POS Activities</span>
            <ShoppingBag className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-heading">
            {stats.totalOperational}
          </div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium truncate">
            {stats.unreadOperational} active in drawer
          </div>
        </div>

        <div className="p-2.5 sm:p-3.5 rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)]/60 border border-slate-200/80 dark:border-purple-900/40 shadow-xs">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-500 dark:text-purple-300/70 mb-1">
            <span className="font-medium truncate">Unread Total</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-heading">
            {totalUnreadCount}
          </div>
          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 font-medium truncate">
            Requires acknowledgment
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="p-3.5 rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)]/80 border border-slate-200/90 dark:border-purple-900/40 shadow-xs space-y-3">
        {/* Category Tabs */}
        <div
          ref={notifTabContainerRef}
          className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar"
        >
          {(
            [
              { key: 'all', label: 'All Items', count: stats.totalNotices + stats.totalOperational },
              { key: 'announcements', label: 'Announcements', count: stats.totalNotices },
              { key: 'operational', label: 'POS Activity', count: stats.totalOperational },
              { key: 'sales', label: 'Sales' },
              { key: 'returns', label: 'Returns' },
              { key: 'urgent', label: 'Urgent Only' },
            ] as ReadonlyArray<{ key: TabCategory; label: string; count?: number }>
          ).map((tab) => {
            const isTabActive = activeTab === tab.key || (tab.key === 'announcements' && activeTab === 'notices');
            return (
              <button
                key={tab.key}
                type="button"
                data-active={isTabActive}
                data-tab={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setPage(1);
                }}
                className={`relative px-3 py-1.5 rounded-xl font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                  isTabActive
                    ? 'text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-purple-950/40 text-slate-600 dark:text-purple-200 hover:text-purple-700 dark:hover:text-white'
                }`}
              >
                {isTabActive && (
                  <motion.span
                    layoutId="notificationsFilterActivePill"
                    className="absolute inset-0 rounded-xl bg-purple-600 shadow-xs"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <span>{tab.label}</span>
                  {'count' in tab && tab.count !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        isTabActive
                          ? 'bg-purple-800 text-purple-100'
                          : 'bg-slate-200 dark:bg-purple-900/60 text-slate-700 dark:text-purple-300'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search, Status & Sorting Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2 border-t border-slate-100 dark:border-purple-900/30">
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notifications, invoices, keywords..."
              className="w-full h-8.5 bg-slate-50 dark:bg-[#0A0E1A] border border-slate-200 dark:border-purple-900/50 rounded-xl pl-9 pr-8 text-xs text-slate-800 dark:text-white placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
            {/* Unread Only Toggle */}
            <button
              type="button"
              onClick={() => {
                setUnreadOnly(!unreadOnly);
                setPage(1);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 ${
                unreadOnly
                  ? 'bg-purple-50 border-purple-300 text-purple-700 dark:bg-purple-950/60 dark:border-purple-700 dark:text-purple-200'
                  : 'bg-white dark:bg-[#0A0E1A] border-slate-200 dark:border-purple-900/50 text-slate-600 dark:text-purple-300/80 hover:bg-slate-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${unreadOnly ? 'bg-purple-600' : 'bg-slate-300 dark:bg-slate-600'}`} />
              <span>Unread Only</span>
            </button>

            {/* Sort Order */}
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
              className="h-8.5 bg-white dark:bg-[#0A0E1A] border border-slate-200 dark:border-purple-900/50 rounded-xl px-2.5 text-xs text-slate-700 dark:text-purple-200 outline-none cursor-pointer"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>

            {/* Limit Selector */}
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="h-8.5 bg-white dark:bg-[#0A0E1A] border border-slate-200 dark:border-purple-900/50 rounded-xl px-2 text-xs text-slate-700 dark:text-purple-200 outline-none cursor-pointer"
            >
              <option value={10}>10 / page</option>
              <option value={15}>15 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
          </div>
        </div>
      </div>

      {/* NOTIFICATION CARDS LIST */}
      <AnimatedTabPanel activeKey={normalizedTab} direction={tabDirection} className="space-y-2.5">
        {allNotificationsQuery.isPending ? (
          <div className="py-16 text-center space-y-3">
            <RefreshCw className="w-7 h-7 mx-auto animate-spin text-purple-600" />
            <p className="text-xs font-semibold text-slate-500 dark:text-purple-300">
              Loading notification records...
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 px-4 text-center rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)]/40 border border-slate-200/80 dark:border-purple-900/30">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 flex items-center justify-center mx-auto mb-3 border border-purple-200/80 dark:border-purple-800/40">
              <CheckCircle2 className="w-6 h-6 stroke-[2]" />
            </div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white font-heading">
              No notifications found
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
              {searchQuery
                ? `No alerts matching "${searchQuery}". Try adjusting your search or tab filters.`
                : 'All caught up! There are no active or historical notifications matching this criteria.'}
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3.5 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-xs font-semibold cursor-pointer"
              >
                Clear Search Filter
              </button>
            )}
          </div>
        ) : (
          items.map((item, index) => (
            <NotificationFeedItem
              key={item.id}
              item={item}
              index={index}
              badge={getTypeBadge(item)}
              actions={resolveNotificationActions(item, currentUserRole)}
              onActionButtonClick={handleActionButtonClick}
              formatTimestamp={formatTimestamp}
              formatFullDate={formatFullDate}
            />
          ))
        )}
      </AnimatedTabPanel>

      {/* ANNOUNCEMENT DETAIL MODAL (/announcements/:id) */}
      {(selectedAnnouncement || pendingAnnouncementId) && (
        <div
          className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-panel-enter relative w-full max-w-lg sm:max-w-xl lg:max-w-2xl my-auto rounded-2xl bg-white dark:bg-[var(--brand-dark-surface,#120726)] border border-slate-200 dark:border-purple-800/60 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="h-1.5 w-full bg-gradient-to-r from-purple-600 to-indigo-600 shrink-0" />
            {selectedAnnouncement ? (
              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider bg-indigo-100 text-indigo-800 dark:bg-purple-900/60 dark:text-purple-200 border border-indigo-200 dark:border-purple-700">
                      <Globe className="w-3 h-3" />
                      <span>{selectedAnnouncement.tenantId ? 'Direct Store Alert' : 'Platform Announcement'}</span>
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-heading">
                      {selectedAnnouncement.title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAnnouncement(null);
                      setPendingAnnouncementId(null);
                      if (window.location.pathname.startsWith('/announcements/')) {
                        window.history.replaceState({}, '', '/notifications');
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/50 cursor-pointer shrink-0"
                    aria-label="Close announcement"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                  <ClickableMessage text={selectedAnnouncement.message} />
                </div>

                <div className="flex flex-wrap items-center justify-between pt-3 border-t border-slate-100 dark:border-purple-900/40 gap-2">
                  <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatFullDate(selectedAnnouncement.createdAt)}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedAnnouncement.actionUrl && /^https?:\/\//i.test(selectedAnnouncement.actionUrl) && (
                      <a
                        href={selectedAnnouncement.actionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
                      >
                        <span>{selectedAnnouncement.actionLabel || 'Open Link'}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAnnouncement(null);
                        setPendingAnnouncementId(null);
                        navigateToNotificationUrl('/pos');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-purple-900/50 hover:bg-slate-200 dark:hover:bg-purple-800/60 text-slate-800 dark:text-purple-100 text-xs font-semibold cursor-pointer"
                    >
                      Open POS
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5 sm:p-6 space-y-4" role="status" aria-label="Loading announcement">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <div className="h-5 w-32 rounded-full bg-slate-200 dark:bg-purple-900/60 animate-pulse" />
                    <div className="h-6 w-3/4 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingAnnouncementId(null);
                      if (window.location.pathname.startsWith('/announcements/')) {
                        window.history.replaceState({}, '', '/notifications');
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-900/50 cursor-pointer"
                    aria-label="Close loading announcement"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2.5 py-2">
                  <div className="h-4 w-full rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  <div className="h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-purple-900/40">
                  <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  <div className="h-7 w-24 rounded-xl bg-slate-200 dark:bg-purple-900/60 animate-pulse" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PAGINATION FOOTER */}
      {pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200/80 dark:border-purple-900/30 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Showing page <span className="font-bold text-slate-800 dark:text-white">{pagination.page}</span> of{' '}
            <span className="font-bold text-slate-800 dark:text-white">{pagination.totalPages}</span> ({pagination.total} total notifications)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1 || loading}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-[var(--brand-dark-surface,#120726)] border border-slate-200 dark:border-purple-800/40 text-slate-700 dark:text-purple-200 hover:bg-slate-50 dark:hover:bg-purple-900/40 disabled:opacity-40 disabled:cursor-not-allowed font-semibold cursor-pointer flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            <span className="px-3 py-1 font-bold text-purple-600 dark:text-purple-300">
              {pagination.page}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-[var(--brand-dark-surface,#120726)] border border-slate-200 dark:border-purple-800/40 text-slate-700 dark:text-purple-200 hover:bg-slate-50 dark:hover:bg-purple-900/40 disabled:opacity-40 disabled:cursor-not-allowed font-semibold cursor-pointer flex items-center gap-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
