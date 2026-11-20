export type NotificationPresetId = 'recommended' | 'all' | 'custom';

export type StoreNotificationEventId =
  | 'sale'
  | 'return'
  | 'exchange'
  | 'low_stock'
  | 'subscription'
  | 'announcement';

export type StoreNotificationChannelId = 'webPush' | 'emailAlerts';

export interface NotificationEventMetadata {
  id: StoreNotificationEventId;
  label: string;
  description: string;
  category: 'transactions' | 'inventory' | 'account';
  recommended: boolean;
  recommendationNote: string;
}

export interface NotificationChannelMetadata {
  id: StoreNotificationChannelId;
  label: string;
  description: string;
  recommended: boolean;
  recommendationNote: string;
}

export interface NotificationPresetMetadata {
  id: NotificationPresetId;
  label: string;
  badge?: string;
  description: string;
}

export const STORE_NOTIFICATION_EVENTS: readonly NotificationEventMetadata[] = [
  {
    id: 'sale',
    label: 'Sale Completed',
    description:
      'Instant alerts when a retail or wholesale sale invoice (including same-invoice returns) is completed.',
    category: 'transactions',
    recommended: true,
    recommendationNote: 'System Recommended for real-time revenue and cashier activity visibility.',
  },
  {
    id: 'return',
    label: 'Sales Return Completed',
    description:
      'Alerts when an independent sales return or combined wholesale return refund is processed.',
    category: 'transactions',
    recommended: true,
    recommendationNote: 'System Recommended to monitor refunds and restored stock accurately.',
  },
  {
    id: 'exchange',
    label: 'Exchange Completed',
    description:
      'Alerts when footwear exchanges are completed along with additional payments or refunds.',
    category: 'transactions',
    recommended: true,
    recommendationNote: 'System Recommended for swap verification and net balance differences.',
  },
  {
    id: 'low_stock',
    label: 'Low Stock Threshold Alerts',
    description:
      'Consolidated alerts when products drop to or below their configured reorder threshold.',
    category: 'inventory',
    recommended: true,
    recommendationNote: 'System Recommended to prevent stockouts on fast-moving articles.',
  },
  {
    id: 'subscription',
    label: 'Subscription & Trial Alerts',
    description:
      'Important plan reminders for free trial expiry, subscription renewals, and expiration notices.',
    category: 'account',
    recommended: true,
    recommendationNote: 'System Recommended so store POS access is never interrupted unexpectedly.',
  },
  {
    id: 'announcement',
    label: 'Platform Notices & Broadcasts',
    description:
      'General platform announcements, feature highlights, and informational broadcasts for your store.',
    category: 'account',
    recommended: false,
    recommendationNote: 'Optional informational updates; muted by default in Recommended to reduce alert noise.',
  },
] as const;

export const STORE_NOTIFICATION_CHANNELS: readonly NotificationChannelMetadata[] = [
  {
    id: 'webPush',
    label: 'Web Push Notifications',
    description:
      'Deliver instant browser and mobile PWA push notifications to subscribed store owner devices.',
    recommended: true,
    recommendationNote: 'System Recommended for immediate live alerts while on desktop or mobile.',
  },
  {
    id: 'emailAlerts',
    label: 'Email Alerts',
    description:
      'Send formatted email notifications and receipts to the registered store owner email address (also powers automatic Email Fallback).',
    recommended: true,
    recommendationNote: 'System Recommended for audit trails and automatic Email Fallback when Web Push cannot reach you.',
  },
] as const;

export const NOTIFICATION_PRESETS: readonly NotificationPresetMetadata[] = [
  {
    id: 'recommended',
    label: 'Recommended',
    badge: 'System Default',
    description:
      'Automatically enables critical sales, return, exchange, low-stock, and subscription alerts across Web Push and Email with smart fallback.',
  },
  {
    id: 'all',
    label: 'All Notifications',
    badge: 'Full Coverage',
    description:
      'Enables every notification event type (including informational platform broadcasts) and all delivery channels.',
  },
  {
    id: 'custom',
    label: 'Custom',
    badge: 'Personalized',
    description:
      'Configure every notification event type and delivery channel individually while preserving your preferences.',
  },
] as const;

