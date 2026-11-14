import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDataSyncListeners,
  emitDataSync,
  subscribeDataSync,
  type DataSyncEvent,
} from '../src/utils/dataSyncBus.ts';
import {
  normalizeKeepAliveTab,
  updateKeepAliveState,
  type KeepAliveState,
} from '../src/context/RouteLifecycleContext.tsx';

test('dataSyncBus: filters by topic, deduplicates multi-topic emissions, and unsubscribes cleanly', () => {
  clearDataSyncListeners();

  const inventoryEvents: DataSyncEvent[] = [];
  const wildcardEvents: DataSyncEvent[] = [];

  const unsubInv = subscribeDataSync(['products', 'inventory'], (e) => inventoryEvents.push(e));
  const unsubAll = subscribeDataSync('*', (e) => wildcardEvents.push(e));

  // Emitting both 'products' and 'inventory' at once triggers subscriber only ONCE
  emitDataSync(['products', 'inventory', 'products'], { source: 'product-management', productId: 42 });
  assert.equal(inventoryEvents.length, 1);
  assert.deepEqual(inventoryEvents[0].topics, ['products', 'inventory']);
  assert.equal(inventoryEvents[0].detail?.source, 'product-management');
  assert.equal(wildcardEvents.length, 1);

  // Unrelated topic does not fire inventory subscriber
  emitDataSync('suppliers', { source: 'supplier-management' });
  assert.equal(inventoryEvents.length, 1);
  assert.equal(wildcardEvents.length, 2);

  unsubInv();
  emitDataSync('inventory');
  assert.equal(inventoryEvents.length, 1);
  assert.equal(wildcardEvents.length, 3);

  unsubAll();
  clearDataSyncListeners();
});

test('normalizeKeepAliveTab: normalizes cashier and wholesale aliased routes cleanly', () => {
  assert.equal(normalizeKeepAliveTab('dashboard', 'ADMIN', 'RETAIL'), 'dashboard');
  assert.equal(normalizeKeepAliveTab('dashboard', 'CASHIER', 'RETAIL'), 'pos');
  assert.equal(normalizeKeepAliveTab('purchases', 'CASHIER', 'RETAIL'), 'pos');
  assert.equal(normalizeKeepAliveTab('inventory', 'CASHIER', 'RETAIL'), 'inventory');

  assert.equal(normalizeKeepAliveTab('returns', 'ADMIN', 'WHOLESALE'), 'pos');
  assert.equal(normalizeKeepAliveTab('exchange', 'ADMIN', 'WHOLESALE'), 'pos');
  assert.equal(normalizeKeepAliveTab('returns', 'ADMIN', 'RETAIL'), 'returns');
});

test('updateKeepAliveState: preserves mounted DOM order and evicts LRU non-pinned tabs past capacity', () => {
  let state: KeepAliveState = {
    mountedTabs: ['dashboard'],
    lruOrder: ['dashboard'],
  };

  // Visit pos, inventory, customers (max = 4)
  state = updateKeepAliveState(state, 'pos', 4);
  state = updateKeepAliveState(state, 'inventory', 4);
  state = updateKeepAliveState(state, 'customers', 4);

  assert.deepEqual(state.mountedTabs, ['dashboard', 'pos', 'inventory', 'customers']);
  assert.deepEqual(state.lruOrder, ['dashboard', 'pos', 'inventory', 'customers']);

  // Reactivating an already-mounted tab keeps mountedTabs insertion order stable (no DOM node reorder)
  const beforeMounted = state.mountedTabs;
  state = updateKeepAliveState(state, 'pos', 4);
  assert.equal(state.mountedTabs, beforeMounted);
  assert.deepEqual(state.lruOrder, ['dashboard', 'inventory', 'customers', 'pos']);

  // Visiting an already-most-recent tab returns the exact same state reference
  const sameRef = updateKeepAliveState(state, 'pos', 4);
  assert.equal(sameRef, state);

  // Adding a 5th tab evicts the oldest non-pinned tab ('inventory'), preserving pinned 'dashboard' and 'pos'
  state = updateKeepAliveState(state, 'reports', 4);
  assert.equal(state.mountedTabs.length, 4);
  assert.equal(state.mountedTabs.includes('inventory'), false);
  assert.equal(state.mountedTabs.includes('dashboard'), true);
  assert.equal(state.mountedTabs.includes('pos'), true);
  assert.equal(state.mountedTabs.includes('customers'), true);
  assert.equal(state.mountedTabs.includes('reports'), true);
});
