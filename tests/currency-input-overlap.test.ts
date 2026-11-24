import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readWorkspaceFile = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('src/index.css places .form-modal-theme inside @layer components and supports .currency-input-group error borders', () => {
  const css = readWorkspaceFile('src/index.css');

  // Verify .form-modal-theme rule is inside @layer components so Tailwind utilities win
  const layerMatch = css.match(/@layer components\s*\{[\s\S]*?\.form-modal-theme input:not\(/);
  assert.ok(layerMatch, '.form-modal-theme input rules must live inside @layer components');

  // Ensure .currency-input-field is excluded from both universal input borders and form-modal-theme padding/borders
  assert.match(css, /\.currency-input-group:not\(\.currency-input-error\)/);
  assert.match(css, /\.currency-input-group\.currency-input-error/);
  assert.match(css, /\.currency-input-field[\s\S]*border:\s*0\s*!important/);

  // Ensure .app-input only sets default padding when no pl-/pr-/px-/py-/p- utility is present
  assert.match(
    css,
    /\.app-input:not\(\[class\*="p-"\]\):not\(\[class\*="px-"\]\):not\(\[class\*="py-"\]\):not\(\[class\*="pl-"\]\):not\(\[class\*="pr-"\]\)/
  );
});

test('ProductFormModal uses non-overlapping .currency-input-group wrappers for all 7 Step 2 pricing fields', () => {
  const modal = readWorkspaceFile('src/components/inventory/ProductFormModal.tsx');

  const groupMatches = modal.match(/className=\{`currency-input-group\b/g) || [];
  assert.equal(groupMatches.length, 7, 'Expected all 7 pricing inputs to use .currency-input-group');

  const fieldMatches = modal.match(/className="currency-input-field\b/g) || [];
  assert.equal(fieldMatches.length, 7, 'Expected all 7 pricing inputs to use .currency-input-field');

  // Verify no absolute-positioned {currencySymbol} spans remain inside ProductFormModal
  assert.equal(
    /absolute[^\n>]*>[\s\n]*\{currencySymbol\}/.test(modal),
    false,
    'ProductFormModal must not float {currencySymbol} with absolute positioning over price inputs'
  );
});

test('Sibling currency inputs across SupplierPaymentModal, PurchaseManagement, and PosTerminal use non-overlapping .currency-input-group', () => {
  const files = [
    { path: 'src/components/suppliers/SupplierPaymentModal.tsx', minGroups: 1 },
    { path: 'src/components/purchases/PurchaseManagement.tsx', minGroups: 1 },
    { path: 'src/components/pos/PosTerminal.tsx', minGroups: 3 },
  ];

  for (const entry of files) {
    const src = readWorkspaceFile(entry.path);
    const groups = src.match(/currency-input-group/g) || [];
    const fields = src.match(/currency-input-field/g) || [];
    assert.ok(groups.length >= entry.minGroups, `${entry.path} should have >= ${entry.minGroups} .currency-input-group containers`);
    assert.ok(fields.length >= entry.minGroups, `${entry.path} should have >= ${entry.minGroups} .currency-input-field inputs`);
    assert.equal(
      /absolute[^\n>]*>[\s\n]*\{currencySymbol\}/.test(src),
      false,
      `${entry.path} must not overlay {currencySymbol} with absolute positioning over inputs`
    );
  }
});

test('Icon-prefixed inputs in BarcodeGeneratorTool, CustomerPicker, and SupplierPicker provide sufficient left padding', () => {
  const barcodeTool = readWorkspaceFile('src/components/inventory/BarcodeGeneratorTool.tsx');
  assert.ok(!barcodeTool.includes('pl-8 pr-3 py-1.5 bg-slate-50'), 'BarcodeGeneratorTool search input should use >= pl-9');
  assert.ok(barcodeTool.includes('pl-9 pr-3 py-1.5 bg-slate-50'), 'BarcodeGeneratorTool search input should have pl-9');

  const customerPicker = readWorkspaceFile('src/components/pos/CustomerPicker.tsx');
  assert.ok(!customerPicker.includes('app-input w-full pl-8 pr-3'), 'CustomerPicker opening balance should use >= pl-9');
  assert.ok(customerPicker.includes('app-input w-full pl-9 pr-3'), 'CustomerPicker opening balance should have pl-9');

  const supplierPicker = readWorkspaceFile('src/components/purchases/SupplierPicker.tsx');
  assert.ok(!supplierPicker.includes('app-input w-full pl-8 pr-3'), 'SupplierPicker opening balance should use >= pl-9');
  assert.ok(supplierPicker.includes('app-input w-full pl-9 pr-3'), 'SupplierPicker opening balance should have pl-9');
});
