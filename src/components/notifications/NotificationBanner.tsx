import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import {
  DEFAULT_SOFT_PROMPT_SNOOZE_DAYS,
  dismissSoftPushPrompt,
  getDetailedPushPermissionStatus,
  resetSoftPushPromptDismissal,
  shouldShowSoftPushPromptAsync,
  subscribeDeviceToWebPush,
  unsubscribeDeviceFromWebPush,
  watchNotificationPermissionChanges,
  type PushPermissionSnapshot,
} from '../../services/pushNotificationClient.ts';

export interface UseNotificationSoftPromptOptions {
  userRole?: string;
  snoozeDays?: number;
  enabled?: boolean;
  onStatusChange?: (snapshot: PushPermissionSnapshot) => void;
}

/**
 * Reusable two-step notification permission hook.
 * - Never calls Notification.requestPermission() or getToken() on mount or login.
 * - Tracks browser/OS status and 7-day localStorage snooze ("Not Now").
 * - Only invokes native permission + getToken() + backend token sync after an explicit click.
 */
export function useNotificationSoftPrompt(options: UseNotificationSoftPromptOptions = {}) {
  const {
    userRole = 'ADMIN',
    snoozeDays = DEFAULT_SOFT_PROMPT_SNOOZE_DAYS,
    enabled = true,
    onStatusChange,
  } = options;

  const [snapshot, setSnapshot] = useState<PushPermissionSnapshot | null>(null);
  const [isPromptVisible, setIsPromptVisible] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
  } | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!enabled) {
      setIsPromptVisible(false);
      return null;
    }
    const snap = await getDetailedPushPermissionStatus();
    setSnapshot(snap);
    onStatusChange?.(snap);
    const eligible = await shouldShowSoftPushPromptAsync();
    setIsPromptVisible(eligible);
    return snap;
  }, [enabled, onStatusChange]);

  useEffect(() => {
    if (!enabled) {
      setIsPromptVisible(false);
      return;
    }

    void refreshStatus();

    const cleanupWatcher = watchNotificationPermissionChanges((snap) => {
      setSnapshot(snap);
      onStatusChange?.(snap);
      if (snap.effectiveStatus !== 'default') {
        setIsPromptVisible(false);
      } else {
        void shouldShowSoftPushPromptAsync().then(setIsPromptVisible);
      }
    });

    const handleSnoozeUpdate = () => {
      void refreshStatus();
    };

    window.addEventListener('pos:push-soft-prompt-updated', handleSnoozeUpdate);
    return () => {
      cleanupWatcher();
      window.removeEventListener('pos:push-soft-prompt-updated', handleSnoozeUpdate);
    };
  }, [enabled, refreshStatus, onStatusChange]);

  const openPrompt = useCallback(() => {
    resetSoftPushPromptDismissal();
    setFeedback(null);
    setIsPromptVisible(true);
  }, []);

  const dismissForLater = useCallback(
    (days = snoozeDays) => {
      dismissSoftPushPrompt(days);
      setIsPromptVisible(false);
      setFeedback(null);
    },
    [snoozeDays]
  );

  const acceptAndEnable = useCallback(async () => {
    if (isBusy) return null;
    setIsBusy(true);
    setFeedback(null);

    try {
      const result = await subscribeDeviceToWebPush(userRole);
      const updated = await getDetailedPushPermissionStatus();
      setSnapshot(updated);
      onStatusChange?.(updated);

      if (result.success && result.permission === 'granted' && !result.androidSystemDisabled) {
        setFeedback({
          type: 'success',
          message:
            result.warning ||
            'Notifications enabled! You will now receive real-time POS alerts on this device.',
        });
        setIsPromptVisible(false);
      } else if (
        result.androidSystemDisabled ||
        result.permission === 'denied' ||
        result.alreadyPrompted
      ) {
        setFeedback({
          type: 'warning',
          message:
            result.error ||
            'Notifications are blocked in your browser or OS site settings. Allow Notifications in site settings to enable alerts.',
        });
        dismissSoftPushPrompt(snoozeDays);
        setIsPromptVisible(false);
      } else {
        dismissSoftPushPrompt(snoozeDays);
        setIsPromptVisible(false);
      }

      return result;
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Unable to enable notifications right now.',
      });
      return { success: false, error: err?.message || 'Unable to enable notifications right now.' };
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, onStatusChange, snoozeDays, userRole]);

  const disableNotifications = useCallback(async () => {
    if (isBusy) return false;
    setIsBusy(true);
    setFeedback(null);
    try {
      const ok = await unsubscribeDeviceFromWebPush();
      const updated = await getDetailedPushPermissionStatus();
      setSnapshot(updated);
      onStatusChange?.(updated);
      setFeedback({
        type: 'info',
        message: 'Push notifications have been disabled for this device.',
      });
      return ok;
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, onStatusChange]);

  return {
    snapshot,
    isPromptVisible,
    isBusy,
    feedback,
    refreshStatus,
    openPrompt,
    dismissForLater,
    acceptAndEnable,
    disableNotifications,
  };
}

