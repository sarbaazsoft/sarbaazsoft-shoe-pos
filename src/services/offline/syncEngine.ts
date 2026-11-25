/**
 * Modular FIFO Offline Sync Engine.
 * Handles idempotent payload serialization, transient network error detection,
 * offline dependency resolution (clientTxId -> real server saleId/saleItemId),
 * and chronological queue replay without coupling to DOM/IndexedDB globals.
 */

import type {
  QueuedReturn,
  QueuedSale,
  OfflineSyncResult,
  OfflineSyncStorageAdapter,
  OfflineSyncTransport,
  SyncedSaleResolution,
} from './offlineTypes.ts';

function normalizeSyncedItems(rawItems: any[]): Array<{ id: number; productId: number; quantity: number }> {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((it) => ({
      id: Number(it?.id || 0),
      productId: Number(it?.productId ?? it?.product_id ?? 0),
      quantity: Number(it?.quantity ?? it?.soldQuantity ?? 0),
    }))
    .filter((it) => it.id > 0 && it.productId > 0);
}

function resolveExchangeAgainstSyncedMap(
  exchange: any,
  syncedByClientTxId: Map<string, SyncedSaleResolution>
): any {
  if (!exchange || !Array.isArray(exchange.items) || exchange.items.length === 0) {
    return null;
  }

  let originalSaleId = exchange.originalSaleId;
  let originalInvoiceNumber = exchange.originalInvoiceNumber;
  let items = exchange.items;

  const clientTxRef =
    exchange.originalClientTxId ||
    (typeof originalInvoiceNumber === 'string' && originalInvoiceNumber.startsWith('OFFLINE-')
      ? originalInvoiceNumber.replace(/\s*\(OFFLINE\)\s*$/i, '').trim()
      : '');

  const resolved = clientTxRef ? syncedByClientTxId.get(clientTxRef) : undefined;
  if (resolved) {
    originalSaleId = resolved.saleId;
    originalInvoiceNumber = resolved.invoiceNumber;
    items = exchange.items.map((ex: any) => {
      const pid = Number(ex.productId ?? ex.product_id ?? 0);
      const matchedItem = resolved.items.find((si) => si.productId === pid);
      const qty = Number(ex.quantity ?? ex.returnQty ?? 1) || 1;
      const unitRefundPrice = Number(ex.unitRefundPrice ?? ex.unit_refund_price ?? 0) || 0;
      return {
        saleItemId: matchedItem ? matchedItem.id : ex.saleItemId,
        productId: pid,
        productName: ex.productName || ex.article,
        article: ex.article || ex.productName,
        quantity: qty,
        unitRefundPrice,
        subtotal:
          ex.subtotal !== undefined
            ? Number(ex.subtotal)
            : Math.round(qty * unitRefundPrice * 100) / 100,
      };
    });
  } else {
    items = exchange.items.map((ex: any) => {
      const qty = Number(ex.quantity ?? ex.returnQty ?? 1) || 1;
      const unitRefundPrice = Number(ex.unitRefundPrice ?? ex.unit_refund_price ?? 0) || 0;
      return {
        saleItemId: ex.saleItemId,
        productId: ex.productId ?? ex.product_id,
        productName: ex.productName || ex.article,
        article: ex.article || ex.productName,
        quantity: qty,
        unitRefundPrice,
        subtotal:
          ex.subtotal !== undefined
            ? Number(ex.subtotal)
            : Math.round(qty * unitRefundPrice * 100) / 100,
      };
    });
  }

  const out: any = {
    originalInvoiceNumber,
    originalSaleDate: exchange.originalSaleDate,
    customerId: exchange.customerId ?? null,
    mode: exchange.mode,
    reason: exchange.reason,
    isExchange: exchange.isExchange,
    isStandaloneExchange: exchange.isStandaloneExchange,
    items,
  };
  if (originalSaleId !== undefined && originalSaleId !== null && Number(originalSaleId) > 0) {
    out.originalSaleId = Number(originalSaleId);
  }
  return out;
}

