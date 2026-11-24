import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Receipt,
  X,
  ShoppingBag,
  Database,
  Cloud,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useOfflineSync } from '../../utils/useOfflineSync.ts';
import { QueuedSale } from '../../utils/offlineDb.ts';
import { formatStockPrice } from '../../utils/priceFormat.ts';

interface OfflineSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  currencySymbol?: string;
}

export const OfflineSyncModal: React.FC<OfflineSyncModalProps> = ({
  isOpen,
  onClose,
  currencySymbol = 'Rs.',
}) => {
  const { isOnline, pendingCount, isSyncing, queueList, syncNow, retrySale, removeSale } = useOfflineSync();
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleManualSync = async () => {
    setSyncFeedback(null);
    const result = await syncNow();
    if (result.synced > 0) {
      setSyncFeedback(`Successfully synchronized ${result.synced} transaction(s) to server.`);
    } else if (result.failed > 0) {
      setSyncFeedback(`Sync completed with ${result.failed} issue(s). Check connection or item stock.`);
    } else {
      setSyncFeedback('All offline transactions are already up to date.');
    }
  };

  return (
    <AnimatePresence>
      <div
        className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center px-2 py-2.5 sm:px-3 sm:py-4 bg-slate-900/60 backdrop-blur-sm no-print"
        onClick={onClose}
      >
        <motion.div
          data-motion-modal="true"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-xl bg-white dark:bg-[#0E1628] rounded-2xl border border-primary-200/80 dark:border-primary-900/60 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[90dvh]"
          role="dialog"
          aria-modal="true"
        >
          {/* Header Accent Bar (matches Notification popup modal) */}
          <div
            className={`h-1.5 w-full ${
              isOnline ? 'bg-emerald-500' : 'bg-primary-500'
            }`}
          />

          <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 flex flex-col min-h-0 flex-1">
            {/* Top Row: Icon Container + Title & Subtitle + Close Button */}
            <div className="flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                {/* Icon Container matching NotificationStatusModal */}
                <div
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-sm shrink-0 border ${
                    isOnline
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400'
                      : 'bg-primary-100 dark:bg-primary-950/60 border-primary-300 dark:border-primary-700/60 text-primary-600 dark:text-primary-400'
                  }`}
                >
                  {isOnline ? (
                    <Wifi className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
                  ) : (
                    <WifiOff className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <h3 className="text-sm sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                      Offline Node & Sync Status
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        isOnline
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                          : 'bg-primary-500/10 text-primary-700 dark:text-primary-300 border border-primary-500/20'
                      }`}
                    >
                      {isOnline ? 'Network Connected' : 'Offline Mode'}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block truncate">
                    POS Local IndexedDB Persistence System
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-2 sm:p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Offline Guidance Card (matching showBrowserGuide style from NotificationStatusModal) */}
            <div
              className={`p-3.5 rounded-xl text-xs space-y-1.5 shrink-0 border ${
                isOnline
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
                  : 'bg-primary-50/70 dark:bg-primary-950/30 border-primary-200/80 dark:border-primary-800/60 text-primary-900 dark:text-primary-200'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <Database className="w-4 h-4 shrink-0" />
                <span>
                  {isOnline
                    ? 'Node Online: Real-time Cloud Synchronization Ready'
                    : 'Node Offline: High-Speed Counter Trading Active'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed">
                {isOnline
                  ? 'Your POS terminal is connected to the cloud server. Pending transactions held in local IndexedDB will synchronize automatically.'
                  : 'Internet connection is temporarily unavailable. All sales, discounts, and receipts are saved securely to your device and will auto-sync once connection returns.'}
              </p>
            </div>

            {/* Metrics Pills Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 shrink-0">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0A0E1A] border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">Total Queue</span>
                  <span className="text-xs font-bold font-mono text-slate-900 dark:text-white">{queueList.length} sales</span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0A0E1A] border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary-500 dark:text-primary-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">Pending Sync</span>
                  <span className="text-xs font-bold font-mono text-primary-600 dark:text-primary-400">{pendingCount}</span>
                </div>
              </div>

              <div className="col-span-2 sm:col-span-1 p-2.5 rounded-xl bg-slate-50 dark:bg-[#0A0E1A] border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <Cloud className={`w-4 h-4 shrink-0 ${isOnline ? 'text-emerald-500' : 'text-primary-500 dark:text-primary-400'}`} />
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">Network</span>
                  <span className={`text-xs font-bold ${isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary-600 dark:text-primary-400'}`}>
                    {isOnline ? 'Connected' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>

            {/* Sync Feedback Alert */}
            {syncFeedback && (
              <div className="p-2.5 rounded-xl bg-primary-50 dark:bg-primary-950/40 border border-primary-200 dark:border-primary-800/60 text-xs text-primary-900 dark:text-primary-200 flex items-center gap-2 shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="flex-1 font-medium">{syncFeedback}</span>
                <button
                  type="button"
                  onClick={() => setSyncFeedback(null)}
                  className="p-1.5 sm:p-0.5 text-primary-400 hover:text-primary-600 dark:hover:text-primary-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Queue List Area */}
            <div className="flex-1 overflow-y-auto min-h-[140px] max-h-[300px] space-y-2 pr-1 custom-scrollbar">
              {queueList.length === 0 ? (
                <div className="py-8 text-center text-slate-400 dark:text-slate-500 space-y-2">
                  <Receipt className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 stroke-[1.5]" />
                  <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Offline queue is empty
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 max-w-xs mx-auto">
                    Any transaction completed while disconnected will appear here and synchronize automatically when reconnected.
                  </p>
                </div>
              ) : (
                queueList.map((sale: QueuedSale) => {
                  const isPending = sale.status === 'PENDING';
                  const isFailed = sale.status === 'FAILED';
                  const isSynced = sale.status === 'SYNCED';
                  const isSyncingItem = sale.status === 'SYNCING';
                  const isExpanded = expandedTxId === sale.clientTxId;

                  return (
                    <div
                      key={sale.clientTxId}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-[#0A0E1A] border border-slate-200 dark:border-slate-800 text-xs transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                              {sale.clientTxId}
                            </span>
                            {isSynced && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Synced: {sale.syncedInvoiceNumber}</span>
                              </span>
                            )}
                            {isPending && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-700 dark:text-primary-300 text-[10px] font-bold">
                                <Clock className="w-3 h-3" />
                                <span>Queued</span>
                              </span>
                            )}
                            {isSyncingItem && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-700 dark:text-primary-300 text-[10px] font-bold">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Syncing...</span>
                              </span>
                            )}
                            {isFailed && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                                <AlertCircle className="w-3 h-3" />
                                <span>Sync Error</span>
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                            <span>{new Date(sale.createdAt).toLocaleTimeString()}</span>
                            <span>•</span>
                            <span>{sale.items.length} item{sale.items.length === 1 ? '' : 's'}</span>
                            <span>•</span>
                            <span className="uppercase font-semibold">{sale.paymentMethod}</span>
                            {sale.customerName && (
                              <>
                                <span>•</span>
                                <span className="text-slate-700 dark:text-slate-300">{sale.customerName}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="text-right flex items-center gap-2 shrink-0">
                          <div>
                            <div className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">
                              {currencySymbol} {formatStockPrice(sale.totalAmount)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Paid: {currencySymbol} {formatStockPrice(sale.cashReceived)}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {isFailed && (
                              <button
                                type="button"
                                onClick={() => retrySale(sale)}
                                title="Retry synchronization"
                                className="p-2 sm:p-1 rounded-lg text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeSale(sale.clientTxId)}
                              title="Delete from local queue"
                              className="p-2 sm:p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedTxId(isExpanded ? null : sale.clientTxId)}
                              className="p-2 sm:p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
                              title="Toggle item details"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded item details */}
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5 text-[10px]">
                          {sale.items.map((item, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-white dark:bg-[#0E1628] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-mono"
                            >
                              {item.quantity}x {item.article || item.name} ({currencySymbol} {formatStockPrice(item.unitPrice)})
                            </span>
                          ))}
                        </div>
                      )}

                      {sale.errorMessage && (
                        <div className="mt-2 text-[10.5px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 p-2 rounded-lg border border-rose-200 dark:border-rose-900/50">
                          Error: {sale.errorMessage}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Action Buttons matching Notification popup modal */}
            <div className="pt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800/80 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing || !isOnline || pendingCount === 0}
                className={`px-4 py-2.5 sm:py-2 rounded-xl text-xs font-bold text-white transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                  isOnline
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-primary-600 hover:bg-primary-700'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>
                  {isSyncing
                    ? 'Syncing with Server...'
                    : pendingCount > 0
                    ? `Sync ${pendingCount} Sale${pendingCount === 1 ? '' : 's'}`
                    : 'All Synced'}
                </span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
