import { formatStockPrice } from '../../utils/priceFormat.ts';
import { escapeHtml } from '../../utils/htmlEscape.ts';
import { formatReceiptPaymentMethodLabel } from '../../utils/notificationFormatters.ts';
import type { PosActionNotification } from '../pushNotificationService.ts';

export { escapeHtml };

export interface TransactionReceiptItem {
  product_id?: number;
  article?: string;
  product_name?: string;
  name?: string;
  brand_name?: string;
  packing_type?: string;
  carton_quantity?: number | string | null;
  cartonQuantity?: number | string | null;
  pairs_per_carton?: number | string | null;
  pairsPerCarton?: number | string | null;
  quantity: number | string;
  unit_price: number | string;
  discount?: number | string;
  subtotal: number | string;
}

export interface TransactionReturnedItem {
  productName?: string;
  product_name?: string;
  article?: string;
  quantity: number | string;
  unitRefundPrice?: number | string;
  unit_refund_price?: number | string;
  subtotal: number | string;
}

export interface TransactionSaleRecord {
  id?: number;
  invoice_number?: string;
  return_number?: string;
  sale_type?: string;
  saleType?: string;
  sale_date?: string;
  subtotal?: number | string;
  discount?: number | string;
  total_amount?: number | string;
  total_cartons?: number | string;
  previous_balance?: number | string;
  paid_amount?: number | string;
  remaining_balance?: number | string;
  payment_method?: string;
  cash_received?: number | string;
  change_given?: number | string;
  cashier_name?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_shop_name?: string;
  customer_market_name?: string;
  customer_city?: string;
  customer_type?: string;
  customerType?: string;
  customer_ntn?: string;
  notes?: string;
  reason?: string;
  exchange_credit?: number | string;
  exchangeCredit?: number | string;
  items?: TransactionReceiptItem[];
  returned_items?: TransactionReturnedItem[];
  returnedItems?: TransactionReturnedItem[];
}

export interface TransactionCompanySettings {
  name?: string;
  company_name?: string;
  companyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  strn?: string;
  tax_id?: string;
  tax_number?: string;
  taxNumber?: string;
  currency_symbol?: string;
  currencySymbol?: string;
  invoice_footer?: string;
  invoiceFooter?: string;
  business_type?: string;
  businessType?: string;
  show_receipt_logo?: boolean;
  showReceiptLogo?: boolean;
  receipt_logo?: string;
  receiptLogo?: string;
  logo?: string;
}

export interface TransactionReceiptEmailInput {
  payload: PosActionNotification;
  sale?: TransactionSaleRecord | null;
  companySettings?: TransactionCompanySettings | null;
  generatedAt?: Date;
}

export interface TransactionReceiptEmailOutput {
  subject: string;
  actionTitle: string;
  storeName: string;
  isWholesaleTransaction: boolean;
  layoutMode: 'thermal_50mm' | 'a4';
  html: string;
  text: string;
}

export function sanitizeStoreName(name?: string | null): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (
    trimmed === '{Store Name}' ||
    trimmed === '{store_name}' ||
    trimmed === '{storeName}' ||
    trimmed === 'Store Name' ||
    trimmed === '[Store Name]' ||
    trimmed === 'SarbaazSoft Shoe POS' ||
    trimmed === 'SarbaazSoft POS' ||
    trimmed.toLowerCase() === '{store name}' ||
    trimmed.toLowerCase() === '{store_name}'
  ) {
    return '';
  }
  return trimmed
    .replace(/\{Store Name\}/gi, '')
    .replace(/SarbaazSoft Shoe POS/gi, '')
    .replace(/SarbaazSoft POS/gi, '')
    .replace(/\|\s*$/g, '')
    .trim();
}

export function sanitizeInvoiceFooter(footer?: string | null): string {
  if (!footer) return '';
  const trimmed = footer.trim();
  if (
    trimmed === 'Powered by SarbaazSoft Shoe POS • © 2026 All rights reserved.' ||
    trimmed === 'Powered by SarbaazSoft Shoe POS' ||
    trimmed === 'SarbaazSoft Shoe POS' ||
    trimmed.toLowerCase().includes('sarbaazsoft')
  ) {
    return trimmed
      .replace(/Powered by\s+SarbaazSoft Shoe POS[\s•·-]*©?\s*20\d\d\s*All rights reserved\.?/gi, '')
      .replace(/Powered by\s+SarbaazSoft Shoe POS/gi, '')
      .replace(/SarbaazSoft Shoe POS/gi, '')
      .replace(/SarbaazSoft POS/gi, '')
      .replace(/(©|&copy;)?\s*20\d\d\s*All rights reserved\.?/gi, '')
      .replace(/Powered by[\s\S]*$/gi, '')
      .trim();
  }
  return trimmed;
}

export function formatPaymentMethodLabel(method?: string | null): string {
  return formatReceiptPaymentMethodLabel(method);
}

export function resolveIsWholesaleTransaction(
  sale?: TransactionSaleRecord | null,
  companySettings?: TransactionCompanySettings | null
): boolean {
  const customerTypeRaw = String(sale?.customer_type || sale?.customerType || '').toUpperCase();
  const isExplicitWholesaler =
    customerTypeRaw === 'WHOLESALER' ||
    customerTypeRaw === 'WHOLESALE' ||
    customerTypeRaw === 'DEALER';
  const isExplicitRetailer =
    customerTypeRaw === 'RETAILER' ||
    customerTypeRaw === 'RETAIL' ||
    customerTypeRaw === 'WALK_IN';

  const isWholesaleStore =
    String(companySettings?.businessType || companySettings?.business_type || '').toUpperCase() ===
    'WHOLESALE';
  const isWholesaleSale =
    String(sale?.sale_type || sale?.saleType || '').toUpperCase() === 'WHOLESALE';
  const hasWholesaleAttributes = Boolean(
    sale?.customer_shop_name || Number(sale?.total_cartons || 0) > 0
  );

  return (
    isExplicitWholesaler ||
    (!isExplicitRetailer && (isWholesaleSale || isWholesaleStore || hasWholesaleAttributes))
  );
}

function parseReturnedCreditFromNotes(notes?: string | null): number {
  if (!notes) return 0;
  const match = String(notes).match(/Returned Credit:\s*Rs\.?\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (!match) return 0;
  const num = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function buildFallbackItemsFromPayload(
  payload: PosActionNotification,
  totalAmountDue: number
): TransactionReceiptItem[] {
  const summary = String(payload.exchangeDetails?.newItems || payload.itemsSummary || '').trim();
  const explicitTotalPairs =
    typeof payload.totalPairs === 'number' && Number.isFinite(payload.totalPairs) && payload.totalPairs > 0
      ? payload.totalPairs
      : null;

  if (!summary) {
    if (explicitTotalPairs !== null) {
      const unitPrice = totalAmountDue > 0 ? Math.round(totalAmountDue / explicitTotalPairs) : 0;
      return [
        {
          article: 'Footwear Item(s)',
          product_name: 'Footwear Item(s)',
          quantity: explicitTotalPairs,
          unit_price: unitPrice,
          subtotal: totalAmountDue,
        },
      ];
    }
    return [];
  }

  // Handle "2x Article A, 1x Article B" if provided cleanly
  const segments = summary
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 1 && /^\d+\s*x\s+/i.test(segments[0])) {
    const m = segments[0].match(/^(\d+)\s*x\s+(.+)$/i);
    if (m) {
      const qty = Math.max(1, parseInt(m[1], 10) || 1);
      const unitPrice = totalAmountDue > 0 ? Math.round(totalAmountDue / qty) : 0;
      return [
        {
          article: m[2].trim(),
          product_name: m[2].trim(),
          quantity: qty,
          unit_price: unitPrice,
          subtotal: totalAmountDue,
        },
      ];
    }
  }

  if (segments.length === 1) {
    const pairSegMatch = segments[0].match(/^(\d+)\s*pairs?$/i);
    if (pairSegMatch || explicitTotalPairs !== null) {
      const qty = pairSegMatch
        ? Math.max(1, parseInt(pairSegMatch[1], 10) || 1)
        : explicitTotalPairs!;
      const label = pairSegMatch ? 'Footwear Item(s)' : segments[0];
      const unitPrice = totalAmountDue > 0 ? Math.round(totalAmountDue / qty) : 0;
      return [
        {
          article: label,
          product_name: label,
          quantity: qty,
          unit_price: unitPrice,
          subtotal: totalAmountDue,
        },
      ];
    }
  }

  return segments.map((seg, idx) => {
    const m = seg.match(/^(\d+)\s*x\s+(.+)$/i);
    const pairMatch = seg.match(/^(\d+)\s*pairs?$/i);
    const qty = m
      ? Math.max(1, parseInt(m[1], 10) || 1)
      : pairMatch
      ? Math.max(1, parseInt(pairMatch[1], 10) || 1)
      : 1;
    const label = m ? m[2].trim() : pairMatch ? 'Footwear Item(s)' : seg;
    return {
      article: label,
      product_name: label,
      quantity: qty,
      unit_price: idx === 0 && segments.length === 1 ? Math.round(totalAmountDue / qty) : 0,
      subtotal: idx === 0 && segments.length === 1 ? totalAmountDue : 0,
    };
  });
}

function buildFallbackReturnedItemsFromPayload(
  payload: PosActionNotification
): TransactionReturnedItem[] {
  const raw = String(payload.exchangeDetails?.oldItems || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(\d+)\s*x\s+(.+)$/i);
      const qty = m ? Math.max(1, parseInt(m[1], 10) || 1) : 1;
      const name = m ? m[2].trim() : seg;
      return {
        product_name: name,
        quantity: qty,
        unit_refund_price: 0,
        subtotal: 0,
      };
    });
}