export function buildCheckoutRequestPayload(
  sale: QueuedSale,
  syncedByClientTxId?: Map<string, SyncedSaleResolution>
): any {
  const payload: any = {
    clientTxId: sale.clientTxId,
    saleDate: sale.createdAt,
    items: (sale.items || []).map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      ...(i.packingType ? { packingType: i.packingType } : {}),
      ...(i.cartonQuantity !== undefined ? { cartonQuantity: i.cartonQuantity } : {}),
      ...(i.pairsPerCarton !== undefined ? { pairsPerCarton: i.pairsPerCarton } : {}),
    })),
    customerId: sale.customerId,
    paymentMethod: sale.paymentMethod,
    ...(sale.splitCashAmount !== undefined ? { splitCashAmount: sale.splitCashAmount } : {}),
    ...(sale.splitOnlineAmount !== undefined ? { splitOnlineAmount: sale.splitOnlineAmount } : {}),
    ...(sale.splitDigitalType ? { splitDigitalType: sale.splitDigitalType } : {}),
    transactionId: sale.transactionId,
    ...(sale.saleType ? { saleType: sale.saleType } : {}),
    ...(sale.totalCartons !== undefined ? { totalCartons: sale.totalCartons } : {}),
    ...(sale.previousBalance !== undefined ? { previousBalance: sale.previousBalance } : {}),
    ...(sale.paidAmount !== undefined ? { paidAmount: sale.paidAmount } : {}),
    ...(sale.amountReceived !== undefined ? { amountReceived: sale.amountReceived } : {}),
    ...(sale.remainingBalance !== undefined ? { remainingBalance: sale.remainingBalance } : {}),
    cashReceived: sale.cashReceived,
    changeGiven: sale.changeGiven,
    notes: sale.notes,
    isMinPriceOverridden: Boolean(sale.isMinPriceOverridden),
    adminOverrideEmail: sale.adminOverrideEmail,
    adminOverridePassword: sale.adminOverridePassword,
  };

  if (sale.exchange && Array.isArray(sale.exchange.items) && sale.exchange.items.length > 0) {
    payload.exchange = resolveExchangeAgainstSyncedMap(
      sale.exchange,
      syncedByClientTxId || new Map()
    );
  }

  return payload;
}

export function buildReturnRequestPayload(
  ret: QueuedReturn,
  syncedByClientTxId?: Map<string, SyncedSaleResolution>
): any {
  let originalSaleId = ret.originalSaleId && Number(ret.originalSaleId) > 0 ? Number(ret.originalSaleId) : null;
  let items = (ret.items || []).map((i) => ({
    saleItemId: i.saleItemId && Number(i.saleItemId) > 0 ? Number(i.saleItemId) : null,
    productId: Number(i.productId),
    quantity: Number(i.quantity),
    unitRefundPrice: Number(i.unitRefundPrice || 0),
  }));

  const clientTxRef =
    ret.originalClientTxId ||
    (typeof ret.originalInvoiceNumber === 'string' && ret.originalInvoiceNumber.startsWith('OFFLINE-')
      ? ret.originalInvoiceNumber.replace(/\s*\(OFFLINE\)\s*$/i, '').trim()
      : '');

  const resolved = clientTxRef && syncedByClientTxId ? syncedByClientTxId.get(clientTxRef) : undefined;
  if (resolved) {
    originalSaleId = resolved.saleId;
    items = (ret.items || []).map((i) => {
      const pid = Number(i.productId);
      const matched = resolved.items.find((si) => si.productId === pid);
      return {
        saleItemId: matched ? matched.id : i.saleItemId && Number(i.saleItemId) > 0 ? Number(i.saleItemId) : null,
        productId: pid,
        quantity: Number(i.quantity),
        unitRefundPrice: Number(i.unitRefundPrice || 0),
      };
    });
  }

  return {
    originalSaleId,
    saleId: originalSaleId,
    customerId: ret.customerId ?? null,
    customerName: ret.customerName,
    paymentMethod: ret.paymentMethod,
    reason: ret.reason || 'Customer Return',
    items,
  };
}

export function isTransientNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const status = Number((err as any)?.status || 0);
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }
  const rawMsg = String((err as any)?.message || err || '');
  const lower = rawMsg.toLowerCase();
  return (
    rawMsg.includes('Failed to fetch') ||
    rawMsg.includes('NetworkError') ||
    rawMsg.includes('Network request failed') ||
    rawMsg.includes('Load failed') ||
    rawMsg.includes('ERR_CONNECTION') ||
    lower.includes('temporarily reconnecting') ||
    lower.includes('internet connection appears to be offline') ||
    lower.includes('network error') ||
    lower.includes('failed to fetch') ||
    lower.includes('unable to reach') ||
    rawMsg.includes('502') ||
    rawMsg.includes('503') ||
    rawMsg.includes('504') ||
    rawMsg.includes('abort')
  );
}

/**
 * Replays pending/failed offline sales and standalone returns in strict chronological (FIFO) order
 * to preserve sequential inventory stock deductions and resolve offline invoice dependencies.
 */
