import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

import {
  calculateCartonsFromPairs,
  convertCartonsToPairs,
  getWholesaleStockStep,
  validateWholesaleStockQuantity,
} from '../src/schemas/productSchema.ts';
import { generateSampleProductsCsv, parseAndValidateProductsCsv } from '../src/utils/csvImport.ts';
import productRoutes from '../src/server/routes/productRoutes.ts';
import inventoryRoutes from '../src/server/routes/inventoryRoutes.ts';
import { pgClient } from '../src/db/index.ts';
import { ensureNotificationsSchema, ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';

test('wholesale stock validator: enforces full carton multiples when half cartons are disallowed', () => {
  // 12 pairs/carton, full cartons only
  for (const validQty of [0, 12, 24, 36, 120]) {
    const res = validateWholesaleStockQuantity({
      quantity: validQty,
      pairsPerCarton: 12,
      allowHalfCarton: false,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, true, `Expected ${validQty} to be valid for 12 pairs/carton`);
    assert.equal(res.normalizedQuantity, validQty);
    assert.equal(res.allowedIncrement, 12);
    assert.equal(res.cartons, validQty / 12);
  }

  for (const invalidQty of [6, 8, 13, 18, 12.5, -12, '', 'abc', Number.NaN, 12.0001]) {
    const res = validateWholesaleStockQuantity({
      quantity: invalidQty,
      pairsPerCarton: 12,
      allowHalfCarton: false,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, false, `Expected ${String(invalidQty)} to be rejected for 12 pairs/carton`);
    assert.ok(res.error && res.error.includes('12 pairs'), `Expected clear 12 pairs message, got: ${res.error}`);
  }

  // 16 pairs/carton, full cartons only
  for (const validQty of [0, 16, 32, 48]) {
    const res = validateWholesaleStockQuantity({
      quantity: validQty,
      pairsPerCarton: 16,
      allowHalfCarton: false,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, true);
    assert.equal(res.allowedIncrement, 16);
  }

  for (const invalidQty of [8, 12, 20, 16.5]) {
    const res = validateWholesaleStockQuantity({
      quantity: invalidQty,
      pairsPerCarton: 16,
      allowHalfCarton: false,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.error && res.error.includes('16 pairs'));
  }
});

test('wholesale stock validator: enforces half-carton multiples when 0.5 carton is allowed', () => {
  // 12 pairs/carton -> increment 6 pairs
  for (const validQty of [0, 6, 12, 18, 24, 30]) {
    const res = validateWholesaleStockQuantity({
      quantity: validQty,
      pairsPerCarton: 12,
      allowHalfCarton: true,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, true, `Expected ${validQty} to be valid for 0.5 carton of 12`);
    assert.equal(res.allowedIncrement, 6);
    assert.equal(res.cartons, validQty / 12);
  }

  for (const invalidQty of [3, 7, 10, 12.5, 6.1, -6]) {
    const res = validateWholesaleStockQuantity({
      quantity: invalidQty,
      pairsPerCarton: 12,
      allowHalfCarton: true,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, false, `Expected ${String(invalidQty)} to be rejected for 0.5 carton of 12`);
    assert.ok(res.error && res.error.includes('6 pairs'), `Expected clear 6 pairs message, got: ${res.error}`);
  }

  // 16 pairs/carton -> increment 8 pairs
  for (const validQty of [0, 8, 16, 24, 32]) {
    const res = validateWholesaleStockQuantity({
      quantity: validQty,
      pairsPerCarton: 16,
      allowHalfCarton: true,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, true);
    assert.equal(res.allowedIncrement, 8);
  }

  for (const invalidQty of [4, 12, 18, 8.5]) {
    const res = validateWholesaleStockQuantity({
      quantity: invalidQty,
      pairsPerCarton: 16,
      allowHalfCarton: true,
      isWholesaleStore: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.error && res.error.includes('8 pairs'));
  }
});

test('wholesale stock validator: precision-safe decimal math avoids IEEE-754 drift and does not affect Retail', () => {
  // Classic IEEE-754: 0.1 + 0.2 === 0.30000000000000004
  assert.equal(convertCartonsToPairs(0.1 + 0.2, 10), 3);
  assert.equal(convertCartonsToPairs(1.5, 12), 18);
  assert.equal(calculateCartonsFromPairs(18, 12), 1.5);
  assert.equal(calculateCartonsFromPairs(24, 16), 1.5);
  assert.equal(getWholesaleStockStep({ pairsPerCarton: 15, allowHalfCarton: true }), 7.5);
  assert.equal(getWholesaleStockStep({ pairsPerCarton: 15, allowHalfCarton: false }), 15);

  // Odd carton size 15 with half carton => 7.5 pairs per 0.5 carton => 22.5 pairs = 1.5 cartons
  const oddHalfValid = validateWholesaleStockQuantity({
    quantity: 0.1 + 0.2 + 22.2, // 22.500000000000004 in JS float
    pairsPerCarton: 15,
    allowHalfCarton: true,
    isWholesaleStore: true,
  });
  assert.equal(oddHalfValid.valid, true);
  assert.equal(oddHalfValid.normalizedQuantity, 22.5);
  assert.equal(oddHalfValid.cartons, 1.5);

  // Reject tiny extra un-snapped decimal
  const excessDecimal = validateWholesaleStockQuantity({
    quantity: 12.00001,
    pairsPerCarton: 12,
    allowHalfCarton: true,
    isWholesaleStore: true,
  });
  assert.equal(excessDecimal.valid, false);

  // Retail store: arbitrary integer quantities allowed without carton divisibility
  for (const qty of [0, 1, 5, 7, 13, 25]) {
    const retailRes = validateWholesaleStockQuantity({
      quantity: qty,
      pairsPerCarton: 12,
      allowHalfCarton: false,
      isWholesaleStore: false,
    });
    assert.equal(retailRes.valid, true);
    assert.equal(retailRes.normalizedQuantity, qty);
  }
});

test('CSV parser: enforces wholesale pairs_per_carton divisibility while leaving retail CSV unchanged', () => {
  const csvSample = [
    'Article Code,Product Name,Brand,Category,Cost Price,Sale Price,Stock (Pairs),Pairs Per Carton',
    'WS-101,Leather Loafer,Bata,Men,1500,2000,18,12',
    'WS-102,Oxford Shoe,Ndure,Men,1800,2400,24,16',
    'WS-103,Sport Runner,Servis,Men,1200,1600,12.5,12',
    'WS-104,Sandal Classic,Bata,Men,900,1300,24,12',
  ].join('\n');

  // Wholesale with allow_half_carton = false: 18 (12/ctn), 24 (16/ctn), 12.5 (12/ctn) invalid; 24 (12/ctn) valid
  const wsFullOnly = parseAndValidateProductsCsv(
    csvSample,
    [],
    { businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: false },
    1
  );
  assert.equal(wsFullOnly.rows.length, 4);
  assert.equal(wsFullOnly.rows[0].isValid, false);
  assert.ok(wsFullOnly.rows[0].validationErrors.total_stock?.includes('12 pairs'));
  assert.equal(wsFullOnly.rows[1].isValid, false);
  assert.ok(wsFullOnly.rows[1].validationErrors.total_stock?.includes('16 pairs'));
  assert.equal(wsFullOnly.rows[2].isValid, false);
  assert.ok(wsFullOnly.rows[2].validationErrors.total_stock);
  assert.equal(wsFullOnly.rows[3].isValid, true);
  assert.equal(wsFullOnly.rows[3].total_stock, 24);

  // Wholesale with allow_half_carton = true: 18 (12/ctn = 1.5 ctn) & 24 (16/ctn = 1.5 ctn) valid; 12.5 invalid
  const wsHalfAllowed = parseAndValidateProductsCsv(
    csvSample,
    [],
    { businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: true },
    1
  );
  assert.equal(wsHalfAllowed.rows[0].isValid, true);
  assert.equal(wsHalfAllowed.rows[0].total_stock, 18);
  assert.equal(wsHalfAllowed.rows[1].isValid, true);
  assert.equal(wsHalfAllowed.rows[1].total_stock, 24);
  assert.equal(wsHalfAllowed.rows[2].isValid, false);
  assert.equal(wsHalfAllowed.rows[3].isValid, true);

  // Retail: all integer rows pass without carton restriction
  const retailCsv = [
    'Article Code,Product Name,Brand,Category,Cost Price,Sale Price,Stock (Pairs)',
    'RT-101,Retail Sneaker,Bata,Men,1500,2200,5',
    'RT-102,Retail Sandal,Ndure,Men,1000,1500,7',
  ].join('\n');
  const retailParsed = parseAndValidateProductsCsv(
    retailCsv,
    [],
    { businessType: 'RETAIL', pricingMode: 'FIXED' },
    1
  );
  assert.equal(retailParsed.rows[0].isValid, true);
  assert.equal(retailParsed.rows[0].total_stock, 5);
  assert.equal(retailParsed.rows[1].isValid, true);
  assert.equal(retailParsed.rows[1].total_stock, 7);
});

test('CSV sample & parser: Allow Half Carton column added ONLY when wholesale allows 0.5 carton globally', () => {
  const retailFixed = generateSampleProductsCsv({ businessType: 'RETAIL', pricingMode: 'FIXED', allowHalfCarton: true });
  assert.equal(retailFixed.includes('Pairs Per Carton'), false);
  assert.equal(retailFixed.includes('Allow Half Carton'), false);
  assert.ok(retailFixed.includes('Sale Price'));

  const retailNeg = generateSampleProductsCsv({ businessType: 'RETAIL', pricingMode: 'NEGOTIABLE', allowHalfCarton: true });
  assert.equal(retailNeg.includes('Pairs Per Carton'), false);
  assert.equal(retailNeg.includes('Allow Half Carton'), false);
  assert.ok(retailNeg.includes('Min Price,Max Price'));

  const wsDisallowed = generateSampleProductsCsv({ businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: false });
  assert.ok(wsDisallowed.includes('Pairs Per Carton'));
  assert.equal(wsDisallowed.includes('Allow Half Carton'), false);

  const wsAllowed = generateSampleProductsCsv({ businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: true });
  assert.ok(wsAllowed.includes('Pairs Per Carton,Allow Half Carton'));

  // Parsing the generated wholesale sample templates produces 100% valid rows
  const parsedWsDisallowed = parseAndValidateProductsCsv(
    wsDisallowed,
    [],
    { businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: false },
    1
  );
  assert.equal(parsedWsDisallowed.rows.length, 2);
  assert.equal(parsedWsDisallowed.rows.every((r) => r.isValid), true);
  assert.equal(parsedWsDisallowed.rows[0].allow_half_carton, undefined);

  const parsedWsAllowed = parseAndValidateProductsCsv(
    wsAllowed,
    [],
    { businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: true },
    1
  );
  assert.equal(parsedWsAllowed.rows.length, 2);
  assert.equal(parsedWsAllowed.rows.every((r) => r.isValid), true);
  assert.equal(parsedWsAllowed.rows[0].allow_half_carton, true);
  assert.equal(parsedWsAllowed.rows[0].total_stock, 18);
  assert.equal(parsedWsAllowed.rows[1].allow_half_carton, false);
  assert.equal(parsedWsAllowed.rows[1].total_stock, 32);

  // Per-row allow_half_carton=false override rejects 18 pairs (1.5 cartons of 12)
  const overrideCsv = [
    'Article Code,Product Name,Brand,Category,Cost Price,Sale Price,Stock (Pairs),Pairs Per Carton,Allow Half Carton',
    'WS-OVR-1,Strict Full,Bata,Men,1500,2000,18,12,false',
    'WS-OVR-2,Invalid Bool,Bata,Men,1500,2000,24,12,maybe',
  ].join('\n');
  const parsedOverride = parseAndValidateProductsCsv(
    overrideCsv,
    [],
    { businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: true },
    1
  );
  assert.equal(parsedOverride.rows[0].isValid, false);
  assert.ok(parsedOverride.rows[0].validationErrors.total_stock?.includes('12 pairs'));
  assert.equal(parsedOverride.rows[1].isValid, false);
  assert.ok(parsedOverride.rows[1].validationErrors.allow_half_carton);

  // When globally disallowed, even a manually added allow_half_carton=true column cannot unlock half cartons
  const manualHalfWhenGlobalOff = parseAndValidateProductsCsv(
    'Article Code,Product Name,Brand,Category,Cost Price,Sale Price,Stock (Pairs),Pairs Per Carton,Allow Half Carton\nWS-OFF-1,Shoe,Bata,Men,1500,2000,18,12,true\n',
    [],
    { businessType: 'WHOLESALE', pricingMode: 'FIXED', allowHalfCarton: false },
    1
  );
  assert.equal(manualHalfWhenGlobalOff.rows[0].isValid, false);
  assert.ok(manualHalfWhenGlobalOff.rows[0].validationErrors.total_stock?.includes('12 pairs'));
  assert.equal(manualHalfWhenGlobalOff.rows[0].allow_half_carton, undefined);
});

test('API integration: Wholesale endpoints reject invalid carton quantities and Retail endpoints stay unaffected', async () => {
  await pgClient.waitReady;
  await ensureSaasControlPlane();
  await ensureNotificationsSchema();

  const suffix = Date.now().toString().slice(-6);

  // Create Wholesale tenant (allow_half_carton = false by default)
  const wsTenantRes = await pgClient.query<{ id: number }>(
    `INSERT INTO tenants (name, status, subscription_plan) VALUES ($1, 'ACTIVE', 'YEARLY') RETURNING id`,
    [`Wholesale Carton Validation ${suffix}`]
  );
  const wsTenantId = wsTenantRes.rows[0].id;
  await pgClient.query(
    `INSERT INTO company_settings (
      tenant_id, address, phone, email, currency, currency_symbol, pricing_mode, business_type, allow_half_carton, low_stock_threshold
    ) VALUES ($1, 'Lahore', '03000000000', $2, 'PKR', 'Rs.', 'FIXED', 'WHOLESALE', false, 5)`,
    [wsTenantId, `ws.${suffix}@shoepos.test`]
  );
  const wsUserRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED') RETURNING id`,
    [wsTenantId, 'WS Admin', `wsadmin.${suffix}@shoepos.test`, '+923001112233', 'hash', '1234']
  );
  const wsUserId = wsUserRes.rows[0].id;

  // Create Retail tenant
  const rtTenantRes = await pgClient.query<{ id: number }>(
    `INSERT INTO tenants (name, status, subscription_plan) VALUES ($1, 'ACTIVE', 'YEARLY') RETURNING id`,
    [`Retail Stock Test ${suffix}`]
  );
  const rtTenantId = rtTenantRes.rows[0].id;
  await pgClient.query(
    `INSERT INTO company_settings (
      tenant_id, address, phone, email, currency, currency_symbol, pricing_mode, business_type, allow_half_carton, low_stock_threshold
    ) VALUES ($1, 'Karachi', '03000000001', $2, 'PKR', 'Rs.', 'FIXED', 'RETAIL', false, 5)`,
    [rtTenantId, `rt.${suffix}@shoepos.test`]
  );
  const rtUserRes = await pgClient.query<{ id: number }>(
    `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'APPROVED') RETURNING id`,
    [rtTenantId, 'RT Admin', `rtadmin.${suffix}@shoepos.test`, '+923001112244', 'hash', '1234']
  );
  const rtUserId = rtUserRes.rows[0].id;

  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  app.use('/api/inventory', inventoryRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const wsHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${generateToken({
      id: wsUserId,
      email: `wsadmin.${suffix}@shoepos.test`,
      name: 'WS Admin',
      role: 'ADMIN',
      status: 'APPROVED',
      tenantId: wsTenantId,
    })}`,
    'X-Tenant-Id': String(wsTenantId),
  };

  const rtHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${generateToken({
      id: rtUserId,
      email: `rtadmin.${suffix}@shoepos.test`,
      name: 'RT Admin',
      role: 'ADMIN',
      status: 'APPROVED',
      tenantId: rtTenantId,
    })}`,
    'X-Tenant-Id': String(rtTenantId),
  };

  try {
    // 1. Wholesale POST /api/products rejects invalid quantities (half carton disabled -> must be multiple of 12)
    for (const badQty of [6, 10, 12.5]) {
      const badCreate = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: wsHeaders,
        body: JSON.stringify({
          article: `WS-BAD-${suffix}`,
          brand: 'Bata',
          category: 'Men',
          costPrice: 1200,
          maxPrice: 1600,
          pairsPerCarton: 12,
          allowHalfCarton: false,
          totalStock: badQty,
        }),
      });
      assert.equal(badCreate.status, 400, `Expected 400 for wholesale POST totalStock=${badQty}`);
      const errBody: any = await badCreate.json();
      assert.ok(String(errBody.error).includes('12 pairs'));
    }

    // 2. Wholesale POST /api/products accepts valid full carton quantity (24 pairs = 2 cartons of 12)
    const goodCreate = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: wsHeaders,
      body: JSON.stringify({
        article: `WS-GOOD-${suffix}`,
        brand: 'Bata',
        category: 'Men',
        costPrice: 1200,
        maxPrice: 1600,
        pairsPerCarton: 12,
        allowHalfCarton: false,
        totalStock: 24,
      }),
    });
    assert.equal(goodCreate.status, 201);
    const createdBody: any = await goodCreate.json();
    const wsProductId = createdBody.product?.id ?? createdBody.productId;
    assert.ok(wsProductId);

    // 3. Wholesale PUT /api/products/:id rejects 18 when allowHalfCarton=false, accepts 36, and accepts 24 when 16-pair half-carton enabled
    const badPut = await fetch(`${baseUrl}/api/products/${wsProductId}`, {
      method: 'PUT',
      headers: wsHeaders,
      body: JSON.stringify({
        costPrice: 1200,
        maxPrice: 1600,
        pairsPerCarton: 12,
        allowHalfCarton: false,
        totalStock: 18,
      }),
    });
    assert.equal(badPut.status, 400);

    const goodPut = await fetch(`${baseUrl}/api/products/${wsProductId}`, {
      method: 'PUT',
      headers: wsHeaders,
      body: JSON.stringify({
        costPrice: 1200,
        maxPrice: 1600,
        pairsPerCarton: 12,
        allowHalfCarton: false,
        totalStock: 36,
      }),
    });
    assert.equal(goodPut.status, 200);

    // Switch product to 16 pairs/carton + allowHalfCarton = true -> 24 (1.5 cartons) valid, 12 invalid
    const badHalf16Put = await fetch(`${baseUrl}/api/products/${wsProductId}`, {
      method: 'PUT',
      headers: wsHeaders,
      body: JSON.stringify({
        costPrice: 1200,
        maxPrice: 1600,
        pairsPerCarton: 16,
        allowHalfCarton: true,
        totalStock: 12,
      }),
    });
    assert.equal(badHalf16Put.status, 400);
    const badHalf16Body: any = await badHalf16Put.json();
    assert.ok(String(badHalf16Body.error).includes('8 pairs'));

    const goodHalf16Put = await fetch(`${baseUrl}/api/products/${wsProductId}`, {
      method: 'PUT',
      headers: wsHeaders,
      body: JSON.stringify({
        costPrice: 1200,
        maxPrice: 1600,
        pairsPerCarton: 16,
        allowHalfCarton: true,
        totalStock: 24,
      }),
    });
    assert.equal(goodHalf16Put.status, 200);

    // 4. POST /api/inventory/adjust & PATCH /api/inventory/inline-stock enforce product's 16/0.5 (8-pair) rule
    for (const badAdj of [10, 12, 16.5]) {
      const adjBadRes = await fetch(`${baseUrl}/api/inventory/adjust`, {
        method: 'POST',
        headers: wsHeaders,
        body: JSON.stringify({ productId: wsProductId, newStock: badAdj, reason: 'Audit check' }),
      });
      assert.equal(adjBadRes.status, 400, `Expected adjust 400 for ${badAdj}`);

      const inlineBadRes = await fetch(`${baseUrl}/api/inventory/inline-stock`, {
        method: 'PATCH',
        headers: wsHeaders,
        body: JSON.stringify({ productId: wsProductId, newStock: badAdj, reason: 'Inline audit' }),
      });
      assert.equal(inlineBadRes.status, 400, `Expected inline-stock 400 for ${badAdj}`);
    }

    const adjGoodRes = await fetch(`${baseUrl}/api/inventory/adjust`, {
      method: 'POST',
      headers: wsHeaders,
      body: JSON.stringify({ productId: wsProductId, newStock: 40, reason: 'Audit verified' }),
    });
    assert.equal(adjGoodRes.status, 200);

    const inlineGoodRes = await fetch(`${baseUrl}/api/inventory/inline-stock`, {
      method: 'PATCH',
      headers: wsHeaders,
      body: JSON.stringify({ productId: wsProductId, newStock: 32, reason: 'Inline verified' }),
    });
    assert.equal(inlineGoodRes.status, 200);

    // 5. Wholesale POST /api/products/bulk-import rejects non-divisible stock & rolls back
    const badBulkRes = await fetch(`${baseUrl}/api/products/bulk-import`, {
      method: 'POST',
      headers: wsHeaders,
      body: JSON.stringify({
        duplicateStrategy: 'MERGE',
        items: [
          {
            article: `WS-BLK-BAD-${suffix}`,
            name: 'Bulk Bad',
            brand: 'Bata',
            category: 'Men',
            cost_price: 1000,
            max_price: 1500,
            pairs_per_carton: 12,
            total_stock: 15,
          },
        ],
      }),
    });
    assert.equal(badBulkRes.status, 400);
    const badBulkBody: any = await badBulkRes.json();
    assert.ok(String(badBulkBody.error).includes('12 pairs'));

    const goodBulkRes = await fetch(`${baseUrl}/api/products/bulk-import`, {
      method: 'POST',
      headers: wsHeaders,
      body: JSON.stringify({
        duplicateStrategy: 'MERGE',
        items: [
          {
            article: `WS-BLK-OK-${suffix}`,
            name: 'Bulk Valid',
            brand: 'Bata',
            category: 'Men',
            cost_price: 1000,
            max_price: 1500,
            pairs_per_carton: 16,
            total_stock: 32,
          },
        ],
      }),
    });
    assert.equal(goodBulkRes.status, 200);

    // Verify persisted product under globally disallowed half-carton store saved allowHalfCarton = false
    const listRes = await fetch(`${baseUrl}/api/products`, { headers: wsHeaders });
    assert.equal(listRes.status, 200);
    const listBody: any = await listRes.json();
    const bulkImported = (listBody.products || []).find((p: any) => p.article === `WS-BLK-OK-${suffix}`);
    assert.ok(bulkImported);
    assert.equal(bulkImported.allowHalfCarton, false);

    // 6. Retail store remains completely unaffected (accepts 5, 7, 13 pairs)
    const rtCreate = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: rtHeaders,
      body: JSON.stringify({
        article: `RT-ITEM-${suffix}`,
        brand: 'Bata',
        category: 'Men',
        costPrice: 1200,
        maxPrice: 1800,
        totalStock: 5,
      }),
    });
    assert.equal(rtCreate.status, 201);
    const rtBody: any = await rtCreate.json();
    const rtProductId = rtBody.product?.id ?? rtBody.productId;
    assert.ok(rtProductId);

    const rtPut = await fetch(`${baseUrl}/api/products/${rtProductId}`, {
      method: 'PUT',
      headers: rtHeaders,
      body: JSON.stringify({
        costPrice: 1200,
        maxPrice: 1800,
        totalStock: 7,
      }),
    });
    assert.equal(rtPut.status, 200);

    const rtAdj = await fetch(`${baseUrl}/api/inventory/adjust`, {
      method: 'POST',
      headers: rtHeaders,
      body: JSON.stringify({ productId: rtProductId, newStock: 13, reason: 'Retail count' }),
    });
    assert.equal(rtAdj.status, 200);

    const rtInline = await fetch(`${baseUrl}/api/inventory/inline-stock`, {
      method: 'PATCH',
      headers: rtHeaders,
      body: JSON.stringify({ productId: rtProductId, newStock: 3, reason: 'Retail inline' }),
    });
    assert.equal(rtInline.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
