/**
 * Clean modular domain contracts for offline POS transaction queuing & synchronization.
 * Decouples storage/transport interfaces from React UI components.
 */

export interface QueuedSaleItem {
  productId: number;
  article?: string;
  name?: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal?: number;
  totalStock?: number;
  cartonQuantity?: number;
  pairsPerCarton?: number;
  packingType?: 'CARTON' | 'PAIR' | string;
}

export interface QueuedSale {
  clientTxId: string;
  tenantId?: number | null;
  createdAt: string;
  items: QueuedSaleItem[];
  customerId: number | null;
  customerName?: string;
  customerPhone?: string;
  customerShopName?: string;
  customerCity?: string;
  customerType?: string;
  paymentMethod: 'CASH' | 'CARD' | 'SPLIT' | 'BANK_TRANSFER' | 'ONLINE' | 'KHATA' | string;
  splitCashAmount?: number;
  splitOnlineAmount?: number;
  splitDigitalType?: string;
  transactionId?: string;
  saleType?: 'RETAIL' | 'WHOLESALE' | string;
  totalCartons?: number;
  previousBalance?: number;
  paidAmount?: number;
  amountReceived?: number;
  remainingBalance?: number;
  cashReceived: number;
  changeGiven: number;
  subtotal?: number;
  totalDiscount?: number;
  totalAmount: number;
  exchangeCredit?: number;
  netDifference?: number;
  returnNumber?: string;
  notes: string;
  cashierName?: string;
  cashierId?: number;
  authToken?: string;
  isMinPriceOverridden?: boolean;
  adminOverrideEmail?: string;
  adminOverridePassword?: string;
  exchange?: any | null;
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  errorMessage?: string;
  syncedInvoiceNumber?: string;
  syncedSaleId?: number;
  syncedItems?: Array<{ id: number; productId: number; quantity: number }>;
  syncedAt?: string;
}

export interface QueuedReturnItem {
  saleItemId?: number | null;
  productId: number;
  productName?: string;
  article?: string;
  barcode?: string;
  quantity: number;
  unitRefundPrice: number;
  subtotal?: number;
}

export interface QueuedReturn {
  clientReturnId: string;
  tenantId?: number | null;
  createdAt: string;
  originalSaleId?: number | null;
  originalClientTxId?: string | null;
  originalInvoiceNumber?: string | null;
  customerId?: number | null;
  customerName?: string;
  paymentMethod?: string;
  reason: string;
  items: QueuedReturnItem[];
  totalRefundAmount: number;
  authToken?: string;
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  errorMessage?: string;
  syncedReturnNumber?: string;
  syncedAt?: string;
}

export interface OfflineSyncResult {
  synced: number;
  failed: number;
  abortedByNetwork?: boolean;
}

export interface SyncedSaleResolution {
  saleId: number;
  invoiceNumber: string;
  items: Array<{ id: number; productId: number; quantity: number }>;
}

export interface OfflineSyncStorageAdapter {
  getSales(): Promise<QueuedSale[]>;
  updateSaleStatus(
    clientTxId: string,
    status: QueuedSale['status'],
    extra?: {
      syncedInvoiceNumber?: string;
      syncedSaleId?: number;
      syncedItems?: Array<{ id: number; productId: number; quantity: number }>;
      errorMessage?: string;
      syncedAt?: string;
    }
  ): Promise<void>;
  getReturns?: () => Promise<QueuedReturn[]>;
  updateReturnStatus?: (
    clientReturnId: string,
    status: QueuedReturn['status'],
    extra?: { syncedReturnNumber?: string; errorMessage?: string; syncedAt?: string }
  ) => Promise<void>;
}

export interface OfflineSyncTransport {
  submitCheckout(payload: any): Promise<{ sale?: any; invoiceNumber?: string }>;
  submitReturn?: (payload: any) => Promise<{ returnNumber?: string; returnId?: number; totalRefundAmount?: number }>;
  verifyInvoice?: (invoiceNumber: string) => Promise<{ sale?: any; items?: any[] }>;
}
