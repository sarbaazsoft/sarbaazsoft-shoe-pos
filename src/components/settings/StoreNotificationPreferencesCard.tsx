import React, { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  AlertCircle,
  Mail,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Loader2,
  Info,
} from 'lucide-react';
import { api } from '../../services/api.ts';
import {
  NOTIFICATION_PRESETS,
  STORE_NOTIFICATION_CHANNELS,
  STORE_NOTIFICATION_EVENTS,
  applyNotificationPreset,
  countCustomizedSettings,
  createDefaultNotificationPreferences,
  isChannelCustomized,
  isEventCustomized,
  updateNotificationChannelToggle,
  updateNotificationEventToggle,
  type EmailFallbackReason,
  type NotificationPresetId,
  type StoreNotificationChannelId,
  type StoreNotificationDeliveryStatus,
  type StoreNotificationEventId,
  type StoreNotificationPreferences,
} from '../../utils/notificationPreferences.ts';

interface StoreNotificationPreferencesCardProps {
  refreshTrigger?: number;
  isDeviceSubscribed?: boolean;
  onNavigateToStoreProfile?: () => void;
}

const EVENT_CATEGORY_META: Record<
  'transactions' | 'inventory' | 'account',
  { title: string; subtitle: string }
> = {
  transactions: {
    title: 'POS Transactions',
    subtitle: 'Real-time retail and wholesale billing counter events',
  },
  inventory: {
    title: 'Inventory Monitoring',
    subtitle: 'Stock threshold and replenishment alerts',
  },
  account: {
    title: 'Subscription & Platform Notices',
    subtitle: 'Billing status reminders and platform-wide updates',
  },
};

function describeFallbackReason(reason: EmailFallbackReason): string {
  switch (reason) {
    case 'web_push_inactive':
      return 'Web Push Notifications are turned OFF in your delivery channels. Store alerts will be routed to your registered owner email.';
    case 'web_push_unavailable':
      return 'Web Push push service is currently unavailable. Store alerts will automatically fall back to your registered owner email.';
    case 'no_active_subscription':
      return 'No active Web Push device subscription is registered for this store yet. Alerts will automatically fall back to your registered owner email until a device is enabled.';
    case 'owner_offline':
      return 'You will automatically receive email fallback alerts whenever your dashboard session is offline or push delivery cannot reach you.';
    case 'push_delivery_failed':
      return 'When Web Push delivery fails, alerts automatically fall back to email.';
    default:
      return 'Web Push is active. Email Fallback will automatically send alerts to your registered owner email if Web Push becomes inactive, unavailable, unsubscribed, or fails.';
  }
}

export const StoreNotificationPreferencesCard: React.FC<
  StoreNotificationPreferencesCardProps
