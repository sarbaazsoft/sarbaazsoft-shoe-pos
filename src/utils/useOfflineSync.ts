import { useState, useEffect, useCallback } from 'react';
import { offlineQueueService } from '../services/offlineQueueService.ts';
import type { QueuedReturn, QueuedSale } from '../utils/offlineDb.ts';

export type SyncStatusState = 'synced' | 'syncing' | 'pending' | 'offline';

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
    // Initial load of sales & returns queues
    Promise.all([
      offlineQueueService.getQueue(),
      offlineQueueService.getReturnsQueue(),
    ]).then(([salesQ, returnsQ]) => {
      setQueueList(salesQ);
      setReturnsQueueList(returnsQ);
      setPendingCount(
        salesQ.filter((s) => s.status === 'PENDING' || s.status === 'FAILED').length +
          returnsQ.filter((r) => r.status === 'PENDING' || r.status === 'FAILED').length
      );
    });

    const unsubscribe = offlineQueueService.subscribe((count, syncing, isConnected, lastSync) => {
      setPendingCount(count);
      setIsSyncing(syncing);
      setBackendConnected(isConnected);
      setLastSyncedAt(lastSync);
      offlineQueueService.getQueue().then(setQueueList);
      offlineQueueService.getReturnsQueue().then(setReturnsQueueList);
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

    // Also prime catalog cache if online
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      offlineQueueService.primeCatalogCache();
      offlineQueueService.checkBackendHealth();
    }

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Compute fine-grained status
  const syncStatus: SyncStatusState =
    !isOnline || !backendConnected
      ? 'offline'
      : isSyncing
      ? 'syncing'
      : pendingCount > 0
      ? 'pending'
      : 'synced';

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
    lastSyncedAt,
    syncStatus,
    pendingCount,
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