export type StoreNotificationEventsMap = Record<StoreNotificationEventId, boolean>;

export interface StoreNotificationChannelsMap {
  webPush: boolean;
  emailAlerts: boolean;
}

export interface StoreNotificationCustomSnapshot {
  channels: StoreNotificationChannelsMap;
  events: StoreNotificationEventsMap;
}

export interface StoreNotificationPreferences {
  preset: NotificationPresetId;
  channels: StoreNotificationChannelsMap;
  events: StoreNotificationEventsMap;
  custom: StoreNotificationCustomSnapshot;
  updatedAt?: string;
}

export type EmailFallbackReason =
  | null
  | 'web_push_inactive'
  | 'web_push_unavailable'
  | 'no_active_subscription'
  | 'owner_offline'
  | 'push_delivery_failed';

export interface StoreNotificationDeliveryStatus {
  fcmServerConfigured: boolean;
  hasActiveOwnerPushSubscription: boolean;
  activeOwnerSubscriptionCount: number;
  registeredOwnerEmails: string[];
  globalEmailAlertsEnabled: boolean;
  emailFallbackActive: boolean;
  emailFallbackReason: EmailFallbackReason;
}

export function getRecommendedChannels(): StoreNotificationChannelsMap {
  return {
    webPush: true,
    emailAlerts: true,
  };
}

export function getRecommendedEvents(): StoreNotificationEventsMap {
  return {
    sale: true,
    return: true,
    exchange: true,
    low_stock: true,
    subscription: true,
    announcement: false,
  };
}

export function getAllEnabledChannels(): StoreNotificationChannelsMap {
  return {
    webPush: true,
    emailAlerts: true,
  };
}

export function getAllEnabledEvents(): StoreNotificationEventsMap {
  return {
    sale: true,
    return: true,
    exchange: true,
    low_stock: true,
    subscription: true,
    announcement: true,
  };
}

export function isValidNotificationPreset(value: unknown): value is NotificationPresetId {
  return value === 'recommended' || value === 'all' || value === 'custom';
}

export function createDefaultNotificationPreferences(): StoreNotificationPreferences {
  const recommendedChannels = getRecommendedChannels();
  const recommendedEvents = getRecommendedEvents();
  return {
    preset: 'recommended',
    channels: { ...recommendedChannels },
    events: { ...recommendedEvents },
    custom: {
      channels: { ...recommendedChannels },
      events: { ...recommendedEvents },
    },
  };
}

function normalizeBooleanMap<K extends string>(
  raw: unknown,
  defaults: Record<K, boolean>
): Record<K, boolean> {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...defaults };
  (Object.keys(defaults) as K[]).forEach((key) => {
    if (typeof obj[key] === 'boolean') {
      result[key] = obj[key] as boolean;
    }
  });
  return result;
}

export function normalizeNotificationPreferences(raw: unknown): StoreNotificationPreferences {
  const defaults = createDefaultNotificationPreferences();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  let parsedRaw: any = raw;
  if (typeof raw === 'string') {
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }

  const preset: NotificationPresetId = isValidNotificationPreset(parsedRaw.preset)
    ? parsedRaw.preset
    : 'recommended';

  const customSource =
    parsedRaw.custom && typeof parsedRaw.custom === 'object'
      ? parsedRaw.custom
      : preset === 'custom'
      ? parsedRaw
      : defaults.custom;

  const custom: StoreNotificationCustomSnapshot = {
    channels: normalizeBooleanMap(customSource.channels, getRecommendedChannels()),
    events: normalizeBooleanMap(customSource.events, getRecommendedEvents()),
  };

  let channels: StoreNotificationChannelsMap;
  let events: StoreNotificationEventsMap;

  if (preset === 'recommended') {
    channels = getRecommendedChannels();
    events = getRecommendedEvents();
  } else if (preset === 'all') {
    channels = getAllEnabledChannels();
    events = getAllEnabledEvents();
  } else {
    channels = normalizeBooleanMap(parsedRaw.channels ?? custom.channels, custom.channels);
    events = normalizeBooleanMap(parsedRaw.events ?? custom.events, custom.events);
    custom.channels = { ...channels };
    custom.events = { ...events };
  }

  return {
    preset,
    channels,
    events,
    custom,
    ...(typeof parsedRaw.updatedAt === 'string' && parsedRaw.updatedAt.trim()
      ? { updatedAt: parsedRaw.updatedAt.trim() }
      : {}),
  };
}

