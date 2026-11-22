export type PairSummaryVerb = 'Sold' | 'Returned' | 'Exchanged' | 'Purchased';

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
  returnedQuantity?: number | null;
  unit?: string | null;
  isWholesale?: boolean | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface PurchaseNotificationInput {
  purchaseNo?: string | null;
  totalAmount?: number | string | null;
  paymentMethod?: string | null;
  totalQuantity?: number | null;
  unit?: string | null;
  supplierName?: string | null;
  cashierName?: string | null;
}

export interface ReturnNotificationInput {
  returnNo?: string | null;
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  totalQuantity?: number | null;
  unit?: string | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface ExchangeNotificationInput {
  exchangeNo?: string | null;
  returnNo?: string | null;
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  totalQuantity?: number | null;
  unit?: string | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface CombinedSaleExchangeNotificationInput {
  exchangeNo?: string | null;
  returnNo?: string | null;
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  soldQuantity?: number | null;
  exchangedQuantity?: number | null;
  unit?: string | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export interface CombinedSaleReturnNotificationInput {
  invoiceNo?: string | null;
  amount?: number | string | null;
  paymentMethod?: string | null;
  soldQuantity?: number | null;
  returnedQuantity?: number | null;
  unit?: string | null;
  isWholesale?: boolean | null;
  customerName?: string | null;
  cashierName?: string | null;
}

export function cleanOptionalText(val?: string | null): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return null;
  return trimmed;
}

export function formatNotificationAmount(amount?: number | string | null): string {
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return '0';
  return Math.round(num).toLocaleString('en-US');
}

export function cleanPaymentMethod(paymentMethod?: string | null): string | null {
  const raw = cleanOptionalText(paymentMethod);
  if (!raw) return null;
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
    case 'CHEQUE':
      return 'Cheque';
    default:
      return raw
        .replace(/_/g, ' ')
        .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }
}

export function formatPaymentMethodLabel(paymentMethod?: string | null): string {
  return cleanPaymentMethod(paymentMethod) || 'Cash';
}

export function normalizeQuantityUnit(unit?: string | null): { singular: string; plural: string } {
  const cleaned = (cleanOptionalText(unit) || 'pair').toLowerCase();
  switch (cleaned) {
    case 'pair':
    case 'pairs':
    case 'prs':
    case 'pr':
      return { singular: 'pair', plural: 'pairs' };
    case 'carton':
    case 'cartons':
    case 'ctn':
    case 'ctns':
      return { singular: 'carton', plural: 'cartons' };
    case 'box':
    case 'boxes':
      return { singular: 'box', plural: 'boxes' };
    case 'dozen':
    case 'dozens':
    case 'doz':
      return { singular: 'dozen', plural: 'dozens' };
    case 'pack':
    case 'packs':
      return { singular: 'pack', plural: 'packs' };
    case 'piece':
    case 'pieces':
    case 'pcs':
    case 'pc':
      return { singular: 'piece', plural: 'pieces' };
    case 'unit':
    case 'units':
      return { singular: 'unit', plural: 'units' };
    case 'shoe':
    case 'shoes':
      return { singular: 'shoe', plural: 'shoes' };
    default: {
      const singular = cleaned.endsWith('s') && !cleaned.endsWith('ss') ? cleaned.slice(0, -1) : cleaned;
      const plural = cleaned.endsWith('s') ? cleaned : `${cleaned}s`;
      return { singular, plural };
    }
  }
}

function sanitizeNonNegativeQty(quantity?: number | null): number {
  const raw = Number(quantity ?? 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (Math.abs(raw - Math.round(raw)) < 1e-6) {
    return Math.round(raw);
  }
  return Number(raw.toFixed(2));
}

export function formatUnitQuantity(quantity?: number | null, unit?: string | null): string {
  const safeQty = sanitizeNonNegativeQty(quantity);
  const { singular, plural } = normalizeQuantityUnit(unit);
  const label = safeQty === 1 ? singular : plural;
  return `${safeQty} ${label}`;
}

export function formatPairSummary(
  quantity?: number | null,
  verb: PairSummaryVerb = 'Sold',
  unit?: string | null
): string {
  return `${formatUnitQuantity(quantity, unit)} ${verb}`;
}

export function formatReturnReferenceToExchange(ref?: string | null): string | null {
  const clean = cleanOptionalText(ref)?.replace(/^#+/, '').trim();
  if (!clean) return null;
  if (/^RET-/i.test(clean)) {
    return clean.replace(/^RET-/i, 'EXC-');
  }
  return clean;
}

export function formatSaleNotification(input: SaleNotificationInput): FormattedNotificationContent {
  const rawInv = cleanOptionalText(input.invoiceNo);
  const invoiceNo = rawInv ? rawInv.replace(/^#+/, '').trim() : null;
  const soldQty = sanitizeNonNegativeQty(input.totalQuantity);
  const returnedQty = sanitizeNonNegativeQty(input.returnedQuantity);
  const hasReturn = returnedQty > 0;
  const netQty = sanitizeNonNegativeQty(Math.max(0, soldQty - returnedQty));
  const isWholesale = Boolean(input.isWholesale);

  const soldText = formatUnitQuantity(soldQty, input.unit);
  const returnedText = formatUnitQuantity(returnedQty, input.unit);
  const netText = formatUnitQuantity(netQty, input.unit);

  const customerName = cleanOptionalText(input.customerName);
  const paymentMethod = cleanPaymentMethod(input.paymentMethod);
  const cashierName = cleanOptionalText(input.cashierName);

  const blocks: string[] = [];

  if (invoiceNo) {
    blocks.push(`Invoice: #${invoiceNo}`);
  }

  if (hasReturn) {
    blocks.push(`Total Sold: ${soldText}\nReturned: ${returnedText}\nNet Sold: ${netText}`);
    if (customerName) {
      blocks.push(`Sold to: ${customerName}`);
    }
  } else if (isWholesale) {
    blocks.push(`Total Sold: ${soldText}`);
    if (customerName) {
      blocks.push(`Sold to: ${customerName}`);
    }
  } else {
    blocks.push(customerName ? `${soldText} sold to ${customerName}.` : `${soldText} sold.`);
  }

  if (paymentMethod) {
    blocks.push(`Payment: ${paymentMethod}`);
  }

  if (cashierName) {
    blocks.push(`Processed by: ${cashierName}`);
  }

  const itemsSummary = hasReturn
    ? `Total Sold: ${soldText}, Returned: ${returnedText}, Net Sold: ${netText}`
    : soldText;

  return {
    title: 'Sale Completed ✅',
    message: blocks.map((line) => line.trim()).filter(Boolean).join('\n'),
    itemsSummary,
  };
}

export function formatPurchaseNotification(input: PurchaseNotificationInput): FormattedNotificationContent {
  const rawPur = cleanOptionalText(input.purchaseNo);
  const purchaseNo = rawPur ? rawPur.replace(/^#+/, '').trim() : null;
  const qtyText = formatUnitQuantity(input.totalQuantity, input.unit);
  const supplierName = cleanOptionalText(input.supplierName);
  const paymentMethod = cleanPaymentMethod(input.paymentMethod);
  const cashierName = cleanOptionalText(input.cashierName);

  const blocks: string[] = [];

  if (purchaseNo) {
    blocks.push(`Purchase #: #${purchaseNo}`);
  }

  blocks.push(supplierName ? `${qtyText} purchased from ${supplierName}.` : `${qtyText} purchased.`);

  if (paymentMethod) {
    blocks.push(`Payment: ${paymentMethod}`);
  }

  if (cashierName) {
    blocks.push(`Processed by: ${cashierName}`);
  }

  return {
    title: 'Purchase Completed',
    message: blocks.map((line) => line.trim()).filter(Boolean).join('\n'),
    itemsSummary: qtyText,
  };
}

export function formatReturnNotification(input: ReturnNotificationInput): FormattedNotificationContent {
  const rawRef = cleanOptionalText(input.returnNo ?? input.invoiceNo);
  const returnNo = rawRef ? rawRef.replace(/^#+/, '').trim() : null;
  const qtyText = formatUnitQuantity(input.totalQuantity, input.unit);
  const customerName = cleanOptionalText(input.customerName);
  const paymentMethod = cleanPaymentMethod(input.paymentMethod);
  const cashierName = cleanOptionalText(input.cashierName);

  const rawAmt =
    input.amount !== undefined && input.amount !== null && String(input.amount).trim() !== ''
      ? Number(input.amount)
      : NaN;

  const blocks: string[] = [];

  if (returnNo) {
    blocks.push(`Return #: #${returnNo}`);
  }

  blocks.push(customerName ? `${qtyText} returned by ${customerName}.` : `${qtyText} returned.`);

  if (Number.isFinite(rawAmt) && rawAmt > 0) {
    const formattedAmt = formatNotificationAmount(rawAmt);
    blocks.push(paymentMethod ? `Refund: Rs. ${formattedAmt} (${paymentMethod})` : `Refund: Rs. ${formattedAmt}`);
  }

  if (cashierName) {
    blocks.push(`Processed by: ${cashierName}`);
  }

  return {
    title: 'Return Completed ✅',
    message: blocks.map((line) => line.trim()).filter(Boolean).join('\n'),
    itemsSummary: qtyText,
  };
}

export function formatExchangeNotification(input: ExchangeNotificationInput): FormattedNotificationContent {
  const rawRef = cleanOptionalText(input.exchangeNo ?? input.returnNo ?? input.invoiceNo);
  const exchangeNo = rawRef ? rawRef.replace(/^#+/, '').trim() : null;
  const qtyText = formatUnitQuantity(input.totalQuantity, input.unit);
  const customerName = cleanOptionalText(input.customerName);
  const paymentMethod = cleanPaymentMethod(input.paymentMethod);
  const cashierName = cleanOptionalText(input.cashierName);

  const rawAmt =
    input.amount !== undefined && input.amount !== null && String(input.amount).trim() !== ''
      ? Number(input.amount)
      : NaN;

  const blocks: string[] = [];

  if (exchangeNo) {
    blocks.push(`Exchange #: #${exchangeNo}`);
  }

  blocks.push(customerName ? `${qtyText} exchanged by ${customerName}.` : `${qtyText} exchanged.`);

  if (Number.isFinite(rawAmt) && rawAmt !== 0) {
    const absFormatted = formatNotificationAmount(Math.abs(rawAmt));
    const prefix = rawAmt > 0 ? 'Additional Payment' : 'Refund';
    blocks.push(paymentMethod ? `${prefix}: Rs. ${absFormatted} (${paymentMethod})` : `${prefix}: Rs. ${absFormatted}`);
  }

  if (cashierName) {
    blocks.push(`Processed by: ${cashierName}`);
  }

  return {
    title: 'Exchange Completed ✅',
    message: blocks.map((line) => line.trim()).filter(Boolean).join('\n'),
    itemsSummary: qtyText,
  };
}

export function formatSaleExchangeNotification(
  input: CombinedSaleExchangeNotificationInput
): FormattedNotificationContent {
  const exchangedQty = sanitizeNonNegativeQty(input.exchangedQuantity ?? input.soldQuantity);
  const exchangeRef =
    cleanOptionalText(input.exchangeNo) ||
    formatReturnReferenceToExchange(input.returnNo) ||
    cleanOptionalText(input.invoiceNo);

  return formatExchangeNotification({
    exchangeNo: exchangeRef,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    totalQuantity: exchangedQty,
    unit: input.unit,
    customerName: input.customerName,
    cashierName: input.cashierName,
  });
}

export function formatSaleReturnNotification(
  input: CombinedSaleReturnNotificationInput
): FormattedNotificationContent {
  return formatSaleNotification({
    invoiceNo: input.invoiceNo,
    totalAmount: input.amount,
    paymentMethod: input.paymentMethod,
    totalQuantity: input.soldQuantity,
    returnedQuantity: input.returnedQuantity,
    unit: input.unit,
    isWholesale: input.isWholesale ?? true,
    customerName: input.customerName,
    cashierName: input.cashierName,
  });
}

const COMPLETED_TRANSACTION_TITLE_REGEX =
  /^(?:sale(?:\s*&\s*(?:return|exchange))?|purchase|return|exchange)\s+completed$/i;

const COMPLETED_TRANSACTION_TYPES = new Set([
  'SALE',
  'PURCHASE',
  'RETURN',
  'EXCHANGE',
  'SALE_RETURN',
  'SALE_EXCHANGE',
]);

export function formatNotificationHeaderTitle(title?: string | null): string {
  return String(title || '')
    .replace(/[\u2705\u2714\uFE0F]|\uD83D\uDD04/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCompletedTransactionNotification(input: {
  kind?: string | null;
  type?: string | null;
  itemType?: string | null;
  title?: string | null;
}): boolean {
  if (String(input.kind || '').toUpperCase() === 'NOTICE') {
    return false;
  }
  const cleanTitle = formatNotificationHeaderTitle(input.title);
  if (COMPLETED_TRANSACTION_TITLE_REGEX.test(cleanTitle)) {
    return true;
  }
  const typeUpper = String(input.type || '').trim().toUpperCase();
  const itemTypeUpper = String(input.itemType || '').trim().toUpperCase();
  if (COMPLETED_TRANSACTION_TYPES.has(typeUpper) || COMPLETED_TRANSACTION_TYPES.has(itemTypeUpper)) {
    return !/\b(?:fail(?:ed)?|error|cancel(?:led)?|stock|alert)\b/i.test(cleanTitle);
  }
  return false;
}
