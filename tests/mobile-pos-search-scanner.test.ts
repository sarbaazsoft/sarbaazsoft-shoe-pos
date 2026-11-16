import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('Header quick search implements compact icon-to-relative-full-width collapsible UI on mobile while preserving desktop layout', () => {
  const src = readProjectFile('src/components/common/Header.tsx');

  // Collapsible state + autofocus effect + outside click cleanup
  assert.ok(src.includes('const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);'));
  assert.ok(src.includes('const searchInputRef = useRef<HTMLInputElement>(null);'));
  assert.match(src, /useEffect\(\(\) => \{\s*if \(!isMobileSearchExpanded\) return;[\s\S]*?searchInputRef\.current\?\.focus\(\);/);
  assert.ok(src.includes('id="header-mobile-search-trigger"'));
  assert.ok(src.includes('id="header-mobile-search-close"'));
  assert.ok(src.includes('id="header-quick-search-input"'));

  // Uses position: relative and smooth transitions on width, max-width, opacity, visibility (not fixed/absolute overlay for the input container)
  const triggerIdx = src.indexOf('id="header-mobile-search-trigger"');
  const closeIdx = src.indexOf('id="header-mobile-search-close"');
  assert.ok(triggerIdx !== -1 && closeIdx !== -1 && closeIdx > triggerIdx);
  const searchSection = src.slice(triggerIdx - 300, closeIdx + 400);

  assert.ok(searchSection.includes('relative flex items-center'));
  assert.ok(searchSection.includes('transition-[width,max-width,opacity,visibility]'));
  assert.ok(searchSection.includes('w-0 max-w-0 opacity-0 invisible'));
  assert.ok(searchSection.includes('w-full max-w-full flex-1 opacity-100 visible'));
  assert.equal(searchSection.includes('fixed '), false);

  // Desktop preservation & sibling collapse to prevent overlap
  assert.ok(src.includes('sm:w-56 md:w-68 lg:w-80'));
  assert.ok(src.includes("${isMobileSearchExpanded ? 'hidden sm:flex' : 'flex'} items-center gap-1.5 sm:gap-2 shrink-0"));

  // Escape key collapses expanded mobile search
  assert.match(src, /if \(e\.key === 'Escape'\)[\s\S]*?setIsMobileSearchExpanded\(false\)/);
});

test('PosTerminal barcode scanner implements compact icon-to-relative-full-width collapsible UI while preserving autofocus, physical scanners, and desktop layout', () => {
  const src = readProjectFile('src/components/pos/PosTerminal.tsx');

  // State, refs, physical scanner burst buffering when collapsed on mobile
  assert.ok(src.includes('const [isMobileScannerExpanded, setIsMobileScannerExpanded] = useState(false);'));
  assert.ok(src.includes('const isMobileScannerExpandedRef = useRef(isMobileScannerExpanded);'));
  assert.ok(src.includes('const pendingScannerBufferRef = useRef(\'\');'));
  assert.ok(src.includes('const pendingScannerEnterRef = useRef(false);'));

  // Auto-expand + flush buffered physical scanner strokes on keyboard wedge input or F2/F3
  assert.match(src, /if \(e\.key === 'F2' \|\| \(e\.ctrlKey && e\.key === 'k'\)\)[\s\S]*?setIsMobileScannerExpanded\(true\)/);
  assert.match(src, /else if \(e\.key === 'F3'\)[\s\S]*?setIsMobileScannerExpanded\(true\)/);
  assert.match(src, /pendingScannerBufferRef\.current \+= e\.key;/);
  assert.match(src, /useEffect\(\(\) => \{\s*if \(!isMobileScannerExpanded\) return;[\s\S]*?focusScannerInput\(/);

  // Compact icon trigger, close button, position: relative animated form wrapper, and desktop sm+ visibility
  assert.ok(src.includes('id="pos-mobile-scanner-trigger"'));
  assert.ok(src.includes('id="pos-mobile-scanner-close"'));
  assert.ok(src.includes('id="pos-barcode-scanner-input"'));
  assert.ok(src.includes('id="pos-scanner-submit-btn"'));

  const scannerStart = src.indexOf('id="pos-mobile-scanner-trigger"');
  const scannerEnd = src.indexOf('id="pos-mobile-scanner-close"');
  assert.ok(scannerStart !== -1 && scannerEnd !== -1 && scannerEnd > scannerStart);
  const scannerSection = src.slice(scannerStart - 300, scannerEnd + 450);

  assert.ok(scannerSection.includes('relative flex items-center'));
  assert.ok(scannerSection.includes('transition-[width,max-width,opacity,visibility]'));
  assert.ok(scannerSection.includes('w-0 max-w-0 opacity-0 invisible'));
  assert.ok(scannerSection.includes('w-full max-w-full flex-1 opacity-100 visible'));
  assert.ok(scannerSection.includes('sm:w-full sm:max-w-full sm:flex-1 sm:opacity-100 sm:visible'));
  assert.equal(scannerSection.includes('fixed '), false);

  // Preserves autoFocus, continuous scanning focus, and existing mode/submit controls
  assert.ok(src.includes('autoFocus'));
  assert.ok(src.includes('id="pos-mode-scanner-btn"'));
  assert.ok(src.includes('id="pos-mode-manual-btn"'));
  assert.ok(src.includes('Scan Barcode / Search Article'));
});
