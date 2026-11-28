import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { api, getActiveTenantId, subscribeSessionClear } from '../services/api.ts';
import { subscribeForegroundNotifications } from '../services/pushNotificationClient.ts';
import { navigateToNotificationUrl } from '../utils/notificationActions.ts';
import type { GroupedNotificationsResponse, PlatformNotification } from '../types.ts';

export type GroupedNotificationItem = GroupedNotificationsResponse['notifications'][number];

interface NotificationContextValue {
  notifications: GroupedNotificationItem[];
  notices: PlatformNotification[];
  readNotifIds: string[];
  isLoading: boolean;
  isBellPulsing: boolean;
  refreshGrouped: (options?: { noticesOnly?: boolean }) => Promise<void>;
  loadHistoryOnDemand: () => Promise<void>;
  setDropdownOpen: (open: boolean) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismissActivity: (id: string) => Promise<void>;
  dismissNotice: (id: number | string) => Promise<void>;
  dismissAll: () => Promise<void>;
  removeNoticeLocally: (id: number | string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function readPersistedReadIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const saved = localStorage.getItem('pos_read_notifications');
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const NotificationProvider: React.FC<{
  currentUser: any;
  children: React.ReactNode;
}> = ({ currentUser, children }) => {
  const [notifications, setNotifications] = useState<GroupedNotificationItem[]>([]);
  const [notices, setNotices] = useState<PlatformNotification[]>([]);
  const [readNotifIds, setReadNotifIds] = useState<string[]>(readPersistedReadIds);
  const [isLoading, setIsLoading] = useState(false);
  const [isBellPulsing, setIsBellPulsing] = useState(false);
  const [foregroundToast, setForegroundToast] = useState<{
    id: string;
    title: string;
    message: string;
    deepLinkUrl?: string;
    payload?: any;
  } | null>(null);

  const activeTenantId = getActiveTenantId();
  const currentRole = String(currentUser?.role || '').trim().toUpperCase();
  const currentUserId = Number(currentUser?.id || currentUser?.userId || 0);
  const sessionScopeKey = currentUser ? `${activeTenantId ?? 'public'}:${currentUserId}:${currentRole}` : '';

  const isDropdownOpenRef = useRef(false);
  const historyDirtyRef = useRef(true);
  const hasLoadedHistoryRef = useRef(false);
  const bellPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedLocalTestIdsRef = useRef<Set<string>>(new Set());
  const localTestCleanupTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const inFlightFetchRef = useRef<Promise<void> | null>(null);
  const inFlightFullHistoryRef = useRef(false);
  const scopeKeyRef = useRef(sessionScopeKey);

  useEffect(() => {
    scopeKeyRef.current = sessionScopeKey;
  }, [sessionScopeKey]);

  const triggerBellPulse = useCallback(() => {
    setIsBellPulsing(true);
    if (bellPulseTimeoutRef.current) {
      clearTimeout(bellPulseTimeoutRef.current);
    }
    bellPulseTimeoutRef.current = setTimeout(() => {
      bellPulseTimeoutRef.current = null;
      setIsBellPulsing(false);
    }, 6500);
  }, []);

  const refreshGrouped = useCallback(
    async (options?: { noticesOnly?: boolean }) => {
      if (!currentUser) return;
      const noticesOnly = Boolean(options?.noticesOnly);
      if (inFlightFetchRef.current) {
        // If a full-history fetch is already in flight or another notices-only fetch is in flight and we also want noticesOnly, reuse it.
        if (noticesOnly || inFlightFullHistoryRef.current) {
          return inFlightFetchRef.current;
        }
        await inFlightFetchRef.current.catch(() => {});
      }

      const targetScope = scopeKeyRef.current;
      inFlightFullHistoryRef.current = !noticesOnly;
      setIsLoading(true);

      const fetchPromise = api.notifications
        .grouped(10, { noticesOnly })
        .then((res) => {
          if (scopeKeyRef.current !== targetScope) return;
          setNotices(Array.isArray(res?.notices) ? res.notices : []);
          if (!noticesOnly) {
            setNotifications(Array.isArray(res?.notifications) ? res.notifications.slice(0, 5) : []);
            hasLoadedHistoryRef.current = true;
            historyDirtyRef.current = false;
          }
        })
        .catch(() => {
          // Preserve existing in-memory notifications on transient network failures
        })
        .finally(() => {
          inFlightFetchRef.current = null;
          inFlightFullHistoryRef.current = false;
          if (scopeKeyRef.current === targetScope) {
            setIsLoading(false);
          }
        });

      inFlightFetchRef.current = fetchPromise;
      return fetchPromise;
    },
    [currentUser]
  );

  const loadHistoryOnDemand = useCallback(async () => {
    if (!currentUser) return;
    if (!hasLoadedHistoryRef.current || historyDirtyRef.current) {
      await refreshGrouped({ noticesOnly: false });
    }
  }, [currentUser, refreshGrouped]);

  const setDropdownOpen = useCallback(
    (open: boolean) => {
      isDropdownOpenRef.current = open;
      if (open) {
        setIsBellPulsing(false);
        if (bellPulseTimeoutRef.current) {
          clearTimeout(bellPulseTimeoutRef.current);
          bellPulseTimeoutRef.current = null;
        }
        void loadHistoryOnDemand();
      }
    },
    [loadHistoryOnDemand]
  );

  // Reset state cleanly on logout or session switch and load active notices once (no polling)
  useEffect(() => {
    setNotifications([]);
    setNotices([]);
    hasLoadedHistoryRef.current = false;
    historyDirtyRef.current = true;

    if (!currentUser) {
      return;
    }

    // Fetch lightweight active notices once on session start; full operational history waits until bell open.
    void refreshGrouped({ noticesOnly: true });
  }, [sessionScopeKey, currentUser, refreshGrouped]);

  useEffect(() => {
    const unsubscribeClear = subscribeSessionClear(() => {
      setNotifications([]);
      setNotices([]);
      hasLoadedHistoryRef.current = false;
      historyDirtyRef.current = true;
    });
    return unsubscribeClear;
  }, []);

  // Listen once to foreground FCM events (`pos:fcm-notification`) & local test push suppression
  useEffect(() => {
    if (!currentUser) return;

    const cleanupForeground = subscribeForegroundNotifications((payload) => {
      const userRole = currentRole;
      const targetRole = payload.targetRole ? String(payload.targetRole).toUpperCase() : undefined;
      const titleLower = (payload.title || '').toLowerCase();
      const msgLower = (payload.message || '').toLowerCase();
      const actionUrlLower = (payload.actionUrl || payload.deepLinkUrl || '').toLowerCase();
      const itemTypeUpper = String(payload.itemType || '').toUpperCase();
      const typeUpper = String(payload.type || 'INFO').toUpperCase();

      const isRenewalRequestNotice =
        titleLower.startsWith('renewal request:') ||
        titleLower.includes('new renewal request') ||
        msgLower.includes('requested subscription renewal');
      const isSuperAdminOnlyNotice =
        targetRole === 'SUPERADMIN' ||
        titleLower.includes('new free trial') ||
        isRenewalRequestNotice ||
        msgLower.includes('free tier store registered') ||
        actionUrlLower.includes('/superadmin');

      if (typeUpper === 'PURCHASE') return;
      if (userRole !== 'SUPERADMIN' && isSuperAdminOnlyNotice) return;

      if (userRole === 'SUPERADMIN') {
        if (['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE', 'PURCHASE', 'STOCK'].includes(typeUpper)) {
          return;
        }
        if (targetRole && !['ALL', 'SUPERADMIN'].includes(targetRole)) return;
        if (titleLower.includes('welcome') || msgLower.includes('welcome to sarbaazsoft')) return;
      } else if (userRole === 'CASHIER') {
        if (['PURCHASE', 'STOCK', 'SUPPLIER'].includes(typeUpper)) return;
        if (targetRole && !['ALL', 'CASHIER'].includes(targetRole)) return;
        if (titleLower.includes('welcome') || msgLower.includes('welcome to sarbaazsoft')) return;
      } else if (userRole === 'ADMIN') {
        if (targetRole && !['ALL', 'ADMIN'].includes(targetRole)) return;
        if (titleLower.includes('welcome') || msgLower.includes('welcome') || msgLower.includes('staff account')) {
          return;
        }
      }

      const incomingEventId = String(payload.eventId || payload.tag || '');
      if (incomingEventId && suppressedLocalTestIdsRef.current.has(incomingEventId)) {
        suppressedLocalTestIdsRef.current.delete(incomingEventId);
        return;
      }

      triggerBellPulse();
      historyDirtyRef.current = true;

      if (typeUpper !== 'TEST_PUSH') {
        const toastId = String(payload.eventId || payload.tag || `fg-${Date.now()}`);
        setForegroundToast({
          id: toastId,
          title: payload.title || 'POS Alert',
          message: payload.message || '',
          deepLinkUrl: payload.deepLinkUrl || payload.actionUrl || undefined,
          payload,
        });
        if (toastTimeoutRef.current) {
          clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
          toastTimeoutRef.current = null;
          setForegroundToast((cur) => (cur?.id === toastId ? null : cur));
        }, 6500);
      }

      if (itemTypeUpper === 'ANNOUNCEMENT' || typeUpper === 'ANNOUNCEMENT') {
        const numericId = Number(payload.announcementId || payload.id) || Date.now();
        setNotices((prev) => {
          if (prev.some((n) => String(n.id) === String(numericId))) return prev;
          const nextNotice: PlatformNotification = {
            id: numericId,
            tenantId: activeTenantId ?? null,
            targetRole: (targetRole as any) || 'ALL',
            title: payload.title || 'Announcement',
            message: payload.message || '',
            type: (payload.type as any) || 'INFO',
            actionUrl: payload.actionUrl || payload.deepLinkUrl || '',
            actionLabel: payload.actionLabel || '',
            createdAt: payload.timestamp || new Date().toISOString(),
            isRead: false,
          };
          return [nextNotice, ...prev].slice(0, 10);
        });
      } else if (typeUpper !== 'TEST_PUSH') {
        const notifId = String(payload.eventId || payload.tag || `fcm-${Date.now()}`);
        setNotifications((prev) => {
          if (prev.some((n) => n.id === notifId)) return prev;
          const nextItem: GroupedNotificationItem = {
            id: notifId,
            rawId: Number(payload.saleId || payload.returnId || payload.id || Date.now()),
            itemType: (itemTypeUpper || typeUpper) as any,
            type: typeUpper as any,
            title: payload.title || 'POS Alert',
            message: payload.message || '',
            invoiceNumber: payload.invoiceNumber,
            returnNumber: payload.returnNumber,
            totalAmount: typeof payload.totalAmount === 'number' ? payload.totalAmount : undefined,
            deepLinkUrl: payload.deepLinkUrl || payload.actionUrl || '/?tab=reports',
            createdAt: payload.timestamp || new Date().toISOString(),
            timestamp: payload.timestamp || new Date().toISOString(),
            isRead: false,
          };
          return [nextItem, ...prev].slice(0, 5);
        });
      }

      // Only refresh from server if bell dropdown is actively open; otherwise keep zero extra network requests
      if (isDropdownOpenRef.current) {
        void refreshGrouped({ noticesOnly: false });
      }
    });

    const handleLocalTestPushDispatched = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const eventId = detail?.eventId ? String(detail.eventId) : '';
      if (!eventId) return;
      suppressedLocalTestIdsRef.current.add(eventId);
      const timer = setTimeout(() => {
        localTestCleanupTimersRef.current.delete(timer);
        suppressedLocalTestIdsRef.current.delete(eventId);
      }, 15_000);
      localTestCleanupTimersRef.current.add(timer);
    };

    window.addEventListener('pos:local-test-push-dispatched', handleLocalTestPushDispatched);

    return () => {
      cleanupForeground();
      window.removeEventListener('pos:local-test-push-dispatched', handleLocalTestPushDispatched);
      if (bellPulseTimeoutRef.current) {
        clearTimeout(bellPulseTimeoutRef.current);
        bellPulseTimeoutRef.current = null;
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      for (const timer of localTestCleanupTimersRef.current) {
        clearTimeout(timer);
      }
      localTestCleanupTimersRef.current.clear();
    };
  }, [currentUser, currentRole, activeTenantId, triggerBellPulse, refreshGrouped]);

  const markAsRead = useCallback((id: string) => {
    setReadNotifIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem('pos_read_notifications', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    const allIds = notifications.map((n) => n.id);
    setReadNotifIds((prev) => {
      const merged = Array.from(new Set([...prev, ...allIds]));
      try {
        localStorage.setItem('pos_read_notifications', JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }, [notifications]);

  const removeNoticeLocally = useCallback((id: number | string) => {
    setNotices((prev) => prev.filter((n) => String(n.id) !== String(id)));
  }, []);

  const dismissActivity = useCallback(async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await api.notifications.dismiss(id);
  }, []);

  const dismissNotice = useCallback(async (id: number | string) => {
    setNotices((prev) => prev.filter((n) => String(n.id) !== String(id)));
    await api.notifications.dismiss(id, 'NOTICE');
  }, []);

  const dismissAll = useCallback(async () => {
    setNotices([]);
    setNotifications([]);
    await api.notifications.dismissAll();
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      notices,
      readNotifIds,
      isLoading,
      isBellPulsing,
      refreshGrouped,
      loadHistoryOnDemand,
      setDropdownOpen,
      markAsRead,
      markAllAsRead,
      dismissActivity,
      dismissNotice,
      dismissAll,
      removeNoticeLocally,
    }),
    [
      notifications,
      notices,
      readNotifIds,
      isLoading,
      isBellPulsing,
      refreshGrouped,
      loadHistoryOnDemand,
      setDropdownOpen,
      markAsRead,
      markAllAsRead,
      dismissActivity,
      dismissNotice,
      dismissAll,
      removeNoticeLocally,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {foregroundToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 right-4 z-[9999] max-w-sm w-[calc(100vw-2rem)] bg-white dark:bg-[#131B2E] border border-purple-200 dark:border-purple-700/70 shadow-2xl rounded-2xl p-3.5 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0 mt-0.5">
            <BellRing className="w-4 h-4" />
          </div>
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => {
              const target = foregroundToast.deepLinkUrl;
              const payload = foregroundToast.payload;
              setForegroundToast(null);
              if (target) {
                navigateToNotificationUrl(target, payload);
              }
            }}
          >
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {foregroundToast.title}
            </p>
            {foregroundToast.message && (
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-line line-clamp-3">
                {foregroundToast.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setForegroundToast(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70 shrink-0 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </NotificationContext.Provider>
  );
};

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}
