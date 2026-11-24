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
import backupRoutes from '../src/server/routes/backupRoutes.ts';

function buildSqlTestServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(tenantRoutingMiddleware);
  app.use('/api/backup', backupRoutes);
  return app;
}

test('SuperAdmin SQL Query endpoint: strict RBAC, confirmation requirement, SELECT/DML execution & atomic rollback', async () => {
  await ensureSaasControlPlane();

  const saRes = await pgClient.query<any>(
    `SELECT id, tenant_id, name, email, role FROM users WHERE UPPER(role::text) = 'SUPERADMIN' ORDER BY id ASC LIMIT 1`
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

  const adminRes = await pgClient.query<any>(
    `SELECT id, tenant_id, name, email, role FROM users WHERE UPPER(role::text) = 'ADMIN' ORDER BY id ASC LIMIT 1`
  );
  assert.ok(adminRes.rows.length > 0, 'Seeded ADMIN user must exist');
  const adminRow = adminRes.rows[0];
  assert.equal(String(adminRow.role).toUpperCase(), 'ADMIN');
  const storeAdminToken = generateToken({
    id: adminRow.id,
    tenantId: adminRow.tenant_id || 1,
    name: adminRow.name,
    email: adminRow.email,
    role: 'ADMIN',
    status: 'APPROVED',
  });

  // Forged token: JWT claims role=SUPERADMIN, but user id belongs to a Store ADMIN in DB
  const forgedSuperAdminToken = generateToken({
    id: adminRow.id,
    tenantId: 0,
    name: adminRow.name,
    email: adminRow.email,
    role: 'SUPERADMIN',
    status: 'APPROVED',
  });

  const app = buildSqlTestServer();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Unauthenticated request is rejected
    const unauthRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1', confirmExecution: true }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Store ADMIN request is rejected (403 Forbidden)
    const adminExecRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${storeAdminToken}`,
      },
      body: JSON.stringify({ sql: 'SELECT 1', confirmExecution: true }),
    });
    assert.equal(adminExecRes.status, 403);

    // 3. Forged SuperAdmin claim pointing to non-SuperAdmin DB user is rejected (401/403)
    const forgedRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${forgedSuperAdminToken}`,
      },
      body: JSON.stringify({ sql: 'SELECT 1', confirmExecution: true }),
    });
    assert.ok(forgedRes.status === 401 || forgedRes.status === 403, `Expected 401 or 403, got ${forgedRes.status}`);

    // 4. Missing confirmation is rejected with 400 CONFIRMATION_REQUIRED
    const noConfirmRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ sql: 'SELECT id, name FROM tenants LIMIT 2', confirmExecution: false }),
    });
    assert.equal(noConfirmRes.status, 400);
    const noConfirmBody = (await noConfirmRes.json()) as any;
    assert.equal(noConfirmBody.code, 'CONFIRMATION_REQUIRED');

    // 5. Empty SQL is rejected cleanly
    const emptySqlRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ sql: '   ', confirmExecution: true }),
    });
    assert.equal(emptySqlRes.status, 400);
    const emptySqlBody = (await emptySqlRes.json()) as any;
    assert.equal(emptySqlBody.code, 'EMPTY_SQL_QUERY');

    // 6. SuperAdmin executes SELECT query against database
    const selectRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        sql: 'SELECT id, name, status FROM tenants ORDER BY id ASC LIMIT 3;',
        confirmExecution: true,
      }),
    });
    assert.equal(selectRes.status, 200);
    const selectBody = (await selectRes.json()) as any;
    assert.equal(selectBody.success, true);
    assert.equal(selectBody.command, 'SELECT');
    assert.deepEqual(selectBody.columns, ['id', 'name', 'status']);
    assert.ok(Array.isArray(selectBody.rows) && selectBody.rows.length > 0);
    assert.ok(typeof selectBody.durationMs === 'number' && selectBody.durationMs >= 1);

    // 7. SuperAdmin executes INSERT, UPDATE, and DELETE queries
    const testKey = `SQL_CONSOLE_TEST_${Date.now()}`;
    const insertRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        sql: `INSERT INTO app_settings (key, value, category, description, is_secret) VALUES ('${testKey}', 'v1', 'system', 'test', false);`,
        confirmExecution: true,
      }),
    });
    assert.equal(insertRes.status, 200);
    const insertBody = (await insertRes.json()) as any;
    assert.equal(insertBody.success, true);
    assert.equal(insertBody.rowCount, 1);

    const updateRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        sql: `UPDATE app_settings SET value = 'v2' WHERE key = '${testKey}'; SELECT key, value FROM app_settings WHERE key = '${testKey}';`,
        confirmExecution: true,
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateBody = (await updateRes.json()) as any;
    assert.equal(updateBody.success, true);
    assert.equal(updateBody.rows[0]?.value, 'v2');

    // Clean up test row via SQL Console DELETE
    const deleteRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        sql: `DELETE FROM app_settings WHERE key = '${testKey}';`,
        confirmExecution: true,
      }),
    });
    assert.equal(deleteRes.status, 200);
    const deleteBody = (await deleteRes.json()) as any;
    assert.equal(deleteBody.rowCount, 1);

    // 8. Invalid SQL returns 400 error and rolls back multi-statement mutations
    const txFailKey = `SQL_TX_ROLLBACK_${Date.now()}`;
    const invalidRes = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        sql: `INSERT INTO app_settings (key, value, category) VALUES ('${txFailKey}', 'temp', 'system'); SELECT * FROM nonexistent_table_999;`,
        confirmExecution: true,
      }),
    });
    assert.equal(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as any;
    assert.equal(invalidBody.success, false);
    assert.ok(invalidBody.error && invalidBody.error.length > 0);
    assert.equal(invalidBody.code, '42P01');

    // Verify first INSERT was rolled back
    const verifyRollback = await fetch(`${baseUrl}/api/backup/execute-sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        sql: `SELECT * FROM app_settings WHERE key = '${txFailKey}';`,
        confirmExecution: true,
      }),
    });
    const verifyRollbackBody = (await verifyRollback.json()) as any;
    assert.equal(verifyRollbackBody.rows.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Frontend SuperAdmin Settings -> Backup tab enforces SQL Query Console structure and safeguards', () => {
  const settingsViewPath = path.resolve(process.cwd(), 'src/components/settings/SettingsView.tsx');
  const backupCompPath = path.resolve(process.cwd(), 'src/components/settings/DataBackupRestore.tsx');

  const settingsSrc = fs.readFileSync(settingsViewPath, 'utf8');
  const backupSrc = fs.readFileSync(backupCompPath, 'utf8');

  // SettingsView gates the backup tab strictly behind isSuperAdmin
  assert.ok(settingsSrc.includes("activeTab === 'backup' && isSuperAdmin"));

  // DataBackupRestore strictly gates SQL Query section behind isSuperAdmin
  assert.ok(backupSrc.includes('superadmin-sql-query-section'));
  assert.ok(backupSrc.includes('isSuperAdmin && ('));

  // Includes large textarea, Execute button, confirmation modal, and success/error feedback
  assert.ok(backupSrc.includes('<textarea') && backupSrc.includes('superadmin-sql-textarea'));
  assert.ok(backupSrc.includes('superadmin-sql-execute-btn'));
  assert.ok(backupSrc.includes('sql-confirm-modal'));
  assert.ok(backupSrc.includes('sql-query-success'));
  assert.ok(backupSrc.includes('sql-query-error'));

  // Never uses browser alert/confirm or raw HTML injection
  assert.equal(/\bwindow\.(alert|confirm)\b/.test(backupSrc), false);
  assert.equal(/dangerouslySetInnerHTML/.test(backupSrc), false);
});