export async function processOfflineSalesQueue(
  storage: OfflineSyncStorageAdapter,
  transport: OfflineSyncTransport,
  onProgress?: () => void
): Promise<OfflineSyncResult> {
  const allSales = await storage.getSales();
  const allReturns = storage.getReturns ? await storage.getReturns() : [];

  const syncedByClientTxId = new Map<string, SyncedSaleResolution>();
  for (const s of allSales) {
    if (s.status === 'SYNCED' && s.clientTxId && s.syncedInvoiceNumber && s.syncedSaleId) {
      syncedByClientTxId.set(s.clientTxId, {
        saleId: s.syncedSaleId,
        invoiceNumber: s.syncedInvoiceNumber,
        items: Array.isArray(s.syncedItems) ? s.syncedItems : [],
      });
    }
  }

  type TimelineEntry =
    | { kind: 'SALE'; createdAt: string; sale: QueuedSale }
    | { kind: 'RETURN'; createdAt: string; ret: QueuedReturn };

  const timeline: TimelineEntry[] = [
    ...allSales
      .filter((s) => s.status === 'PENDING' || s.status === 'FAILED')
      .map((sale) => ({ kind: 'SALE' as const, createdAt: sale.createdAt, sale })),
    ...allReturns
      .filter((r) => r.status === 'PENDING' || r.status === 'FAILED')
      .map((ret) => ({ kind: 'RETURN' as const, createdAt: ret.createdAt, ret })),
  ];

  if (timeline.length === 0) {
    return { synced: 0, failed: 0 };
  }

  timeline.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const ensureClientTxResolution = async (clientTxRef?: string | null) => {
    if (!clientTxRef) return;
    const cleanRef = clientTxRef.replace(/\s*\(OFFLINE\)\s*$/i, '').trim();
    const existing = syncedByClientTxId.get(cleanRef);
    if (existing && existing.items.length > 0) return;

    const priorSale = allSales.find((s) => s.clientTxId === cleanRef && s.status === 'SYNCED');
    if (priorSale?.syncedInvoiceNumber && transport.verifyInvoice) {
      try {
        const verified = await transport.verifyInvoice(priorSale.syncedInvoiceNumber);
        if (verified?.sale?.id) {
          syncedByClientTxId.set(cleanRef, {
            saleId: Number(verified.sale.id),
            invoiceNumber: verified.sale.invoiceNumber || priorSale.syncedInvoiceNumber,
            items: normalizeSyncedItems(verified.items || verified.sale.items || []),
          });
        }
      } catch {
        // Proceed with best known data
      }
    }
  };

  let synced = 0;
  let failed = 0;
  let abortedByNetwork = false;

  for (const entry of timeline) {
    if (entry.kind === 'SALE') {
      const sale = entry.sale;
      try {
        await storage.updateSaleStatus(sale.clientTxId, 'SYNCING');
        onProgress?.();

        if (sale.exchange?.originalClientTxId) {
          await ensureClientTxResolution(sale.exchange.originalClientTxId);
        }

        const payload = buildCheckoutRequestPayload(sale, syncedByClientTxId);
        const res = await transport.submitCheckout(payload);

        const realSaleId = Number(res?.sale?.id || 0) || undefined;
        const realInvoiceNumber = res?.sale?.invoiceNumber || res?.sale?.invoice_number || res?.invoiceNumber;
        const realItems = normalizeSyncedItems(res?.sale?.items || []);

        if (realSaleId && realInvoiceNumber) {
          syncedByClientTxId.set(sale.clientTxId, {
            saleId: realSaleId,
            invoiceNumber: realInvoiceNumber,
            items: realItems,
          });
        }

        await storage.updateSaleStatus(sale.clientTxId, 'SYNCED', {
          syncedInvoiceNumber: realInvoiceNumber,
          syncedSaleId: realSaleId,
          syncedItems: realItems,
          syncedAt: new Date().toISOString(),
          errorMessage: undefined,
        });

        synced++;
      } catch (err: any) {
        if (isTransientNetworkError(err)) {
          await storage.updateSaleStatus(sale.clientTxId, 'PENDING', {
            errorMessage: 'Server offline (will auto-retry on reconnect)',
          });
          failed++;
          abortedByNetwork = true;
          break;
        } else {
          await storage.updateSaleStatus(sale.clientTxId, 'FAILED', {
            errorMessage: String(err?.message || err || 'Unknown sync error'),
          });
          failed++;
        }
      }
    } else {
      const ret = entry.ret;
      if (!transport.submitReturn || !storage.updateReturnStatus) {
        continue;
      }
      try {
        await storage.updateReturnStatus(ret.clientReturnId, 'SYNCING');
        onProgress?.();

        if (ret.originalClientTxId) {
          await ensureClientTxResolution(ret.originalClientTxId);
        }

        const payload = buildReturnRequestPayload(ret, syncedByClientTxId);
        const res = await transport.submitReturn(payload);

        await storage.updateReturnStatus(ret.clientReturnId, 'SYNCED', {
          syncedReturnNumber: res?.returnNumber,
          syncedAt: new Date().toISOString(),
          errorMessage: undefined,
        });

        synced++;
      } catch (err: any) {
        if (isTransientNetworkError(err)) {
          await storage.updateReturnStatus(ret.clientReturnId, 'PENDING', {
            errorMessage: 'Server offline (will auto-retry on reconnect)',
          });
          failed++;
          abortedByNetwork = true;
          break;
        } else {
          await storage.updateReturnStatus(ret.clientReturnId, 'FAILED', {
            errorMessage: String(err?.message || err || 'Unknown return sync error'),
          });
          failed++;
        }
      }
    }
  }

  return { synced, failed, abortedByNetwork };
}
