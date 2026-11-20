import { registerHooks } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Stub static image imports (e.g. .jpg/.png) when running SSR component tests outside Vite
registerHooks({
  load(url, context, nextLoad) {
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(url)) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${JSON.stringify(url)};`,
      };
    }
    return nextLoad(url, context);
  },
});

const { ThemeProvider } = await import('../src/context/ThemeContext.tsx');
const { AuthModal } = await import('../src/components/auth/AuthModal.tsx');
const { FreeTrialOnboardingModal } = await import('../src/components/saas/FreeTrialOnboardingModal.tsx');

const ROOT = process.cwd();

describe('Auth Route Free Trial Registration Link', () => {
  it('renders the free trial registration prompt and trigger directly beneath #login-submit-btn', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AuthModal, {
          onSuccess: () => {},
          companySettings: { name: 'SarbaazSoft Shoe POS', logo: '/pwa-192x192.png' },
        })
      )
    );

    const submitIdx = html.indexOf('id="login-submit-btn"');
    const promptIdx = html.indexOf('Don&#x27;t have a store account yet?');
    const linkIdx = html.indexOf('id="auth-register-free-trial-link"');

    assert.ok(submitIdx !== -1, 'Expected Sign In submit button to render');
    assert.ok(promptIdx !== -1, 'Expected unregistered store prompt label to render');
    assert.ok(linkIdx !== -1, 'Expected Free Trial link button to render');
    assert.ok(
      submitIdx < promptIdx && promptIdx < linkIdx,
      'Free trial prompt and link must appear directly below #login-submit-btn'
    );
    assert.ok(html.includes('Start 30-Day Free Trial'), 'Expected clear Free Trial CTA label');
  });

  it('wires FreeTrialOnboardingModal cleanly in AuthModal and routes via handleFreeTrialStoreCreated in App.tsx', () => {
    const authSrc = readFileSync(join(ROOT, 'src/components/auth/AuthModal.tsx'), 'utf8');
    assert.ok(authSrc.includes('FreeTrialOnboardingModal'), 'AuthModal should import and mount FreeTrialOnboardingModal');
    assert.ok(authSrc.includes('showFreeTrialModal'), 'AuthModal should track free trial modal open state');
    assert.ok(authSrc.includes('onClick={() => setShowFreeTrialModal(true)}'), 'Auth free trial link should open FreeTrialOnboardingModal');
    assert.ok(authSrc.includes('initialPlan="TRIAL"'), 'Auth free trial modal should default to TRIAL plan');

    const appSrc = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    const callbackMatches = appSrc.match(/onStoreCreated=\{handleFreeTrialStoreCreated\}/g) || [];
    assert.equal(callbackMatches.length, 3, 'App.tsx should pass handleFreeTrialStoreCreated to both AuthModal mounts and SaasLandingPage');

    const modalHtml = renderToStaticMarkup(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(FreeTrialOnboardingModal, {
          isOpen: true,
          onClose: () => {},
          initialPlan: 'TRIAL',
        })
      )
    );
    assert.ok(modalHtml.includes('Register Free Trial Store'), 'FreeTrialOnboardingModal should render dialog heading when opened');
  });
});
