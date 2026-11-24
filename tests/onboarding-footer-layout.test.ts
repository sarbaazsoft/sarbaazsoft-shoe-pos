import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingStepFooter } from '../src/components/saas/OnboardingStepFooter.tsx';

const ROOT = process.cwd();

function readWizardSource(): string {
  return readFileSync(join(ROOT, 'src/components/saas/TenantOnboardingWizard.tsx'), 'utf8');
}

describe('Mobile Onboarding Card Footer Layout', () => {
  it('keeps card horizontal padding at exact 1rem (p-4) on mobile so full-width Next button has 1rem card edge spacing', () => {
    const src = readWizardSource();
    assert.ok(
      src.includes('className="app-card bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-purple-200/80 dark:border-purple-800/80 rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-2xl'),
      'Expected onboarding card form to maintain p-4 (1rem) mobile padding'
    );
    // Ensure all 4 step containers avoid oversized vertical gap on mobile
    const stepMatches = src.match(/<div className="space-y-4 sm:space-y-6">/g) ?? [];
    assert.equal(stepMatches.length, 4, 'Expected all 4 onboarding steps to use compact mobile vertical spacing');
  });

  it('places Next: [Step Name] first and full-width on mobile, and Back + Save & Launch aligned left/right in row 2', () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingStepFooter, {
        leftLabel: 'Back',
        onLeftClick: () => {},
        nextLabel: 'Next: Invoices, Taxes & Receipts',
        onNextClick: () => {},
        saving: false,
      })
    );

    const nextIdx = html.indexOf('Next: Invoices, Taxes &amp; Receipts');
    const backIdx = html.indexOf('Back');
    const saveIdx = html.indexOf('Save &amp; Launch');

    assert.ok(nextIdx !== -1 && backIdx !== -1 && saveIdx !== -1, 'Expected all 3 footer actions to render');
    assert.ok(nextIdx < backIdx && backIdx < saveIdx, 'Expected Next button at top, followed by Back then Save & Launch');

    // Outer container: mobile flex-col, desktop horizontal row
    assert.ok(
      html.includes('flex flex-col gap-2.5 pt-3.5 sm:pt-4 border-t') &&
      html.includes('sm:flex-row sm:items-center sm:justify-between'),
      'Expected responsive vertical mobile -> horizontal desktop footer container'
    );

    // Next button: top on mobile (order-1), 100% width inside card p-4 (w-full), compact on desktop (sm:w-auto sm:order-3)
    assert.ok(
      html.includes('btn-primary order-1 sm:order-3 w-full sm:w-auto'),
      'Expected Next button to be top row full-width on mobile and right-most on desktop'
    );

    // Second row wrapper: far-left / far-right flex row on mobile, transparent contents on desktop
    assert.ok(
      html.includes('order-2 sm:contents flex items-center justify-between gap-2 w-full'),
      'Expected Back and Save & Launch row to align far-left and far-right on mobile'
    );

    // Consistent height, vertical alignment, and no-wrap overflow prevention on row-2 buttons
    const row2BtnMatches = html.match(/min-h-10[^"]*whitespace-nowrap shrink-0/g) ?? [];
    assert.equal(row2BtnMatches.length, 2, 'Expected Back and Save & Launch to share min-h-10 + whitespace-nowrap + shrink-0');
  });

  it('keeps Step 1 Cancel Setup and Step 4 final launch CTA consistent with mobile and desktop alignment rules', () => {
    const step1Html = renderToStaticMarkup(
      React.createElement(OnboardingStepFooter, {
        leftLabel: 'Cancel Setup',
        showLeftArrow: false,
        onLeftClick: () => {},
        nextLabel: 'Next: Cashier Account Setup (Recommended)',
        onNextClick: () => {},
        saving: false,
      })
    );
    assert.ok(step1Html.includes('Next: Cashier Account Setup (Recommended)'));
    assert.ok(step1Html.includes('Cancel Setup'));
    assert.ok(step1Html.includes('Save &amp; Launch'));

    const step4Html = renderToStaticMarkup(
      React.createElement(OnboardingStepFooter, {
        leftLabel: 'Back',
        onLeftClick: () => {},
        saving: false,
        isFinalStep: true,
      })
    );
    const submitIdx = step4Html.indexOf('Complete Store Setup &amp; Unlock Owner Portal');
    const backIdx = step4Html.indexOf('Back');
    assert.ok(submitIdx !== -1 && backIdx !== -1 && submitIdx < backIdx);
    assert.ok(step4Html.includes('btn-primary order-1 sm:order-2 w-full sm:w-auto'));
    assert.ok(step4Html.includes('order-2 sm:order-1 flex items-center justify-start w-full sm:w-auto'));
  });
});
