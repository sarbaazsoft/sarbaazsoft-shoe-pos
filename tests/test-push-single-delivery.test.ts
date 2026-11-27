import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { pgClient } from '../src/db/index.ts';
import { dispatchPosEmailAlert } from '../src/server/services/emailAlertService.ts';
import { updateAppSettings } from '../src/server/services/appSettingsService.ts';
import {
  normalizeFcmPrivateKey,
  registerSseClient,
  testFcmPush,
} from '../src/server/pushNotificationService.ts';
import {
  claimNotificationChannel,
  getNotificationDedupeKey,
  resetNotificationDedupeCache,
} from '../src/utils/notificationDedupe.ts';

test('testFcmPush dispatches exactly one SSE event and at most one FCM push per click', async () => {
  const adminSseWrites: string[] = [];
  const superAdminSseWrites: string[] = [];
  const otherTenantSseWrites: string[] = [];

  const unregisterAdmin = registerSseClient(5, 10, 'ADMIN', {
    write: (chunk: string) => {
      adminSseWrites.push(chunk);
      return true;
    },
  } as any);

  const unregisterSuperAdmin = registerSseClient(0, 1, 'SUPERADMIN', {
    write: (chunk: string) => {
      superAdminSseWrites.push(chunk);
      return true;
    },
  } as any);

  const unregisterOtherTenant = registerSseClient(99, 20, 'ADMIN', {
    write: (chunk: string) => {
      otherTenantSseWrites.push(chunk);
      return true;
    },
  } as any);

  const fcmCalls: Array<{ tokens: string[]; tag?: string; eventId?: string }> = [];

  try {
    const result = await testFcmPush(5, 'Store Test', 'Single alert check', {
      eventId: 'test-push-fixed-1',
      getFirebaseAdminFn: () => ({} as any),
      fetchTokensFn: async () => ['tok-a', 'tok-a', 'tok-b'],
      sendFcmPushToTokensFn: async (tokens, payload) => {
        fcmCalls.push({
          tokens,
          tag: payload.tag,
          eventId: payload.data?.eventId,
        });
        return { success: true, sentCount: tokens.length, failureCount: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.channel, 'fcm');
    assert.equal(result.fcmSentCount, 2);
    assert.equal(result.sentCount, 2);
    assert.equal(result.eventId, 'test-push-fixed-1');

    // Must write SSE once to matching tenant ADMIN, zero to SUPERADMIN and other tenants
    assert.equal(adminSseWrites.length, 1);
    assert.equal(superAdminSseWrites.length, 0);
    assert.equal(otherTenantSseWrites.length, 0);

    // Must invoke FCM push sender strictly ONCE (not twice via notifyPlatformAnnouncement)
    assert.equal(fcmCalls.length, 1);
    assert.deepEqual(fcmCalls[0].tokens, ['tok-a', 'tok-b']);
    assert.equal(fcmCalls[0].tag, 'test-push-fixed-1');
    assert.equal(fcmCalls[0].eventId, 'test-push-fixed-1');

    // SSE payload must share the same eventId/tag for client cross-channel deduplication
    assert.ok(adminSseWrites[0].includes('"eventId":"test-push-fixed-1"'));
  } finally {
    unregisterAdmin();
    unregisterSuperAdmin();
    unregisterOtherTenant();
  }
});

test('testFcmPush for SuperAdmin sends SSE only to SUPERADMIN and emits zero FCM calls when Admin SDK is unconfigured', async () => {
  const adminSseWrites: string[] = [];
  const superAdminSseWrites: string[] = [];

  const unregisterAdmin = registerSseClient(5, 10, 'ADMIN', {
    write: (chunk: string) => {
      adminSseWrites.push(chunk);
      return true;
    },
  } as any);

  const unregisterSuperAdmin = registerSseClient(0, 1, 'SUPERADMIN', {
    write: (chunk: string) => {
      superAdminSseWrites.push(chunk);
      return true;
    },
  } as any);

  let fcmCallCount = 0;

  try {
    const result = await testFcmPush(0, 'SuperAdmin Test', 'Single alert', {
      eventId: 'test-push-sa-1',
      getFirebaseAdminFn: () => null,
      sendFcmPushToTokensFn: async () => {
        fcmCallCount++;
        return { success: true, sentCount: 1, failureCount: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.channel, 'sse');
    assert.equal(result.fcmSentCount, 0);
    assert.equal(result.eventId, 'test-push-sa-1');

    assert.equal(superAdminSseWrites.length, 1);
    assert.equal(adminSseWrites.length, 0);
    assert.equal(fcmCallCount, 0);
  } finally {
    unregisterAdmin();
    unregisterSuperAdmin();
  }
});

test('notificationDedupe claims each delivery channel only once across SSE and FCM payloads', () => {
  resetNotificationDedupeCache();

  const ssePayload = {
    eventId: 'test-push-xyz',
    tag: 'test-push-xyz',
    type: 'TEST_PUSH',
    title: 'POS Test Push Alert',
    message: 'Delivered once',
  };

  const fcmForegroundPayload = {
    notification: {
      title: 'POS Test Push Alert',
      body: 'Delivered once',
    },
    data: {
      eventId: 'test-push-xyz',
      tag: 'test-push-xyz',
      type: 'TEST_PUSH',
    },
  };

  const sseKey = getNotificationDedupeKey(ssePayload);
  const fcmKey = getNotificationDedupeKey(fcmForegroundPayload);
  assert.equal(sseKey, fcmKey);

  // First SSE delivery claims sse & audio
  assert.equal(claimNotificationChannel(sseKey, 'sse'), true);
  assert.equal(claimNotificationChannel(sseKey, 'audio'), true);

  // Second SSE listener or duplicate event is rejected
  assert.equal(claimNotificationChannel(sseKey, 'sse'), false);

  // FCM foreground listener sees audio already claimed by SSE, while OS notification can claim once
  assert.equal(claimNotificationChannel(fcmKey, 'audio'), false);
  assert.equal(claimNotificationChannel(fcmKey, 'os_notification'), true);

  // Any subsequent OS notification fallback for the same event is rejected
  assert.equal(claimNotificationChannel(fcmKey, 'os_notification'), false);
});

test('dispatchPosEmailAlert queries users with valid user_status_enum (APPROVED) and avoids invalid ACTIVE literal', async () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'server', 'services', 'emailAlertService.ts'),
    'utf8'
  );
  assert.equal(/\bstatus\s+IN\s*\([^)]*'ACTIVE'/i.test(source), false);
  assert.equal(/\bstatus\s*=\s*'ACTIVE'/i.test(source), false);

  const capturedQueries: string[] = [];
  const origQuery = pgClient.query.bind(pgClient);
  (pgClient as any).query = async (sql: string, _params?: any[]) => {
    capturedQueries.push(String(sql));
    if (String(sql).includes('FROM users')) {
      assert.doesNotMatch(String(sql), /'ACTIVE'/i);
      assert.match(String(sql), /status\s*=\s*'APPROVED'/i);
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };

  try {
    const result = await dispatchPosEmailAlert(1, {
      type: 'SALE',
      title: 'Sale #INV-1',
      message: 'Sale recorded',
      invoiceNumber: 'INV-1',
      totalAmount: 1500,
      deepLinkUrl: '/pos',
      timestamp: new Date().toISOString(),
    });
    assert.equal(result, false);
    assert.ok(capturedQueries.some((q) => q.includes('FROM users')));
  } finally {
    (pgClient as any).query = origQuery;
  }
});

test('normalizeFcmPrivateKey parses PEM escapes, quoted snippets, and full Service Account JSON', () => {
  const quoted = '"-----BEGIN PRIVATE KEY-----\\nABC123\\n-----END PRIVATE KEY-----\\n",';
  const parsedQuoted = normalizeFcmPrivateKey(quoted);
  assert.equal(parsedQuoted.privateKey, '-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----');

  const fullJson = JSON.stringify({
    type: 'service_account',
    project_id: 'new-shoe-pos-99',
    client_email: 'firebase-adminsdk@new-shoe-pos-99.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nXYZ789\n-----END PRIVATE KEY-----\n',
  });
  const parsedJson = normalizeFcmPrivateKey(fullJson);
  assert.equal(parsedJson.projectIdFromJson, 'new-shoe-pos-99');
  assert.equal(parsedJson.clientEmailFromJson, 'firebase-adminsdk@new-shoe-pos-99.iam.gserviceaccount.com');
  assert.equal(parsedJson.privateKey, '-----BEGIN PRIVATE KEY-----\nXYZ789\n-----END PRIVATE KEY-----');
});

test('FCM backend and client invalidate caches on key rotation and propagate real multicast failure reasons', () => {
  const pushServiceSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'server', 'pushNotificationService.ts'),
    'utf8'
  );
  assert.ok(
    pushServiceSrc.includes("createHash('sha256')") && !pushServiceSrc.includes('privateKey.slice(0, 32)'),
    'Must hash full private key with sha256 instead of prefix slicing'
  );
  assert.ok(
    pushServiceSrc.includes("errCode === 'messaging/mismatched-credential'"),
    'Must prune stale tokens belonging to an older Firebase project'
  );
  assert.ok(
    pushServiceSrc.includes('...(formattedError ? { error: formattedError } : {})'),
    'sendFcmPushToTokens must return detailed error message instead of leaving error undefined'
  );

  const firebaseConfigSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'services', 'firebaseConfig.ts'),
    'utf8'
  );
  assert.ok(firebaseConfigSrc.includes('export async function resetFirebaseClientCache'));
  assert.ok(firebaseConfigSrc.includes('FCM_CLIENT_CONFIG_SIG_KEY'));
  assert.ok(firebaseConfigSrc.includes('cachedFirebaseConfigSig === nextConfigSig'));
  assert.ok(
    firebaseConfigSrc.includes('options?: { forceRefresh?: boolean }') &&
      firebaseConfigSrc.includes('oldSub.unsubscribe()') &&
      firebaseConfigSrc.includes("postMessage({ type: 'REINIT_FIREBASE_CONFIG' })"),
    'acquireAndSyncFcmToken must support forced token/PushSubscription rotation and notify the Service Worker'
  );
  assert.ok(
    !firebaseConfigSrc
      .slice(
        firebaseConfigSrc.indexOf('export async function resetFirebaseClientCache'),
        firebaseConfigSrc.indexOf('export async function initFirebaseClient')
      )
      .includes('FCM_CLIENT_CONFIG_SIG_KEY'),
    'resetFirebaseClientCache must preserve FCM_CLIENT_CONFIG_SIG_KEY so config rotation detection works'
  );

  const swSrc = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  assert.ok(
    swSrc.includes("data.type === 'REINIT_FIREBASE_CONFIG'") &&
      swSrc.includes('await app.delete()'),
    'Service Worker must clear prior Firebase app instance and reinitialize on REINIT_FIREBASE_CONFIG'
  );

  const providersUiSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'settings', 'NotificationAlertProvidersSettings.tsx'),
    'utf8'
  );
  assert.ok(providersUiSrc.includes('resetFirebaseClientCache(true)'));
  assert.ok(providersUiSrc.includes('{ forceRefresh: true }'));
  assert.ok(providersUiSrc.includes('configConsistencyWarning'));

  const settingsViewSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'settings', 'SettingsView.tsx'),
    'utf8'
  );
  assert.ok(
    settingsViewSrc.includes('resetFirebaseClientCache(true)') &&
      settingsViewSrc.includes("acquireAndSyncFcmToken('SUPERADMIN', { forceRefresh: true })"),
    'SettingsView Save button must also rotate client FCM subscription when FCM settings are saved'
  );
});

