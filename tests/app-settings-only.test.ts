import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { pgClient } from '../src/db/index.ts';
import {
  ensureAppSettingsSchema,
  getAllAppSettings,
  getAppSetting,
  updateAppSettings,
} from '../src/server/services/appSettingsService.ts';
import {
  getActiveEmailProvider,
  getDynamicGmailCredentials,
  getDynamicResendApiKey,
  parseSenderAddress,
} from '../src/server/utils/email.ts';
import { getFcmStats } from '../src/server/pushNotificationService.ts';
import { getGeminiClient } from '../src/server/gemini.ts';
import { getJwtSecret } from '../src/server/auth.ts';

function collectCodeFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectCodeFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

test('.env.example defines only DATABASE_URL and JWT_SECRET', () => {
  const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
  const keys = envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim());

  assert.deepEqual(keys, ['DATABASE_URL', 'JWT_SECRET']);
  assert.equal(fs.existsSync(path.join(process.cwd(), '.env')), false);
});

test('no application configuration reads process.env or import.meta.env outside DATABASE_URL, JWT_SECRET, and host flags', () => {
  const allowedEnvVars = new Set([
    'DATABASE_URL',
    'JWT_SECRET',
    'NODE_ENV',
    'PORT',
    'VERCEL',
    'NETLIFY',
    'AWS_LAMBDA_FUNCTION_NAME',
    'DISABLE_HMR',
  ]);

  const files = [
    ...collectCodeFiles(path.join(process.cwd(), 'src')),
    path.join(process.cwd(), 'server.ts'),
    path.join(process.cwd(), 'vite.config.ts'),
  ];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      /\bimport\.meta\.env\b/.test(content),
      false,
      `Unexpected import.meta.env reference in ${filePath}`
    );

    const matches = content.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/g);
    for (const match of matches) {
      const varName = match[1];
      assert.ok(
        allowedEnvVars.has(varName),
        `Disallowed process.env.${varName} fallback found in ${filePath}`
      );
      if (varName === 'DISABLE_HMR') {
        assert.equal(
          path.basename(filePath),
          'vite.config.ts',
          `DISABLE_HMR process.env reference only allowed in vite.config.ts (found in ${filePath})`
        );
      }
    }
  }
});

test('getJwtSecret reads process.env.JWT_SECRET dynamically when present', () => {
  const prev = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'custom-test-jwt-secret-999';
    assert.equal(getJwtSecret(), 'custom-test-jwt-secret-999');

    delete process.env.JWT_SECRET;
    assert.ok(getJwtSecret().length > 0);
  } finally {
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
  }
});