function isSafeEmailImageUrl(src?: string | null): boolean {
  if (!src) return false;
  const trimmed = src.trim();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/')
  );
}

function renderThermal50mmPreviewHtml(params: {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  taxNumber: string;
  invoiceFooter: string;
  showReceiptLogo: boolean;
  receiptLogo: string;
  currencySymbol: string;
  docLabel: string;
  docNumber: string;
  saleDate: string;
  cashierName: string;
  customerName: string;
  totalPairsLabel: string;
  paymentMethodLabel: string;
  items: TransactionReceiptItem[];
  returnedItems: TransactionReturnedItem[];
  isStandaloneReturn: boolean;
  isWholesaleTransaction: boolean;
  effectiveSubtotal: number;
  discount: number;
  exchangeCredit: number;
  previousBalance: number;
  currentItemsTotal: number;
  grandTotalDue: number;
  paidAmount: number;
  remainingBalance: number;
  changeGiven: number;
  refundTotal: number;
  reason?: string;
}): string {
  const {
    storeName,
    storeAddress,
    storePhone,
    taxNumber,
    invoiceFooter,
    showReceiptLogo,
    receiptLogo,
    currencySymbol,
    docLabel,
    docNumber,
    saleDate,
    cashierName,
    customerName,
    totalPairsLabel,
    paymentMethodLabel,
    items,
    returnedItems,
    isStandaloneReturn,
    isWholesaleTransaction,
    effectiveSubtotal,
    discount,
    exchangeCredit,
    previousBalance,
    currentItemsTotal,
    grandTotalDue,
    paidAmount,
    remainingBalance,
    changeGiven,
    refundTotal,
    reason,
  } = params;

  const logoHtml =
    showReceiptLogo && isSafeEmailImageUrl(receiptLogo)
      ? `<div style="margin-bottom: 6px; text-align: center;"><img src="${escapeHtml(
          receiptLogo
        )}" alt="${escapeHtml(
          storeName
        )}" style="max-height: 34px; max-width: 84px; width: auto; height: auto; display: inline-block;" /></div>`
      : '';

  const itemRowsHtml =
    items.length > 0
      ? items
          .map((item) => {
            const title = escapeHtml(item.article || item.product_name || item.name || 'Footwear Item');
            const qty = Number(item.quantity || 0);
            const unitPrice = Number(item.unit_price || 0);
            const lineSubtotal = Number(item.subtotal || qty * unitPrice);
            return `
              <tr>
                <td colspan="2" style="padding: 5px 0 4px 0; border-bottom: 1px solid #f3f4f6;">
                  <div style="font-weight: 700; color: #000000; font-size: 10.5px; line-height: 1.3;">${title}</div>
                  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 2px;">
                    <tr>
                      <td style="font-size: 9.5px; color: #6b7280; font-family: 'Courier New', Courier, monospace;">
                        ${qty} &times; ${escapeHtml(currencySymbol)} ${formatStockPrice(unitPrice)}
                      </td>
                      <td align="right" style="font-size: 10px; font-weight: 700; color: #000000; font-family: 'Courier New', Courier, monospace;">
                        ${escapeHtml(currencySymbol)} ${formatStockPrice(lineSubtotal)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            `;
          })
          .join('')
      : '';

  const returnedRowsHtml =
    returnedItems.length > 0
      ? `
        <tr>
          <td colspan="2" style="padding: 6px 0 2px 0; border-top: ${
            items.length > 0 ? '1px dashed #9ca3af' : 'none'
          };">
            <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #4338ca; letter-spacing: 0.4px; margin-bottom: 3px;">
              ${isStandaloneReturn ? 'Returned Items' : 'Returned / Exchanged Items'}
            </div>
            ${returnedItems
              .map((r) => {
                const name = escapeHtml(r.article || r.productName || r.product_name || 'Returned Item');
                const qty = Number(r.quantity || 0);
                const rate = Number(r.unitRefundPrice ?? r.unit_refund_price ?? 0);
                const sub = Number(r.subtotal ?? qty * rate);
                return `
                  <div style="padding: 3px 0; border-bottom: 1px solid #f3f4f6;">
                    <div style="font-weight: 700; color: #111827; font-size: 10px;">${name}</div>
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 9px; color: #6b7280; font-family: 'Courier New', Courier, monospace;">
                          ${qty} prs${rate > 0 ? ` &times; ${escapeHtml(currencySymbol)} ${formatStockPrice(rate)}` : ''}
                        </td>
                        <td align="right" style="font-size: 9.5px; font-weight: 700; color: ${
                          isStandaloneReturn ? '#dc2626' : '#4338ca'
                        }; font-family: 'Courier New', Courier, monospace;">
                          ${sub > 0 ? `-${escapeHtml(currencySymbol)} ${formatStockPrice(sub)}` : `${qty} prs`}
                        </td>
                      </tr>
                    </table>
                  </div>
                `;
              })
              .join('')}
          </td>
        </tr>
      `
      : '';

  const totalsHtml = isStandaloneReturn
    ? `
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="2" style="font-family: 'Courier New', Courier, monospace; font-size: 10.5px; color: #111827;">
        <tr>
          <td style="font-weight: 900; font-size: 12px; color: #000000; padding-top: 4px;">TOTAL REFUND:</td>
          <td align="right" style="font-weight: 900; font-size: 12px; color: #dc2626; padding-top: 4px;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(refundTotal)}
          </td>
        </tr>
        ${
          reason
            ? `<tr><td colspan="2" style="font-size: 9.5px; color: #4b5563; padding-top: 4px;">Reason: ${escapeHtml(reason)}</td></tr>`
            : ''
        }
      </table>
    `
    : `
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="2" style="font-family: 'Courier New', Courier, monospace; font-size: 10.5px; color: #111827;">
        <tr>
          <td>Subtotal:</td>
          <td align="right">${escapeHtml(currencySymbol)} ${formatStockPrice(
            discount > 0 ? effectiveSubtotal : currentItemsTotal
          )}</td>
        </tr>
        ${
          discount > 0
            ? `
          <tr style="color: #047857;">
            <td>Discount:</td>
            <td align="right">-${escapeHtml(currencySymbol)} ${formatStockPrice(discount)}</td>
          </tr>
        `
            : ''
        }
        ${
          exchangeCredit > 0
            ? `
          <tr style="color: #4338ca; font-weight: 700;">
            <td>${isWholesaleTransaction ? 'Return Credit:' : 'Exchange Credit:'}</td>
            <td align="right">-${escapeHtml(currencySymbol)} ${formatStockPrice(exchangeCredit)}</td>
          </tr>
        `
            : ''
        }
        ${
          isWholesaleTransaction && previousBalance !== 0
            ? `
          <tr style="color: #334155; font-weight: 600;">
            <td>Prev Khata:</td>
            <td align="right">${escapeHtml(currencySymbol)} ${formatStockPrice(previousBalance)}</td>
          </tr>
        `
            : ''
        }
        <tr>
          <td style="font-weight: 900; font-size: 12px; color: #000000; border-top: 1px solid #d1d5db; padding-top: 5px;">TOTAL DUE:</td>
          <td align="right" style="font-weight: 900; font-size: 12px; color: #000000; border-top: 1px solid #d1d5db; padding-top: 5px;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(
              isWholesaleTransaction || exchangeCredit > 0 ? grandTotalDue : currentItemsTotal
            )}
          </td>
        </tr>
        <tr>
          <td style="padding-top: 3px;">Paid:</td>
          <td align="right" style="font-weight: 700; padding-top: 3px;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(paidAmount)}
          </td>
        </tr>
        ${
          changeGiven > 0
            ? `
          <tr style="color: #047857; font-weight: 700;">
            <td>Change:</td>
            <td align="right">${escapeHtml(currencySymbol)} ${formatStockPrice(changeGiven)}</td>
          </tr>
        `
            : remainingBalance > 0
            ? `
          <tr style="color: #be123c; font-weight: 700;">
            <td>Balance:</td>
            <td align="right">${escapeHtml(currencySymbol)} ${formatStockPrice(remainingBalance)}</td>
          </tr>
        `
            : ''
        }
      </table>
    `;

  return `
    <table role="presentation" align="center" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 276px; margin: 0 auto; background-color: #ffffff; border: 1px solid #d1d5db; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);">
      <tr>
        <td style="padding: 16px 14px; font-family: 'Courier New', Courier, monospace; color: #111827; font-size: 11px; line-height: 1.4;">
          <!-- Store Header -->
          <div style="text-align: center; padding-bottom: 8px; border-bottom: 1px dashed #6b7280;">
            ${logoHtml}
            <div style="font-weight: 900; font-size: 13px; text-transform: uppercase; letter-spacing: 0.2px; color: #000000;">
              ${escapeHtml(storeName)}
            </div>
            ${
              storeAddress
                ? `<div style="font-size: 9.5px; color: #4b5563; margin-top: 2px; line-height: 1.3;">${escapeHtml(storeAddress)}</div>`
                : ''
            }
            ${
              storePhone
                ? `<div style="font-size: 9.5px; color: #4b5563; margin-top: 1px;">Tel: ${escapeHtml(storePhone)}</div>`
                : ''
            }
            ${
              taxNumber
                ? `<div style="font-size: 9.5px; color: #4b5563; margin-top: 1px;">Tax Reg: ${escapeHtml(taxNumber)}</div>`
                : ''
            }
          </div>

          <!-- Meta Details -->
          <div style="padding: 7px 0; border-bottom: 1px dashed #6b7280;">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="1" style="font-family: 'Courier New', Courier, monospace; font-size: 10px; color: #374151;">
              <tr>
                <td style="font-weight: 700; color: #000000;">${escapeHtml(docLabel)}:</td>
                <td align="right" style="font-weight: 700; color: #000000;">${escapeHtml(docNumber)}</td>
              </tr>
              <tr>
                <td>Date:</td>
                <td align="right">${escapeHtml(saleDate)}</td>
              </tr>
              <tr>
                <td>Cashier:</td>
                <td align="right">${escapeHtml(cashierName || 'Counter Staff')}</td>
              </tr>
              <tr>
                <td>Customer:</td>
                <td align="right" style="font-weight: 700; color: #000000;">${escapeHtml(
                  customerName || 'Walk-in Customer'
                )}</td>
              </tr>
              <tr>
                <td>Total Pairs:</td>
                <td align="right" style="font-weight: 700; color: #000000;">${escapeHtml(totalPairsLabel)}</td>
              </tr>
              <tr>
                <td>Payment:</td>
                <td align="right" style="font-weight: 700; color: #111827;">${escapeHtml(paymentMethodLabel)}</td>
              </tr>
            </table>
          </div>

          <!-- Items Table -->
          <div style="padding: 6px 0; border-bottom: 1px dashed #6b7280;">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-family: 'Courier New', Courier, monospace; font-size: 10px;">
              ${
                items.length > 0
                  ? `
                <thead>
                  <tr>
                    <th align="left" style="padding-bottom: 3px; border-bottom: 1px solid #d1d5db; font-weight: 700; color: #111827;">Item</th>
                    <th align="right" style="padding-bottom: 3px; border-bottom: 1px solid #d1d5db; font-weight: 700; color: #111827;">Qty / Total</th>
                  </tr>
                </thead>
              `
                  : ''
              }
              <tbody>
                ${itemRowsHtml}
                ${returnedRowsHtml}
              </tbody>
            </table>
          </div>

          <!-- Totals -->
          <div style="padding: 7px 0; border-bottom: 1px dashed #6b7280;">
            ${totalsHtml}
          </div>

          <!-- Receipt Footer -->
          ${
            invoiceFooter
              ? `
            <div style="padding-top: 8px; text-align: center; font-size: 9px; font-style: italic; color: #4b5563;">
              ${escapeHtml(invoiceFooter)}
            </div>
          `
              : ''
          }
        </td>
      </tr>
    </table>
  `;
}