test('updateAppSettings purges stale fcm_tokens when Firebase project/sender/VAPID settings rotate', async () => {
  const capturedSql: string[] = [];
  const origQuery = pgClient.query.bind(pgClient);
  (pgClient as any).query = async (sql: string) => {
    const normalized = String(sql);
    capturedSql.push(normalized);
    if (normalized.includes('FROM public.app_settings WHERE key = ANY')) {
      return {
        rows: [
          { key: 'FCM_PROJECT_ID', value: 'old-shoe-pos-project' },
          { key: 'FCM_MESSAGING_SENDER_ID', value: '900875095665' },
        ],
        rowCount: 2,
      };
    }
    return { rows: [], rowCount: 0 };
  };

  try {
    await updateAppSettings(
      {
        FCM_PROJECT_ID: 'new-shoe-pos-project',
        FCM_MESSAGING_SENDER_ID: '123456789012',
      },
      'SUPERADMIN',
      { allowInternal: true }
    );
    assert.ok(
      capturedSql.some((q) => q.includes('DELETE FROM public.fcm_tokens')),
      'Rotating Firebase project or Sender ID must purge stale public.fcm_tokens rows'
    );

    capturedSql.length = 0;
    await updateAppSettings(
      { INVOICE_PREFIX: 'INV-' },
      'SUPERADMIN',
      { allowInternal: true }
    );
    assert.equal(
      capturedSql.some((q) => q.includes('DELETE FROM public.fcm_tokens')),
      false,
      'Unrelated settings updates must not delete registered fcm_tokens'
    );
  } finally {
    (pgClient as any).query = origQuery;
  }
});

