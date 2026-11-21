import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PLATFORM_DOCUMENT_NAME } from '../src/utils/documentTitle.ts';
import { generateSaleEscPos } from '../src/utils/printer/escpos.ts';

test('InvoicePrintModal renders app name credit in both thermal and A4 preview and print-only outputs', () => {
  const modalPath = path.join(process.cwd(), 'src', 'components', 'pos', 'InvoicePrintModal.tsx');
  const src = readFileSync(modalPath, 'utf8');

  assert.ok(
    src.includes("import { PLATFORM_DOCUMENT_NAME } from '../../utils/documentTitle.ts';"),
    'InvoicePrintModal should import PLATFORM_DOCUMENT_NAME'
  );
  assert.ok(
    src.includes('const appNameCredit = `Powered by : ${PLATFORM_DOCUMENT_NAME}`;'),
    'InvoicePrintModal should define appNameCredit using Powered by : ${PLATFORM_DOCUMENT_NAME}'
  );

  const previewStart = src.indexOf('INTERACTIVE PREVIEW CONTAINER');
  const printStart = src.indexOf('PRINT-ONLY CONTAINER');
  assert.ok(previewStart > -1 && printStart > previewStart, 'Expected preview and print sections in InvoicePrintModal');

  const previewSection = src.slice(previewStart, printStart);
  const printSection = src.slice(printStart);

  // Preview section: both 50mm thermal and A4 invoice previews
  assert.ok(
    previewSection.includes('data-testid="invoice-app-credit-preview-thermal"'),
    'Thermal preview should render app name credit'
  );
  assert.ok(
    previewSection.includes('data-testid="invoice-app-credit-preview-a4"'),
    'A4 preview should render app name credit'
  );
  assert.equal(
    (previewSection.match(/\{appNameCredit\}/g) || []).length,
    2,
    'Preview section should render {appNameCredit} in both 50mm thermal and A4 layouts'
  );

  // Print-only section: both 50mm thermal and A4 invoice printouts
  assert.ok(
    printSection.includes('data-testid="invoice-app-credit-print-thermal"'),
    'Thermal print-only layout should render app name credit'
  );
  assert.ok(
    printSection.includes('data-testid="invoice-app-credit-print-a4"'),
    'A4 print-only layout should render app name credit'
  );
  assert.equal(
    (printSection.match(/\{appNameCredit\}/g) || []).length,
    2,
    'Print-only section should render {appNameCredit} in both 50mm thermal and A4 layouts'
  );

  // Ensure credit blocks preserve natural mixed casing (no uppercase transform)
  for (const testId of [
    'invoice-app-credit-preview-thermal',
    'invoice-app-credit-preview-a4',
    'invoice-app-credit-print-thermal',
    'invoice-app-credit-print-a4',
  ]) {
    const idx = src.indexOf(testId);
    assert.ok(idx > -1, `Expected ${testId} in InvoicePrintModal`);
    const snippet = src.slice(idx, idx + 320);
    assert.equal(
      /\buppercase\b/i.test(snippet),
      false,
      `${testId} must preserve natural mixed casing instead of forcing uppercase`
    );
  }

  // Ensure neither preview nor print section uses <footer> which @media print hides globally
  assert.equal(/<footer\b/i.test(printSection), false, 'Print-only section must not use <footer> tags');
});

test('ESC/POS receipt bytes include Powered by : SarbaazSoft Shoe POS credit line', () => {
  const bytes = generateSaleEscPos(
    {
      invoice_number: 'INV-1001',
      sale_date: '2026-05-01',
      payment_method: 'CASH',
      total_amount: 2500,
      subtotal: 2500,
      items: [{ article: 'Runner Pro', quantity: 1, unit_price: 2500, subtotal: 2500 }],
    },
    {
      name: 'TJ Shoes Collection',
      invoice_footer: 'No cash refund without receipt.',
    },
    { paperWidth: 50 }
  );

  const decoded = new TextDecoder().decode(bytes);
  assert.ok(
    decoded.includes(`Powered by : ${PLATFORM_DOCUMENT_NAME}`),
    'ESC/POS receipt output should include Powered by : SarbaazSoft Shoe POS'
  );
});

test('App credit does not appear at bottom of PosTerminal route or FinancialSummaryPrintModal, only in footers and invoices', () => {
  const posSrc = readFileSync(path.join(process.cwd(), 'src', 'components', 'pos', 'PosTerminal.tsx'), 'utf8');
  assert.equal(/Powered by/i.test(posSrc), false, 'PosTerminal must not render Powered by app credits');
  assert.equal(/All rights reserved/i.test(posSrc), false, 'PosTerminal must not render copyright footer credit');
  assert.equal(/Dedicated Footer Branding/i.test(posSrc), false, 'PosTerminal must not have inline footer branding');

  const finReportSrc = readFileSync(
    path.join(process.cwd(), 'src', 'components', 'reports', 'FinancialSummaryPrintModal.tsx'),
    'utf8'
  );
  assert.equal(/Powered by/i.test(finReportSrc), false, 'FinancialSummaryPrintModal must not render app credit');

  const appSrc = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  assert.ok(appSrc.includes('<footer') && appSrc.includes('SarbaazSoft Shoe POS. All rights reserved.'), 'App footer retains app credit');

  const publicFooterSrc = readFileSync(
    path.join(process.cwd(), 'src', 'components', 'common', 'PublicFooter.tsx'),
    'utf8'
  );
  assert.ok(publicFooterSrc.includes('<footer') && publicFooterSrc.includes('SarbaazSoft Shoe POS. All rights reserved.'), 'PublicFooter retains app credit');
});
