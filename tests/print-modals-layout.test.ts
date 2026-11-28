import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('Keep-alive tab animations resolve to transform: none so fixed print modals anchor to the viewport', () => {
  const css = readProjectFile('src/index.css');

  assert.match(
    css,
    /@keyframes keepaliveTabEnterForward[\s\S]*?to\s*\{[\s\S]*?transform:\s*none;/,
    'keepaliveTabEnterForward must finish with transform: none so modals are not trapped inside <main>'
  );
  assert.match(
    css,
    /@keyframes keepaliveTabEnterBackward[\s\S]*?to\s*\{[\s\S]*?transform:\s*none;/,
    'keepaliveTabEnterBackward must finish with transform: none so modals are not trapped inside <main>'
  );
});

test('src/index.css provides compact modal control rules without breaking stepper focus or padding', () => {
  const css = readProjectFile('src/index.css');

  assert.ok(css.includes('.form-modal-theme input.compact-modal-input'), 'Should style compact modal inputs cleanly');
  assert.ok(css.includes('.form-modal-theme input.compact-stepper-input'), 'Should style compact stepper inputs cleanly');
  assert.ok(css.includes('.form-modal-theme select.compact-modal-select'), 'Should style compact modal selects cleanly');
  assert.ok(
    css.includes(':not(.compact-stepper-input)'),
    'Global input border/focus overrides must exclude .compact-stepper-input'
  );
});

test('SideEndBoxLabelModal uses adaptive width, natural label height, compact controls, and preserves 3x4 print dimensions', () => {
  const src = readProjectFile('src/components/inventory/SideEndBoxLabelModal.tsx');

  // No oversized fixed lg:max-w-3xl modal shell or artificial vertical voids inside preview
  assert.equal(src.includes('lg:max-w-3xl'), false, 'Modal container should adapt cleanly by copies/orientation instead of fixed lg:max-w-3xl');
  assert.equal(src.includes('h-[375px]'), false, 'Portrait preview must not reserve an empty 375px vertical void');
  assert.equal(src.includes('min-h-[280px]'), false, 'Landscape preview must not reserve an empty 280px vertical void');

  // Responsive container widths and flex shrink containment
  assert.ok(src.includes("copies > 1\n            ? 'max-w-lg sm:max-w-xl lg:max-w-2xl'"), 'Multi-copy grid should scale to lg:max-w-2xl');
  assert.ok(src.includes("orientation === 'landscape'\n            ? 'max-w-lg sm:max-w-xl'\n            : 'max-w-md sm:max-w-lg'"), 'Single-copy modal should fit orientation tightly');
  assert.ok(src.includes('flex-1 min-h-0 p-3.5 sm:p-5 overflow-y-auto'), 'Preview stage must apply min-h-0 so modal scrolls cleanly');
  assert.ok(src.includes('compact-modal-input'), 'Inline copy/write-in inputs should use compact-modal-input');

  // Dark mode button parity
  assert.ok(src.includes('dark:bg-purple-500/15') && src.includes('dark:border-purple-500/40'), 'Download buttons should support Dark Mode cleanly');

  // Physical print dimensions preserved untouched
  assert.ok(src.includes("width: orientation === 'portrait' ? '76mm' : '102mm'"));
  assert.ok(src.includes("height: orientation === 'portrait' ? '102mm' : '76mm'"));
});

test('BarcodeStickerModal eliminates blank preview gaps, keeps compact inline controls, and preserves thermal roll dimensions', () => {
  const src = readProjectFile('src/components/inventory/BarcodeStickerModal.tsx');

  // No fixed tall vertical voids inside thermal preview cards
  assert.equal(src.includes('min-h-[145px]'), false, '40x25 preview must not use hardcoded min-h-[145px]');
  assert.equal(src.includes('min-h-[165px]'), false, '50x30 preview must not use hardcoded min-h-[165px]');
  assert.equal(src.includes('min-h-[195px]'), false, '60x40 preview must not use hardcoded min-h-[195px]');
  assert.equal(src.includes('lg:max-w-2xl'), false, 'Single-tag modal should fit tightly within max-w-lg sm:max-w-xl');

  // Compact inline stepper & select
  assert.ok(src.includes('compact-stepper-input'), 'Copies stepper input should use compact-stepper-input');
  assert.ok(src.includes('compact-modal-select w-auto h-8'), 'Tag size select should stay compact and inline');
  assert.ok(src.includes('flex-1 min-h-0 p-4 sm:p-5 overflow-y-auto'), 'Preview stage must set min-h-0');

  // Dark mode support on expandable field options panel
  assert.ok(src.includes('dark:bg-[#0E1628]'), 'Tag Fields panel must style Dark Mode background cleanly');
  assert.ok(src.includes('dark:bg-indigo-950/60'), 'Checked field options must support Dark Mode styling');

  // Physical print-only sticker dimensions preserved untouched
  assert.ok(src.includes("width: tagSize === '40x25' ? '40mm' : tagSize === '60x40' ? '60mm' : '50mm'"));
  assert.ok(src.includes("height: tagSize === '40x25' ? '25mm' : tagSize === '60x40' ? '40mm' : '30mm'"));
});

test('InvoicePrintModal adapts dialog width by format, centers preview without clipping on mobile, and avoids duplicate close buttons', () => {
  const src = readProjectFile('src/components/pos/InvoicePrintModal.tsx');

  // Dynamic modal sizing by selected format (no oversized lg:max-w-4xl around 50mm receipt)
  assert.equal(src.includes('lg:max-w-4xl'), false, 'Modal should adapt width between 50mm thermal and A4 formats');
  assert.ok(
    src.includes("useThermalLayout\n            ? 'max-w-md sm:max-w-lg'\n            : 'max-w-lg sm:max-w-2xl lg:max-w-[820px]'"),
    'InvoicePrintModal should size tightly for 50mm thermal and expand cleanly for A4'
  );

  // Scroll container prevents left-edge clipping on mobile horizontal scroll while mx-auto centers when space allows
  assert.ok(
    src.includes('flex-1 min-h-0 overflow-auto p-3 sm:p-4 bg-slate-100 dark:bg-[#080D1A] flex justify-start items-start'),
    'Preview scroll area should start-align for horizontal overflow safety while children use mx-auto'
  );
  assert.ok(
    src.includes('className="invoice-preview-receipt w-full max-w-[250px] sm:max-w-[260px] mx-auto h-fit shrink-0 bg-white'),
    '50mm thermal preview card must be centered with mx-auto and crisp responsive width'
  );
  assert.ok(
    src.includes('className="invoice-preview-receipt w-full min-w-[540px] sm:min-w-0 max-w-[740px] mx-auto h-fit shrink-0 bg-white'),
    'A4 preview card must scroll cleanly on mobile and center on larger screens'
  );

  // No duplicate Close (<X />) icon button in the layout/actions toolbar
  const closeIconMatches = src.match(/<X className=/g) || [];
  assert.equal(closeIconMatches.length, 1, 'Header should have a single close icon button without a duplicate in the toolbar');

  // Print-only thermal & A4 dimensions preserved untouched
  assert.ok(src.includes("width: '48mm', maxWidth: '50mm'"));
  assert.ok(src.includes('className="print-a4-invoice"'));
});
