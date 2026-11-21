import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterDisplayQuickReceiveChips,
  generateRetailQuickReceiveChips,
  generateWholesaleQuickReceiveChips,
} from '../src/components/pos/QuickReceiveChips.tsx';

test('generateRetailQuickReceiveChips: returns 5 chips for 3250 with 3300 between Exact and 3500', () => {
  const chips = generateRetailQuickReceiveChips(3250);
  assert.deepEqual(
    chips.map((c) => c.amount),
    [3250, 3300, 3500, 4000, 5000]
  );
  assert.equal(chips[0].isExact, true);
  assert.equal(chips[0].label, 'Exact');
  assert.equal(chips.some((c) => c.amount % 100 === 75), false);
});

test('filterDisplayQuickReceiveChips: hides Exact when > 3 non-exact chips exist, renders when < 4', () => {
  // 3250 has 4 non-exact chips [3300, 3500, 4000, 5000] (> 3) -> Exact is hidden
  const for3250 = filterDisplayQuickReceiveChips(generateRetailQuickReceiveChips(3250));
  assert.deepEqual(
    for3250.map((c) => c.amount),
    [3300, 3500, 4000, 5000]
  );

  // 4250 has 3 non-exact chips [4300, 4500, 5000] (< 4) -> Exact is kept
  const for4250 = filterDisplayQuickReceiveChips(generateRetailQuickReceiveChips(4250));
  assert.deepEqual(
    for4250.map((c) => c.amount),
    [4250, 4300, 4500, 5000]
  );

  // 5000 has 0 non-exact chips (< 4) -> Exact is kept
  const for5000 = filterDisplayQuickReceiveChips(generateRetailQuickReceiveChips(5000));
  assert.deepEqual(
    for5000.map((c) => c.amount),
    [5000]
  );
});

test('generateRetailQuickReceiveChips: ignores rare Rs. 75 note and generates all PKR notes up to 5000 top note', () => {
  // Small bill 40 uses 50, 100, 500, 1000, and top note 5000 (never Rs. 75)
  assert.deepEqual(
    generateRetailQuickReceiveChips(40).map((c) => c.amount),
    [40, 50, 100, 500, 1000, 5000]
  );

  // Bill with small tail triggers Rs. 10 and Rs. 20 notes too (e.g. 36,005)
  assert.deepEqual(
    generateRetailQuickReceiveChips(36005).map((c) => c.amount),
    [36005, 36010, 36020, 36050, 36100, 36500, 37000, 40000]
  );

  // Bill between 50 and 100 tail uses 50+20 = 70 smartly (never 4x20 = 80)
  assert.deepEqual(
    generateRetailQuickReceiveChips(36055).map((c) => c.amount),
    [36055, 36060, 36070, 36100, 36500, 37000, 40000]
  );

  // Bill 36,120 includes 50, 100, 500, 1000, and 5000 steps (never 50,000)
  assert.deepEqual(
    generateRetailQuickReceiveChips(36120).map((c) => c.amount),
    [36120, 36150, 36200, 36500, 37000, 40000]
  );

  // Bill 36,000 produces only Exact (36,000) and next 5,000 top note multiple (40,000) — NEVER 50,000
  const for36000 = generateRetailQuickReceiveChips(36000);
  assert.deepEqual(
    for36000.map((c) => c.amount),
    [36000, 40000]
  );
  assert.equal(for36000.some((c) => c.amount === 50000), false);

  // Bill between 5000 and 10000
  assert.deepEqual(
    generateRetailQuickReceiveChips(6250).map((c) => c.amount),
    [6250, 6300, 6500, 7000, 10000]
  );

  // Exact multiple of 5000 returns Exact only
  assert.deepEqual(
    generateRetailQuickReceiveChips(10000).map((c) => c.amount),
    [10000]
  );

  // Bill 12,250 rounds through 100, 500, 1000, and 5000 (15,000) — never non-PKR 20,000 jump
  assert.deepEqual(
    generateRetailQuickReceiveChips(12250).map((c) => c.amount),
    [12250, 12300, 12500, 13000, 15000]
  );
});

test('generateWholesaleQuickReceiveChips: cash customers (0 ledger) use PKR note denominations; Khata accounts cap at invoice + ledger', () => {
  // Wholesale cash customer with 0 ledger balance and 36,000 bill gets [36000, 40000] (never 50,000)
  const cash36k = generateWholesaleQuickReceiveChips(36000, 0);
  assert.deepEqual(
    cash36k.map((c) => c.amount),
    [36000, 40000]
  );
  assert.equal(cash36k.some((c) => c.amount === 50000), false);

  // Wholesale cash customer with non-round 36,120 bill gets full PKR denominations
  assert.deepEqual(
    generateWholesaleQuickReceiveChips(36120, 0).map((c) => c.amount),
    [36120, 36150, 36200, 36500, 37000, 40000]
  );

  // Wholesale dealer with existing Khata balance caps at invoice + ledger balance
  const withLedger = generateWholesaleQuickReceiveChips(3250, 20000);
  assert.ok(withLedger.every((c) => c.amount <= 23250));
  assert.equal(withLedger[0].amount, 3250);
  assert.equal(withLedger[0].label, 'Bill Only');
  assert.equal(withLedger[withLedger.length - 1].amount, 23250);
  assert.equal(withLedger[withLedger.length - 1].label, 'Pay All');

  const displayWholesale = filterDisplayQuickReceiveChips(withLedger, {
    isWholesale: true,
    customerLedgerBalance: 20000,
  });
  assert.equal(displayWholesale[displayWholesale.length - 1].label, 'Pay All');
});

test('PosTerminal Wholesale Cash payment displays single theme-colored Amount Received block without duplicate green tender controls', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const posSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/pos/PosTerminal.tsx'), 'utf8');

  // Only one Amount Received header & input
  assert.equal((posSrc.match(/Amount Received \(Payment Collected Now\)/g) || []).length, 1);
  assert.equal((posSrc.match(/id="pos-amount-received"/g) || []).length, 1);

  // Duplicate green quick-add block (+500 / +1,000 / +5,000 with bg-emerald-600 Exact) is removed
  assert.equal(posSrc.includes('addQuickCash('), false);
  assert.equal(posSrc.includes('setExactCash'), false);
  assert.equal(posSrc.includes('Cash Received Tender & Quick Cash Buttons'), false);

  // Change Given lives inside the primary Amount Received card with dynamic theme colors (purple-* mapped to --primary-*)
  const changeIdx = posSrc.indexOf('<span>Change Given:</span>');
  const khataIdx = posSrc.indexOf('<span>Dealer Khata Balance</span>');
  assert.ok(changeIdx > 0 && khataIdx > changeIdx, 'Change Given should sit inside the primary Amount Received section before Dealer Khata Balance');
  const changeSnippet = posSrc.slice(Math.max(0, changeIdx - 220), changeIdx + 120);
  assert.ok(changeSnippet.includes('bg-purple-50/75') && !changeSnippet.includes('bg-emerald-50'));
});

