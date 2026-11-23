import test from 'node:test';
import assert from 'node:assert/strict';

import { pgClient } from '../src/db/index.ts';
import {
  buildTransactionReceiptEmailHtml,
  dispatchPosEmailAlert,
} from '../src/server/services/emailAlertService.ts';
import type { PosActionNotification } from '../src/server/pushNotificationService.ts';

test('Retail Sale email embeds 50mm thermal receipt preview in middle with exact in-app details', () => {
  const payload: PosActionNotification = {
    type: 'SALE',
    title: 'Sale Completed',
    message: '#INV-000063 · Rs. 3,300 (Cash)',
    invoiceNumber: 'INV-000063',
    saleId: 63,
    totalAmount: 3300,
    customerName: 'Ayesha Khan',
    cashierName: 'Talhah',
    itemsSummary: '2x Classic Loafer Black',
    deepLinkUrl: '/?tab=reports&viewInvoice=INV-000063',
    timestamp: '2026-11-17T10:15:00.000Z',
  };

  const result = buildTransactionReceiptEmailHtml({
    payload,
    companySettings: {
      company_name: 'Al-Madina Footwear',
      address: 'Shop 12, Liberty Market, Lahore',
      phone: '0300-1234567',
      tax_id: 'STRN-998877',
      currency_symbol: 'Rs.',
      business_type: 'RETAIL',
      invoice_footer: 'No cash refund without receipt. Powered by SarbaazSoft Shoe POS',
    },
    sale: {
      id: 63,
      invoice_number: 'INV-000063',
      sale_type: 'RETAIL',
      sale_date: '2026-11-17',
      subtotal: 3500,
      discount: 200,
      total_amount: 3300,
      paid_amount: 3500,
      cash_received: 3500,
      change_given: 200,
      remaining_balance: 0,
      payment_method: 'CASH',
      cashier_name: 'Talhah',
      customer_name: 'Ayesha Khan',
      customer_phone: '0321-5556677',
      items: [
        {
          article: 'Classic Loafer Black',
          quantity: 2,
          unit_price: 1750,
          discount: 200,
          subtotal: 3300,
        },
      ],
    },
    generatedAt: new Date('2026-11-17T10:15:00.000Z'),
  });

  assert.equal(result.isWholesaleTransaction, false);
  assert.equal(result.layoutMode, 'thermal_50mm');
  assert.equal(result.subject, '[Al-Madina Footwear] New Sale #INV-000063 (Rs. 3,300)');

  // Outer alert sections retained
  assert.match(result.html, /Instant Transaction Receipt &amp; Owner Alert/);
  assert.match(result.html, /Al-Madina Footwear/);
  assert.match(result.html, /SALE COMPLETED/);
  assert.match(result.html, /Processed By:/);
  assert.match(result.html, /Total Pairs:/);
  assert.match(result.html, /2 Pairs/);
  assert.match(result.html, /Talhah/);
  assert.match(result.html, /Ayesha Khan/);
  assert.match(result.html, /This is an automated real-time transaction alert from your Point of Sale system\./);
  assert.match(result.text, /Total Pairs:\s*2 Pairs/);
  assert.match(result.text, /Customer:\s*Ayesha Khan/);
  assert.match(result.text, /Processed By \(Cashier\):\s*Talhah/);

  // Middle thermal receipt preview details
  assert.match(result.html, /50mm Thermal Receipt/);
  assert.match(result.html, /border-bottom: 1px dashed #6b7280/);
  assert.match(result.html, /Shop 12, Liberty Market, Lahore/);
  assert.match(result.html, /Tel: 0300-1234567/);
  assert.match(result.html, /Tax Reg: STRN-998877/);
  assert.match(result.html, /Classic Loafer Black/);
  assert.match(result.html, /2 &times; Rs\. 1750/);
  assert.match(result.html, /Subtotal:/);
  assert.match(result.html, /Rs\. 3500/);
  assert.match(result.html, /Discount:/);
  assert.match(result.html, /-Rs\. 200/);
  assert.match(result.html, /TOTAL DUE:/);
  assert.match(result.html, /Rs\. 3300/);
  assert.match(result.html, /Paid:/);
  assert.match(result.html, /Change:/);

  // Platform branding sanitized from receipt footer just like InvoicePrintModal.tsx
  assert.doesNotMatch(result.html, /SarbaazSoft/i);

  // Email-client safety: table layout & viewport meta, zero client scripts
  assert.match(result.html, /role="presentation"/);
  assert.match(result.html, /name="viewport"/);
  assert.doesNotMatch(result.html, /<script/i);
});

test('Wholesale A4 email embeds complete A4 commercial invoice preview with cartons, half-cartons, khata, and returned items', () => {
  const payload: PosActionNotification = {
    type: 'SALE_RETURN',
    title: 'Sale & Return Completed',
    message: '#INV-000120',
    invoiceNumber: 'INV-000120',
    returnNumber: 'RET-000018',
    saleId: 120,
    totalAmount: 55000,
    netDifference: 32000,
    customerName: 'Bilal Traders',
    cashierName: 'Usman',
    deepLinkUrl: '/?tab=reports&viewInvoice=INV-000120',
    timestamp: '2026-11-17T12:00:00.000Z',
  };

  const result = buildTransactionReceiptEmailHtml({
    payload,
    companySettings: {
      company_name: 'Lahore Wholesale Shoe House',
      address: 'Moti Bazar, Shah Alam Market, Lahore',
      phone: '042-37654321',
      email: 'billing@lahoreshoes.pk',
      strn: '3277876123456',
      currency_symbol: 'Rs.',
      business_type: 'WHOLESALE',
      invoice_footer: 'Goods once dispatched are verified at loading.',
    },
    sale: {
      id: 120,
      invoice_number: 'INV-000120',
      sale_type: 'WHOLESALE',
      sale_date: '2026-11-17',
      subtotal: 42000,
      discount: 2000,
      exchange_credit: 8000,
      previous_balance: 23000,
      total_amount: 55000,
      paid_amount: 20000,
      remaining_balance: 35000,
      payment_method: 'KHATA',
      total_cartons: 1.5,
      cashier_name: 'Usman',
      customer_name: 'Bilal Ahmed',
      customer_phone: '0301-9998877',
      customer_shop_name: 'Bilal Traders Footwear',
      customer_market_name: 'Hussain Agahi Market',
      customer_city: 'Multan',
      customer_type: 'WHOLESALER',
      customer_ntn: 'NTN-445566',
      items: [
        {
          article: 'Peshawari Chappal Deluxe',
          brand_name: 'Khyber Craft',
          carton_quantity: 1,
          pairs_per_carton: 12,
          quantity: 12,
          unit_price: 2000,
          subtotal: 24000,
        },
        {
          article: 'Formal Oxford Leather',
          brand_name: 'Apex Step',
          carton_quantity: 0.5,
          pairs_per_carton: 12,
          quantity: 6,
          unit_price: 3000,
          subtotal: 18000,
        },
      ],
      returned_items: [
        {
          product_name: 'Canvas Sneaker White',
          quantity: 4,
          unit_refund_price: 2000,
          subtotal: 8000,
        },
      ],
    },
    generatedAt: new Date('2026-11-17T12:00:00.000Z'),
  });

  assert.equal(result.isWholesaleTransaction, true);
  assert.equal(result.layoutMode, 'a4');
  assert.match(result.html, /A4 Commercial Layout/);
  assert.match(result.html, /TAX INVOICE/);
  assert.match(result.html, /DEALER \/ BILLED TO:/);
  assert.match(result.html, /Bilal Traders Footwear/);
  assert.match(result.html, /Hussain Agahi Market, Multan/);
  assert.match(result.html, /NTN: NTN-445566/);
  assert.doesNotMatch(result.html, /Transport \/ Cargo/);
  assert.doesNotMatch(result.html, /Bilty \/ LR #/);
  assert.match(result.html, /1\.5 Ctns/);
  assert.match(result.html, /18 Pairs/);
  assert.match(result.html, /0\.5 Ctn \(HALF\)/);
  assert.match(result.html, /includes 1 half-carton/);
  assert.match(result.html, /Returned Footwear/);
  assert.match(result.html, /Canvas Sneaker White/);
  assert.match(result.html, /Previous Khata Ledger Balance:/);
  assert.match(result.html, /GRAND TOTAL DUE:/);
  assert.match(result.html, /Balance Carried Forward \(Khata\):/);
  assert.match(result.html, /Dealer Stamp &amp; Sign/);
  assert.match(result.html, /Authorized Signature/);
  assert.match(result.html, /Total Pairs:/);
  assert.match(result.html, /18 Pairs \(4 Returned\)/);
  assert.match(result.text, /Total Pairs:\s*18 Pairs \(4 Returned\)/);
  assert.match(result.text, /Customer:\s*Bilal Traders Footwear \(Bilal Ahmed\)/);
  assert.match(result.text, /Processed By \(Cashier\):\s*Usman/);
});

test('Standalone Return and Exchange fallbacks sanitize HTML and render complete receipt preview without DB row', () => {
  const returnHtml = buildTransactionReceiptEmailHtml({
    payload: {
      type: 'RETURN',
      title: 'Return Completed',
      message: '#RET-000025 · Rs. 1,500 Refund',
      invoiceNumber: '',
      returnNumber: 'RET-000025',
      refundAmount: 1500,
      customerName: 'Walk-in <script>alert(1)</script>',
      cashierName: 'Ali',
      deepLinkUrl: '/?tab=returns&viewReturn=RET-000025',
      timestamp: '2026-11-17T14:00:00.000Z',
    },
    companySettings: {
      company_name: '{Store Name}',
      currency_symbol: 'Rs.',
      business_type: 'RETAIL',
    },
    sale: {
      return_number: 'RET-000025',
      sale_date: '2026-11-17',
      total_amount: 1500,
      payment_method: 'CASH',
      cashier_name: 'Ali',
      customer_name: 'Walk-in <script>alert(1)</script>',
      reason: 'Size mismatch',
      returned_items: [
        {
          product_name: 'Sneaker <img src=x onerror=alert(1)>',
          quantity: 1,
          unit_refund_price: 1500,
          subtotal: 1500,
        },
      ],
    },
  });

  assert.equal(returnHtml.storeName, 'Shoe Store');
  assert.match(returnHtml.html, /RETURN COMPLETED/);
  assert.match(returnHtml.html, /RET-000025/);
  assert.match(returnHtml.html, /TOTAL REFUND:/);
  assert.match(returnHtml.html, /1 Pair Returned/);
  assert.match(returnHtml.html, /Size mismatch/);
  assert.doesNotMatch(returnHtml.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(returnHtml.html, /<img src=x/);
  assert.match(returnHtml.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(returnHtml.text, /Total Pairs:\s*1 Pair Returned/);
  assert.match(returnHtml.text, /Processed By \(Cashier\):\s*Ali/);

  const exchangeHtml = buildTransactionReceiptEmailHtml({
    payload: {
      type: 'EXCHANGE',
      title: 'Exchange Completed',
      message: '#EXC-000012 · Rs. 500 Additional Collected',
      invoiceNumber: 'INV-000090',
      exchangeNumber: 'EXC-000012',
      returnNumber: 'RET-000012',
      totalAmount: 3000,
      netDifference: 500,
      customerName: 'Zain',
      cashierName: 'Talhah',
      exchangeDetails: {
        oldItems: '1x Loafers Brown',
        newItems: '1x Runners Pro',
        netDifference: 500,
      },
      deepLinkUrl: '/?tab=reports&viewInvoice=INV-000090',
      timestamp: '2026-11-17T15:00:00.000Z',
    },
    companySettings: {
      company_name: 'City Shoes',
      business_type: 'RETAIL',
    },
    sale: null,
  });

  assert.match(exchangeHtml.html, /EXCHANGE COMPLETED/);
  assert.match(exchangeHtml.html, /Runners Pro/);
  assert.match(exchangeHtml.html, /Loafers Brown/);
  assert.match(exchangeHtml.html, /Exchange Credit:/);
  assert.match(exchangeHtml.html, /-Rs\. 2500/);
  assert.match(exchangeHtml.html, /1 Pair/);
  assert.match(exchangeHtml.text, /Total Pairs:\s*1 Pair/);
  assert.match(exchangeHtml.text, /Customer:\s*Zain/);
  assert.match(exchangeHtml.text, /Processed By \(Cashier\):\s*Talhah/);

  // Wholesale Standalone Return includes Total Pairs summary strip and sparse no-DB sale includes Total Pairs, Walk-in Customer, Counter Staff
  const wholesaleReturn = buildTransactionReceiptEmailHtml({
    payload: {
      type: 'RETURN',
      title: 'Return Completed',
      message: '#RET-000077',
      invoiceNumber: '',
      returnNumber: 'RET-000077',
      refundAmount: 24000,
      totalPairs: 12,
      returnedPairs: 12,
      customerName: 'National Footwear',
      cashierName: 'Imran',
      deepLinkUrl: '/?tab=returns',
      timestamp: '2026-11-17T16:00:00.000Z',
    },
    companySettings: {
      company_name: 'Star Wholesale',
      business_type: 'WHOLESALE',
    },
    sale: {
      return_number: 'RET-000077',
      sale_date: '2026-11-17',
      total_amount: 24000,
      payment_method: 'CASH',
      cashier_name: 'Imran',
      customer_name: 'National Footwear',
      customer_type: 'WHOLESALER',
      returned_items: [
        {
          product_name: 'Bulk Mocassin',
          quantity: 12,
          unit_refund_price: 2000,
          subtotal: 24000,
        },
      ],
    },
  });
  assert.match(wholesaleReturn.html, /Total Footwear Pairs Returned:/);
  assert.match(wholesaleReturn.html, /12 Pairs/);
  assert.match(wholesaleReturn.text, /Total Pairs:\s*12 Pairs Returned/);
  assert.match(wholesaleReturn.text, /Customer:\s*National Footwear/);
  assert.match(wholesaleReturn.text, /Processed By \(Cashier\):\s*Imran/);

  const sparseSaleNoDb = buildTransactionReceiptEmailHtml({
    payload: {
      type: 'SALE',
      title: 'Sale Completed',
      message: 'Inv #INV-000888',
      invoiceNumber: 'INV-000888',
      totalAmount: 4000,
      totalPairs: 4,
      deepLinkUrl: '/?tab=reports',
      timestamp: '2026-11-17T16:30:00.000Z',
    },
    companySettings: {
      company_name: 'Corner Shoe Mart',
      business_type: 'RETAIL',
    },
    sale: null,
  });
  assert.match(sparseSaleNoDb.html, /4 Pairs/);
  assert.match(sparseSaleNoDb.html, /Walk-in Customer/);
  assert.match(sparseSaleNoDb.html, /Counter Staff/);
  assert.match(sparseSaleNoDb.text, /Total Pairs:\s*4 Pairs/);
  assert.match(sparseSaleNoDb.text, /Customer:\s*Walk-in Customer/);
  assert.match(sparseSaleNoDb.text, /Processed By \(Cashier\):\s*Counter Staff/);
});

test('dispatchPosEmailAlert gracefully handles DB hydration queries when no recipients or empty invoice rows are returned', async () => {
  const capturedSql: string[] = [];
  const origQuery = pgClient.query.bind(pgClient);
  (pgClient as any).query = async (sql: string) => {
    const q = String(sql);
    capturedSql.push(q);
    if (q.includes('FROM app_settings')) {
      return { rows: [{ value: 'true' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  try {
    const delivered = await dispatchPosEmailAlert(1, {
      type: 'SALE',
      title: 'Sale Completed',
      message: '#INV-000001',
      invoiceNumber: 'INV-000001',
      saleId: 1,
      totalAmount: 2500,
      cashierName: 'Talhah',
      customerName: 'Walk-in Customer',
      deepLinkUrl: '/?tab=reports&viewInvoice=INV-000001',
      timestamp: new Date().toISOString(),
    });
    assert.equal(delivered, false);
    assert.ok(capturedSql.some((s) => s.includes('FROM company_settings')));
    assert.ok(capturedSql.some((s) => s.includes('FROM users') && s.includes("'APPROVED'")));
  } finally {
    (pgClient as any).query = origQuery;
  }
});