test('app_settings is the sole source of truth and ignores process.env overrides', async () => {
  await ensureAppSettingsSchema();

  const envSnapshot: Record<string, string | undefined> = {};
  const injectedEnv: Record<string, string> = {
    ACTIVE_EMAIL_PROVIDER: 'gmail',
    RESEND_API_KEY: 're_env_should_not_be_used_1234567890',
    RESEND_FROM: 'Env Override <env@override.example>',
    RESEND_FROM_EMAIL: 'env@override.example',
    RESEND_REPLY_TO: 'reply-env@override.example',
    GMAIL_USER: 'env-gmail@override.example',
    GMAIL_APP_PASSWORD: 'env-password-ignored',
    GMAIL_FROM_NAME: 'EnvFromName',
    FCM_PROJECT_ID: 'env-fcm-project-ignored',
    FCM_CLIENT_EMAIL: 'env-client@ignored.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nENV_IGNORED\n-----END PRIVATE KEY-----',
    GEMINI_API_KEY: 'env-gemini-ignored',
    PUBLIC_APP_URL: 'https://env-override.example.com',
    TWA_PACKAGE_NAME: 'com.env.override',
    ASSETLINKS_SHA256: 'AA:BB:CC:DD',
  };

  for (const [k, v] of Object.entries(injectedEnv)) {
    envSnapshot[k] = process.env[k];
    process.env[k] = v;
  }

  try {
    // Seed known DB state cleanly via updateAppSettings
    await updateAppSettings({
      ACTIVE_EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: '',
      RESEND_FROM: 'DB Sender <db@sarbaazsoft.com>',
      RESEND_FROM_EMAIL: 'db@sarbaazsoft.com',
      RESEND_REPLY_TO: 'db-reply@sarbaazsoft.com',
      GMAIL_USER: 'db-user@sarbaazsoft.com',
      GMAIL_APP_PASSWORD: '',
      GMAIL_FROM_NAME: 'DBSenderName',
      FCM_PROJECT_ID: 'db-fcm-project',
      FCM_CLIENT_EMAIL: '',
      FCM_PRIVATE_KEY: '',
      GEMINI_API_KEY: '',
      PUBLIC_APP_URL: 'https://pos.db.example.com',
      TWA_PACKAGE_NAME: 'com.db.shoepos',
      ASSETLINKS_SHA256: '',
    });

    assert.equal(await getActiveEmailProvider(), 'resend');
    assert.equal(await getDynamicResendApiKey(), '');

    const gmailCreds = await getDynamicGmailCredentials();
    assert.equal(gmailCreds.user, 'db-user@sarbaazsoft.com');
    assert.equal(gmailCreds.pass, '');
    assert.equal(gmailCreds.fromName, 'DBSenderName');

    assert.equal(await getAppSetting('RESEND_FROM'), 'DB Sender <db@sarbaazsoft.com>');
    assert.equal(await getAppSetting('RESEND_REPLY_TO'), 'db-reply@sarbaazsoft.com');
    assert.equal(await getAppSetting('PUBLIC_APP_URL'), 'https://pos.db.example.com');
    assert.equal(await getAppSetting('TWA_PACKAGE_NAME'), 'com.db.shoepos');
    assert.equal(await getAppSetting('ASSETLINKS_SHA256'), '');

    const parsed = parseSenderAddress(
      await getAppSetting('RESEND_FROM'),
      await getAppSetting('RESEND_REPLY_TO')
    );
    assert.equal(parsed.resendFrom, 'DB Sender <db@sarbaazsoft.com>');

    const fcmStats = await getFcmStats();
    assert.equal(fcmStats.configured, false);

    // GEMINI_API_KEY in DB is empty -> must reject even though process.env.GEMINI_API_KEY is set
    await assert.rejects(() => getGeminiClient(), /GEMINI_API_KEY is not configured in app_settings/);

    // Updating DB app_settings immediately drives runtime getters
    await updateAppSettings({
      ACTIVE_EMAIL_PROVIDER: 'gmail',
      RESEND_API_KEY: 're_db_valid_key_12345678901234',
      GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
      GEMINI_API_KEY: 'db-gemini-test-key',
    });

    assert.equal(await getActiveEmailProvider(), 'gmail');
    assert.equal(await getDynamicResendApiKey(), 're_db_valid_key_12345678901234');
    const updatedGmail = await getDynamicGmailCredentials();
    assert.equal(updatedGmail.pass, 'abcd efgh ijkl mnop');

    const geminiClient = await getGeminiClient();
    assert.ok(geminiClient);

    const all = await getAllAppSettings('SUPERADMIN');
    assert.equal(all.byKey.RESEND_REPLY_TO, 'db-reply@sarbaazsoft.com');
    assert.equal(all.byKey.PUBLIC_APP_URL, 'https://pos.db.example.com');

    // Ensure no empty-key row polluted public.app_settings in DB/mock store
    const rawRows = await pgClient.query<{ key: string }>(`SELECT key FROM public.app_settings`);
    assert.ok(rawRows.rows.every((r) => Boolean(r.key && r.key.trim())));

    // seedDatabaseAndAppSettings must be idempotent and preserve existing secrets/values
    const { seedDatabaseAndAppSettings } = await import('../src/db/schemaInit.ts');
    const seedRun = await seedDatabaseAndAppSettings();
    assert.equal(seedRun.seedSqlApplied, true);
    assert.ok(seedRun.appSettingsCount >= 35, `Expected seeded app_settings count >= 35, got ${seedRun.appSettingsCount}`);
    assert.equal(await getDynamicResendApiKey(), 're_db_valid_key_12345678901234');
    assert.equal(await getAppSetting('PUBLIC_APP_URL'), 'https://pos.db.example.com');
  } finally {
    for (const [k, orig] of Object.entries(envSnapshot)) {
      if (orig === undefined) delete process.env[k];
      else process.env[k] = orig;
    }
  }
});