function renderWholesaleA4PreviewHtml(params: {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeEmail: string;
  taxNumber: string;
  invoiceFooter: string;
  showReceiptLogo: boolean;
  receiptLogo: string;
  currencySymbol: string;
  docTitle: string;
  docNumber: string;
  saleDate: string;
  cashierName: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  dealerShopName: string;
  dealerMarket: string;
  dealerCity: string;
  dealerNtn: string;
  paymentMethodLabel: string;
  rawPaymentMethod: string;
  displayTotalCartons: string;
  totalPairsDispatched: number;
  halfCartonItemsCount: number;
  items: TransactionReceiptItem[];
  returnedItems: TransactionReturnedItem[];
  isStandaloneReturn: boolean;
  effectiveSubtotal: number;
  discount: number;
  exchangeCredit: number;
  currentItemsTotal: number;
  previousBalance: number;
  grandTotalDue: number;
  paidAmount: number;
  remainingBalance: number;
  changeGiven: number;
  refundTotal: number;
  reason?: string;
}): string {
  const {
    storeName,
    storeAddress,
    storePhone,
    storeEmail,
    taxNumber,
    invoiceFooter,
    showReceiptLogo,
    receiptLogo,
    currencySymbol,
    docTitle,
    docNumber,
    saleDate,
    cashierName,
    customerName,
    customerPhone,
    customerAddress,
    dealerShopName,
    dealerMarket,
    dealerCity,
    dealerNtn,
    paymentMethodLabel,
    rawPaymentMethod,
    displayTotalCartons,
    totalPairsDispatched,
    halfCartonItemsCount,
    items,
    returnedItems,
    isStandaloneReturn,
    effectiveSubtotal,
    discount,
    exchangeCredit,
    currentItemsTotal,
    previousBalance,
    grandTotalDue,
    paidAmount,
    remainingBalance,
    changeGiven,
    refundTotal,
    reason,
  } = params;

  const logoHtml =
    showReceiptLogo && isSafeEmailImageUrl(receiptLogo)
      ? `<td valign="top" style="padding-right: 12px; width: 68px;"><img src="${escapeHtml(
          receiptLogo
        )}" alt="${escapeHtml(
          storeName
        )}" style="max-height: 48px; max-width: 88px; width: auto; height: auto; display: block;" /></td>`
      : '';

  const locationLine = [dealerMarket, dealerCity || customerAddress].filter(Boolean).join(', ');

  const itemsTableRowsHtml = items
    .map((item, idx) => {
      const qty = Number(item.quantity || 0);
      const ppc = Math.max(1, Number(item.pairs_per_carton || item.pairsPerCarton || 12) || 12);
      const rawCtn =
        item.carton_quantity !== undefined && item.carton_quantity !== null
          ? parseFloat(String(item.carton_quantity))
          : item.cartonQuantity !== undefined && item.cartonQuantity !== null
          ? parseFloat(String(item.cartonQuantity))
          : qty / ppc;
      const parsedCtn = !isNaN(rawCtn) && rawCtn > 0 ? rawCtn : qty / ppc;
      const isHalfCarton = parsedCtn === 0.5;
      const hasFraction = parsedCtn % 1 !== 0;

      const cartonDisplayHtml = isHalfCarton
        ? `<span style="display: inline-block; background-color: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-family: 'Courier New', Courier, monospace; font-size: 10px;">0.5 Ctn (HALF)</span>`
        : hasFraction
        ? `<span style="font-weight: 700; color: #030712; font-family: 'Courier New', Courier, monospace;">${parsedCtn.toFixed(
            1
          )} Ctns</span> <span style="font-size: 9.5px; color: #4338ca;">(${Math.floor(
            parsedCtn
          )} + &frac12;)</span>`
        : `<span style="font-weight: 700; color: #030712; font-family: 'Courier New', Courier, monospace;">${parsedCtn} ${
            parsedCtn === 1 ? 'Ctn' : 'Ctns'
          }</span>`;

      const unitPrice = Number(item.unit_price || 0);
      const lineSubtotal = Number(item.subtotal || qty * unitPrice);

      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 6px; color: #6b7280; font-family: 'Courier New', Courier, monospace; font-size: 10.5px;">${
            idx + 1
          }</td>
          <td style="padding: 8px 8px;">
            <div style="font-weight: 700; color: #030712; font-size: 11px;">${escapeHtml(
              item.article || item.product_name || item.name || 'Footwear'
            )}</div>
            ${
              item.brand_name
                ? `<div style="font-size: 9.5px; color: #6b7280;">Brand: ${escapeHtml(item.brand_name)}</div>`
                : ''
            }
          </td>
          <td align="center" style="padding: 8px 6px; font-size: 10.5px;">${cartonDisplayHtml}</td>
          <td align="center" style="padding: 8px 6px; color: #4b5563; font-family: 'Courier New', Courier, monospace; font-size: 10.5px;">${ppc} pr/ctn</td>
          <td align="center" style="padding: 8px 6px; font-weight: 700; color: #111827; font-family: 'Courier New', Courier, monospace; font-size: 10.5px;">${qty} pr</td>
          <td align="right" style="padding: 8px 6px; color: #1f2937; font-family: 'Courier New', Courier, monospace; font-size: 10.5px;">
            <div>${escapeHtml(currencySymbol)} ${formatStockPrice(
        unitPrice
      )} <span style="font-size: 9px; color: #6b7280;">/pr</span></div>
            <div style="font-size: 9px; color: #6b7280;">(${escapeHtml(
              currencySymbol
            )} ${formatStockPrice(unitPrice * ppc)}/ctn)</div>
          </td>
          <td align="right" style="padding: 8px 6px; font-weight: 700; color: #030712; font-family: 'Courier New', Courier, monospace; font-size: 11px;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(lineSubtotal)}
          </td>
        </tr>
      `;
    })
    .join('');

  const returnedSectionHtml =
    returnedItems.length > 0
      ? `
        <div style="margin-top: 14px; padding-top: 12px; border-top: 2px solid #c7d2fe;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 6px;">
            <tr>
              <td style="font-size: 10.5px; font-weight: 800; text-transform: uppercase; color: #1e1b4b; letter-spacing: 0.4px;">
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; background-color: #e0e7ff; color: #3730a3; font-size: 9.5px; margin-right: 5px;">RETURN</span>
                Returned Footwear ${isStandaloneReturn ? '' : '(Deducted directly from Balance)'}
              </td>
              <td align="right" style="font-family: 'Courier New', Courier, monospace; font-size: 10.5px; font-weight: 700; color: #4338ca;">
                Total Credit: -${escapeHtml(currencySymbol)} ${formatStockPrice(
        isStandaloneReturn ? refundTotal : exchangeCredit
      )}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; font-size: 10.5px;">
            <thead>
              <tr style="background-color: #eef2ff; border-top: 1px solid #c7d2fe; border-bottom: 1px solid #c7d2fe; color: #1e1b4b;">
                <th align="left" style="padding: 6px;">#</th>
                <th align="left" style="padding: 6px;">Article / Product</th>
                <th align="center" style="padding: 6px;">Returned Pairs</th>
                <th align="right" style="padding: 6px;">Return Rate</th>
                <th align="right" style="padding: 6px;">Credit Value</th>
              </tr>
            </thead>
            <tbody>
              ${returnedItems
                .map((r, rIdx) => {
                  const rate = Number(r.unitRefundPrice ?? r.unit_refund_price ?? 0);
                  const qty = Number(r.quantity || 0);
                  const sub = Number(r.subtotal ?? qty * rate);
                  return `
                    <tr style="border-bottom: 1px solid #e0e7ff; color: #1e293b;">
                      <td style="padding: 6px; color: #6b7280; font-family: 'Courier New', Courier, monospace; font-size: 10px;">${
                        rIdx + 1
                      }</td>
                      <td style="padding: 6px; font-weight: 700; color: #0f172a;">${escapeHtml(
                        r.article || r.productName || r.product_name || 'Returned Footwear'
                      )}</td>
                      <td align="center" style="padding: 6px; font-family: 'Courier New', Courier, monospace; font-weight: 700;">${qty} prs</td>
                      <td align="right" style="padding: 6px; font-family: 'Courier New', Courier, monospace;">${escapeHtml(
                        currencySymbol
                      )} ${formatStockPrice(rate)}</td>
                      <td align="right" style="padding: 6px; font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #4338ca;">-${escapeHtml(
                        currencySymbol
                      )} ${formatStockPrice(sub)}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `
      : '';

  const financialSummaryHtml = isStandaloneReturn
    ? `
      <table role="presentation" align="right" width="100%" border="0" cellspacing="0" cellpadding="3" style="max-width: 290px; font-size: 11px;">
        <tr>
          <td style="font-weight: 900; font-size: 12.5px; color: #030712; border-top: 2px solid #1f2937; padding-top: 6px;">TOTAL REFUND CREDIT:</td>
          <td align="right" style="font-weight: 900; font-size: 12.5px; color: #dc2626; border-top: 2px solid #1f2937; padding-top: 6px; font-family: 'Courier New', Courier, monospace;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(refundTotal)}
          </td>
        </tr>
        ${
          reason
            ? `<tr><td colspan="2" style="color: #4b5563; font-size: 10px; padding-top: 4px;">Reason: ${escapeHtml(reason)}</td></tr>`
            : ''
        }
      </table>
    `
    : `
      <table role="presentation" align="right" width="100%" border="0" cellspacing="0" cellpadding="3" style="max-width: 300px; font-size: 11px; color: #1f2937;">
        <tr style="color: #4b5563;">
          <td>Current Items Subtotal:</td>
          <td align="right" style="font-family: 'Courier New', Courier, monospace;">${escapeHtml(
            currencySymbol
          )} ${formatStockPrice(effectiveSubtotal > 0 ? effectiveSubtotal : currentItemsTotal)}</td>
        </tr>
        ${
          discount > 0
            ? `
          <tr style="color: #047857;">
            <td>Total Discount:</td>
            <td align="right" style="font-family: 'Courier New', Courier, monospace;">-${escapeHtml(
              currencySymbol
            )} ${formatStockPrice(discount)}</td>
          </tr>
        `
            : ''
        }
        ${
          exchangeCredit > 0
            ? `
          <tr style="color: #4338ca; font-weight: 600;">
            <td>Returned Shoes Credit:</td>
            <td align="right" style="font-family: 'Courier New', Courier, monospace;">-${escapeHtml(
              currencySymbol
            )} ${formatStockPrice(exchangeCredit)}</td>
          </tr>
        `
            : ''
        }
        <tr style="font-weight: 700; color: #111827;">
          <td style="border-top: 1px solid #e5e7eb; padding-top: 4px;">Current Invoice Total:</td>
          <td align="right" style="border-top: 1px solid #e5e7eb; padding-top: 4px; font-family: 'Courier New', Courier, monospace;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(currentItemsTotal)}
          </td>
        </tr>
        ${
          previousBalance !== 0
            ? `
          <tr style="color: #374151; font-weight: 600;">
            <td>Previous Khata Ledger Balance:</td>
            <td align="right" style="font-family: 'Courier New', Courier, monospace;">${escapeHtml(
              currencySymbol
            )} ${formatStockPrice(previousBalance)}</td>
          </tr>
        `
            : ''
        }
        <tr>
          <td style="font-weight: 900; font-size: 12.5px; color: #030712; border-top: 2px solid #1f2937; padding-top: 6px;">GRAND TOTAL DUE:</td>
          <td align="right" style="font-weight: 900; font-size: 12.5px; color: #030712; border-top: 2px solid #1f2937; padding-top: 6px; font-family: 'Courier New', Courier, monospace;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(grandTotalDue)}
          </td>
        </tr>
        <tr>
          <td style="padding-top: 4px; color: #1f2937;">
            ${String(rawPaymentMethod || '').toUpperCase() === 'KHATA' ? 'Payment Received Now:' : 'Amount Paid:'}
          </td>
          <td align="right" style="padding-top: 4px; font-weight: 700; font-family: 'Courier New', Courier, monospace;">
            ${escapeHtml(currencySymbol)} ${formatStockPrice(paidAmount)}
          </td>
        </tr>
        ${
          remainingBalance > 0
            ? `
          <tr style="color: #be123c; font-weight: 700;">
            <td style="border-top: 1px dashed #d1d5db; padding-top: 4px;">Balance Carried Forward (Khata):</td>
            <td align="right" style="border-top: 1px dashed #d1d5db; padding-top: 4px; font-family: 'Courier New', Courier, monospace;">
              ${escapeHtml(currencySymbol)} ${formatStockPrice(remainingBalance)}
            </td>
          </tr>
        `
            : changeGiven > 0
            ? `
          <tr style="color: #047857; font-weight: 700;">
            <td style="border-top: 1px dashed #d1d5db; padding-top: 4px;">Change Given:</td>
            <td align="right" style="border-top: 1px dashed #d1d5db; padding-top: 4px; font-family: 'Courier New', Courier, monospace;">
              ${escapeHtml(currencySymbol)} ${formatStockPrice(changeGiven)}
            </td>
          </tr>
        `
            : `
          <tr style="color: #047857; font-weight: 600;">
            <td style="border-top: 1px dashed #d1d5db; padding-top: 4px;">Account Status:</td>
            <td align="right" style="border-top: 1px dashed #d1d5db; padding-top: 4px;">Paid in Full</td>
          </tr>
        `
        }
      </table>
    `;

  return `
    <table role="presentation" align="center" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 590px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);">
      <tr>
        <td style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 11px;">
          <!-- A4 Header -->
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-bottom: 2px solid #1f2937; padding-bottom: 14px;">
            <tr>
              <td valign="top" style="width: 65%;">
                <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    ${logoHtml}
                    <td valign="top">
                      <div style="font-size: 17px; font-weight: 900; color: #030712; text-transform: uppercase; letter-spacing: -0.2px;">
                        ${escapeHtml(storeName)}
                      </div>
                      ${
                        storeAddress
                          ? `<div style="font-size: 11px; color: #4b5563; margin-top: 2px;">${escapeHtml(storeAddress)}</div>`
                          : ''
                      }
                      <div style="font-size: 11px; color: #4b5563; margin-top: 1px;">
                        Phone: ${escapeHtml(storePhone || 'N/A')}${
                          storeEmail ? ` | Email: ${escapeHtml(storeEmail)}` : ''
                        }
                      </div>
                      ${
                        taxNumber
                          ? `<div style="font-size: 11px; font-weight: 700; color: #1f2937; margin-top: 2px;">STRN / NTN Tax ID: ${escapeHtml(taxNumber)}</div>`
                          : ''
                      }
                    </td>
                  </tr>
                </table>
              </td>
              <td valign="top" align="right" style="width: 35%;">
                <div style="display: inline-block; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.6px; color: #111827; border-bottom: 1px solid #111827; padding-bottom: 2px;">
                  ${escapeHtml(docTitle)}
                </div>
                <div style="font-family: 'Courier New', Courier, monospace; font-weight: 700; font-size: 12.5px; color: #030712; margin-top: 5px;">
                  ${escapeHtml(docNumber)}
                </div>
                <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">
                  Date: ${escapeHtml(saleDate)}
                </div>
              </td>
            </tr>
          </table>

          <!-- Dealer Billed To & Payment Details -->
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; font-size: 11px;">
            <tr>
              <td valign="top" style="width: 55%; padding-right: 10px;">
                <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; margin-bottom: 4px;">
                  DEALER / BILLED TO:
                </div>
                ${
                  dealerShopName
                    ? `<div style="font-size: 12.5px; font-weight: 900; color: #030712;">${escapeHtml(dealerShopName)}</div>`
                    : ''
                }
                <div style="font-weight: 700; color: #111827; margin-top: 2px;">
                  ${escapeHtml(customerName || 'Wholesale Client / Walk-in Dealer')}
                </div>
                ${
                  customerPhone
                    ? `<div style="color: #4b5563; margin-top: 1px;">Contact: ${escapeHtml(customerPhone)}</div>`
                    : ''
                }
                ${
                  locationLine
                    ? `<div style="color: #4b5563; margin-top: 1px;">Market / City: ${escapeHtml(locationLine)}</div>`
                    : ''
                }
                ${
                  dealerNtn
                    ? `<div style="color: #374151; font-family: 'Courier New', Courier, monospace; font-weight: 600; margin-top: 1px;">NTN: ${escapeHtml(dealerNtn)}</div>`
                    : ''
                }
              </td>
              <td valign="top" align="right" style="width: 45%;">
                <div style="font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; margin-bottom: 4px;">
                  PAYMENT &amp; OPERATOR:
                </div>
                <div style="color: #1f2937;">
                  Payment Mode: <strong style="color: #030712;">${escapeHtml(paymentMethodLabel)}</strong>
                </div>
                <div style="color: #1f2937; margin-top: 2px;">
                  Cashier / Dispatch: <strong style="color: #030712;">${escapeHtml(cashierName)}</strong>
                </div>
              </td>
            </tr>
          </table>

          <!-- Wholesale Items Table -->
          ${
            items.length > 0
              ? `
            <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 10px; border-collapse: collapse; font-size: 11px;">
                <thead>
                  <tr style="border-top: 2px solid #1f2937; border-bottom: 2px solid #1f2937; background-color: #f9fafb; color: #1f2937;">
                    <th align="left" style="padding: 7px 6px; font-weight: 700;">#</th>
                    <th align="left" style="padding: 7px 8px; font-weight: 700;">Article / Item</th>
                    <th align="center" style="padding: 7px 6px; font-weight: 700;">Cartons</th>
                    <th align="center" style="padding: 7px 6px; font-weight: 700;">Packing</th>
                    <th align="center" style="padding: 7px 6px; font-weight: 700;">Total Pairs</th>
                    <th align="right" style="padding: 7px 6px; font-weight: 700;">Wholesale Rate</th>
                    <th align="right" style="padding: 7px 6px; font-weight: 700;">Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsTableRowsHtml}
                </tbody>
              </table>
            </div>

            <!-- Wholesale Dispatch Summary Strip -->
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="8" style="margin-top: 10px; background-color: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; font-size: 10.5px;">
              <tr>
                <td style="font-weight: 700; color: #1e1b4b;">Wholesale Dispatch Summary:</td>
                <td align="right" style="font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #312e81;">
                  Total Master Cartons: <strong style="color: #000000; text-decoration: underline;">${escapeHtml(
                    displayTotalCartons
                  )} Ctns</strong>${
                    halfCartonItemsCount > 0
                      ? ` <span style="color: #047857;">(includes ${halfCartonItemsCount} half-carton${
                          halfCartonItemsCount > 1 ? 's' : ''
                        })</span>`
                      : ''
                  } &nbsp;&bull;&nbsp; Total Footwear Pairs: <strong style="color: #000000; text-decoration: underline;">${totalPairsDispatched} Pairs</strong>
                </td>
              </tr>
            </table>
          `
              : returnedItems.length > 0
              ? `
            <!-- Wholesale Return Summary Strip -->
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="8" style="margin-top: 10px; background-color: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; font-size: 10.5px;">
              <tr>
                <td style="font-weight: 700; color: #1e1b4b;">Wholesale Return Summary:</td>
                <td align="right" style="font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #312e81;">
                  Total Footwear Pairs Returned: <strong style="color: #000000; text-decoration: underline;">${returnedItems.reduce(
                    (acc, r) => acc + (Number(r.quantity) || 0),
                    0
                  )} Pairs</strong>
                </td>
              </tr>
            </table>
          `
              : ''
          }

          ${returnedSectionHtml}

          <!-- Financial Summary -->
          <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #d1d5db;">
            <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td>
                  ${financialSummaryHtml}
                </td>
              </tr>
            </table>
          </div>

          <!-- Footer & Signatures -->
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 20px; padding-top: 14px; border-top: 1px solid #e5e7eb;">
            <tr>
              <td valign="bottom" style="width: 48%; font-size: 10px; color: #6b7280;">
                ${invoiceFooter ? escapeHtml(invoiceFooter) : ''}
              </td>
              <td valign="bottom" align="right" style="width: 52%;">
                <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="right">
                  <tr>
                    <td align="center" style="padding-right: 18px;">
                      <div style="width: 105px; border-bottom: 1px solid #6b7280; height: 18px; margin-bottom: 4px;"></div>
                      <div style="font-size: 8.5px; color: #4b5563; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;">Dealer Stamp &amp; Sign</div>
                    </td>
                    <td align="center">
                      <div style="width: 105px; border-bottom: 1px solid #1f2937; height: 18px; margin-bottom: 4px;"></div>
                      <div style="font-size: 8.5px; color: #030712; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;">Authorized Signature</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function buildTransactionReceiptEmailHtml(
  input: TransactionReceiptEmailInput
): TransactionReceiptEmailOutput {
  const { payload, sale, companySettings, generatedAt = new Date() } = input;
  const actionType = String(payload.type || 'SALE').toUpperCase();
  const isSale = actionType === 'SALE';
  const isPurchase = actionType === 'PURCHASE';
  const isSaleReturn = actionType === 'SALE_RETURN';
  const isSaleExchange = actionType === 'SALE_EXCHANGE';
  const isExchange = actionType === 'EXCHANGE';
  const isReturn = actionType === 'RETURN';
  const isStandaloneReturn = isReturn && !sale?.invoice_number && !payload.invoiceNumber;

  const isWholesaleTransaction = resolveIsWholesaleTransaction(sale, companySettings);
  const layoutMode: 'thermal_50mm' | 'a4' = isWholesaleTransaction ? 'a4' : 'thermal_50mm';

  const rawCandidateStore =
    companySettings?.name || companySettings?.company_name || companySettings?.companyName || '';
  const storeName =
    sanitizeStoreName(rawCandidateStore) ||
    (isWholesaleTransaction ? 'Footwear Wholesale' : 'Shoe Store');
  const storeAddress = String(companySettings?.address || '').trim();
  const storePhone = String(companySettings?.phone || '').trim();
  const storeEmail = String(companySettings?.email || '').trim();
  const taxNumber = String(
    companySettings?.tax_number ||
      companySettings?.taxNumber ||
      companySettings?.strn ||
      companySettings?.tax_id ||
      ''
  ).trim();
  const currencySymbol = String(
    companySettings?.currency_symbol || companySettings?.currencySymbol || 'Rs.'
  ).trim();
  const rawInvoiceFooter = String(
    companySettings?.invoice_footer ||
      companySettings?.invoiceFooter ||
      'Thank you for your business!'
  );
  const invoiceFooter = sanitizeInvoiceFooter(rawInvoiceFooter);
  const showReceiptLogo = Boolean(
    companySettings?.show_receipt_logo ?? companySettings?.showReceiptLogo ?? false
  );
  const receiptLogo = String(
    companySettings?.receipt_logo || companySettings?.receiptLogo || companySettings?.logo || ''
  ).trim();

  const refNum =
    sale?.invoice_number ||
    payload.invoiceNumber ||
    payload.purchaseNumber ||
    payload.exchangeNumber ||
    sale?.return_number ||
    payload.returnNumber ||
    'N/A';

  const cashierName =
    String(sale?.cashier_name || payload.cashierName || payload.triggeredBy || 'Counter Staff').trim() ||
    'Counter Staff';
  const customerName =
    String(sale?.customer_name || payload.supplierName || payload.customerName || 'Walk-in Customer').trim() ||
    'Walk-in Customer';
  const customerPhone = String(sale?.customer_phone || '').trim();
  const customerAddress = String(sale?.customer_address || '').trim();
  const dealerShopName = String(sale?.customer_shop_name || '').trim();
  const dealerMarket = String(sale?.customer_market_name || '').trim();
  const dealerCity = String(sale?.customer_city || '').trim();
  const dealerNtn = String(sale?.customer_ntn || '').trim();

  const rawPaymentMethod = String(sale?.payment_method || (payload as any).paymentMethod || 'CASH').trim();
  const paymentMethodLabel = formatPaymentMethodLabel(rawPaymentMethod);

  const saleDate = String(
    sale?.sale_date ||
      generatedAt.toISOString().slice(0, 10)
  ).trim();

  // Line items & returned items with graceful payload fallbacks
  const saleAmountFallback = Number(
    sale?.total_amount ?? payload.totalAmount ?? payload.netDifference ?? payload.refundAmount ?? 0
  );
  const dbItems = Array.isArray(sale?.items) ? sale!.items! : [];
  const items: TransactionReceiptItem[] =
    dbItems.length > 0
      ? dbItems
      : isStandaloneReturn
      ? []
      : buildFallbackItemsFromPayload(payload, saleAmountFallback);

  const dbReturnedItems = Array.isArray(sale?.returned_items)
    ? sale!.returned_items!
    : Array.isArray(sale?.returnedItems)
    ? sale!.returnedItems!
    : [];
  const returnedItems: TransactionReturnedItem[] =
    dbReturnedItems.length > 0
      ? dbReturnedItems
      : buildFallbackReturnedItemsFromPayload(payload);

  const itemsSubtotal = items.reduce(
    (acc, it) => acc + (Number(it.subtotal) || Number(it.quantity || 0) * Number(it.unit_price || 0)),
    0
  );
  const subtotal = Number(sale?.subtotal || 0);
  const discount = Number(sale?.discount || 0);
  const effectiveSubtotal =
    subtotal > 0 ? subtotal : itemsSubtotal > 0 ? itemsSubtotal : Math.max(0, saleAmountFallback);
  const currentItemsTotal = Math.max(0, effectiveSubtotal - discount);

  const returnedSum = returnedItems.reduce((acc, r) => acc + Number(r.subtotal || 0), 0);
  const explicitCredit = Number(sale?.exchange_credit ?? sale?.exchangeCredit ?? 0);
  const notesCredit = parseReturnedCreditFromNotes(sale?.notes);
  const exchangeCredit =
    explicitCredit > 0 ? explicitCredit : returnedSum > 0 ? returnedSum : notesCredit;

  const previousBalance = Number(sale?.previous_balance || 0);
  const derivedExchangeCredit =
    exchangeCredit > 0
      ? exchangeCredit
      : !sale &&
        (isExchange || isSaleExchange || isSaleReturn) &&
        typeof payload.netDifference === 'number' &&
        currentItemsTotal > payload.netDifference
      ? Math.max(0, currentItemsTotal - payload.netDifference)
      : 0;

  const computedFallbackDue = Math.max(
    0,
    currentItemsTotal - derivedExchangeCredit + previousBalance
  );
  const effectiveExchangeCredit = derivedExchangeCredit;
  const grandTotalDue =
    sale?.total_amount !== undefined && sale?.total_amount !== null
      ? Number(sale.total_amount)
      : computedFallbackDue;

  const paidAmount =
    sale?.paid_amount !== undefined && sale?.paid_amount !== null
      ? Number(sale.paid_amount)
      : sale?.cash_received !== undefined && sale?.cash_received !== null
      ? Number(sale.cash_received)
      : grandTotalDue;
  const remainingBalance =
    sale?.remaining_balance !== undefined && sale?.remaining_balance !== null
      ? Number(sale.remaining_balance)
      : Math.max(0, grandTotalDue - paidAmount);
  const changeGiven =
    sale?.change_given !== undefined && sale?.change_given !== null
      ? Number(sale.change_given)
      : paidAmount > grandTotalDue
      ? paidAmount - grandTotalDue
      : 0;

  const refundTotal = Number(payload.refundAmount ?? sale?.total_amount ?? returnedSum ?? 0);

  // Wholesale carton math matching InvoicePrintModal.tsx
  let totalPairsDispatched = 0;
  let calculatedTotalCartons = 0;
  let halfCartonItemsCount = 0;
  items.forEach((it) => {
    const qty = Number(it.quantity) || 0;
    totalPairsDispatched += qty;
    const ppc = Math.max(1, Number(it.pairs_per_carton || it.pairsPerCarton || 12) || 12);
    const rawCtn =
      it.carton_quantity !== undefined && it.carton_quantity !== null
        ? parseFloat(String(it.carton_quantity))
        : it.cartonQuantity !== undefined && it.cartonQuantity !== null
        ? parseFloat(String(it.cartonQuantity))
        : qty / ppc;
    const ctn = !isNaN(rawCtn) && rawCtn > 0 ? rawCtn : qty / ppc;
    calculatedTotalCartons += ctn;
    if (ctn === 0.5 || ctn % 1 === 0.5) {
      halfCartonItemsCount += 1;
    }
  });
  const returnedPairsCountFromItems = returnedItems.reduce(
    (acc, r) => acc + (Number(r.quantity) || 0),
    0
  );
  const explicitPayloadTotalPairs =
    typeof payload.totalPairs === 'number' && Number.isFinite(payload.totalPairs) && payload.totalPairs >= 0
      ? payload.totalPairs
      : null;
  const explicitPayloadReturnedPairs =
    typeof payload.returnedPairs === 'number' && Number.isFinite(payload.returnedPairs) && payload.returnedPairs >= 0
      ? payload.returnedPairs
      : null;
  const msgPairsMatch = String(payload.message || payload.itemsSummary || '').match(
    /\b(\d+(?:\.\d+)?)\s*pairs?\b/i
  );
  const fallbackParsedPairs = msgPairsMatch ? Number(msgPairsMatch[1]) : 0;

  const returnedPairsCount =
    returnedPairsCountFromItems > 0
      ? returnedPairsCountFromItems
      : explicitPayloadReturnedPairs !== null
      ? explicitPayloadReturnedPairs
      : isStandaloneReturn
      ? explicitPayloadTotalPairs ?? fallbackParsedPairs
      : 0;

  if (totalPairsDispatched === 0 && !isStandaloneReturn) {
    totalPairsDispatched = explicitPayloadTotalPairs ?? (fallbackParsedPairs > 0 ? fallbackParsedPairs : returnedPairsCount);
  }

  const effectiveTotalPairs = isStandaloneReturn
    ? returnedPairsCount
    : totalPairsDispatched > 0
    ? totalPairsDispatched
    : returnedPairsCount;

  const totalPairsLabel = isStandaloneReturn
    ? `${returnedPairsCount} ${returnedPairsCount === 1 ? 'Pair' : 'Pairs'} Returned`
    : returnedPairsCount > 0 && !isExchange && !isSaleExchange
    ? `${totalPairsDispatched} ${totalPairsDispatched === 1 ? 'Pair' : 'Pairs'} (${returnedPairsCount} Returned)`
    : `${effectiveTotalPairs} ${effectiveTotalPairs === 1 ? 'Pair' : 'Pairs'}`;

  const totalCartons = Number(sale?.total_cartons || calculatedTotalCartons || 0);
  const displayTotalCartons =
    totalCartons > 0
      ? totalCartons % 1 === 0
        ? totalCartons.toString()
        : totalCartons.toFixed(1)
      : calculatedTotalCartons > 0
      ? calculatedTotalCartons % 1 === 0
        ? calculatedTotalCartons.toString()
        : calculatedTotalCartons.toFixed(1)
      : '0';

  const heroAmountVal = isStandaloneReturn
    ? refundTotal
    : payload.refundAmount && payload.returnNumber
    ? Number(payload.refundAmount)
    : isSaleExchange || isExchange || isSaleReturn
    ? payload.netDifference ?? grandTotalDue
    : grandTotalDue || Number(payload.totalAmount ?? 0);

  const formattedHeroAmount = Math.round(Number(heroAmountVal || 0)).toLocaleString('en-US');

  const actionTitle = isSale
    ? payload.returnNumber
      ? `Sale Return Updated #${refNum} (Refund Rs. ${formattedHeroAmount})`
      : `New Sale #${refNum} (Rs. ${formattedHeroAmount})`
    : isPurchase
    ? `Purchase Completed #${refNum} (Rs. ${formattedHeroAmount})`
    : isSaleExchange
    ? `Sale & Exchange #${refNum} (Rs. ${formattedHeroAmount})`
    : isSaleReturn
    ? `Sale & Return #${refNum} (Rs. ${formattedHeroAmount})`
    : isExchange
    ? `Exchange Completed #${payload.exchangeNumber || refNum}`
    : isReturn
    ? `Return Completed #${payload.returnNumber || refNum} (Refund Rs. ${formattedHeroAmount})`
    : `Transaction Alert #${refNum}`;

  const statusBadge = isStandaloneReturn
    ? { label: 'RETURN COMPLETED', bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' }
    : isSaleReturn || (isSale && payload.returnNumber)
    ? { label: 'SALE & RETURN', bg: '#fef3c7', fg: '#92400e', border: '#fde68a' }
    : isSaleExchange || isExchange
    ? { label: isSaleExchange ? 'SALE & EXCHANGE' : 'EXCHANGE COMPLETED', bg: '#e0e7ff', fg: '#3730a3', border: '#c7d2fe' }
    : { label: 'SALE COMPLETED', bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' };

  const heroLabel = isStandaloneReturn || (isSale && payload.returnNumber)
    ? 'Total Refund Processed'
    : isExchange || isSaleExchange || isSaleReturn
    ? 'Net Transaction Amount'
    : isWholesaleTransaction && remainingBalance > 0
    ? 'Grand Total Due'
    : 'Total Amount Received';

  const heroAmountColor = isStandaloneReturn || (isSale && payload.returnNumber) ? '#dc2626' : '#16a34a';

  const dateFormatted = generatedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const invoicePreviewHtml = isWholesaleTransaction
    ? renderWholesaleA4PreviewHtml({
        storeName,
        storeAddress,
        storePhone,
        storeEmail,
        taxNumber,
        invoiceFooter,
        showReceiptLogo,
        receiptLogo,
        currencySymbol,
        docTitle: isStandaloneReturn ? 'RETURN CREDIT NOTE' : 'TAX INVOICE',
        docNumber: refNum,
        saleDate,
        cashierName,
        customerName,
        customerPhone,
        customerAddress,
        dealerShopName,
        dealerMarket,
        dealerCity,
        dealerNtn,
        paymentMethodLabel,
        rawPaymentMethod,
        displayTotalCartons,
        totalPairsDispatched,
        halfCartonItemsCount,
        items,
        returnedItems,
        isStandaloneReturn,
        effectiveSubtotal,
        discount,
        exchangeCredit: effectiveExchangeCredit,
        currentItemsTotal,
        previousBalance,
        grandTotalDue,
        paidAmount,
        remainingBalance,
        changeGiven,
        refundTotal,
        reason: sale?.reason,
      })
    : renderThermal50mmPreviewHtml({
        storeName,
        storeAddress,
        storePhone,
        taxNumber,
        invoiceFooter,
        showReceiptLogo,
        receiptLogo,
        currencySymbol,
        docLabel: isStandaloneReturn ? 'Return' : 'Inv',
        docNumber: refNum,
        saleDate,
        cashierName,
        customerName,
        totalPairsLabel,
        paymentMethodLabel,
        items,
        returnedItems,
        isStandaloneReturn,
        isWholesaleTransaction,
        effectiveSubtotal,
        discount,
        exchangeCredit: effectiveExchangeCredit,
        previousBalance,
        currentItemsTotal,
        grandTotalDue,
        paidAmount,
        remainingBalance,
        changeGiven,
        refundTotal,
        reason: sale?.reason,
      });

  const customerSummaryDisplay = dealerShopName
    ? `${dealerShopName} (${customerName})`
    : customerPhone
    ? `${customerName} · ${customerPhone}`
    : customerName;

  const html = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(actionTitle)}</title>
  <style type="text/css">
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .email-outer-pad { padding: 10px !important; }
      .email-section-pad { padding: 16px 14px !important; }
      .email-preview-pad { padding: 18px 10px !important; }
      .stack-col { display: block !important; width: 100% !important; text-align: left !important; padding-bottom: 6px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 20px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #e2e8f0; color: #1e293b;" class="email-outer-pad">
  <table role="presentation" align="center" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);">
    <!-- 1. Top Alert Header -->
    <tr>
      <td bgcolor="#1e1b4b" style="background-color: #1e1b4b; background-image: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 22px 24px; color: #ffffff;" class="email-section-pad">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td valign="middle" class="stack-col">
              <div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 1.4px; color: #c7d2fe; font-weight: 700;">
                Instant Transaction Receipt &amp; Owner Alert
              </div>
              <div style="font-size: 21px; font-weight: 800; color: #ffffff; margin-top: 4px; line-height: 1.2;">
                ${escapeHtml(storeName)}
              </div>
            </td>
            <td valign="middle" align="right" class="stack-col">
              <span style="display: inline-block; background-color: ${statusBadge.bg}; color: ${statusBadge.fg}; border: 1px solid ${statusBadge.border}; font-size: 10.5px; font-weight: 800; letter-spacing: 0.6px; padding: 5px 10px; border-radius: 999px; text-transform: uppercase;">
                ${escapeHtml(statusBadge.label)}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- 2. Transaction Summary & Details -->
    <tr>
      <td style="padding: 20px 24px 18px 24px; background-color: #ffffff;" class="email-section-pad">
        <!-- Hero KPI Card -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 16px;">
          <tr>
            <td align="center" style="padding: 16px 14px;">
              <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px;">
                ${escapeHtml(heroLabel)}
              </div>
              <div style="font-size: 30px; font-weight: 800; color: ${heroAmountColor}; margin: 4px 0; line-height: 1.15;">
                ${escapeHtml(currencySymbol)} ${escapeHtml(formattedHeroAmount)}
              </div>
              <div style="font-size: 12px; color: #475569;">
                ${isStandaloneReturn ? 'Return' : isExchange ? 'Exchange' : 'Invoice'}
                <strong style="color: #0f172a;">#${escapeHtml(refNum)}</strong>
                ${
                  payload.returnNumber && !isStandaloneReturn
                    ? ` &bull; Ref <strong style="color: #4338ca;">#${escapeHtml(payload.returnNumber)}</strong>`
                    : ''
                }
                &bull; ${escapeHtml(dateFormatted)}
              </div>
            </td>
          </tr>
        </table>

        <!-- Processed-By, Customer & Total Pairs Strip -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12.5px;">
          <tr>
            <td style="padding: 9px 12px; border-bottom: 1px solid #f1f5f9; color: #64748b; width: 34%;">Processed By:</td>
            <td style="padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #0f172a;">${escapeHtml(cashierName)}</td>
          </tr>
          <tr>
            <td style="padding: 9px 12px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Customer:</td>
            <td style="padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #0f172a;">${escapeHtml(customerSummaryDisplay)}</td>
          </tr>
          <tr>
            <td style="padding: 9px 12px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Total Pairs:</td>
            <td style="padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #0f172a;">${escapeHtml(totalPairsLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 9px 12px; color: #64748b;">Payment &amp; Format:</td>
            <td style="padding: 9px 12px; font-weight: 600; color: #334155;">
              ${escapeHtml(paymentMethodLabel)} &bull; ${isWholesaleTransaction ? 'Wholesale A4 Invoice' : 'Retail 50mm Receipt'}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- 3. MIDDLE OF EMAIL BODY: Complete Live Invoice Preview (In-App Matching Layout) -->
    <tr>
      <td bgcolor="#f1f5f9" style="background-color: #f1f5f9; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 20px 16px 24px 16px;" class="email-preview-pad">
        <div style="text-align: center; font-size: 10px; font-weight: 800; letter-spacing: 1.3px; text-transform: uppercase; color: #64748b; margin-bottom: 12px;">
          Current Invoice Preview &bull; ${isWholesaleTransaction ? 'A4 Commercial Layout' : '50mm Thermal Receipt'}
        </div>
        ${invoicePreviewHtml}
      </td>
    </tr>

    <!-- 4. Automated Owner Alert Footer -->
    <tr>
      <td style="padding: 18px 24px; background-color: #ffffff; text-align: center;" class="email-section-pad">
        <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 700; color: #334155;">
          ${escapeHtml(storeName)}
        </p>
        ${
          storeAddress || storePhone
            ? `<p style="margin: 0 0 8px 0; font-size: 11px; color: #64748b;">${escapeHtml(
                [storeAddress, storePhone ? `Tel: ${storePhone}` : ''].filter(Boolean).join(' • ')
              )}</p>`
            : ''
        }
        <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5;">
          This is an automated real-time transaction alert from your Point of Sale system.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = [
    `${storeName} — ${actionTitle}`,
    `${isStandaloneReturn ? 'Return' : isExchange ? 'Exchange' : 'Invoice'}: #${refNum}`,
    `Date: ${dateFormatted}`,
    `Total Pairs: ${totalPairsLabel}`,
    `Customer: ${customerSummaryDisplay}`,
    `Processed By (Cashier): ${cashierName}`,
    `Payment: ${paymentMethodLabel}`,
    `${heroLabel}: ${currencySymbol} ${formattedHeroAmount}`,
  ].join('\n');

  return {
    subject: `[${storeName}] ${actionTitle}`,
    actionTitle,
    storeName,
    isWholesaleTransaction,
    layoutMode,
    html,
    text,
  };
}
