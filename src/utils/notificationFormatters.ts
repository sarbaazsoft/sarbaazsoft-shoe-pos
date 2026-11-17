export type PairSummaryVerb = 'Sold' | 'Returned' | 'Exchanged';

export interface FormattedNotificationContent {
  title: string;
  message: string;
  itemsSummary: string;
}

export interface SaleNotificationInput {
  invoiceNo?: string | null;
  totalAmount?: number | string | null;
  paymentMethod?: string | null;
  totalQuantity?: number | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface ReturnNotificationInput {
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  totalQuantity?: number | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface ExchangeNotificationInput {
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  totalQuantity?: number | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface CombinedSaleExchangeNotificationInput {
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  soldQuantity?: number | null;
  exchangedQuantity?: number | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface CombinedSaleReturnNotificationInput {
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  soldQuantity?: number | null;
  returnedQuantity?: number | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export function cleanNotificationInvoiceNo(invoiceNo?: string | null): string {
  const cleaned = String(invoiceNo ?? '')
    .trim()
    .replace(/^#+/, '')
    .trim();
  return cleaned || 'N/A';
}

export function formatNotificationAmount(amount?: number | string | null): string {
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return '0';
  return Math.round(num).toLocaleString('en-US');
}

export function formatPaymentMethodLabel(paymentMethod?: string | null): string {
  const raw = String(paymentMethod ?? '').trim();
  if (!raw) return 'Cash';
  const upper = raw.toUpperCase();
  switch (upper) {
    case 'CASH':
      return 'Cash';
    case 'ONLINE':
      return 'Online';
    case 'BANK_TRANSFER':
      return 'Bank Transfer';
    case 'SPLIT':
      return 'Split';
    case 'KHATA':
      return 'Khata';
    case 'CARD':
      return 'Card';
    default:
      return raw
        .replace(/_/g, ' ')
        .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }
}

export function formatPairSummary(quantity?: number | null, verb: PairSummaryVerb = 'Sold'): string {
  const parsed = Math.round(Number(quantity ?? 0));
  const safeQty = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const pairLabel = safeQty === 1 ? 'Pair' : 'Pairs';
  return `${safeQty} ${pairLabel} ${verb}`;
}

export function formatSaleNotification(input: SaleNotificationInput): FormattedNotificationContent {
  const invoiceNo = cleanNotificationInvoiceNo(input.invoiceNo);
  const totalAmount = formatNotificationAmount(input.totalAmount);
  const paymentMethod = formatPaymentMethodLabel(input.paymentMethod);
  const itemsSummary = formatPairSummary(input.totalQuantity, 'Sold');
  const customerName = String(input.customerName ?? '').trim() || 'Walk-in Customer';
  const cashierName = String(input.cashierName ?? '').trim() || 'Counter Staff';

  return {
    title: 'Sale Completed ✅',
    message: `#${invoiceNo} · Rs. ${totalAmount} (${paymentMethod})\n${itemsSummary} · ${customerName}\nCashier: ${cashierName}`,
    itemsSummary,
  };
}

export function formatReturnNotification(input: ReturnNotificationInput): FormattedNotificationContent {
  const invoiceNo = cleanNotificationInvoiceNo(input.invoiceNo);
  const amount = formatNotificationAmount(input.amount);
  const paymentMethod = formatPaymentMethodLabel(input.paymentMethod);
  const itemsSummary = formatPairSummary(input.totalQuantity, 'Returned');
  const customerName = String(input.customerName ?? '').trim() || 'Walk-in Customer';
  const cashierName = String(input.cashierName ?? '').trim() || 'Authorized Staff';

  return {
    title: 'Return Completed 🔄',
    message: `#${invoiceNo} · Refund: Rs. ${amount} (${paymentMethod})\n${itemsSummary} · ${customerName}\nProcessed by: ${cashierName}`,
    itemsSummary,
  };
}

export function formatExchangeNotification(input: ExchangeNotificationInput): FormattedNotificationContent {
  const invoiceNo = cleanNotificationInvoiceNo(input.invoiceNo);
  const amount = formatNotificationAmount(input.amount);
  const paymentMethod = formatPaymentMethodLabel(input.paymentMethod);
  const itemsSummary = formatPairSummary(input.totalQuantity, 'Exchanged');
  const customerName = String(input.customerName ?? '').trim() || 'Walk-in Customer';
  const cashierName = String(input.cashierName ?? '').trim() || 'Counter Staff';

  return {
    title: 'Exchange Completed 🔄',
    message: `#${invoiceNo} · Adjustment: Rs. ${amount} (${paymentMethod})\n${itemsSummary} · ${customerName}\nProcessed by: ${cashierName}`,
    itemsSummary,
  };
}

export function formatSaleExchangeNotification(
  input: CombinedSaleExchangeNotificationInput
): FormattedNotificationContent {
  const invoiceNo = cleanNotificationInvoiceNo(input.invoiceNo);
  const netNum = Number(input.amount ?? 0);
  const safeNet = Number.isFinite(netNum) ? netNum : 0;
  const amountLabel =
    safeNet < 0
      ? `Refund: Rs. ${formatNotificationAmount(Math.abs(safeNet))}`
      : `Net: Rs. ${formatNotificationAmount(safeNet)}`;
  const paymentMethod = formatPaymentMethodLabel(input.paymentMethod);
  const soldSummary = formatPairSummary(input.soldQuantity, 'Sold');
  const exchangedSummary = formatPairSummary(input.exchangedQuantity, 'Exchanged');
  const itemsSummary = `${soldSummary}, ${exchangedSummary}`;
  const customerName = String(input.customerName ?? '').trim() || 'Walk-in Customer';
  const cashierName = String(input.cashierName ?? '').trim() || 'Counter Staff';

  return {
    title: 'Sale & Exchange Completed ✅',
    message: `#${invoiceNo} · ${amountLabel} (${paymentMethod})\n${itemsSummary} · ${customerName}\nCashier: ${cashierName}`,
    itemsSummary,
  };
}

export function formatSaleReturnNotification(
  input: CombinedSaleReturnNotificationInput
): FormattedNotificationContent {
  const invoiceNo = cleanNotificationInvoiceNo(input.invoiceNo);
  const netNum = Number(input.amount ?? 0);
  const safeNet = Number.isFinite(netNum) ? netNum : 0;
  const amountLabel =
    safeNet < 0
      ? `Refund: Rs. ${formatNotificationAmount(Math.abs(safeNet))}`
      : `Net: Rs. ${formatNotificationAmount(safeNet)}`;
  const paymentMethod = formatPaymentMethodLabel(input.paymentMethod);
  const soldSummary = formatPairSummary(input.soldQuantity, 'Sold');
  const returnedSummary = formatPairSummary(input.returnedQuantity, 'Returned');
  const itemsSummary = `${soldSummary}, ${returnedSummary}`;
  const customerName = String(input.customerName ?? '').trim() || 'Walk-in Customer';
  const cashierName = String(input.cashierName ?? '').trim() || 'Counter Staff';

  return {
    title: 'Sale & Return Completed ✅',
    message: `#${invoiceNo} · ${amountLabel} (${paymentMethod})\n${itemsSummary} · ${customerName}\nCashier: ${cashierName}`,
    itemsSummary,
  };
}