export interface NotificationBannerProps {
  userRole?: string;
  snoozeDays?: number;
  title?: string;
  description?: string;
  className?: string;
  onStatusChange?: (snapshot: PushPermissionSnapshot) => void;
}

/**
 * Reusable two-step soft prompt banner for Web Push / FCM permissions.
 * - Renders nothing automatically if permission is already granted, denied, or snoozed for 7 days.
 * - Calls Notification.requestPermission() + getToken() ONLY after explicit click on "Enable Notifications".
 */
export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  userRole = 'ADMIN',
  snoozeDays = DEFAULT_SOFT_PROMPT_SNOOZE_DAYS,
  title = 'Enable Real-Time POS Alerts',
  description = 'Get instant updates for sales invoices, customer returns, low-stock warnings, and store announcements.',
  className = '',
  onStatusChange,
}) => {
  const {
    snapshot,
    isPromptVisible,
    isBusy,
    feedback,
    acceptAndEnable,
    dismissForLater,
    disableNotifications,
  } = useNotificationSoftPrompt({ userRole, snoozeDays, onStatusChange });

  const isDenied =
    snapshot?.effectiveStatus === 'browser-denied' ||
    snapshot?.effectiveStatus === 'android-system-disabled' ||
    snapshot?.browserPermission === 'denied';

  if (snapshot?.effectiveStatus === 'granted' && snapshot.canReceiveSystemNotifications) {
    return (
      <div
        className={`rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 ${className}`}
      >
        <div className="flex items-center gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold">Real-time notifications are active on this device.</span>
        </div>
        <button
          type="button"
          onClick={() => void disableNotifications()}
          disabled={isBusy}
          className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellOff className="w-3.5 h-3.5" />}
          <span>Disable</span>
        </button>
      </div>
    );
  }

  if (isDenied) {
    return (
      <div
        className={`rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 ${className}`}
      >
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">Notifications Blocked in Browser Settings</p>
          <p className="text-[11px] leading-relaxed mt-0.5">
            {snapshot?.androidSystemDisabled
              ? 'Allow notifications in Android Settings → Apps → SarbaazSoft POS → Notifications.'
              : 'Click the lock/site settings icon (🔒) next to the URL and set Notifications to Allow.'}
          </p>
        </div>
      </div>
    );
  }

  if (!isPromptVisible) {
    return null;
  }

  return (
    <div
      className={`relative rounded-2xl border border-purple-200/90 dark:border-purple-800/60 bg-white dark:bg-slate-900 p-4 shadow-lg text-slate-800 dark:text-slate-100 ${className}`}
    >
      <button
        type="button"
        onClick={() => dismissForLater(snoozeDays)}
        aria-label="Dismiss notification banner"
        className="absolute top-3 right-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
          <BellRing className="w-4 h-4" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{description}</p>
        </div>
      </div>

      {feedback && (
        <p className="mt-2.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {feedback.message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void acceptAndEnable()}
          disabled={isBusy}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-sm transition cursor-pointer disabled:opacity-60"
        >
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
          <span>{isBusy ? 'Enabling...' : 'Enable Notifications'}</span>
        </button>

        <button
          type="button"
          onClick={() => dismissForLater(snoozeDays)}
          disabled={isBusy}
          className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
        >
          Not Now
        </button>
      </div>
    </div>
  );
};
