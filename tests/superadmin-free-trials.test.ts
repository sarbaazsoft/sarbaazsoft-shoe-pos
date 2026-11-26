import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { pgClient } from '../src/db/index.ts';
import { ensureSaasControlPlane } from '../src/db/schemaInit.ts';
import { generateToken } from '../src/server/auth.ts';
import { tenantRoutingMiddleware } from '../src/server/middleware/tenantMiddleware.ts';
import authRoutes from '../src/server/routes/authRoutes.ts';
import tenantSaasRoutes from '../src/server/routes/tenantSaasRoutes.ts';
import productRoutes from '../src/server/routes/productRoutes.ts';
import settingsRoutes from '../src/server/routes/settingsRoutes.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';

function buildTestServerApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(tenantRoutingMiddleware);
  app.use('/api/auth', authRoutes);
  app.use('/api', tenantSaasRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/notifications', notificationRoutes);
  return app;
}

test('SuperAdmin Free Trial Management: access override, lifecycle tracking, permanent deletion & tenant isolation', async () => {
  await ensureSaasControlPlane();

  // Look up seeded SuperAdmin in DB
  const saRes = await pgClient.query<any>(
    `SELECT id, tenant_id, name, email, role FROM users WHERE role = 'SUPERADMIN' ORDER BY id ASC LIMIT 1`
  );
  assert.ok(saRes.rows.length > 0, 'Seeded SUPERADMIN user must exist');
  const saRow = saRes.rows[0];
  const superAdminToken = generateToken({
    id: saRow.id,
    tenantId: saRow.tenant_id || 0,
    name: saRow.name,
    email: saRow.email,
    role: 'SUPERADMIN',
    status: 'APPROVED',
  });

  const app = buildTestServerApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const suffix = Date.now().toString().slice(-6);
  let trialId1 = 0;
  let tenantId1 = 0;
  let ownerUserId1 = 0;
  let trialId2 = 0;
  let tenantId2 = 0;

  try {
    // 1. Provision two Free Trial stores via SuperAdmin provisioning endpoint
    const email1 = `trial.owner.${suffix}@example.com`;
    const email2 = `trial.convert.${suffix}@example.com`;
    const provision1 = await fetch(`${baseUrl}/api/superadmin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        storeName: `Trial Alpha ${suffix}`,
        ownerName: 'Alpha Owner',
        ownerEmail: email1,
        password: 'Password@123',
        subscriptionPlan: 'free_tier',
        businessType: 'RETAIL',
        pricingMode: 'FIXED',
      }),
    });
    assert.equal(provision1.status, 201);
    const p1Body = (await provision1.json()) as any;
    tenantId1 = Number(p1Body.provisioned?.tenantId ?? p1Body.tenant?.id);
    assert.ok(tenantId1 > 0);

    const provision2 = await fetch(`${baseUrl}/api/superadmin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        storeName: `Trial Beta ${suffix}`,
        ownerName: 'Beta Owner',
        ownerEmail: email2,
        password: 'Password@123',
        subscriptionPlan: 'free_tier',
        businessType: 'WHOLESALE',
        pricingMode: 'NEGOTIABLE',
      }),
    });
    assert.equal(provision2.status, 201);
    const p2Body = (await provision2.json()) as any;
    tenantId2 = Number(p2Body.provisioned?.tenantId ?? p2Body.tenant?.id);
    assert.ok(tenantId2 > 0);

    // Load Free Trials list & inspect both trials
    const listRes = await fetch(`${baseUrl}/api/superadmin/free-trials`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as any;
    const trial1 = (listBody.trials || []).find((t: any) => Number(t.tenantId) === tenantId1);
    const trial2 = (listBody.trials || []).find((t: any) => Number(t.tenantId) === tenantId2);
    assert.ok(trial1 && trial1.id > 0, 'Trial 1 must appear in GET /api/superadmin/free-trials');
    assert.ok(trial2 && trial2.id > 0, 'Trial 2 must appear in GET /api/superadmin/free-trials');
    trialId1 = trial1.id;
    trialId2 = trial2.id;
    assert.equal(trial1.email, email1);
    assert.equal(trial1.userName, 'Alpha Owner');
    assert.equal(trial1.status, 'ACTIVE');

    // Look up owner1 user id & generate store admin token for isolation/enforcement tests
    const ownerRes = await pgClient.query<any>(
      `SELECT id, tenant_id, name, email, role FROM users WHERE tenant_id = $1 AND role = 'ADMIN' LIMIT 1`,
      [tenantId1]
    );
    assert.ok(ownerRes.rows.length > 0);
    ownerUserId1 = Number(ownerRes.rows[0].id);
    const store1AdminToken = generateToken({
      id: ownerUserId1,
      tenantId: tenantId1,
      name: ownerRes.rows[0].name,
      email: ownerRes.rows[0].email,
      role: 'ADMIN',
      status: 'APPROVED',
    });

    const owner2Res = await pgClient.query<any>(
      `SELECT id, tenant_id, name, email, role FROM users WHERE tenant_id = $1 AND role = 'ADMIN' LIMIT 1`,
      [tenantId2]
    );
    assert.ok(owner2Res.rows.length > 0);
    const store2AdminToken = generateToken({
      id: owner2Res.rows[0].id,
      tenantId: tenantId2,
      name: owner2Res.rows[0].name,
      email: owner2Res.rows[0].email,
      role: 'ADMIN',
      status: 'APPROVED',
    });

    // Ensure SuperAdmin can seed & read tenant1 product, and store2 ADMIN cannot cross-access tenant1
    const seededProdRes = await fetch(`${baseUrl}/api/products?tenantId=${tenantId1}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
      body: JSON.stringify({
        article: `TR-${suffix}`,
        brand: 'Nike',
        category: 'Men',
        costPrice: 1200,
        maxPrice: 1800,
        totalStock: 15,
      }),
    });
    assert.equal(seededProdRes.status, 201);

    // Tenant isolation check: Store 2 Admin targeting Store 1 via X-Tenant-Id is strictly rejected
    const crossReadRes = await fetch(`${baseUrl}/api/products`, {
      headers: {
        Authorization: `Bearer ${store2AdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(crossReadRes.status, 401);
    const crossReadBody = (await crossReadRes.json()) as any;
    assert.equal(crossReadBody.code, 'CROSS_STORE_TOKEN_REJECTED');

    // Store 2 Admin reading their own store must not see Store 1's product
    const ownReadRes = await fetch(`${baseUrl}/api/products`, {
      headers: {
        Authorization: `Bearer ${store2AdminToken}`,
        'X-Tenant-Id': String(tenantId2),
      },
    });
    assert.equal(ownReadRes.status, 200);
    const ownReadBody = (await ownReadRes.json()) as any;
    const leaked = (ownReadBody.products || []).some((p: any) => p.article === `TR-${suffix}`);
    assert.equal(leaked, false, 'Non-SuperAdmin must remain strictly isolated to own tenantId');

    // 2. Edit Free Trial store & owner details
    const updatedEmail1 = `alpha.updated.${suffix}@example.com`;
    const editRes = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        storeName: `Trial Alpha Renamed ${suffix}`,
        userName: 'Alpha Owner Updated',
        email: updatedEmail1,
        phone: '+92-300-1122334',
        notes: 'Verified owner contact update',
      }),
    });
    assert.equal(editRes.status, 200);
    const editBody = (await editRes.json()) as any;
    assert.equal(editBody.trial.storeName, `Trial Alpha Renamed ${suffix}`);
    assert.equal(editBody.trial.userName, 'Alpha Owner Updated');
    assert.equal(editBody.trial.email, updatedEmail1);

    // 3. Extend Free Trial (+15 days)
    const extendRes = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ days: 15, notes: 'Granted 15 extra trial days' }),
    });
    assert.equal(extendRes.status, 200);
    const extendBody = (await extendRes.json()) as any;
    assert.equal(extendBody.trial.status, 'ACTIVE');
    assert.ok(extendBody.trial.daysRemaining >= 40);

    // 4. Expire Free Trial -> SuperAdmin bypass works, Store Admin blocked (403 SUBSCRIPTION_EXPIRED), forged token blocked
    const expireRes = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}/expire`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ notes: 'Testing manual expiration override' }),
    });
    assert.equal(expireRes.status, 200);
    const expireBody = (await expireRes.json()) as any;
    assert.equal(expireBody.trial.status, 'EXPIRED');

    // Verified SUPERADMIN accesses expired store POS endpoints
    const saExpiredProd = await fetch(`${baseUrl}/api/products?tenantId=${tenantId1}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(saExpiredProd.status, 200);
    assert.equal(saExpiredProd.headers.get('x-superadmin-override'), 'true');
    const saExpiredProdBody = (await saExpiredProd.json()) as any;
    assert.ok((saExpiredProdBody.products || []).some((p: any) => p.article === `TR-${suffix}`));

    // Store Admin is blocked with 403 SUBSCRIPTION_EXPIRED
    const adminExpiredProd = await fetch(`${baseUrl}/api/products?tenantId=${tenantId1}`, {
      headers: {
        Authorization: `Bearer ${store1AdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(adminExpiredProd.status, 403);
    const adminExpiredBody = (await adminExpiredProd.json()) as any;
    assert.equal(adminExpiredBody.code, 'SUBSCRIPTION_EXPIRED');

    // Forged non-SuperAdmin or invalid JWT token cannot spoof override
    const forgedToken = generateToken({
      id: ownerUserId1,
      tenantId: tenantId1,
      name: 'Fake SA',
      email: updatedEmail1,
      role: 'SUPERADMIN',
      status: 'APPROVED',
    });
    const forgedProd = await fetch(`${baseUrl}/api/products?tenantId=${tenantId1}`, {
      headers: {
        Authorization: `Bearer ${forgedToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(forgedProd.status, 403, 'DB-role check must block spoofed SUPERADMIN claims');

    // 5. Suspend Free Trial -> SuperAdmin override works on API and /api/auth/login; Store Admin blocked (423 TENANT_SUSPENDED)
    const suspendRes = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}/suspend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ notes: 'Testing manual suspension override' }),
    });
    assert.equal(suspendRes.status, 200);
    const suspendBody = (await suspendRes.json()) as any;
    assert.equal(suspendBody.trial.status, 'SUSPENDED');

    const saSuspendedSettings = await fetch(`${baseUrl}/api/settings?tenantId=${tenantId1}`, {
      headers: {
        Authorization: `Bearer ${superAdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(saSuspendedSettings.status, 200);
    assert.equal(saSuspendedSettings.headers.get('x-superadmin-override'), 'true');

    const adminSuspendedProd = await fetch(`${baseUrl}/api/products?tenantId=${tenantId1}`, {
      headers: {
        Authorization: `Bearer ${store1AdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(adminSuspendedProd.status, 423);
    const adminSuspendedBody = (await adminSuspendedProd.json()) as any;
    assert.equal(adminSuspendedBody.code, 'TENANT_SUSPENDED');

    // SuperAdmin login works even targeting a SUSPENDED tenant
    const saLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': String(tenantId1),
      },
      body: JSON.stringify({ email: saRow.email, password: 'admin123', tenantId: tenantId1 }),
    });
    assert.equal(saLoginRes.status, 200);
    const saLoginBody = (await saLoginRes.json()) as any;
    assert.equal(saLoginBody.user?.role, 'SUPERADMIN');

    // 6. Reactivate Free Trial -> Store returns to ACTIVE & Store Admin regains access
    const reactivateRes = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}/reactivate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ days: 20, notes: 'Reactivating after review' }),
    });
    assert.equal(reactivateRes.status, 200);
    const reactivateBody = (await reactivateRes.json()) as any;
    assert.equal(reactivateBody.trial.status, 'ACTIVE');

    const adminReactivatedProd = await fetch(`${baseUrl}/api/products?tenantId=${tenantId1}`, {
      headers: {
        Authorization: `Bearer ${store1AdminToken}`,
        'X-Tenant-Id': String(tenantId1),
      },
    });
    assert.equal(adminReactivatedProd.status, 200);

    // 7. Convert Trial 2 from free_tier to YEARLY via subscription upgrade -> logs CONVERTED
    const convertRes = await fetch(`${baseUrl}/api/superadmin/tenants/${tenantId2}/subscription`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ subscriptionPlan: 'YEARLY' }),
    });
    assert.equal(convertRes.status, 200);

    // Verify Search & Status Filter on /superadmin/free-trials
    const searchSuspendedRes = await fetch(
      `${baseUrl}/api/superadmin/free-trials?search=${encodeURIComponent(updatedEmail1)}&status=ACTIVE`,
      { headers: { Authorization: `Bearer ${superAdminToken}` } }
    );
    assert.equal(searchSuspendedRes.status, 200);
    const searchBody = (await searchSuspendedRes.json()) as any;
    assert.equal(searchBody.trials.length, 1);
    assert.equal(searchBody.trials[0].id, trialId1);

    const convertedListRes = await fetch(
      `${baseUrl}/api/superadmin/free-trials?status=CONVERTED`,
      { headers: { Authorization: `Bearer ${superAdminToken}` } }
    );
    assert.equal(convertedListRes.status, 200);
    const convertedListBody = (await convertedListRes.json()) as any;
    assert.ok(convertedListBody.trials.some((t: any) => t.id === trialId2 && t.status === 'CONVERTED'));

    // Verify Free Trial Tracking History records ACTIVATED, EDITED, EXTENDED, EXPIRED, SUSPENDED, REACTIVATED, CONVERTED
    const histRes = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}/history`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(histRes.status, 200);
    const histBody = (await histRes.json()) as any;
    const eventTypes = new Set((histBody.history || []).map((h: any) => h.eventType));
    for (const expectedEvent of ['ACTIVATED', 'EDITED', 'EXTENDED', 'EXPIRED', 'SUSPENDED', 'REACTIVATED']) {
      assert.ok(eventTypes.has(expectedEvent), `Expected tracking history event ${expectedEvent}`);
    }

    const ledgerRes = await fetch(
      `${baseUrl}/api/superadmin/free-trials/history?eventType=EXPIRED_CONVERTED_SUSPENDED`,
      { headers: { Authorization: `Bearer ${superAdminToken}` } }
    );
    assert.equal(ledgerRes.status, 200);
    const ledgerBody = (await ledgerRes.json()) as any;
    const ledgerEvents = new Set((ledgerBody.history || []).map((h: any) => h.eventType));
    assert.ok(ledgerEvents.has('EXPIRED'));
    assert.ok(ledgerEvents.has('SUSPENDED'));
    assert.ok(ledgerEvents.has('CONVERTED'));

    // 8. Seed a notification & activity log for Trial 1, then permanently delete Trial 1 & Trial 2
    await pgClient.query(
      `INSERT INTO notifications (tenant_id, title, message, type, target_role, created_at)
       VALUES ($1, 'Seeded Notification', 'Should be wiped', 'INFO', 'ALL', NOW())`,
      [tenantId1]
    );

    const deleteTrial1Res = await fetch(`${baseUrl}/api/superadmin/free-trials/${trialId1}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(deleteTrial1Res.status, 200);

    // Also test permanent deletion via /api/superadmin/tenants/:id on Trial 2
    const deleteTenant2Res = await fetch(`${baseUrl}/api/superadmin/tenants/${tenantId2}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(deleteTenant2Res.status, 200);

    // Assert zero orphaned records in database tables
    const tenantCheck = await pgClient.query(`SELECT id FROM tenants WHERE id = ANY($1::int[])`, [[tenantId1, tenantId2]]);
    assert.equal(tenantCheck.rows.length, 0, 'Deleted tenants must not exist');

    const trialCheck = await pgClient.query(`SELECT id FROM trial_activations WHERE id = ANY($1::int[])`, [[trialId1, trialId2]]);
    assert.equal(trialCheck.rows.length, 0, 'Deleted trial_activations must not exist');

    const histCheck = await pgClient.query(
      `SELECT id FROM trial_tracking_history WHERE trial_id = ANY($1::int[]) OR tenant_id = ANY($2::int[])`,
      [[trialId1, trialId2], [tenantId1, tenantId2]]
    );
    assert.equal(histCheck.rows.length, 0, 'Deleted trial_tracking_history must not exist');

    const prodCheck = await pgClient.query(`SELECT id FROM products WHERE tenant_id = ANY($1::int[])`, [[tenantId1, tenantId2]]);
    assert.equal(prodCheck.rows.length, 0, 'Deleted store products must not exist');

    const notifCheck = await pgClient.query(`SELECT id FROM notifications WHERE tenant_id = ANY($1::int[])`, [[tenantId1, tenantId2]]);
    assert.equal(notifCheck.rows.length, 0, 'Deleted store notifications must not exist');

    const nonSaUserCheck = await pgClient.query(
      `SELECT id FROM users WHERE tenant_id = ANY($1::int[]) AND role <> 'SUPERADMIN'`,
      [[tenantId1, tenantId2]]
    );
    assert.equal(nonSaUserCheck.rows.length, 0, 'Deleted store users must not exist');

    // Verify SUPERADMIN account still exists
    const saStillExists = await pgClient.query(`SELECT id FROM users WHERE id = $1 AND role = 'SUPERADMIN'`, [saRow.id]);
    assert.equal(saStillExists.rows.length, 1, 'SUPERADMIN user must never be deleted');

    // Verify reports/overview & history API return zero trace of deleted trial stores
    const postDeleteOverview = await fetch(`${baseUrl}/api/superadmin/overview`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(postDeleteOverview.status, 200);
    const postOverviewBody = (await postDeleteOverview.json()) as any;
    assert.equal((postOverviewBody.stores || []).some((s: any) => s.id === tenantId1 || s.id === tenantId2), false);
    assert.equal((postOverviewBody.trialActivations || []).some((t: any) => t.id === trialId1 || t.id === trialId2), false);

    const postDeleteHist = await fetch(`${baseUrl}/api/superadmin/free-trials/history`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(postDeleteHist.status, 200);
    const postHistBody = (await postDeleteHist.json()) as any;
    assert.equal(
      (postHistBody.history || []).some(
        (h: any) => h.trialId === trialId1 || h.trialId === trialId2 || h.tenantId === tenantId1 || h.tenantId === tenantId2
      ),
      false,
      'Deleted store history must never appear in Free Trial reports'
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('Frontend integration: /admin/free-trials route, SuperAdmin bypass, and Free Trial CRUD view', () => {
  const appTsx = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const controlPanel = fs.readFileSync(path.join(process.cwd(), 'src/components/saas/SuperAdminControlPanel.tsx'), 'utf8');
  const trialsView = fs.readFileSync(path.join(process.cwd(), 'src/components/saas/SuperAdminFreeTrialsView.tsx'), 'utf8');

  // App.tsx preserves /admin/free-trials and bypasses expiry/suspension lockouts for SuperAdmin
  assert.ok(appTsx.includes("window.location.pathname.startsWith('/admin')"));
  assert.ok(appTsx.includes("setSaasMode(isPlatformOwner ? 'TENANT_ACTIVE' : 'TENANT_SUSPENDED')"));
  assert.ok(appTsx.includes("setSaasMode(isPlatformOwner ? 'TENANT_ACTIVE' : 'TENANT_EXPIRED')"));

  // SuperAdminControlPanel syncs activeTab === 'trials' with /admin/free-trials and popstate
  assert.ok(controlPanel.includes("'/admin/free-trials'"));
  assert.ok(controlPanel.includes("window.addEventListener('popstate'"));
  assert.ok(controlPanel.includes('SuperAdminFreeTrialsView'));

  // SuperAdminFreeTrialsView exposes View, Edit, Extend, Suspend, Expire, Reactivate, Delete, and History Ledger
  assert.ok(trialsView.includes('api.superAdmin.getFreeTrials'));
  assert.ok(trialsView.includes('api.superAdmin.updateFreeTrial'));
  assert.ok(trialsView.includes('api.superAdmin.extendFreeTrial'));
  assert.ok(trialsView.includes('api.superAdmin.suspendFreeTrial'));
  assert.ok(trialsView.includes('api.superAdmin.expireFreeTrial'));
  assert.ok(trialsView.includes('api.superAdmin.reactivateFreeTrial'));
  assert.ok(trialsView.includes('api.superAdmin.deleteFreeTrial'));
  assert.ok(trialsView.includes('TRIAL_TRACKING_HISTORY') || trialsView.includes('Tracking History'));
});
