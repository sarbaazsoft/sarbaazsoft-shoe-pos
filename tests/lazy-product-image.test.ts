import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { LazyProductImage, sanitizeProductImageSrc } = await import('../src/components/common/LazyProductImage.tsx');
const { BrandLogo } = await import('../src/components/common/BrandLogo.tsx');

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('useIntersectionObserver hook implements IntersectionObserver lifecycle, triggerOnce, rootMargin, and SSR fallback', () => {
  const hookSrc = readProjectFile('src/hooks/useIntersectionObserver.ts');

  assert.ok(hookSrc.includes('export function useIntersectionObserver'), 'Must export useIntersectionObserver hook');
  assert.ok(hookSrc.includes("rootMargin = '150px 0px'"), 'Hook must provide default pre-load rootMargin');
  assert.ok(hookSrc.includes('triggerOnce = true'), 'Hook must default triggerOnce to true');
  assert.ok(hookSrc.includes('new IntersectionObserver('), 'Hook must instantiate browser IntersectionObserver');
  assert.ok(hookSrc.includes('observer.observe(targetNode)'), 'Hook must observe attached target node');
  assert.ok(hookSrc.includes('observer.disconnect()'), 'Hook must disconnect observer on intersection/cleanup');
  assert.ok(
    hookSrc.includes("typeof IntersectionObserver !== 'undefined'"),
    'Hook must gracefully fall back when IntersectionObserver is unavailable (e.g. SSR)'
  );
});

test('sanitizeProductImageSrc allows valid image URLs and blocks unsafe schemes', () => {
  assert.equal(sanitizeProductImageSrc('https://cdn.example.com/shoe.webp'), 'https://cdn.example.com/shoe.webp');
  assert.equal(sanitizeProductImageSrc('/uploads/shoe.png'), '/uploads/shoe.png');
  assert.equal(
    sanitizeProductImageSrc('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  );
  assert.equal(sanitizeProductImageSrc('javascript:alert(1)'), '');
  assert.equal(sanitizeProductImageSrc('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeProductImageSrc('   '), '');
  assert.equal(sanitizeProductImageSrc(null), '');
});

test('LazyProductImage defers <img> until intersection in DOM and renders loading="lazy" + fallback cleanly', () => {
  const compSrc = readProjectFile('src/components/common/LazyProductImage.tsx');
  assert.ok(compSrc.includes('useIntersectionObserver'), 'LazyProductImage must use useIntersectionObserver');
  assert.ok(
    compSrc.includes('{hasIntersected && (') && compSrc.includes('loading="lazy"'),
    'LazyProductImage must only mount <img loading="lazy"> after intersection'
  );

  // SSR fallback (no window/IntersectionObserver) renders the <img> so SSR/older browsers remain visible
  const ssrImgHtml = renderToStaticMarkup(
    React.createElement(LazyProductImage, {
      src: 'https://cdn.example.com/runner.jpg',
      alt: 'Apex Runner',
      containerClassName: 'w-12 h-12',
    })
  );
  assert.ok(ssrImgHtml.includes('<img'), 'SSR fallback must still output <img> when IntersectionObserver is absent');
  assert.ok(ssrImgHtml.includes('loading="lazy"'));
  assert.ok(ssrImgHtml.includes('decoding="async"'));
  assert.ok(ssrImgHtml.includes('alt="Apex Runner"'));

  // Missing or unsafe src renders fallback instead of <img>
  const fallbackHtml = renderToStaticMarkup(
    React.createElement(LazyProductImage, {
      src: 'javascript:alert(1)',
      alt: 'Bad Image',
      fallback: React.createElement('span', { 'data-testid': 'custom-fallback' }, 'No Image'),
    })
  );
  assert.equal(fallbackHtml.includes('<img'), false, 'Unsafe/empty URL must render fallback instead of <img>');
  assert.ok(fallbackHtml.includes('data-testid="custom-fallback"'));

  // BrandLogo with valid logo also integrates useIntersectionObserver
  const brandHtml = renderToStaticMarkup(
    React.createElement(BrandLogo, {
      logo: 'https://cdn.example.com/nike.png',
      name: 'Nike',
      size: 'xs',
    })
  );
  assert.ok(brandHtml.includes('loading="lazy"'));
  assert.ok(brandHtml.includes('alt="Nike logo"'));
});

test('Inventory and POS views integrate LazyProductImage & useIntersectionObserver across product and brand thumbnails', () => {
  const inventorySrc = readProjectFile('src/components/inventory/ProductManagement.tsx');
  assert.ok(
    inventorySrc.includes("import { LazyProductImage } from '../common/LazyProductImage.tsx';"),
    'ProductManagement must import LazyProductImage'
  );
  const inventoryLazyCount = (inventorySrc.match(/<LazyProductImage\b/g) || []).length;
  assert.ok(
    inventoryLazyCount >= 2,
    `ProductManagement must use LazyProductImage in both mobile card and desktop table views (found ${inventoryLazyCount})`
  );

  const posSrc = readProjectFile('src/components/pos/PosTerminal.tsx');
  assert.ok(
    posSrc.includes("import { LazyProductImage } from '../common/LazyProductImage.tsx';"),
    'PosTerminal must import LazyProductImage'
  );
  assert.ok(posSrc.includes('<LazyProductImage'), 'PosTerminal product list must render LazyProductImage');

  const headerSrc = readProjectFile('src/components/common/Header.tsx');
  assert.ok(
    headerSrc.includes("import { LazyProductImage } from './LazyProductImage.tsx';"),
    'Header quick price check must import LazyProductImage'
  );
  assert.ok(headerSrc.includes('<LazyProductImage'), 'Header QuickSearchProductImage must render LazyProductImage');

  const brandSrc = readProjectFile('src/components/common/BrandLogo.tsx');
  assert.ok(
    brandSrc.includes("import { useIntersectionObserver } from '../../hooks/useIntersectionObserver.ts';"),
    'BrandLogo must integrate useIntersectionObserver'
  );
});