> = ({ refreshTrigger = 0, isDeviceSubscribed, onNavigateToStoreProfile }) => {
  const [prefs, setPrefs] = useState<StoreNotificationPreferences>(() =>
    createDefaultNotificationPreferences()
  );
  const [deliveryStatus, setDeliveryStatus] =
    useState<StoreNotificationDeliveryStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadPreferences = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await api.notifications.getPreferences();
      if (res?.preferences) {
        setPrefs(res.preferences);
      }
      if (res?.deliveryStatus) {
        setDeliveryStatus(res.deliveryStatus);
      }
    } catch (err: any) {
      if (!silent) {
        setFeedback({
          type: 'error',
          text: err?.message || 'Unable to load store notification preferences.',
        });
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPreferences(false);
  }, []);

  useEffect(() => {
    if (refreshTrigger > 0) {
      void loadPreferences(true);
    }
  }, [refreshTrigger, isDeviceSubscribed]);

  const persistNextPreferences = async (
    nextPrefs: StoreNotificationPreferences,
    successText: string
  ) => {
    const previous = prefs;
    setPrefs(nextPrefs);
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await api.notifications.updatePreferences(nextPrefs);
      if (res?.preferences) {
        setPrefs(res.preferences);
      }
      if (res?.deliveryStatus) {
        setDeliveryStatus(res.deliveryStatus);
      }
      setFeedback({ type: 'success', text: successText });
    } catch (err: any) {
      setPrefs(previous);
      setFeedback({
        type: 'error',
        text: err?.message || 'Failed to save notification preferences.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectPreset = async (presetId: NotificationPresetId) => {
    const nextPrefs = applyNotificationPreset(prefs, presetId);
    const label =
      NOTIFICATION_PRESETS.find((p) => p.id === presetId)?.label || presetId;
    await persistNextPreferences(nextPrefs, `${label} preset applied and saved.`);
  };

  const handleToggleChannel = async (channelId: StoreNotificationChannelId) => {
    const currentVal = Boolean(prefs.channels[channelId]);
    const nextPrefs = updateNotificationChannelToggle(prefs, channelId, !currentVal);
    const label =
      STORE_NOTIFICATION_CHANNELS.find((c) => c.id === channelId)?.label || channelId;
    await persistNextPreferences(
      nextPrefs,
      `${label} ${!currentVal ? 'enabled' : 'disabled'} (Custom settings saved).`
    );
  };

  const handleToggleEvent = async (eventId: StoreNotificationEventId) => {
    const currentVal = Boolean(prefs.events[eventId]);
    const nextPrefs = updateNotificationEventToggle(prefs, eventId, !currentVal);
    const label =
      STORE_NOTIFICATION_EVENTS.find((e) => e.id === eventId)?.label || eventId;
    await persistNextPreferences(
      nextPrefs,
      `${label} ${!currentVal ? 'enabled' : 'disabled'} (Custom settings saved).`
    );
  };

  const handleResetToRecommended = async () => {
    const nextPrefs = applyNotificationPreset(prefs, 'recommended');
    await persistNextPreferences(
      nextPrefs,
      'Restored to System Recommended defaults.'
    );
  };

  const customizedCount = countCustomizedSettings(prefs);
  const categories: Array<'transactions' | 'inventory' | 'account'> = [
    'transactions',
    'inventory',
    'account',
  ];

  const effectiveFallbackReason: EmailFallbackReason = !prefs.channels.webPush
    ? 'web_push_inactive'
    : deliveryStatus && !deliveryStatus.fcmServerConfigured
    ? 'web_push_unavailable'
    : deliveryStatus && !deliveryStatus.hasActiveOwnerPushSubscription
    ? 'no_active_subscription'
    : null;

  const hasRegisteredEmails = Boolean(
    deliveryStatus && deliveryStatus.registeredOwnerEmails.length > 0
  );
  const emailFallbackActive = Boolean(
    effectiveFallbackReason !== null &&
      prefs.channels.emailAlerts &&
      (deliveryStatus ? deliveryStatus.globalEmailAlertsEnabled && hasRegisteredEmails : true)
  );

  return (
    <div
      id="store-notification-preferences-card"
      className="bg-white dark:bg-[#131B2E] p-3.5 sm:p-6 rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm space-y-6 transition-colors"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-purple-900/40">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-400/30 flex items-center justify-center shrink-0">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                Store Notification Preferences
              </h3>
              {prefs.preset === 'recommended' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/60">
                  <Sparkles className="w-3 h-3" />
                  System Default
                </span>
              ) : prefs.preset === 'all' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/60">
                  All Notifications
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60">
                  Custom ({customizedCount} modified)
                </span>
              )}
              {isSaving && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-purple-200/70 mt-1">
              Choose a notification preset or customize individual store event triggers and delivery channels.
            </p>
          </div>
        </div>

        {(prefs.preset !== 'recommended' || customizedCount > 0) && (
          <button
            type="button"
            onClick={() => void handleResetToRecommended()}
            disabled={isSaving || isLoading}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Recommended</span>
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-xs font-semibold text-slate-500 dark:text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
          <span>Loading store notification preferences...</span>
        </div>
      ) : (
        <>
          {/* Section 1: Notification Presets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                1. Notification Presets
              </h4>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Preset updates apply immediately
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {NOTIFICATION_PRESETS.map((preset) => {
                const isSelected = prefs.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-preset={preset.id}
                    aria-pressed={isSelected}
                    disabled={isSaving}
                    onClick={() => void handleSelectPreset(preset.id)}
                    className={`text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2.5 disabled:opacity-70 ${
                      isSelected
                        ? 'bg-purple-50/90 dark:bg-purple-950/50 border-purple-500 dark:border-purple-400 ring-2 ring-purple-500/20 shadow-sm'
                        : 'bg-slate-50/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{preset.label}</span>
                        </div>
                        {preset.badge && (
                          <span
                            className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border ${
                              preset.id === 'recommended'
                                ? 'bg-emerald-100/90 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/60'
                                : preset.id === 'all'
                                ? 'bg-indigo-100/90 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/60'
                                : 'bg-amber-100/90 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700/60'
                            }`}
                          >
                            {preset.badge}
                          </span>
                        )}
                      </div>
                      <span
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          isSelected
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Delivery Channels & Email Fallback */}
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-purple-900/40">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                2. Delivery Channels &amp; Email Fallback
              </h4>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Independent channel controls
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {STORE_NOTIFICATION_CHANNELS.map((channel) => {
                const enabled = Boolean(prefs.channels[channel.id]);
                const customized = isChannelCustomized(prefs, channel.id);
                const Icon = channel.id === 'webPush' ? Radio : Mail;

                return (
                  <div
                    key={channel.id}
                    className={`p-4 rounded-xl border transition-colors flex flex-col justify-between gap-3 ${
                      enabled
                        ? 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700/80'
                        : 'bg-slate-50/40 dark:bg-slate-900/20 border-slate-200/70 dark:border-slate-800/70 opacity-85'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                            enabled
                              ? 'bg-purple-50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-200 dark:border-purple-500/30'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {channel.label}
                            </span>
                            {customized ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60">
                                Custom
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/60">
                                System Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                            {channel.description}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`Toggle ${channel.label}`}
                        data-channel-toggle={channel.id}
                        disabled={isSaving}
                        onClick={() => void handleToggleChannel(channel.id)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500/40 disabled:opacity-50 ${
                          enabled
                            ? 'bg-purple-600 dark:bg-purple-500'
                            : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      {channel.id === 'webPush' ? (
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {deliveryStatus
                            ? deliveryStatus.hasActiveOwnerPushSubscription
                              ? `${deliveryStatus.activeOwnerSubscriptionCount} active owner subscription(s)`
                              : 'No active owner push subscription on record'
                            : 'Push subscription status synced'}
                        </span>
                      ) : (
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {deliveryStatus && deliveryStatus.registeredOwnerEmails.length > 0
                            ? `Recipient: ${deliveryStatus.registeredOwnerEmails.join(', ')}`
                            : 'No registered store owner email found'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Email Fallback Status Banner */}
            <div
              data-testid="email-fallback-status"
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                !prefs.channels.emailAlerts
                  ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
                  : emailFallbackActive
                  ? 'bg-indigo-50/90 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/60 text-indigo-900 dark:text-indigo-200'
                  : 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <div className="font-bold flex flex-wrap items-center gap-2">
                  <span>
                    {!prefs.channels.emailAlerts
                      ? 'Email Fallback Disabled'
                      : emailFallbackActive
                      ? 'Email Fallback Active'
                      : 'Email Fallback Ready'}
                  </span>
                  {!hasRegisteredEmails && deliveryStatus && onNavigateToStoreProfile && (
                    <button
                      type="button"
                      onClick={onNavigateToStoreProfile}
                      className="text-[11px] font-bold underline hover:no-underline cursor-pointer"
                    >
                      Configure Store Email
                    </button>
                  )}
                </div>
                <p className="text-[11.5px] leading-relaxed opacity-90">
                  {!prefs.channels.emailAlerts
                    ? 'Email Alerts are turned OFF. If Web Push is inactive or unreachable, fallback emails will NOT be sent.'
                    : describeFallbackReason(effectiveFallbackReason)}
                </p>
              </div>
            </div>
          </div>

          {/* Section 3: Individual Notification Event Types */}
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-purple-900/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                3. Notification Event Types
              </h4>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <Info className="w-3.5 h-3.5 text-purple-500" />
                <span>Disabled event types are never sent across any channel</span>
              </div>
            </div>

            <div className="space-y-4">
              {categories.map((cat) => {
                const catEvents = STORE_NOTIFICATION_EVENTS.filter(
                  (e) => e.category === cat
                );
                const meta = EVENT_CATEGORY_META[cat];
                return (
                  <div
                    key={cat}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50/40 dark:bg-slate-900/30"
                  >
                    <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {meta.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {meta.subtitle}
                        </div>
                      </div>
                      <Bell className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                    </div>

                    <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                      {catEvents.map((ev) => {
                        const enabled = Boolean(prefs.events[ev.id]);
                        const customized = isEventCustomized(prefs, ev.id);
                        return (
                          <div
                            key={ev.id}
                            className="px-4 py-3.5 flex items-start sm:items-center justify-between gap-4 bg-white/70 dark:bg-transparent hover:bg-slate-50/90 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                                  {ev.label}
                                </span>
                                {ev.recommended ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/60">
                                    System Recommended
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                    Optional
                                  </span>
                                )}
                                {customized && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60">
                                    Custom
                                  </span>
                                )}
                              </div>
                              <p className="text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                {ev.description}
                              </p>
                              <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                {ev.recommendationNote}
                              </p>
                            </div>

                            <div className="flex items-center gap-2.5 shrink-0 pt-0.5 sm:pt-0">
                              <span
                                className={`text-[10.5px] font-extrabold uppercase tracking-wide ${
                                  enabled
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {enabled ? 'ON' : 'OFF'}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                aria-label={`Toggle ${ev.label}`}
                                data-event-toggle={ev.id}
                                disabled={isSaving}
                                onClick={() => void handleToggleEvent(ev.id)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500/40 disabled:opacity-50 ${
                                  enabled
                                    ? 'bg-purple-600 dark:bg-purple-500'
                                    : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
                                    enabled ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
