import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAuthToken } from '../services/api.ts';
import { offlineQueueService } from '../services/offlineQueueService.ts';
import type { QueuedReturn, QueuedSale } from '../utils/offlineDb.ts';

export type SyncStatusState = 'synced' | 'syncing' | 'pending' | 'offline';

export interface DerivedOfflineSyncState {
  isConnected: boolean;
  pendingCount: number;
  unsyncedCount: number;
  failedCount: number;
  lastSyncError: string | null;
  syncStatus: SyncStatusState;
  indicatorColor: 'green' | 'amber' | 'red';
  hasUnsyncedInvoices: boolean;
  canCloseReminder: boolean;
}

export function deriveOfflineSyncState(params: {
  isOnline: boolean;
  backendConnected: boolean;
  isSyncing: boolean;
  reportedPendingCount: number;
  queueList: QueuedSale[];
  returnsQueueList: QueuedReturn[];
}): DerivedOfflineSyncState {
  const unsyncedSales = params.queueList.filter((s) => s.status !== 'SYNCED');
  const unsyncedReturns = params.returnsQueueList.filter((r) => r.status !== 'SYNCED');
  const failedSales = params.queueList.filter((s) => s.status === 'FAILED');
  const failedReturns = params.returnsQueueList.filter((r) => r.status === 'FAILED');

  const unsyncedCount = unsyncedSales.length + unsyncedReturns.length;
  const failedCount = failedSales.length + failedReturns.length;
  const lastSyncError =
    failedSales.find((s) => s.errorMessage)?.errorMessage ||
    failedReturns.find((r) => r.errorMessage)?.errorMessage ||
    null;

  const pendingCount = Math.max(params.reportedPendingCount, unsyncedCount);
  const isConnected = params.isOnline && params.backendConnected;

  // Never report 'synced' / green while offline or while any pending, syncing, or failed invoices remain
  const syncStatus: SyncStatusState = !isConnected
    ? 'offline'
    : params.isSyncing
    ? 'syncing'
    : pendingCount > 0 || failedCount > 0
    ? 'pending'
    : 'synced';

  const indicatorColor: 'green' | 'amber' | 'red' =
    syncStatus === 'offline' ? 'red' : syncStatus === 'synced' ? 'green' : 'amber';

  const hasUnsyncedInvoices = pendingCount > 0 || params.isSyncing || failedCount > 0;

  return {
    isConnected,
    pendingCount,
    unsyncedCount,
    failedCount,
    lastSyncError,
    syncStatus,
    indicatorColor,
    hasUnsyncedInvoices,
    canCloseReminder: !hasUnsyncedInvoices,
  };
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [backendConnected, setBackendConnected] = useState<boolean>(
    offlineQueueService.isBackendConnected
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(
    offlineQueueService.lastSyncedAt
  );
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [queueList, setQueueList] = useState<QueuedSale[]>([]);
  const [returnsQueueList, setReturnsQueueList] = useState<QueuedReturn[]>([]);

  useEffect(() => {
    let isMounted = true;

    const refreshQueues = () => {
      Promise.all([
        offlineQueueService.getQueue(),
        offlineQueueService.getReturnsQueue(),
      ]).then(([salesQ, returnsQ]) => {
        if (!isMounted) return;
        setQueueList(salesQ);
        setReturnsQueueList(returnsQ);
        setPendingCount(
          salesQ.filter((s) => s.status !== 'SYNCED').length +
            returnsQ.filter((r) => r.status !== 'SYNCED').length
        );
      }).catch(() => {});
    };

    refreshQueues();

    const unsubscribe = offlineQueueService.subscribe((count, syncing, isConnected, lastSync) => {
      if (!isMounted) return;
      setPendingCount(count);
      setIsSyncing(syncing);
      setBackendConnected(isConnected);
      setLastSyncedAt(lastSync);
      setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
      refreshQueues();
    });

    const handleOnline = () => {
      setIsOnline(true);
      offlineQueueService.checkBackendHealth();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setBackendConnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also prime catalog cache if online and authenticated
    if (typeof navigator !== 'undefined' && navigator.onLine && getAuthToken()) {
      offlineQueueService.primeCatalogCache();
      if (!offlineQueueService.isBackendConnected) {
        offlineQueueService.checkBackendHealth();
      }
    }

    return () => {
      isMounted = false;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const derived = useMemo(
    () =>
      deriveOfflineSyncState({
        isOnline,
        backendConnected,
        isSyncing,
        reportedPendingCount: pendingCount,
        queueList,
        returnsQueueList,
      }),
    [isOnline, backendConnected, isSyncing, pendingCount, queueList, returnsQueueList]
  );

  const {
    isConnected,
    pendingCount: effectivePendingCount,
    unsyncedCount,
    failedCount,
    lastSyncError,
    syncStatus,
  } = derived;

  const syncNow = useCallback(async () => {
    return await offlineQueueService.syncPendingSales();
  }, []);

  const checkConnection = useCallback(async () => {
    return await offlineQueueService.checkBackendHealth();
  }, []);

  const recordRemoteSave = useCallback(() => {
    offlineQueueService.recordRemoteSave();
  }, []);

  const retrySale = async (sale: QueuedSale) => {
    return await offlineQueueService.retrySingleSale(sale);
  };

  const removeSale = async (clientTxId: string) => {
    await offlineQueueService.removeSale(clientTxId);
    const updated = await offlineQueueService.getQueue();
    setQueueList(updated);
  };

  const retryReturn = async (ret: QueuedReturn) => {
    return await offlineQueueService.retrySingleReturn(ret);
  };

  const removeReturn = async (clientReturnId: string) => {
    await offlineQueueService.removeReturn(clientReturnId);
    const updated = await offlineQueueService.getReturnsQueue();
    setReturnsQueueList(updated);
  };

  return {
    isOnline,
    backendConnected,
    isConnected,
    lastSyncedAt,
    syncStatus,
    pendingCount: effectivePendingCount,
    unsyncedCount,
    failedCount,
    lastSyncError,
    isSyncing,
    queueList,
    returnsQueueList,
    syncNow,
    checkConnection,
    recordRemoteSave,
    retrySale,
    removeSale,
    retryReturn,
    removeReturn,
  };
}
