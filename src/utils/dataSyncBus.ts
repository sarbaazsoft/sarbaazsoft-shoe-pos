export type DataSyncTopic =
  | 'products'
  | 'inventory'
  | 'sales'
  | 'returns'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'notifications'
  | 'settings';

export interface DataSyncEvent {
  topics: DataSyncTopic[];
  detail?: {
    source?: string;
    [key: string]: unknown;
  };
  timestamp: number;
}

type DataSyncListener = (event: DataSyncEvent) => void;

interface SubscriberEntry {
  topics: Set<DataSyncTopic> | '*';
  handler: DataSyncListener;
}

const subscribers = new Set<SubscriberEntry>();

export function subscribeDataSync(
  topics: DataSyncTopic[] | '*',
  handler: DataSyncListener
): () => void {
  const entry: SubscriberEntry = {
    topics: topics === '*' ? '*' : new Set(topics),
    handler,
  };
  subscribers.add(entry);
  return () => {
    subscribers.delete(entry);
  };
}

export function emitDataSync(
  topics: DataSyncTopic | DataSyncTopic[],
  detail?: DataSyncEvent['detail']
): void {
  const topicList = Array.from(new Set(Array.isArray(topics) ? topics : [topics]));
  if (topicList.length === 0) return;

  const event: DataSyncEvent = {
    topics: topicList,
    detail,
    timestamp: Date.now(),
  };

  for (const entry of Array.from(subscribers)) {
    const subscribedTopics = entry.topics;
    const matches =
      subscribedTopics === '*' || topicList.some((topic) => subscribedTopics.has(topic));
    if (matches) {
      try {
        entry.handler(event);
      } catch (err) {
        console.warn('dataSyncBus listener error:', err);
      }
    }
  }

  // Bridge to legacy window CustomEvents when running in browser
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    const bridgeDetail = { ...(detail || {}), __fromDataSyncBus: true };
    if (topicList.includes('inventory') || topicList.includes('products')) {
      window.dispatchEvent(new CustomEvent('inventory:updated', { detail: bridgeDetail }));
    }
    if (topicList.includes('sales')) {
      window.dispatchEvent(new CustomEvent('pos:sale-completed', { detail: bridgeDetail }));
    }
    if (topicList.includes('returns')) {
      window.dispatchEvent(new CustomEvent('pos:return-completed', { detail: bridgeDetail }));
    }
    if (topicList.includes('purchases')) {
      window.dispatchEvent(new CustomEvent('pos:purchase-completed', { detail: bridgeDetail }));
    }
  }
}

export function clearDataSyncListeners(): void {
  subscribers.clear();
}
