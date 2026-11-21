import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  bumpLazyRetryGeneration,
  getLazyRetryGeneration,
  isDynamicImportError,
  retryDynamicImport,
} from '../src/utils/lazyWithRetry.ts';

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('isDynamicImportError recognizes browser dynamic module fetch errors without false positives', () => {
  assert.equal(
    isDynamicImportError(
      new TypeError(
        'Failed to fetch dynamically imported module: https://ais-dev.example.run.app/src/components/dashboard/DashboardOverview.tsx'
      )
    ),
    true
  );
  assert.equal(isDynamicImportError(new Error('Importing a module script failed.')), true);
  assert.equal(isDynamicImportError(new Error('Loading chunk dashboard-123 failed')), true);
  assert.equal(isDynamicImportError(new Error('Cannot read properties of undefined')), false);
});

test('retryDynamicImport automatically retries transient module fetch failures and resolves when recovered', async () => {
  let attempts = 0;
  const result = await retryDynamicImport(async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new TypeError(
        'Failed to fetch dynamically imported module: https://ais-dev.example.run.app/src/components/dashboard/DashboardOverview.tsx'
      );
    }
    return { ok: true };
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, { ok: true });
});

test('bumpLazyRetryGeneration increments generation for TabErrorBoundary manual retry reset', () => {
  const before = getLazyRetryGeneration();
  const after = bumpLazyRetryGeneration();
  assert.equal(after, before + 1);
});

test('Service Worker bypasses Vite dev source modules and ES module scripts while App & TabErrorBoundary wire retry recovery', () => {
  const swSrc = readProjectFile('public/sw.js');
  assert.ok(swSrc.includes("SW_ENV === 'development' && request.mode !== 'navigate'"));
  assert.ok(swSrc.includes("url.pathname.startsWith('/src/')"));
  assert.ok(swSrc.includes("request.destination === 'script'"));

  const appSrc = readProjectFile('src/App.tsx');
  assert.ok(appSrc.includes('lazyWithRetry('));
  assert.ok(appSrc.includes("'/src/components/dashboard/DashboardOverview.tsx'"));

  const keepAliveSrc = readProjectFile('src/components/common/KeepAliveRouteHost.tsx');
  assert.ok(keepAliveSrc.includes('bumpLazyRetryGeneration()'));
  assert.ok(keepAliveSrc.includes('this.state.retryNonce'));
});
