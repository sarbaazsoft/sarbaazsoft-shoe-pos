import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  Flame,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Save,
  RefreshCw,
  RotateCcw,
  Send,
  X,
  BellRing,
  Laptop,
} from 'lucide-react';
import { api } from '../../services/api.ts';
import {
  FCM_TOKEN_KEY,
  acquireAndSyncFcmToken,
  isExplicitUserPushOptOut,
  requestFcmDeviceToken,
  resetFirebaseClientCache,
} from '../../services/firebaseConfig.ts';
import {
  getDetailedPushPermissionStatus,
  watchNotificationPermissionChanges,
  triggerTestNotificationShadeFallback,
  type PushPermissionSnapshot,
} from '../../services/pushNotificationClient.ts';
import {
  areSnapshotsEqual,
  useRegisterUnsavedScope,
} from '../../context/UnsavedChangesContext.tsx';

export interface FcmProviderSettingsState {
  FCM_PROJECT_ID: string;
  FCM_CLIENT_EMAIL: string;
  FCM_PRIVATE_KEY: string;
  FCM_API_KEY: string;
  FCM_MESSAGING_SENDER_ID: string;
  FCM_APP_ID: string;
  FCM_MEASUREMENT_ID: string;
  FCM_VAPID_KEY: string;
}

const EMPTY_FCM_SETTINGS: FcmProviderSettingsState = {
  FCM_PROJECT_ID: '',
  FCM_CLIENT_EMAIL: '',
  FCM_PRIVATE_KEY: '',
  FCM_API_KEY: '',
  FCM_MESSAGING_SENDER_ID: '',
  FCM_APP_ID: '',
  FCM_MEASUREMENT_ID: '',
  FCM_VAPID_KEY: '',
};

interface NotificationAlertProvidersSettingsProps {
  formData?: any;
  setFormData?: React.Dispatch<React.SetStateAction<any>>;
  isEmbeddedInForm?: boolean;
  embedded?: boolean;
  isActive?: boolean;
  fcmDraft?: FcmProviderSettingsState;
  savedFcmBaseline?: FcmProviderSettingsState;
  onFcmDraftChange?: (next: FcmProviderSettingsState) => void;
  onFcmSaved?: (saved: FcmProviderSettingsState) => void;
  onSaveSuccess?: (updated?: any) => void;
  onClose?: () => void;
}

