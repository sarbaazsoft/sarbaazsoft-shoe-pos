import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wifi, WifiOff, Cloud, RefreshCw, ChevronRight, ChevronUp, Minus, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useOfflineSync } from '../../utils/useOfflineSync.ts';

const OfflineSyncModal = lazy(() =>
  import('../pos/OfflineSyncModal.tsx').then((m) => ({ default: m.OfflineSyncModal }))
);

interface OfflineToastNotificationProps {
  currencySymbol?: string;
}

export const OfflineToastNotification: React.FC<OfflineToastNotificationProps> = ({
  currencySymbol = 'Rs.',
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [showPostSyncNotice, setShowPostSyncNotice] = useState<boolean>(false);
  const [isManuallyOpened, setIsManuallyOpened] = useState<boolean>(false);

  const {
    isOnline,
    isConnected,
    pendingCount,
    failedCount,
    lastSyncError,
    lastSyncedAt,
    isSyncing,
  } = useOfflineSync();

  const isOffline = !isConnected;
  const hasUnsyncedInvoices = pendingCount > 0 || isSyncing || failedCount > 0;
  const canCloseModal = !hasUnsyncedInvoices;

  const prevOfflineRef = useRef<boolean>(isOffline);
  const hadUnsyncedInvoicesRef = useRef<boolean>(hasUnsyncedInvoices);

  useEffect(() => {
    const wasOffline = prevOfflineRef.current;
    prevOfflineRef.current = isOffline;

    if (!wasOffline && isOffline) {
      // New connection outage: show reminder and reset minimized/dismissed states
      setIsDismissed(false);
      setIsMinimized(false);
      setShowPostSyncNotice(false);
    }

    if (hasUnsyncedInvoices) {
      hadUnsyncedInvoicesRef.current = true;
      setIsDismissed(false);
      setShowPostSyncNotice(false);
    } else if (isConnected && hadUnsyncedInvoicesRef.current) {
      // All offline invoices finished synchronizing: automatically restore X close button
      hadUnsyncedInvoicesRef.current = false;
      setShowPostSyncNotice(true);
    } else if (!hasUnsyncedInvoices && isOffline) {
      hadUnsyncedInvoicesRef.current = false;
    } else if (wasOffline && isConnected && !isManuallyOpened && !showPostSyncNotice) {
      // Returned online with zero unsynced invoices from an empty outage
      setIsDismissed(false);
      setIsMinimized(false);
    }
  }, [isOffline, isConnected, hasUnsyncedInvoices, isManuallyOpened, showPostSyncNotice]);

  useEffect(() => {
    const handleOpenReminder = () => {
      setIsDismissed(false);
      setIsMinimized(false);
      setIsManuallyOpened(true);
    };

    window.addEventListener('pos:open-offline-reminder', handleOpenReminder);
    return () => {
      window.removeEventListener('pos:open-offline-reminder', handleOpenReminder);
    };
  }, []);

  const handleCloseReminder = () => {
    if (!canCloseModal) return;
    setIsDismissed(true);
    setShowPostSyncNotice(false);
    setIsManuallyOpened(false);
  };

  // Visible while offline, while unsynced offline invoices exist, after sync completes, or when opened from Header
  const isVisible =
    ((isOffline || hasUnsyncedInvoices || showPostSyncNotice) && !isDismissed) ||
    isManuallyOpened;

  const connectivityLabel = isConnected
    ? 'Online'
    : !isOnline
    ? 'Offline • No Internet'
    : 'Offline • Server Unreachable';

  const actualSyncStatusLabel = isSyncing
    ? `Syncing ${pendingCount} invoice${pendingCount === 1 ? '' : 's'}...`
    : isOffline
    ? pendingCount > 0
      ? `Paused offline (${pendingCount} queued)`
      : 'Queued locally until online'
    : failedCount > 0
    ? `Sync failed (${failedCount} issue${failedCount === 1 ? '' : 's'})`
    : pendingCount > 0
    ? `Pending sync (${pendingCount} invoice${pendingCount === 1 ? '' : 's'})`
    : 'All invoices synchronized';

  return (
    <>
      <AnimatePresence mode="wait">
        {isVisible && !isMinimized && (
          <motion.div
            key="offline-toast-expanded"
            id="offline-mode-toast-notification"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="fixed bottom-3 left-3 right-3 sm:bottom-4 sm:left-auto sm:right-6 sm:max-w-md z-50 no-print pointer-events-auto"
          >
            <div className="relative w-full bg-white dark:bg-[#0E1628] rounded-2xl border border-primary-200/80 dark:border-primary-900/60 shadow-2xl overflow-hidden">
              {/* Header Accent Bar */}
              <div className="h-1.5 w-full bg-primary-500" />

              <div className="p-3.5 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Icon container matching NotificationStatusModal */}
                    <div
                      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl border flex items-center justify-center shadow-sm shrink-0 ${
                        isConnected && !hasUnsyncedInvoices
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400'
                          : 'bg-primary-100 dark:bg-primary-950/60 border-primary-300 dark:border-primary-700/60 text-primary-600 dark:text-primary-400'
                      }`}
                    >
                      {isConnected ? (
                        isSyncing ? (
                          <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2] animate-spin" />
                        ) : !hasUnsyncedInvoices ? (
                          <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
                        ) : (
                          <Wifi className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
                        )
                      ) : (
                        <WifiOff className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                          {isOffline
                            ? 'Offline Node Active'
                            : isSyncing
                            ? 'Synchronizing Invoices'
                            : failedCount > 0
                            ? 'Sync Attention Needed'
                            : pendingCount > 0
                            ? 'Pending Offline Invoices'
                            : 'Online & Synced'}
                        </h4>
                        <span
                          id="offline-toast-connectivity-badge"
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            isConnected
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                              : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25'
                          }`}
                        >
                          {connectivityLabel}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block truncate">
                        Local IndexedDB Ready
                      </span>
                    </div>
                  </div>

                  {/* Minimize & Close Controls (X hidden whenever unsynced offline invoices exist) */}
                  <div className="flex items-center gap-1 shrink-0 -mt-0.5 -mr-1">
                    <button
                      type="button"
                      id="offline-toast-minimize-btn"
                      onClick={() => setIsMinimized(true)}
                      aria-label="Minimize offline notice"
                      title="Minimize to compact status bar"
                      className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    {canCloseModal && (
                      <button
                        type="button"
                        id="offline-toast-close-btn"
                        onClick={handleCloseReminder}
                        aria-label="Close offline notice"
                        title="Close offline notice"
                        className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-2">
                  <p>
                    {isOffline
                      ? 'POS operations are currently running offline. Sales will queue safely and synchronize automatically when reconnected.'
                      : hasUnsyncedInvoices
                      ? failedCount > 0 && !isSyncing
                        ? 'Connection is active, but one or more offline invoices require retry before closing this reminder.'
                        : 'Connection restored. Unsynced offline invoices are being synchronized to the server.'
                      : 'All offline invoices are synchronized with the server.'}
                  </p>

                  {/* Real-time Connectivity, Pending Count & Sync Status Summary */}
                  <div className="grid grid-cols-2 gap-1.5 p-2 rounded-xl bg-slate-50 dark:bg-[#0A0E1A] border border-slate-200/80 dark:border-slate-800/80 text-[11px]">
                    <div className="flex items-center justify-between gap-1.5 px-1">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Connectivity:</span>
                      <span
                        className={`font-bold ${
                          isConnected
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isConnected ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1.5 px-1">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Pending:</span>
                      <span
                        id="offline-toast-pending-count"
                        className="font-mono font-bold text-primary-600 dark:text-primary-400"
                      >
                        {pendingCount}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-1.5 px-1 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                      <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">Sync Status:</span>
                      <span
                        id="offline-toast-sync-status"
                        className={`font-semibold truncate flex items-center gap-1 ${
                          failedCount > 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : hasUnsyncedInvoices || isOffline
                            ? 'text-primary-600 dark:text-primary-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {failedCount > 0 && <AlertCircle className="w-3 h-3 shrink-0" />}
                        <span>{actualSyncStatusLabel}</span>
                      </span>
                    </div>
                    {failedCount > 0 && lastSyncError && (
                      <div className="col-span-2 px-1 text-[10px] text-rose-600 dark:text-rose-400 truncate">
                        {lastSyncError}
                      </div>
                    )}
                    {!hasUnsyncedInvoices && lastSyncedAt && isConnected && (
                      <div className="col-span-2 px-1 text-[10px] text-slate-400 dark:text-slate-500 truncate">
                        Last synced: {lastSyncedAt.toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
                    <Cloud className="w-3.5 h-3.5 text-primary-500 dark:text-primary-400 shrink-0" />
                    <span>
                      Queue: <strong className="text-slate-900 dark:text-white font-mono font-bold">{pendingCount}</strong>
                    </span>
                    {isSyncing && <RefreshCw className="w-3 h-3 text-primary-600 dark:text-primary-400 animate-spin ml-1 shrink-0" />}
                  </div>

                  <button
                    type="button"
                    id="offline-toast-view-queue-btn"
                    onClick={() => setIsModalOpen(true)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-white transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700"
                  >
                    <span>View Node Queue</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {isVisible && isMinimized && (
          <motion.div
            key="offline-toast-minimized"
            id="offline-mode-toast-minimized"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 20, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.92 }}
            transition={{ type: 'spring', damping: 26, stiffness: 360 }}
            className="fixed bottom-3 right-3 sm:bottom-4 sm:right-6 z-50 no-print pointer-events-auto"
          >
            <div className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-xl bg-white dark:bg-[#0E1628] border border-primary-300/90 dark:border-primary-700/60 shadow-xl text-xs">
              <button
                type="button"
                id="offline-toast-view-queue-btn"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 pr-1 text-left cursor-pointer group"
                title="Open Offline Node Queue"
              >
                <span
                  className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${
                    isConnected && !hasUnsyncedInvoices
                      ? 'bg-emerald-100 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400'
                      : 'bg-primary-100 dark:bg-primary-950/70 border-primary-300 dark:border-primary-700/60 text-primary-600 dark:text-primary-400'
                  }`}
                >
                  {isConnected ? (
                    !hasUnsyncedInvoices ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5" />
                    )
                  ) : (
                    <WifiOff className="w-3.5 h-3.5" />
                  )}
                </span>
                <span className="font-bold text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {isOffline
                    ? 'Offline'
                    : isSyncing
                    ? 'Syncing'
                    : failedCount > 0
                    ? 'Sync Failed'
                    : pendingCount > 0
                    ? 'Pending'
                    : 'Synced'}
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-primary-500/10 border border-primary-500/20 font-mono text-[11px] font-bold text-primary-700 dark:text-primary-300">
                  Queue: {pendingCount}
                </span>
                {isSyncing && <RefreshCw className="w-3 h-3 text-primary-600 dark:text-primary-400 animate-spin shrink-0" />}
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" aria-hidden="true" />

              <button
                type="button"
                id="offline-toast-expand-btn"
                onClick={() => setIsMinimized(false)}
                aria-label="Expand offline notice"
                title="Expand offline notice"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>

              {canCloseModal && (
                <button
                  type="button"
                  id="offline-toast-close-btn"
                  onClick={handleCloseReminder}
                  aria-label="Close offline notice"
                  title="Close offline notice"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline Queue & Sync Modal */}
      {isModalOpen && (
        <Suspense fallback={null}>
          <OfflineSyncModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            currencySymbol={currencySymbol}
          />
        </Suspense>
      )}
    </>
  );
};
