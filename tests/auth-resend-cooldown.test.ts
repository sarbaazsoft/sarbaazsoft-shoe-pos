import { registerHooks } from 'node:module';
import http from 'node:http';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, before, after } from 'node:test';
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

const { pgClient } = await import('../src/db/index.ts');
const rateLimitSvc = await import('../src/server/services/authResendRateLimitService.ts');
const emailVerifySvc = await import('../src/server/services/emailVerificationService.ts');
const authRoutes = (await import('../src/server/routes/authRoutes.ts')).default;
const {
  formatCountdownMMSS,
  formatNextAvailableClock,
  buildCooldownStorageKey,
} = await import('../src/hooks/useResendCooldown.ts');
const { ResendSecurityNotice } = await import('../src/components/auth/ResendSecurityNotice.tsx');
const { PasswordResetFlow } = await import('../src/components/auth/PasswordResetFlow.tsx');
const { VerifyEmailNoticeView } = await import('../src/components/auth/VerifyEmailNoticeView.tsx');
const { AuthModal } = await import('../src/components/auth/AuthModal.tsx');
const { ThemeProvider } = await import('../src/context/ThemeContext.tsx');

const ROOT = process.cwd();

async function requestJson(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: Record<string, any>;
    ip?: string;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any }> {
  const { method = 'GET', body, ip = '198.51.100.77' } = options;
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': ip,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 500, headers: res.headers, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Auth Email Confirmation & Password Reset Resend Cooldowns', () => {
  const createdEmails: string[] = [];
  const createdIps: string[] = [];

  after(async () => {
    for (const email of createdEmails) {
      await rateLimitSvc.resetResendCooldown('email_verification', email).catch(() => {});
      await rateLimitSvc.resetResendCooldown('password_reset', email).catch(() => {});
      await pgClient
        .query('DELETE FROM users WHERE LOWER(email) = LOWER($1)', [email])
        .catch(() => {});
    }
    for (const ip of createdIps) {
      await pgClient
        .query(`DELETE FROM auth_resend_rate_limits WHERE scope_type = 'ip' AND scope_key = $1`, [ip])
        .catch(() => {});
    }
  });

  describe('Progressive Cooldown Schedule & Service Guarantees', () => {
    it('enforces exact progressive durations (2m, 5m, 10m, 15m, 30m+) and rejects duplicate requests during cooldown', async () => {
      const testEmail = `progressive-${Date.now()}@example.com`;
      createdEmails.push(testEmail);
      const expectedSchedule = [120, 300, 600, 900, 1800, 1800];

      let cursorMs = Date.UTC(2026, 5, 1, 10, 0, 0);

      for (let i = 0; i < expectedSchedule.length; i++) {
        const expectedCooldown = expectedSchedule[i];
        const testIp = `203.0.113.${10 + i}`;
        createdIps.push(testIp);

        const consumed = await rateLimitSvc.enforceAndConsumeResendLimit({
          flow: 'email_verification',
          email: testEmail,
          ip: testIp,
          mode: 'resend',
          nowMs: cursorMs,
        });

        assert.equal(consumed.allowed, true, `Attempt ${i + 1} should succeed once prior cooldown expired`);
        assert.equal(consumed.attemptCount, i + 1);
        assert.equal(consumed.cooldownSeconds, expectedCooldown);
        assert.equal(consumed.remainingSeconds, expectedCooldown);
        assert.equal(consumed.isInCooldown, true);
        assert.ok(consumed.nextAvailableAt, 'nextAvailableAt timestamp must be persisted');

        // Duplicate request 5 seconds later must be rejected with exact remaining cooldown
        const blocked = await rateLimitSvc.enforceAndConsumeResendLimit({
          flow: 'email_verification',
          email: testEmail,
          ip: testIp,
          mode: 'resend',
          nowMs: cursorMs + 5000,
        });

        assert.equal(blocked.allowed, false, `Attempt ${i + 1} repeat inside cooldown must be blocked`);
        assert.equal(blocked.code, 'RESEND_COOLDOWN_ACTIVE');
        assert.equal(blocked.remainingSeconds, expectedCooldown - 5);
        assert.equal(blocked.attemptCount, i + 1);

        // Status snapshot reads persisted cooldown accurately (simulating refresh / new tab)
        const status = await rateLimitSvc.getResendCooldownStatus(
          'email_verification',
          testEmail,
          testIp,
          cursorMs + 10000
        );
        assert.equal(status.isInCooldown, true);
        assert.equal(status.remainingSeconds, expectedCooldown - 10);
        assert.equal(status.attemptCount, i + 1);

        // Advance clock past expiration for the next progressive step
        cursorMs += (expectedCooldown + 1) * 1000;
      }
    });

    it('keeps email_verification and password_reset cooldowns completely independent and resets them independently', async () => {
      const testEmail = `independent-${Date.now()}@example.com`;
      const verifyIp = '203.0.113.201';
      const resetIp = '203.0.113.202';
      createdEmails.push(testEmail);
      createdIps.push(verifyIp, resetIp);

      const nowMs = Date.UTC(2026, 5, 2, 12, 0, 0);

      // Consume 1st and 2nd resends on email_verification -> 300s cooldown, attemptCount = 2
      const v1 = await rateLimitSvc.enforceAndConsumeResendLimit({
        flow: 'email_verification',
        email: testEmail,
        ip: verifyIp,
        mode: 'resend',
        nowMs,
      });
      assert.equal(v1.cooldownSeconds, 120);

      const v2 = await rateLimitSvc.enforceAndConsumeResendLimit({
        flow: 'email_verification',
        email: testEmail,
        ip: verifyIp,
        mode: 'resend',
        nowMs: nowMs + 121_000,
      });
      assert.equal(v2.attemptCount, 2);
      assert.equal(v2.cooldownSeconds, 300);

      // password_reset for the SAME email must remain unaffected and start at 1st resend (120s)
      const r1 = await rateLimitSvc.enforceAndConsumeResendLimit({
        flow: 'password_reset',
        email: testEmail,
        ip: resetIp,
        mode: 'resend',
        nowMs: nowMs + 125_000,
      });
      assert.equal(r1.allowed, true);
      assert.equal(r1.attemptCount, 1);
      assert.equal(r1.cooldownSeconds, 120);

      // Completing email verification resets ONLY email_verification, keeping password_reset cooldown intact
      await rateLimitSvc.resetResendCooldown('email_verification', testEmail);

      const verifyAfterReset = await rateLimitSvc.getResendCooldownStatus(
        'email_verification',
        testEmail,
        verifyIp,
        nowMs + 130_000
      );
      assert.equal(verifyAfterReset.isInCooldown, false);
      assert.equal(verifyAfterReset.attemptCount, 0);

      const resetStillActive = await rateLimitSvc.getResendCooldownStatus(
        'password_reset',
        testEmail,
        resetIp,
        nowMs + 130_000
      );
      assert.equal(resetStillActive.isInCooldown, true);
      assert.equal(resetStillActive.attemptCount, 1);
      assert.equal(resetStillActive.remainingSeconds, 115);
    });

    it('enforces IP-based rate limit after repeated requests from the same client IP', async () => {
      const attackerIp = '198.51.100.244';
      createdIps.push(attackerIp);
      const baseMs = Date.UTC(2026, 5, 3, 9, 0, 0);

      for (let i = 0; i < rateLimitSvc.IP_WINDOW_MAX_REQUESTS; i++) {
        const hit = await rateLimitSvc.recordIpLookupAttempt('password_reset', attackerIp, baseMs + i * 1000);
        assert.equal(hit.allowed, true, `IP lookup #${i + 1} within window should be allowed`);
      }

      const blocked = await rateLimitSvc.recordIpLookupAttempt(
        'password_reset',
        attackerIp,
        baseMs + 11_000
      );
      assert.equal(blocked.allowed, false, 'Exceeding IP window max requests must trigger IP lockout');
      assert.equal(blocked.blockedByIp, true);
      assert.equal(blocked.code, 'IP_RATE_LIMIT_ACTIVE');
      assert.ok(blocked.remainingSeconds > 0);
    });
  });

  describe('Backend Express API Enforcement & Safe Persistence', () => {
    let server: http.Server;
    let baseUrl = '';
    const routeEmail = `route-user-${Date.now()}@example.com`;
    const verifyRouteIp = '192.0.2.50';
    const resetRouteIp = '192.0.2.51';

    before(async () => {
      createdEmails.push(routeEmail);
      createdIps.push(verifyRouteIp, resetRouteIp);

      await pgClient.query(
        `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'PENDING')`,
        [1, 'Route Test Owner', routeEmail, '+923001112233', 'hashed-pw', 'Test123!']
      );

      const app = express();
      app.use(express.json());
      app.use('/api/auth', authRoutes);

      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    after(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('enforces backend cooldown (429 + Retry-After + zero token leak) on /resend-verification and resets after /verify-email', async () => {
      // 1st manual resend succeeds with 2-minute cooldown
      const firstRes = await requestJson(baseUrl, '/api/auth/resend-verification', {
        method: 'POST',
        body: { email: routeEmail },
        ip: verifyRouteIp,
      });
      assert.equal(firstRes.status, 200);
      assert.equal(firstRes.data.success, true);
      assert.equal(firstRes.data.verificationToken, undefined, '200 resend-verification response must never expose verificationToken');
      assert.equal(firstRes.data.verificationLink, undefined, '200 resend-verification response must never expose verificationLink');
      assert.equal(firstRes.data.cooldown.attemptCount, 1);
      assert.equal(firstRes.data.cooldown.cooldownSeconds, 120);
      assert.equal(firstRes.data.cooldown.remainingSeconds, 120);

      // Immediate 2nd request is blocked with HTTP 429 & Retry-After and leaks NO tokens
      const secondRes = await requestJson(baseUrl, '/api/auth/resend-verification', {
        method: 'POST',
        body: { email: routeEmail },
        ip: verifyRouteIp,
      });
      assert.equal(secondRes.status, 429);
      assert.ok(Number(secondRes.headers['retry-after']) > 0, 'Retry-After header must be present');
      assert.equal(secondRes.data.code, 'RESEND_COOLDOWN_ACTIVE');
      assert.equal(secondRes.data.verificationToken, undefined, '429 response must never leak verificationToken');
      assert.equal(secondRes.data.verificationLink, undefined, '429 response must never leak verificationLink');

      // Status endpoint exposes only cooldown timing metadata, no tokens or account fields
      const statusRes = await requestJson(
        baseUrl,
        `/api/auth/resend-status?flow=email_verification&email=${encodeURIComponent(routeEmail)}`,
        { ip: verifyRouteIp }
      );
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.data.isInCooldown, true);
      assert.equal(statusRes.data.attemptCount, 1);
      assert.equal(statusRes.data.email, undefined);
      assert.equal(statusRes.data.verificationToken, undefined);

      // Verify email token in DB is strictly a 6-digit numeric code and resets cooldown on verification
      const tokenRow = (
        await pgClient.query('SELECT token FROM email_verification_tokens ORDER BY id DESC LIMIT 1')
      ).rows[0] as any;
      assert.ok(tokenRow?.token, 'Verification code should exist in DB before verification');
      assert.match(String(tokenRow.token), /^\d{6}$/, 'Verification code must be a 6-digit numeric string');

      const verifyRes = await requestJson(baseUrl, '/api/auth/verify-email', {
        method: 'POST',
        body: { code: tokenRow.token, email: routeEmail },
        ip: verifyRouteIp,
      });
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.data.verified, true);

      const postVerifyStatus = await requestJson(
        baseUrl,
        `/api/auth/resend-status?flow=email_verification&email=${encodeURIComponent(routeEmail)}`,
        { ip: verifyRouteIp }
      );
      assert.equal(postVerifyStatus.status, 200);
      assert.equal(postVerifyStatus.data.isInCooldown, false);
      assert.equal(postVerifyStatus.data.attemptCount, 0);
    });

    it('invalidates 6-digit confirmation code after 5 incorrect guesses to prevent brute force', async () => {
      const bfEmail = `bruteforce-${Date.now()}@example.com`;
      const bfIp = '192.0.2.52';
      createdEmails.push(bfEmail);
      createdIps.push(bfIp);

      const userInsert = await pgClient.query<{ id: number }>(
        `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', 'PENDING') RETURNING id`,
        [1, 'Brute Force Guard User', bfEmail, '+923001112244', 'hashed-pw', 'Test123!']
      );
      const userId = Number(userInsert.rows[0].id);

      const { code } = await emailVerifySvc.issueEmailVerificationCode({ tenantId: 1, userId });
      assert.match(code, /^\d{6}$/, 'Issued confirmation code must be 6 numeric digits');
      const wrongCode = code === '000000' ? '111111' : '000000';

      for (let attempt = 1; attempt <= 4; attempt++) {
        const failRes = await requestJson(baseUrl, '/api/auth/verify-email', {
          method: 'POST',
          body: { code: wrongCode, email: bfEmail },
          ip: bfIp,
        });
        assert.equal(failRes.status, 400, `Attempt ${attempt} should reject wrong 6-digit code with 400`);
      }

      // 5th failed attempt invalidates the code and returns 429
      const lockoutRes = await requestJson(baseUrl, '/api/auth/verify-email', {
        method: 'POST',
        body: { code: wrongCode, email: bfEmail },
        ip: bfIp,
      });
      assert.equal(lockoutRes.status, 429);
      assert.equal(lockoutRes.data.code, 'VERIFICATION_ATTEMPTS_EXCEEDED');

      // Even the previously valid code must now fail because it was invalidated
      const afterLockoutRes = await requestJson(baseUrl, '/api/auth/verify-email', {
        method: 'POST',
        body: { code, email: bfEmail },
        ip: bfIp,
      });
      assert.equal(afterLockoutRes.status, 400);
    });

    it('enforces centralized 6-digit password reset & cooldown across Store Owner (ADMIN), Cashier (CASHIER), and Super Admin (SUPERADMIN)', async () => {
      // 1. STORE OWNER (ADMIN): Initial request -> manual resend cooldown -> 429 block -> verify -> confirm -> login
      const initialRes = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: routeEmail, tenantId: 1, roleScope: 'STORE', isResend: false },
        ip: resetRouteIp,
      });
      assert.equal(initialRes.status, 200);
      assert.equal(initialRes.data.success, true);
      assert.equal(initialRes.data.code, undefined, '200 initial reset response must never expose 6-digit code');
      assert.equal((initialRes.data as any).resetToken, undefined, 'Must never expose legacy resetToken');
      assert.equal((initialRes.data as any).resetLink, undefined, 'Must never expose legacy resetLink');
      assert.equal(initialRes.data.cooldown.attemptCount, 0);
      assert.equal(initialRes.data.cooldown.isInCooldown, false);

      // Manual resend triggers 1st progressive cooldown (120s)
      const resendRes = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: routeEmail, tenantId: 1, roleScope: 'STORE', isResend: true },
        ip: resetRouteIp,
      });
      assert.equal(resendRes.status, 200);
      assert.equal(resendRes.data.code, undefined, '200 resend response must never expose 6-digit code');
      assert.equal(resendRes.data.cooldown.attemptCount, 1);
      assert.equal(resendRes.data.cooldown.cooldownSeconds, 120);

      // Immediate duplicate request returns HTTP 429 without exposing any code
      const blockedRes = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: routeEmail, tenantId: 1, roleScope: 'STORE', isResend: true },
        ip: resetRouteIp,
      });
      assert.equal(blockedRes.status, 429);
      assert.ok(Number(blockedRes.headers['retry-after']) > 0);
      assert.equal(blockedRes.data.code, 'RESEND_COOLDOWN_ACTIVE');

      // Retrieve latest 6-digit numeric code from password_reset_codes
      const adminUserRow = (
        await pgClient.query<{ id: number }>('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [routeEmail])
      ).rows[0];
      assert.ok(adminUserRow?.id);

      const adminCodeRow = (
        await pgClient.query<{ code: string }>(
          'SELECT code FROM password_reset_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
          [adminUserRow.id]
        )
      ).rows[0];
      assert.ok(adminCodeRow?.code, '6-digit password reset code should exist in DB');
      assert.match(String(adminCodeRow.code), /^\d{6}$/, 'Password reset code must be 6 numeric digits');

      // Verify code step succeeds
      const adminVerifyRes = await requestJson(baseUrl, '/api/auth/password-reset/verify', {
        method: 'POST',
        body: { email: routeEmail, code: adminCodeRow.code, tenantId: 1, roleScope: 'STORE' },
        ip: resetRouteIp,
      });
      assert.equal(adminVerifyRes.status, 200);
      assert.equal(adminVerifyRes.data.valid, true);
      assert.equal(adminVerifyRes.data.verified, true);

      // Confirm reset updates password, deletes single-use code, and clears cooldown
      const ownerNewPassword = 'NewOwnerPassword99!';
      const completeReset = await requestJson(baseUrl, '/api/auth/password-reset/confirm', {
        method: 'POST',
        body: {
          email: routeEmail,
          code: adminCodeRow.code,
          newPassword: ownerNewPassword,
          confirmPassword: ownerNewPassword,
          tenantId: 1,
          roleScope: 'STORE',
        },
        ip: resetRouteIp,
      });
      assert.equal(completeReset.status, 200);
      assert.equal(completeReset.data.success, true);

      const postResetCodes = await pgClient.query('SELECT id FROM password_reset_codes WHERE user_id = $1', [adminUserRow.id]);
      assert.equal(postResetCodes.rows.length, 0, 'Single-use password reset code must be deleted after completion');

      const postResetStatus = await requestJson(
        baseUrl,
        `/api/auth/resend-status?flow=password_reset&email=${encodeURIComponent(routeEmail)}`,
        { ip: resetRouteIp }
      );
      assert.equal(postResetStatus.status, 200);
      assert.equal(postResetStatus.data.isInCooldown, false);
      assert.equal(postResetStatus.data.attemptCount, 0);

      // Approve admin user briefly to confirm new password logs in cleanly
      await pgClient.query(`UPDATE users SET status = 'APPROVED' WHERE id = $1`, [adminUserRow.id]);
      const adminLoginRes = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: { email: routeEmail, password: ownerNewPassword },
        ip: resetRouteIp,
      });
      assert.equal(adminLoginRes.status, 200, 'Store Owner should sign in with newly reset password');
      assert.ok(adminLoginRes.data.token);

      // 2. CASHIER (CASHIER): Role-scoped 6-digit reset, brute-force lockout after 5 wrong guesses, expiration check, and completion
      const cashierEmail = `cashier-reset-${Date.now()}@example.com`;
      const cashierIp = '192.0.2.53';
      createdEmails.push(cashierEmail);
      createdIps.push(cashierIp);

      const cashierInsert = await pgClient.query<{ id: number }>(
        `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'CASHIER', 'APPROVED') RETURNING id`,
        [1, 'Test Cashier', cashierEmail, '+923009998877', 'old-hash', 'OldPass1!']
      );
      const cashierUserId = Number(cashierInsert.rows[0].id);

      const cashierReq = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: cashierEmail, tenantId: 1, roleScope: 'STORE', isResend: false },
        ip: cashierIp,
      });
      assert.equal(cashierReq.status, 200);

      const cashierCodeRow1 = (
        await pgClient.query<{ code: string }>(
          'SELECT code FROM password_reset_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
          [cashierUserId]
        )
      ).rows[0];
      assert.match(String(cashierCodeRow1?.code), /^\d{6}$/);

      const wrongResetCode = cashierCodeRow1.code === '000000' ? '111111' : '000000';
      for (let i = 1; i <= 4; i++) {
        const failRes = await requestJson(baseUrl, '/api/auth/password-reset/verify', {
          method: 'POST',
          body: { email: cashierEmail, code: wrongResetCode, tenantId: 1, roleScope: 'STORE' },
          ip: cashierIp,
        });
        assert.equal(failRes.status, 400, `Cashier wrong code attempt #${i} should return 400`);
      }

      const cashierLockoutRes = await requestJson(baseUrl, '/api/auth/password-reset/verify', {
        method: 'POST',
        body: { email: cashierEmail, code: wrongResetCode, tenantId: 1, roleScope: 'STORE' },
        ip: cashierIp,
      });
      assert.equal(cashierLockoutRes.status, 429);
      assert.equal(cashierLockoutRes.data.code, 'VERIFICATION_ATTEMPTS_EXCEEDED');

      // SuperAdmin roleScope must NOT authorize a Cashier account
      const wrongScopeReq = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: cashierEmail, roleScope: 'SUPERADMIN', isResend: false },
        ip: cashierIp,
      });
      assert.equal(wrongScopeReq.status, 404, 'SUPERADMIN roleScope must reject non-SUPERADMIN accounts');

      // Request fresh code for Cashier and test expiry rejection + valid reset
      const cashierResend = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: cashierEmail, tenantId: 1, roleScope: 'STORE', isResend: true },
        ip: cashierIp,
      });
      assert.equal(cashierResend.status, 200);

      const cashierCodeRow2 = (
        await pgClient.query<{ id: number; code: string }>(
          'SELECT id, code FROM password_reset_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
          [cashierUserId]
        )
      ).rows[0];

      await pgClient.query(
        `UPDATE password_reset_codes SET expires_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
        [cashierCodeRow2.id]
      );
      const expiredVerifyRes = await requestJson(baseUrl, '/api/auth/password-reset/verify', {
        method: 'POST',
        body: { email: cashierEmail, code: cashierCodeRow2.code, tenantId: 1, roleScope: 'STORE' },
        ip: cashierIp,
      });
      assert.equal(expiredVerifyRes.status, 400);
      assert.equal(expiredVerifyRes.data.code, 'VERIFICATION_CODE_EXPIRED');

      // Restore future expiry on newly generated code and complete Cashier reset
      const futureExpiry = new Date(Date.now() + 15 * 60 * 1000);
      await pgClient.query(
        `INSERT INTO password_reset_codes (tenant_id, user_id, code, attempts, expires_at)
         VALUES ($1, $2, $3, 0, $4)`,
        [1, cashierUserId, '654321', futureExpiry]
      );
      const cashierNewPw = 'CashierSecure2026!';
      const cashierConfirmRes = await requestJson(baseUrl, '/api/auth/password-reset/confirm', {
        method: 'POST',
        body: {
          email: cashierEmail,
          code: '654321',
          newPassword: cashierNewPw,
          confirmPassword: cashierNewPw,
          tenantId: 1,
          roleScope: 'STORE',
        },
        ip: cashierIp,
      });
      assert.equal(cashierConfirmRes.status, 200);
      assert.equal(cashierConfirmRes.data.success, true);

      const cashierLoginRes = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: { email: cashierEmail, password: cashierNewPw },
        ip: cashierIp,
      });
      assert.equal(cashierLoginRes.status, 200, 'Cashier should sign in with newly reset password');

      // 3. SUPER ADMIN (SUPERADMIN): Uses the exact same centralized 6-digit flow with roleScope: 'SUPERADMIN'
      const superAdminEmail = `superadmin-reset-${Date.now()}@example.com`;
      const superAdminIp = '192.0.2.54';
      createdEmails.push(superAdminEmail);
      createdIps.push(superAdminIp);

      const saInsert = await pgClient.query<{ id: number }>(
        `INSERT INTO users (tenant_id, name, email, phone, password_hash, quick_password, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'SUPERADMIN', 'APPROVED') RETURNING id`,
        [0, 'Super Admin Tester', superAdminEmail, '+923001234567', 'old-sa-hash', 'OldSA123!']
      );
      const saUserId = Number(saInsert.rows[0].id);

      const saReq = await requestJson(baseUrl, '/api/auth/password-reset/request', {
        method: 'POST',
        body: { email: superAdminEmail, roleScope: 'SUPERADMIN', isResend: false },
        ip: superAdminIp,
      });
      assert.equal(saReq.status, 200);
      assert.equal(saReq.data.success, true);
      assert.equal(saReq.data.code, undefined, 'SuperAdmin reset request must never leak the 6-digit code');

      const saCodeRow = (
        await pgClient.query<{ code: string }>(
          'SELECT code FROM password_reset_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
          [saUserId]
        )
      ).rows[0];
      assert.match(String(saCodeRow?.code), /^\d{6}$/, 'SuperAdmin reset must issue a 6-digit numeric code');

      const saVerify = await requestJson(baseUrl, '/api/auth/password-reset/verify', {
        method: 'POST',
        body: { email: superAdminEmail, code: saCodeRow.code, roleScope: 'SUPERADMIN' },
        ip: superAdminIp,
      });
      assert.equal(saVerify.status, 200);
      assert.equal(saVerify.data.valid, true);

      const saNewPassword = 'SuperAdminNewPass2026!';
      const saConfirm = await requestJson(baseUrl, '/api/auth/password-reset/confirm', {
        method: 'POST',
        body: {
          email: superAdminEmail,
          code: saCodeRow.code,
          newPassword: saNewPassword,
          confirmPassword: saNewPassword,
          roleScope: 'SUPERADMIN',
        },
        ip: superAdminIp,
      });
      assert.equal(saConfirm.status, 200);
      assert.equal(saConfirm.data.success, true);

      const saLogin = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: { email: superAdminEmail, password: saNewPassword },
        ip: superAdminIp,
      });
      assert.equal(saLogin.status, 200, 'SuperAdmin should sign in with newly reset password');
      assert.equal(saLogin.data.user.role, 'SUPERADMIN');
    });
  });

  describe('Frontend Countdown Helpers & Auth UI Integration', () => {
    it('formats live countdowns cleanly in MM:SS and creates distinct storage keys per flow & email', () => {
      assert.equal(formatCountdownMMSS(0), '00:00');
      assert.equal(formatCountdownMMSS(59), '00:59');
      assert.equal(formatCountdownMMSS(120), '02:00');
      assert.equal(formatCountdownMMSS(300), '05:00');
      assert.equal(formatCountdownMMSS(600), '10:00');
      assert.equal(formatCountdownMMSS(900), '15:00');
      assert.equal(formatCountdownMMSS(1800), '30:00');

      const kVerify = buildCooldownStorageKey('email_verification', 'Owner@Store.COM');
      const kReset = buildCooldownStorageKey('password_reset', 'Owner@Store.COM');
      assert.notEqual(kVerify, kReset, 'Email confirmation and password reset storage keys must be isolated');

      const clockLabel = formatNextAvailableClock(new Date(Date.now() + 120_000).toISOString(), 120);
      assert.ok(clockLabel && clockLabel.length > 0);
      assert.equal(formatNextAvailableClock(null, 0), null);
    });

    it('renders ResendSecurityNotice with Inbox + Spam/Junk helper text, cooldown countdown, and disabled state', () => {
      const html = renderToStaticMarkup(
        React.createElement(ResendSecurityNotice, {
          idPrefix: 'test-reset',
          email: 'cashier@shoepos.com',
          helperContext: 'reset',
          buttonLabel: 'Resend Reset Code',
          onResend: () => {},
          isResending: false,
          isInCooldown: true,
          formattedCountdown: '04:45',
          nextAvailableTimeLabel: '12:35 PM',
          attemptCount: 2,
          successMessage: 'Reset email sent!',
        })
      );

      assert.ok(html.includes('Inbox'), 'Must instruct user to check Inbox');
      assert.ok(html.includes('Spam / Junk'), 'Must advise checking Spam / Junk folder');
      assert.ok(html.includes('Resend Reset Code (04:45)'), 'Button label must display live MM:SS countdown');
      assert.ok(html.includes('disabled=""') || html.includes('disabled '), 'Resend button must be disabled during cooldown');
      assert.ok(html.includes('Next resend available in'), 'Must display next resend availability');
      assert.ok(html.includes('04:45'), 'Must render countdown timer in MM:SS format');
      assert.ok(html.includes('12:35 PM'), 'Must render next available time label');
      assert.ok(html.includes('Attempt 2/5'), 'Must show progressive attempt stage');
      assert.ok(html.includes('Reset email sent!'), 'Must display inline success feedback');
    });

    it('renders VerifyEmailNoticeView with "Resend Confirmation Email", Inbox, and Spam/Junk guidance', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(VerifyEmailNoticeView, {
            initialEmail: 'founder@shoepos.com',
            storeName: 'Apex Shoes',
            initialTenantId: 1,
            onNavigateLogin: () => {},
            onNavigateHome: () => {},
          })
        )
      );

      assert.ok(html.includes('Resend Confirmation Email'), 'Must label Email Confirmation resend button accurately');
      assert.ok(html.includes('6-Digit Confirmation Code'), 'Must label input as 6-Digit Confirmation Code');
      assert.ok(html.includes('maxLength="6"'), 'Code input must enforce 6-digit maxLength');
      assert.ok(html.includes('inputMode="numeric"'), 'Code input must use numeric keyboard on mobile');
      assert.ok(html.includes('Inbox'), 'Must include Inbox guidance');
      assert.ok(html.includes('Spam / Junk'), 'Must include Spam/Junk guidance');
      assert.ok(html.includes('founder@shoepos.com'), 'Must display target confirmation email');

      const verifySrc = readFileSync(join(ROOT, 'src/components/auth/VerifyEmailNoticeView.tsx'), 'utf8');
      assert.equal(
        verifySrc.includes('res.verificationToken') || verifySrc.includes('setTokenInput(res.'),
        false,
        'VerifyEmailNoticeView must never auto-fill verification codes from resend responses'
      );
      assert.ok(verifySrc.includes("setTokenInput('')"), 'VerifyEmailNoticeView should clear stale input on resend so user enters emailed code manually');
    });

    it('wires centralized usePasswordReset hook and PasswordResetFlow into AuthModal and SuperAdminControlPanel with zero legacy token logic', () => {
      const useResetSrc = readFileSync(join(ROOT, 'src/hooks/usePasswordReset.ts'), 'utf8');
      assert.ok(useResetSrc.includes("flow: 'password_reset'"), 'usePasswordReset must use password_reset cooldown flow');
      assert.ok(useResetSrc.includes('cooldown.clearCooldown()'), 'usePasswordReset must clear cooldown after reset completes');
      assert.ok(useResetSrc.includes(".replace(/\\D/g, '').slice(0, 6)"), 'usePasswordReset must normalize input to 6 digits');

      const resetFlowSrc = readFileSync(join(ROOT, 'src/components/auth/PasswordResetFlow.tsx'), 'utf8');
      assert.ok(resetFlowSrc.includes('buttonLabel="Resend Reset Code"'), 'PasswordResetFlow must include Resend Reset Code button');
      assert.ok(resetFlowSrc.includes('inputMode="numeric"'), 'PasswordResetFlow must use numeric keyboard for 6-digit code');
      assert.ok(resetFlowSrc.includes('maxLength={6}'), 'PasswordResetFlow must enforce 6-digit maxLength');

      // Render PasswordResetFlow in step='verify' and confirm 6-digit UI + ResendSecurityNotice
      const verifyStepHtml = renderToStaticMarkup(
        React.createElement(PasswordResetFlow, {
          idPrefix: 'unit-test',
          roleScope: 'STORE',
          onBackToLogin: () => {},
          controller: {
            step: 'verify',
            setStep: () => {},
            email: 'cashier@shoepos.com',
            trimmedEmail: 'cashier@shoepos.com',
            updateEmail: () => {},
            isEmailValid: true,
            showEmailError: false,
            setEmailTouched: () => {},
            code: '123456',
            setCode: () => {},
            newPassword: '',
            setNewPassword: () => {},
            confirmPassword: '',
            setConfirmPassword: () => {},
            showNewPassword: false,
            setShowNewPassword: () => {},
            showConfirmPassword: false,
            setShowConfirmPassword: () => {},
            pasteBlocked: false,
            setPasteBlocked: () => {},
            triggerPasteBlockedNotice: () => {},
            isSubmitting: false,
            isResending: false,
            errorMessage: null,
            setErrorMessage: () => {},
            infoMessage: null,
            setInfoMessage: () => {},
            resendSuccess: null,
            resendError: null,
            cooldown: {
              attemptCount: 0,
              cooldownSeconds: 0,
              remainingSeconds: 0,
              formattedCountdown: '00:00',
              nextAvailableAt: null,
              nextAvailableTimeLabel: null,
              isInCooldown: false,
              blockedByIp: false,
              applyServerCooldown: () => {},
              clearCooldown: () => {},
              syncWithBackend: async () => {},
            },
            requestCode: async () => true,
            verifyCode: async () => true,
            confirmReset: async () => true,
            resendCode: async () => true,
            resetFlow: () => {},
          },
        })
      );
      assert.ok(verifyStepHtml.includes('6-Digit Verification Code'));
      assert.ok(verifyStepHtml.includes('Resend Reset Code'));
      assert.ok(verifyStepHtml.includes('inputMode="numeric"'));
      assert.ok(verifyStepHtml.includes('maxLength="6"'));

      const authModalSrc = readFileSync(join(ROOT, 'src/components/auth/AuthModal.tsx'), 'utf8');
      assert.ok(authModalSrc.includes('usePasswordReset('), 'AuthModal must use centralized usePasswordReset hook');
      assert.ok(authModalSrc.includes('<PasswordResetFlow'), 'AuthModal must render centralized PasswordResetFlow');
      assert.equal(
        /resetToken|sendResetLink|verifyResetToken|forgotPassword|resetLink/.test(authModalSrc),
        false,
        'AuthModal must contain zero legacy reset token logic'
      );

      const superAdminSrc = readFileSync(join(ROOT, 'src/components/saas/SuperAdminControlPanel.tsx'), 'utf8');
      assert.ok(superAdminSrc.includes('usePasswordReset('), 'SuperAdminControlPanel must use centralized usePasswordReset hook');
      assert.ok(superAdminSrc.includes('<PasswordResetFlow'), 'SuperAdminControlPanel must render centralized PasswordResetFlow');
      assert.ok(superAdminSrc.includes('roleScope="SUPERADMIN"'), 'SuperAdminControlPanel must pass SUPERADMIN roleScope');
      assert.equal(
        /resetToken|sendResetLink|verifyResetToken|forgotPassword|resetLink/.test(superAdminSrc),
        false,
        'SuperAdminControlPanel must contain zero legacy reset token logic'
      );

      // Ensure AuthModal default render stays completely intact
      const authHtml = renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AuthModal, {
            onSuccess: () => {},
            companySettings: { name: 'SarbaazSoft Shoe POS', logo: '/pwa-192x192.png' },
          })
        )
      );
      assert.ok(authHtml.includes('id="login-submit-btn"'));
    });
  });
});