export const NotificationAlertProvidersSettings: React.FC<NotificationAlertProvidersSettingsProps> = ({
  embedded = false,
  isActive = true,
  fcmDraft,
  savedFcmBaseline,
  onFcmDraftChange,
  onFcmSaved,
  onSaveSuccess,
  onClose,
}) => {
  const isControlled = Boolean(fcmDraft && onFcmDraftChange);
  const [savedLocalFcm, setSavedLocalFcm] = useState<FcmProviderSettingsState>(EMPTY_FCM_SETTINGS);
  const [localFcmSettings, setLocalFcmSettings] = useState<FcmProviderSettingsState>(EMPTY_FCM_SETTINGS);

  const fcmSettings = isControlled && fcmDraft ? fcmDraft : localFcmSettings;
  const effectiveSavedFcm = isControlled && savedFcmBaseline ? savedFcmBaseline : savedLocalFcm;

  const [loading, setLoading] = useState(!isControlled);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password / Private Key visibility
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // Test push state
  const [isTestingPush, setIsTestingPush] = useState(false);
  const isTestingPushRef = useRef(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Device registration state
  const [isSubscribingThisDevice, setIsSubscribingThisDevice] = useState(false);
  const [thisDeviceSubscribed, setThisDeviceSubscribed] = useState(false);
  const [permissionSnapshot, setPermissionSnapshot] = useState<PushPermissionSnapshot | null>(null);
  const [deviceStats, setDeviceStats] = useState<{
    configured: boolean;
    projectId: string;
    totalTokens: number;
    tokensByRole: Record<string, number>;
  }>({
    configured: false,
    projectId: '',
    totalTokens: 0,
    tokensByRole: {},
  });

  const isFcmDirty = useMemo(
    () => !loading && !areSnapshotsEqual(fcmSettings, effectiveSavedFcm),
    [loading, fcmSettings, effectiveSavedFcm]
  );

  const getActiveUserRole = (): string => {
    try {
      const raw = localStorage.getItem('pos_current_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.role) return String(parsed.role).toUpperCase();
      }
    } catch {}
    return 'ADMIN';
  };

  const applyPermissionSnapshot = (snap: PushPermissionSnapshot) => {
    setPermissionSnapshot(snap);
    setThisDeviceSubscribed(snap.effectiveStatus === 'granted' && snap.canReceiveSystemNotifications);
  };

  // Load app settings / device stats from server
  const loadSettings = useCallback(async (syncCredentials = !isControlled) => {
    if (!isControlled) setLoading(true);
    try {
      const [appSettingsRes, statsRes, permSnap] = await Promise.all([
        syncCredentials ? api.settings.getAppSettings().catch(() => null) : Promise.resolve(null),
        api.notifications.getFcmStats().catch(() => null),
        getDetailedPushPermissionStatus().catch(() => null),
      ]);

      if (syncCredentials && appSettingsRes?.appSettings) {
        const s = appSettingsRes.appSettings;
        const loaded: FcmProviderSettingsState = {
          FCM_PROJECT_ID: s.FCM_PROJECT_ID || '',
          FCM_CLIENT_EMAIL: s.FCM_CLIENT_EMAIL || '',
          FCM_PRIVATE_KEY: s.FCM_PRIVATE_KEY || '',
          FCM_API_KEY: s.FCM_API_KEY || '',
          FCM_MESSAGING_SENDER_ID: s.FCM_MESSAGING_SENDER_ID || '',
          FCM_APP_ID: s.FCM_APP_ID || '',
          FCM_MEASUREMENT_ID: s.FCM_MEASUREMENT_ID || '',
          FCM_VAPID_KEY: s.FCM_VAPID_KEY || '',
        };
        setSavedLocalFcm(loaded);
        setLocalFcmSettings(loaded);
      }

      if (statsRes) {
        setDeviceStats(statsRes);
      }

      if (permSnap) {
        applyPermissionSnapshot(permSnap);
      }
    } catch (err: any) {
      console.warn('Could not load FCM settings:', err);
    } finally {
      setLoading(false);
    }
  }, [isControlled]);

  useEffect(() => {
    void loadSettings(!isControlled);
    const cleanup = watchNotificationPermissionChanges((snap) => {
      applyPermissionSnapshot(snap);
    });
    return () => {
      cleanup();
    };
  }, [isControlled, loadSettings]);

  const handleChange = (key: keyof FcmProviderSettingsState, value: string) => {
    setSaveMessage(null);
    if (isControlled && onFcmDraftChange && fcmDraft) {
      onFcmDraftChange({ ...fcmDraft, [key]: value });
    } else {
      setLocalFcmSettings((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handleDiscardFcm = useCallback(() => {
    setSaveMessage(null);
    if (isControlled && onFcmDraftChange && savedFcmBaseline) {
      onFcmDraftChange({ ...savedFcmBaseline });
    } else {
      setLocalFcmSettings({ ...savedLocalFcm });
    }
  }, [isControlled, onFcmDraftChange, savedFcmBaseline, savedLocalFcm]);

  const handleSave = useCallback(async (e?: React.FormEvent): Promise<boolean> => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    const payload: FcmProviderSettingsState = {
      FCM_PROJECT_ID: fcmSettings.FCM_PROJECT_ID.trim(),
      FCM_CLIENT_EMAIL: fcmSettings.FCM_CLIENT_EMAIL.trim(),
      FCM_PRIVATE_KEY: fcmSettings.FCM_PRIVATE_KEY.trim(),
      FCM_API_KEY: fcmSettings.FCM_API_KEY.trim(),
      FCM_MESSAGING_SENDER_ID: fcmSettings.FCM_MESSAGING_SENDER_ID.trim(),
      FCM_APP_ID: fcmSettings.FCM_APP_ID.trim(),
      FCM_MEASUREMENT_ID: fcmSettings.FCM_MEASUREMENT_ID.trim(),
      FCM_VAPID_KEY: fcmSettings.FCM_VAPID_KEY.trim(),
    };

    try {
      await api.settings.saveAppSettings({ ...payload } as Record<string, string>);

      if (isControlled) {
        onFcmSaved?.(payload);
      } else {
        setSavedLocalFcm(payload);
        setLocalFcmSettings(payload);
      }

      await resetFirebaseClientCache(true);
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        !isExplicitUserPushOptOut()
      ) {
        const resync = await acquireAndSyncFcmToken(getActiveUserRole(), { forceRefresh: true }).catch((err: any) => ({
          success: false,
          token: undefined,
          error: err?.message || 'Failed to refresh browser FCM registration.',
          warning: undefined,
        }));
        if (resync && !resync.token && (resync.error || resync.warning)) {
          setTestResult({
            success: false,
            message: `Credentials saved, but browser FCM token registration reported: ${resync.error || resync.warning}`,
          });
        } else if (resync?.token) {
          setTestResult(null);
        }
      }

      setSaveMessage({
        type: 'success',
        text: 'Firebase Cloud Messaging credentials saved successfully!',
      });

      await loadSettings(false);
      if (onSaveSuccess) onSaveSuccess(payload);
      setTimeout(() => setSaveMessage(null), 4000);
      return true;
    } catch (err: any) {
      setSaveMessage({
        type: 'error',
        text: err?.message || 'Failed to save Firebase configuration.',
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [fcmSettings, isControlled, loadSettings, onFcmSaved, onSaveSuccess]);

  useRegisterUnsavedScope('settings:app_settings_fcm', {
    label: 'Firebase Push Configuration',
    isDirty: !isControlled && isFcmDirty,
    isActive: !isControlled && isActive,
    save: () => handleSave(),
    discard: handleDiscardFcm,
  });

  const isSuperAdminUser = getActiveUserRole() === 'SUPERADMIN';

  const handleTestPush = async () => {
    if (!isSuperAdminUser || isTestingPushRef.current) return;
    isTestingPushRef.current = true;
    setIsTestingPush(true);
    setTestResult(null);

    try {
      const activeRole = getActiveUserRole();
      const canUseBrowserPush =
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        !isExplicitUserPushOptOut();

      // Ensure this browser device has a registered FCM token before testing when permission is granted
      let hasLocalToken = false;
      try {
        hasLocalToken = Boolean(localStorage.getItem(FCM_TOKEN_KEY));
      } catch {}

      if (canUseBrowserPush && !hasLocalToken) {
        await acquireAndSyncFcmToken(activeRole, { forceRefresh: false }).catch(() => null);
      }

      const dispatchTestAlert = async () => {
        const eventId = `test-fcm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const testTitle = 'Firebase Push Test';
        const testMessage = 'FCM push delivery confirmed. Real-time alerts are operational.';
        const res = await api.notifications.testPush({
          title: testTitle,
          message: testMessage,
          eventId,
        });
        return { res, eventId, testTitle, testMessage };
      };

      let { res, eventId, testTitle, testMessage } = await dispatchTestAlert();

      const rawErrText = `${res.error || ''} ${res.message || ''}`.toLowerCase();
      const isStaleTokenFailure =
        !res.success &&
        (rawErrText.includes('registration-token-not-registered') ||
          rawErrText.includes('invalid-registration-token') ||
          rawErrText.includes('mismatched-credential') ||
          rawErrText.includes('senderid mismatch') ||
          rawErrText.includes('device unregistered'));

      // Self-heal once: server just purged the unregistered token(s), so rotate/re-register this
      // browser's fresh FCM token and retry testPush once automatically.
      if (isStaleTokenFailure && canUseBrowserPush) {
        await resetFirebaseClientCache(true);
        const healed = await acquireAndSyncFcmToken(activeRole, { forceRefresh: true }).catch(() => null);
        if (healed?.success && healed.token) {
          const retried = await dispatchTestAlert();
          res = retried.res;
          eventId = retried.eventId;
          testTitle = retried.testTitle;
          testMessage = retried.testMessage;
        } else if (healed && (healed.error || healed.warning)) {
          res = {
            ...res,
            message: `${res.message || 'FCM delivery reported unregistered device.'} Browser re-registration note: ${healed.error || healed.warning}`,
          };
        }
      }

      if (res.success) {
        void triggerTestNotificationShadeFallback({
          eventId: res.eventId || eventId,
          title: testTitle,
          body: testMessage,
          url: '/admin',
          isAdmin: true,
          fcmSentCount: res.fcmSentCount,
        });
      }

      setTestResult({
        success: res.success,
        message: res.message || (res.success ? '✓ Test push notification dispatched!' : 'Failed to deliver test alert.'),
      });

      const stats = await api.notifications.getFcmStats().catch(() => null);
      if (stats) setDeviceStats(stats);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Error triggering test FCM push alert.',
      });
    } finally {
      setIsTestingPush(false);
      isTestingPushRef.current = false;
    }
  };

  const handleSubscribeThisDevice = async () => {
    setIsSubscribingThisDevice(true);
    setTestResult(null);
    const activeRole = getActiveUserRole();
    try {
      const currentSnap = await getDetailedPushPermissionStatus();
      applyPermissionSnapshot(currentSnap);

      if (currentSnap.effectiveStatus === 'android-system-disabled') {
        setTestResult({
          success: false,
          message:
            'Browser permission may be granted, but Android system notifications (POST_NOTIFICATIONS) are disabled for this app. Enable them in Android Settings → Apps → Notifications, then tap Check Status.',
        });
        return;
      }

      if (currentSnap.effectiveStatus === 'browser-denied') {
        setTestResult({
          success: false,
          message:
            'Notifications are blocked in your browser site settings. Click the lock/site-settings icon (🔒) in your address bar to set Notifications to Allow.',
        });
        return;
      }

      if (currentSnap.effectiveStatus === 'granted' && currentSnap.canReceiveSystemNotifications) {
        await resetFirebaseClientCache(true);
        const syncRes = await acquireAndSyncFcmToken(activeRole, { forceRefresh: true });
        const latestSnap = await getDetailedPushPermissionStatus();
        applyPermissionSnapshot(latestSnap);
        const stats = await api.notifications.getFcmStats().catch(() => null);
        if (stats) setDeviceStats(stats);
        const hasRealToken = Boolean(syncRes.success && syncRes.token);
        setTestResult({
          success: hasRealToken,
          message: hasRealToken
            ? '✓ Existing notification permission & FCM subscription verified for this device!'
            : syncRes.error ||
              syncRes.warning ||
              'Could not verify FCM device token with Firebase. Check your Web API Key, App ID, Sender ID, and VAPID key above.',
        });
        return;
      }

      const res = await requestFcmDeviceToken(activeRole);
      const refreshedSnap = await getDetailedPushPermissionStatus();
      applyPermissionSnapshot(refreshedSnap);

      if (res.success && !res.androidSystemDisabled) {
        const stats = await api.notifications.getFcmStats().catch(() => null);
        if (stats) setDeviceStats(stats);
        setTestResult({
          success: true,
          message: '✓ This device is now registered to receive Firebase push notifications!',
        });
      } else {
        setTestResult({
          success: false,
          message: res.error || 'Failed to subscribe this device.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Failed to request notification permission.',
      });
    } finally {
      setIsSubscribingThisDevice(false);
    }
  };

  const isBackendConfigured = Boolean(
    fcmSettings.FCM_PROJECT_ID && fcmSettings.FCM_CLIENT_EMAIL && fcmSettings.FCM_PRIVATE_KEY
  );

  const isClientConfigured = Boolean(
    fcmSettings.FCM_PROJECT_ID && fcmSettings.FCM_API_KEY && fcmSettings.FCM_APP_ID
  );

  const configConsistencyWarning = useMemo(() => {
    const projectId = fcmSettings.FCM_PROJECT_ID.trim();
    const senderId = fcmSettings.FCM_MESSAGING_SENDER_ID.trim();
    const appId = fcmSettings.FCM_APP_ID.trim();
    const appIdMatch = appId.match(/^1:(\d+):/);
    const senderFromAppId = appIdMatch ? appIdMatch[1] : '';

    if (senderId && senderFromAppId && senderId !== senderFromAppId) {
      return `Sender ID (${senderId}) does not match the project number inside Web App ID (${appId}, expected ${senderFromAppId}). Both must come from the same Firebase Web App to prevent "SenderId mismatch".`;
    }
    if (
      projectId &&
      projectId !== 'sarbaazsoft-shoe-pos' &&
      (senderId === '900875095665' || appId === '1:900875095665:web:2050a569fe0b7eded995d0')
    ) {
      return `Firebase Project ID is "${projectId}", while Sender ID / Web App ID still point to the old default project (900875095665). Replace Web API Key, Sender ID, Web App ID, and VAPID Key from "${projectId}" to avoid "SenderId mismatch".`;
    }
    return null;
  }, [fcmSettings.FCM_PROJECT_ID, fcmSettings.FCM_MESSAGING_SENDER_ID, fcmSettings.FCM_APP_ID]);

  if (loading) {
    return (
      <div className="p-8 text-center bg-white dark:bg-[#131B2E] rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm">
        <RefreshCw className="w-6 h-6 animate-spin text-purple-600 mx-auto mb-2" />
        <span className="text-xs text-slate-500 dark:text-slate-400">Loading FCM configuration...</span>
      </div>
    );
  }

  const content = (
    <div className="space-y-5">
      {/* STATUS METRICS OVERVIEW */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <div className="p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-purple-900/40">
          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Push Provider</span>
          <span className="text-xs font-bold text-amber-600 dark:text-amber-400 font-mono mt-0.5 flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 fill-amber-500 shrink-0" /> <span className="truncate">Firebase FCM</span>
          </span>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-purple-900/40">
          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Admin SDK Status</span>
          <span
            className={`text-xs font-bold font-mono mt-0.5 block truncate ${
              isBackendConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {isBackendConfigured ? '✓ Initialized' : 'Keys Needed'}
          </span>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-purple-900/40">
          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Registered Devices</span>
          <span className="text-xs font-bold text-purple-600 dark:text-purple-400 font-mono mt-0.5 flex items-center gap-1">
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{deviceStats.totalTokens} Device(s)</span>
          </span>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-purple-900/40">
          <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 block font-medium">This Device</span>
          <span
            className={`text-xs font-bold font-mono mt-0.5 flex items-center gap-1 ${
              thisDeviceSubscribed
                ? 'text-emerald-600 dark:text-emerald-400'
                : permissionSnapshot?.effectiveStatus === 'android-system-disabled'
                ? 'text-amber-600 dark:text-amber-400'
                : permissionSnapshot?.effectiveStatus === 'browser-denied'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Laptop className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {thisDeviceSubscribed
                ? 'Subscribed'
                : permissionSnapshot?.effectiveStatus === 'android-system-disabled'
                ? 'OS Disabled'
                : permissionSnapshot?.effectiveStatus === 'browser-denied'
                ? 'Blocked'
                : 'Not Subscribed'}
            </span>
          </span>
        </div>
      </div>

      {/* SECTION 1: BACKEND FIREBASE ADMIN SDK KEYS */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2 pb-2 border-b border-slate-100 dark:border-purple-900/40">
          <Key className="w-4 h-4 text-amber-500" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
            Backend Firebase Admin SDK Credentials
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
          <div className="min-w-0">
            <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Firebase Project ID <span className="text-rose-500 font-bold">*</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_PROJECT_ID)</code>
            </label>
            <input
              type="text"
              value={fcmSettings.FCM_PROJECT_ID}
              onChange={(e) => handleChange('FCM_PROJECT_ID', e.target.value.trim())}
              placeholder="e.g. shoe-pos-app-12345"
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>

          <div className="min-w-0">
            <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Service Account Client Email <span className="text-rose-500 font-bold">*</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_CLIENT_EMAIL)</code>
            </label>
            <input
              type="email"
              value={fcmSettings.FCM_CLIENT_EMAIL}
              onChange={(e) => handleChange('FCM_CLIENT_EMAIL', e.target.value.trim())}
              placeholder="e.g. firebase-adminsdk-xyz@shoe-pos-app.iam.gserviceaccount.com"
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
              <span>Service Account Private Key (PEM)</span>
              <span className="text-rose-500 ml-1 font-bold">*</span>
              <code className="text-[10px] text-purple-600 dark:text-purple-400 font-mono ml-1.5">(FCM_PRIVATE_KEY)</code>
            </label>
            <button
              type="button"
              onClick={() => setShowPrivateKey(!showPrivateKey)}
              className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 flex items-center gap-1 cursor-pointer font-medium"
            >
              {showPrivateKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showPrivateKey ? 'Hide Key' : 'Reveal Key'}</span>
            </button>
          </div>
          <textarea
            rows={4}
            value={showPrivateKey ? fcmSettings.FCM_PRIVATE_KEY : fcmSettings.FCM_PRIVATE_KEY ? '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••\n[Private Key Stored Securely]' : ''}
            onChange={(e) => handleChange('FCM_PRIVATE_KEY', e.target.value)}
            placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----"
            className="w-full p-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20 leading-relaxed"
          />
        </div>
      </div>

      {/* SECTION 2: FRONTEND FIREBASE WEB CLIENT KEYS */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center space-x-2 pb-2 border-b border-slate-100 dark:border-purple-900/40">
          <Smartphone className="w-4 h-4 text-purple-500" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
            Frontend Firebase Web Client Configuration
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
          <div className="min-w-0">
            <label className="flex items-center justify-between gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Web API Key <span className="text-rose-500 font-bold">*</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_API_KEY)</code>
            </label>
            <input
              type="text"
              value={fcmSettings.FCM_API_KEY}
              onChange={(e) => handleChange('FCM_API_KEY', e.target.value.trim())}
              placeholder="AIzaSy..."
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>

          <div className="min-w-0">
            <label className="flex items-center justify-between gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Sender ID <span className="text-rose-500 font-bold">*</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_MESSAGING_SENDER_ID)</code>
            </label>
            <input
              type="text"
              value={fcmSettings.FCM_MESSAGING_SENDER_ID}
              onChange={(e) => handleChange('FCM_MESSAGING_SENDER_ID', e.target.value.trim())}
              placeholder="e.g. 104857291039"
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>

          <div className="min-w-0">
            <label className="flex items-center justify-between gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Web App ID <span className="text-rose-500 font-bold">*</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_APP_ID)</code>
            </label>
            <input
              type="text"
              value={fcmSettings.FCM_APP_ID}
              onChange={(e) => handleChange('FCM_APP_ID', e.target.value.trim())}
              placeholder="1:104857291039:web:abcdef"
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
          <div className="min-w-0">
            <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Web Push / VAPID Key <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_VAPID_KEY)</code>
            </label>
            <input
              type="text"
              value={fcmSettings.FCM_VAPID_KEY}
              onChange={(e) => handleChange('FCM_VAPID_KEY', e.target.value.trim())}
              placeholder="e.g. BEl62iUY... (Web Push Key Pair)"
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>

          <div className="min-w-0">
            <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 min-h-[20px] min-w-0">
              <span className="truncate">
                Analytics Measurement ID <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
              </span>
              <code className="shrink-0 whitespace-nowrap text-[10px] text-purple-600 dark:text-purple-400 font-mono">(FCM_MEASUREMENT_ID)</code>
            </label>
            <input
              type="text"
              value={fcmSettings.FCM_MEASUREMENT_ID}
              onChange={(e) => handleChange('FCM_MEASUREMENT_ID', e.target.value.trim())}
              placeholder="G-XXXXXXX"
              className="w-full h-10 px-3 font-mono bg-slate-50 dark:bg-[#060B18]/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
            />
          </div>
        </div>
      </div>

      {/* CONFIGURATION MISMATCH WARNING */}
      {configConsistencyWarning && (
        <div className="p-3.5 rounded-xl text-xs font-semibold flex items-start gap-2.5 border bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>{configConsistencyWarning}</span>
        </div>
      )}

      {/* FEEDBACK BANNERS */}
      {saveMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
            saveMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          {saveMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span>{saveMessage.text}</span>
        </div>
      )}

      {testResult && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-start gap-2.5 border ${
            testResult.success
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <span>{testResult.message}</span>
          </div>
        </div>
      )}

      {/* ACTION BAR */}
      <div className="pt-4 border-t border-slate-100 dark:border-purple-900/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSubscribeThisDevice}
            disabled={isSubscribingThisDevice}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <BellRing className={`w-3.5 h-3.5 text-purple-500 ${isSubscribingThisDevice ? 'animate-spin' : ''}`} />
            <span>
              {thisDeviceSubscribed
                ? 'Verify Device Registration'
                : permissionSnapshot?.effectiveStatus === 'android-system-disabled' ||
                  permissionSnapshot?.effectiveStatus === 'browser-denied'
                ? 'Check Status'
                : 'Enable Push on This Device'}
            </span>
          </button>

          {isSuperAdminUser && (
            <button
              type="button"
              onClick={handleTestPush}
              disabled={isTestingPush || !isBackendConfigured}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-xs"
              title={!isBackendConfigured ? 'Save Firebase credentials first to enable test push' : 'Send test FCM push notification'}
            >
              <Send className={`w-3.5 h-3.5 ${isTestingPush ? 'animate-spin' : ''}`} />
              <span>{isTestingPush ? 'Dispatching...' : 'Test Push Alert (FCM)'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isFcmDirty && (
            <button
              id="fcm-discard-changes-btn"
              type="button"
              onClick={handleDiscardFcm}
              disabled={isSaving}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Discard Changes</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="w-full sm:w-auto px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-md shadow-purple-600/25 active:scale-95"
          >
            <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
            <span>{isSaving ? 'Saving...' : 'Save Firebase Credentials'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="bg-white dark:bg-[#131B2E] rounded-2xl border border-slate-200 dark:border-purple-800/60 shadow-sm overflow-hidden transition-colors">
      {/* HEADER SECTION */}
      <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-purple-900/40 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-purple-500/5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-orange-500/20">
              <Flame className="w-6 h-6 fill-white stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  Firebase Cloud Messaging (FCM)
                </h3>
                <span
                  className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1.5 ${
                    isBackendConfigured && isClientConfigured
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isBackendConfigured && isClientConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                  />
                  {isBackendConfigured && isClientConfigured ? 'FCM Active' : 'Setup Required'}
                </span>
              </div>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {content}
      </div>
    </div>
  );
};