export function applyNotificationPreset(
  current: StoreNotificationPreferences,
  nextPreset: NotificationPresetId
): StoreNotificationPreferences {
  const normalizedCurrent = normalizeNotificationPreferences(current);
  const preservedCustom: StoreNotificationCustomSnapshot = {
    channels: { ...normalizedCurrent.custom.channels },
    events: { ...normalizedCurrent.custom.events },
  };

  if (nextPreset === 'recommended') {
    return {
      preset: 'recommended',
      channels: getRecommendedChannels(),
      events: getRecommendedEvents(),
      custom: preservedCustom,
      updatedAt: new Date().toISOString(),
    };
  }

  if (nextPreset === 'all') {
    return {
      preset: 'all',
      channels: getAllEnabledChannels(),
      events: getAllEnabledEvents(),
      custom: preservedCustom,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    preset: 'custom',
    channels: { ...preservedCustom.channels },
    events: { ...preservedCustom.events },
    custom: preservedCustom,
    updatedAt: new Date().toISOString(),
  };
}

export function updateNotificationEventToggle(
  current: StoreNotificationPreferences,
  eventId: StoreNotificationEventId,
  enabled: boolean
): StoreNotificationPreferences {
  const normalized = normalizeNotificationPreferences(current);
  const nextEvents: StoreNotificationEventsMap = {
    ...normalized.events,
    [eventId]: Boolean(enabled),
  };
  const nextChannels: StoreNotificationChannelsMap = { ...normalized.channels };
  return {
    preset: 'custom',
    channels: nextChannels,
    events: nextEvents,
    custom: {
      channels: { ...nextChannels },
      events: { ...nextEvents },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function updateNotificationChannelToggle(
  current: StoreNotificationPreferences,
  channelId: StoreNotificationChannelId,
  enabled: boolean
): StoreNotificationPreferences {
  const normalized = normalizeNotificationPreferences(current);
  const nextChannels: StoreNotificationChannelsMap = {
    ...normalized.channels,
    [channelId]: Boolean(enabled),
  };
  const nextEvents: StoreNotificationEventsMap = { ...normalized.events };
  return {
    preset: 'custom',
    channels: nextChannels,
    events: nextEvents,
    custom: {
      channels: { ...nextChannels },
      events: { ...nextEvents },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function isEventCustomized(
  prefs: StoreNotificationPreferences,
  eventId: StoreNotificationEventId
): boolean {
  const recommended = getRecommendedEvents();
  return Boolean(prefs.events[eventId]) !== Boolean(recommended[eventId]);
}

export function isChannelCustomized(
  prefs: StoreNotificationPreferences,
  channelId: StoreNotificationChannelId
): boolean {
  const recommended = getRecommendedChannels();
  return Boolean(prefs.channels[channelId]) !== Boolean(recommended[channelId]);
}

export function countCustomizedSettings(prefs: StoreNotificationPreferences): number {
  const recEvents = getRecommendedEvents();
  const recChannels = getRecommendedChannels();
  let diff = 0;
  (Object.keys(recEvents) as StoreNotificationEventId[]).forEach((key) => {
    if (Boolean(prefs.events[key]) !== Boolean(recEvents[key])) diff++;
  });
  (Object.keys(recChannels) as StoreNotificationChannelId[]).forEach((key) => {
    if (Boolean(prefs.channels[key]) !== Boolean(recChannels[key])) diff++;
  });
  return diff;
}

export function mapPosActionTypeToEventKey(actionType: string): StoreNotificationEventId | null {
  const upper = String(actionType || '').trim().toUpperCase();
  if (upper === 'SALE' || upper === 'SALE_RETURN') return 'sale';
  if (upper === 'RETURN') return 'return';
  if (upper === 'EXCHANGE' || upper === 'SALE_EXCHANGE') return 'exchange';
  if (upper === 'STOCK' || upper === 'LOW_STOCK') return 'low_stock';
  return null;
}

export function mapPlatformAnnouncementToEventKey(payload: {
  eventId?: string;
  title?: string;
  type?: string;
}): StoreNotificationEventId {
  const eventIdLower = String(payload.eventId || '').toLowerCase();
  const titleLower = String(payload.title || '').toLowerCase();

  if (
    eventIdLower.startsWith('sub-') ||
    eventIdLower.startsWith('trial-') ||
    eventIdLower.startsWith('renewal-') ||
    titleLower.includes('subscription') ||
    titleLower.includes('free trial') ||
    titleLower.includes('renewal request')
  ) {
    return 'subscription';
  }

  return 'announcement';
}

export interface StoreChannelDeliveryInput {
  preferences: StoreNotificationPreferences;
  eventKey: StoreNotificationEventId;
  ownerOnline: boolean;
  fcmConfigured: boolean;
  hasActiveOwnerPushSubscription: boolean;
  ownerTargeted?: boolean;
}

export interface StoreChannelDeliveryPlan {
  eventEnabled: boolean;
  sendInAppSse: boolean;
  sendOwnerWebPush: boolean;
  sendCashierWebPush: boolean;
  sendOwnerEmail: boolean;
  emailFallbackTriggered: boolean;
  emailFallbackReason: EmailFallbackReason;
}

/**
 * Evaluates exact channel routing and Email Fallback behavior for a store notification event:
 * - Disabled event types send nothing.
 * - Web Push only delivers when the Web Push channel is enabled, Firebase Admin SDK is available,
 *   and at least one active push subscription exists.
 * - Email Fallback activates automatically when Web Push is inactive, unavailable, or lacks an
 *   active push subscription (provided Email Alerts are enabled), as well as when the Owner is offline.
 */
export function resolveStoreChannelDelivery(input: StoreChannelDeliveryInput): StoreChannelDeliveryPlan {
  const prefs = normalizeNotificationPreferences(input.preferences);
  const eventEnabled = Boolean(prefs.events[input.eventKey]);

  if (!eventEnabled) {
    return {
      eventEnabled: false,
      sendInAppSse: false,
      sendOwnerWebPush: false,
      sendCashierWebPush: false,
      sendOwnerEmail: false,
      emailFallbackTriggered: false,
      emailFallbackReason: null,
    };
  }

  const ownerTargeted = input.ownerTargeted !== false;
  const webPushEnabled = Boolean(prefs.channels.webPush);
  const emailAlertsEnabled = Boolean(prefs.channels.emailAlerts);
  const fcmConfigured = Boolean(input.fcmConfigured);
  const hasSub = Boolean(input.hasActiveOwnerPushSubscription);

  let nonDeliveryReason: EmailFallbackReason = null;
  if (!webPushEnabled) {
    nonDeliveryReason = 'web_push_inactive';
  } else if (!fcmConfigured) {
    nonDeliveryReason = 'web_push_unavailable';
  } else if (!hasSub) {
    nonDeliveryReason = 'no_active_subscription';
  }

  const canDeliverOwnerPush = nonDeliveryReason === null;
  const sendOwnerWebPush = ownerTargeted && canDeliverOwnerPush;
  const sendCashierWebPush = webPushEnabled && fcmConfigured;

  let emailFallbackReason: EmailFallbackReason = null;
  let emailFallbackTriggered = false;
  let sendOwnerEmail = false;

  if (ownerTargeted && emailAlertsEnabled && nonDeliveryReason !== null) {
    emailFallbackReason = nonDeliveryReason;
    emailFallbackTriggered = true;
    sendOwnerEmail = true;
  }

  return {
    eventEnabled: true,
    sendInAppSse: true,
    sendOwnerWebPush,
    sendCashierWebPush,
    sendOwnerEmail,
    emailFallbackTriggered,
    emailFallbackReason,
  };
}
