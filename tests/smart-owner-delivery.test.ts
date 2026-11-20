import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';

import {
  disconnectOwnerSseClients,
  disconnectSuperAdminSseClients,
  hasActiveAuthenticatedOwnerSse,
  hasActiveAuthenticatedSuperAdminSse,
  isStoreOwnerOnline,
  isSuperAdminOnline,
  notifyPlatformAnnouncement,
  notifyPosAction,
  registerSseClient,
  resetServerNotificationDedupeCache,
} from '../src/server/pushNotificationService.ts';
import {
  clearTenantOwnerPresence,
  getActiveOwnerSessions,
  getActiveSuperAdminSessions,
  hasFreshOwnerHeartbeat,
  hasFreshSuperAdminHeartbeat,
  isOwnerRole,
  isPlatformSuperAdminOnline,
  isSuperAdminRole,
  markOwnerSessionOffline,
  markSuperAdminSessionOffline,
  OWNER_HEARTBEAT_TTL_MS,
  OWNER_SSE_GRACE_TTL_MS,
  recordOwnerHeartbeat,
  recordSuperAdminHeartbeat,
  resetOwnerPresenceForTests,
  shrinkOwnerSessionGraceWindow,
  shrinkSuperAdminSessionGraceWindow,
} from '../src/server/services/ownerPresenceService.ts';
import {
  buildSuperAdminAlertEmailHtml,
  dispatchSuperAdminEmailAlert,
} from '../src/server/services/emailAlertService.ts';
import {
  generateToken,
  isTokenRevoked,
  resetRevokedTokensForTests,
} from '../src/server/auth.ts';
import notificationRoutes from '../src/server/routes/notificationRoutes.ts';
import authRoutes from '../src/server/routes/authRoutes.ts';

function createMockSseRes() {
  const chunks: string[] = [];
  let ended = false;
  return {
    chunks,
    get writableEnded() {
      return ended;
    },
    get destroyed() {
      return ended;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
  };
}

test('Smart Owner Delivery: Owner Online via authenticated SSE receives SSE + FCM push and NEVER sends email', async () => {
  resetServerNotificationDedupeCache();
  resetOwnerPresenceForTests();

  const tenantId = 301;
  const ownerRes = createMockSseRes();
  const cashierRes = createMockSseRes();

  const unregisterOwner = registerSseClient(tenantId, 11, 'ADMIN', ownerRes as any, {
    sessionId: 'tab-owner-1',
    authenticated: true,
  });
  const unregisterCashier = registerSseClient(tenantId, 22, 'CASHIER', cashierRes as any, {
    sessionId: 'tab-cashier-1',
    authenticated: true,
  });

  const pushedTokenBatches: string[][] = [];
  let emailCallCount = 0;

  try {
    assert.equal(isStoreOwnerOnline(tenantId), true);
    assert.equal(hasActiveAuthenticatedOwnerSse(tenantId), true);

    const txTypes = ['SALE', 'RETURN', 'EXCHANGE', 'SALE_RETURN', 'SALE_EXCHANGE'] as const;
    for (let i = 0; i < txTypes.length; i++) {
      const txType = txTypes[i];
      await notifyPosAction(
        tenantId,
        {
          eventId: `smart-online-${txType}-${i}`,
          type: txType,
          title: `${txType} Completed`,
          message: `Test ${txType}`,
          invoiceNumber: `INV-30${i}`,
          saleId: 3000 + i,
          cashierId: 22,
          totalAmount: 2500,
          deepLinkUrl: '/?tab=reports',
          timestamp: new Date().toISOString(),
          targetRole: 'ALL',
          targetRoles: ['ADMIN', 'CASHIER'],
        },
        {
          fetchFcmTokensFn: async () => [
            { token: 'fcm-owner-1', user_role: 'ADMIN', user_id: 11 },
            { token: 'fcm-cashier-22', user_role: 'CASHIER', user_id: 22 },
            { token: 'fcm-cashier-99', user_role: 'CASHIER', user_id: 99 },
          ],
          sendFcmPushToTokensFn: async (tokens) => {
            pushedTokenBatches.push(tokens);
            return { success: true, sentCount: tokens.length, failureCount: 0 };
          },
          dispatchPosEmailAlertFn: async () => {
            emailCallCount++;
            return true;
          },
        }
      );
    }

    assert.equal(ownerRes.chunks.length, txTypes.length);
    assert.equal(cashierRes.chunks.length, txTypes.length);
    assert.equal(pushedTokenBatches.length, txTypes.length);
    for (const batch of pushedTokenBatches) {
      assert.deepEqual(batch, ['fcm-owner-1', 'fcm-cashier-22']);
    }
    assert.equal(emailCallCount, 0, 'Email MUST NOT be dispatched when Owner is Online');
  } finally {
    unregisterOwner();
    unregisterCashier();
    resetServerNotificationDedupeCache();
    resetOwnerPresenceForTests();
  }
});

test('Smart Owner Delivery: Owner Online via heartbeat (without SSE) sends push and suppresses email', async () => {
  resetServerNotificationDedupeCache();
  resetOwnerPresenceForTests();

  const tenantId = 302;
  const pushedTokenBatches: string[][] = [];
  let emailCallCount = 0;

  try {
    assert.equal(isStoreOwnerOnline(tenantId), false);
    recordOwnerHeartbeat({
      tenantId,
      userId: 12,
      role: 'OWNER',
      sessionId: 'mobile-pwa',
    });
    assert.equal(isStoreOwnerOnline(tenantId), true);
    assert.equal(hasActiveAuthenticatedOwnerSse(tenantId), false);
    assert.equal(hasFreshOwnerHeartbeat(tenantId), true);

    await notifyPosAction(
      tenantId,
      {
        eventId: 'smart-heartbeat-only-sale-1',
        type: 'SALE',
        title: 'Sale Completed',
        message: '#INV-401 · Rs. 1,500 (Cash)',
        invoiceNumber: 'INV-401',
        saleId: 401,
        cashierId: 44,
        totalAmount: 1500,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        fetchFcmTokensFn: async () => [
          { token: 'fcm-owner-pwa', user_role: 'OWNER', user_id: 12 },
          { token: 'fcm-cashier-44', user_role: 'CASHIER', user_id: 44 },
        ],
        sendFcmPushToTokensFn: async (tokens) => {
          pushedTokenBatches.push(tokens);
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async () => {
          emailCallCount++;
          return true;
        },
      }
    );

    assert.equal(pushedTokenBatches.length, 1);
    assert.deepEqual(pushedTokenBatches[0], ['fcm-owner-pwa', 'fcm-cashier-44']);
    assert.equal(emailCallCount, 0);
  } finally {
    resetServerNotificationDedupeCache();
    resetOwnerPresenceForTests();
  }
});

test('FCM Primary + Email Fallback: Owner receives FCM push even when browser is closed (no email duplicate), and Cashier stays self-scoped', async () => {
  resetServerNotificationDedupeCache();
  resetOwnerPresenceForTests();

  const tenantId = 303;
  const cashierRes = createMockSseRes();
  const unregisterCashier = registerSseClient(tenantId, 55, 'CASHIER', cashierRes as any, {
    sessionId: 'cashier-pos-tab',
    authenticated: true,
  });

  // Ensure a Cashier heartbeat still never counts as Owner online
  const cashierHeartbeatAccepted = recordOwnerHeartbeat({
    tenantId,
    userId: 55,
    role: 'CASHIER',
    sessionId: 'cashier-pos-tab',
  });
  assert.equal(cashierHeartbeatAccepted, false);
  assert.equal(isStoreOwnerOnline(tenantId), false);

  const pushedTokenBatches: string[][] = [];
  const emailedPayloads: any[] = [];

  try {
    // Case A: Registered tokens exist for Owner + Cashier -> FCM delivers to Owner + Cashier tokens; no duplicate Email
    await notifyPosAction(
      tenantId,
      {
        eventId: 'smart-offline-sale-with-tokens',
        type: 'SALE',
        title: 'Sale Completed',
        message: '#INV-501 · Rs. 4,200 (Cash)',
        invoiceNumber: 'INV-501',
        saleId: 501,
        cashierId: 55,
        totalAmount: 4200,
        deepLinkUrl: '/?tab=reports',
        timestamp: new Date().toISOString(),
      },
      {
        fetchFcmTokensFn: async () => [
          { token: 'fcm-owner-offline', user_role: 'ADMIN', user_id: 1 },
          { token: 'fcm-owner-2', user_role: 'OWNER', user_id: 2 },
          { token: 'fcm-cashier-55', user_role: 'CASHIER', user_id: 55 },
        ],
        sendFcmPushToTokensFn: async (tokens) => {
          pushedTokenBatches.push(tokens);
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async (tid, payload) => {
          emailedPayloads.push({ tid, eventId: payload.eventId, type: payload.type });
          return true;
        },
      }
    );

    assert.equal(cashierRes.chunks.length, 1, 'Cashier should still see their counter notification');
    assert.deepEqual(
      pushedTokenBatches,
      [['fcm-owner-offline', 'fcm-owner-2', 'fcm-cashier-55']],
      'FCM primary delivers to Owner background/closed devices alongside counter Cashier'
    );
    assert.equal(emailedPayloads.length, 0, 'Email Fallback must stay suppressed when Owner FCM push succeeds');

    // Case B: 0 FCM tokens in database -> must NOT early-return before dispatching email alert
    await notifyPosAction(
      tenantId,
      {
        eventId: 'smart-offline-return-zero-tokens',
        type: 'RETURN',
        title: 'Return Completed',
        message: '#RET-502 · Rs. 900 Refund',
        invoiceNumber: '',
        returnNumber: 'RET-502',
        returnId: 502,
        cashierId: 55,
        refundAmount: 900,
        deepLinkUrl: '/?tab=returns',
        timestamp: new Date().toISOString(),
      },
      {
        fetchFcmTokensFn: async () => [],
        sendFcmPushToTokensFn: async (tokens) => {
          pushedTokenBatches.push(tokens);
          return { success: true, sentCount: 0, failureCount: 0 };
        },
        dispatchPosEmailAlertFn: async (tid, payload) => {
          emailedPayloads.push({ tid, eventId: payload.eventId, type: payload.type });
          return true;
        },
      }
    );

    assert.equal(emailedPayloads.length, 1, 'Email Fallback MUST trigger when Store Owner has 0 active FCM tokens');
    assert.equal(emailedPayloads[0].type, 'RETURN');
  } finally {
    unregisterCashier();
    resetServerNotificationDedupeCache();
    resetOwnerPresenceForTests();
  }
});

test('Owner Presence Service: Multi-tab isolation, heartbeat TTL expiration, SSE close grace window, and security guards', async () => {
  resetOwnerPresenceForTests();
  const tenantId = 304;
  const userId = 7;
  const t0 = 1_700_000_000_000;

  // Unauthenticated SSE or userId <= 0 never counts as online
  const unauthRes = createMockSseRes();
  const unauthUnregister = registerSseClient(tenantId, 0, 'ADMIN', unauthRes as any, {
    sessionId: 'spoof-tab',
    authenticated: false,
  });
  assert.equal(hasActiveAuthenticatedOwnerSse(tenantId), false);
  assert.equal(isStoreOwnerOnline(tenantId, t0), false);
  await notifyPosAction(
    tenantId,
    {
      eventId: 'unauth-sse-check',
      type: 'SALE',
      title: 'Sale',
      message: 'Body',
      invoiceNumber: 'INV-UNAUTH',
      saleId: 901,
      deepLinkUrl: '/',
      timestamp: new Date().toISOString(),
    },
    {
      fetchFcmTokensFn: async () => [],
      dispatchPosEmailAlertFn: async () => false,
    }
  );
  assert.equal(unauthRes.chunks.length, 0, 'Unauthenticated SSE MUST NOT receive owner events');
  unauthUnregister();

  // Multi-tab isolation
  recordOwnerHeartbeat({ tenantId, userId, role: 'ADMIN', sessionId: 'tab-a', now: t0 });
  recordOwnerHeartbeat({ tenantId, userId, role: 'ADMIN', sessionId: 'tab-b', now: t0 });
  assert.equal(getActiveOwnerSessions(tenantId, t0).length, 2);
  assert.equal(isStoreOwnerOnline(tenantId, t0), true);

  // Closing tab-b leaves tab-a online
  markOwnerSessionOffline({ tenantId, userId, sessionId: 'tab-b' });
  assert.equal(getActiveOwnerSessions(tenantId, t0).length, 1);
  assert.equal(isStoreOwnerOnline(tenantId, t0), true);

  // Closing last tab marks Owner immediately offline
  markOwnerSessionOffline({ tenantId, userId, sessionId: 'tab-a' });
  assert.equal(isStoreOwnerOnline(tenantId, t0), false);

  // Heartbeat TTL expiry
  recordOwnerHeartbeat({ tenantId, userId, role: 'ADMIN', sessionId: 'tab-c', now: t0 });
  assert.equal(isStoreOwnerOnline(tenantId, t0 + OWNER_HEARTBEAT_TTL_MS - 1), true);
  assert.equal(isStoreOwnerOnline(tenantId, t0 + OWNER_HEARTBEAT_TTL_MS + 1), false);

  // SSE close shrinks remaining TTL to brief grace window
  recordOwnerHeartbeat({ tenantId, userId, role: 'ADMIN', sessionId: 'tab-d', now: t0 });
  shrinkOwnerSessionGraceWindow({ tenantId, userId, sessionId: 'tab-d', now: t0 });
  assert.equal(isStoreOwnerOnline(tenantId, t0 + OWNER_SSE_GRACE_TTL_MS - 1), true);
  assert.equal(isStoreOwnerOnline(tenantId, t0 + OWNER_SSE_GRACE_TTL_MS + 1), false);

  // Tenant suspension / expiry clear helper wipes all tenant owner presence
  recordOwnerHeartbeat({ tenantId, userId, role: 'OWNER', sessionId: 'tab-e', now: t0 });
  assert.equal(isStoreOwnerOnline(tenantId, t0), true);
  clearTenantOwnerPresence(tenantId);
  assert.equal(isStoreOwnerOnline(tenantId, t0), false);
  assert.equal(isOwnerRole('ADMIN'), true);
  assert.equal(isOwnerRole('OWNER'), true);
  assert.equal(isOwnerRole('CASHIER'), false);

  resetOwnerPresenceForTests();
  resetServerNotificationDedupeCache();
});

test('HTTP Integration: Unauthenticated SSE blocked from Owner alerts, and /presence/offline + /auth/logout immediately transition Owner Offline', async () => {
  resetOwnerPresenceForTests();
  resetRevokedTokensForTests();
  resetServerNotificationDedupeCache();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/notifications', notificationRoutes);

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const tenantId = 305;
  const userId = 19;
  const ownerToken = generateToken({
    id: userId,
    tenantId,
    name: 'Store Owner',
    email: 'owner305@example.com',
    role: 'ADMIN',
    status: 'APPROVED',
  });

  try {
    // 1. Unauthenticated SSE connection claiming role=ADMIN must NOT mark Owner online
    const unauthReq = await new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve) => {
      const req = http.get(`${baseUrl}/api/notifications/stream?__tenantId=${tenantId}&role=ADMIN&userId=${userId}`, (res) => {
        resolve({ req, res });
      });
    });
    assert.equal(isStoreOwnerOnline(tenantId), false, 'Unauthenticated SSE MUST NOT mark Owner online');
    unauthReq.req.destroy();

    // 2. Authenticated SSE stream with valid JWT DOES mark Owner Online
    const authStream = await new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve) => {
      const req = http.get(
        `${baseUrl}/api/notifications/stream?__token=${encodeURIComponent(ownerToken)}&sessionId=http-tab-1`,
        (res) => {
          res.once('data', () => resolve({ req, res }));
        }
      );
    });
    assert.equal(hasActiveAuthenticatedOwnerSse(tenantId), true);
    assert.equal(isStoreOwnerOnline(tenantId), true);

    // 3. POST /api/notifications/presence/offline via sendBeacon-style text/plain immediately marks Owner Offline and closes SSE
    const offlineResp = await fetch(
      `${baseUrl}/api/notifications/presence/offline?__token=${encodeURIComponent(ownerToken)}&sessionId=http-tab-1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ sessionId: 'http-tab-1' }),
      }
    );
    assert.equal(offlineResp.status, 200);
    assert.equal(isStoreOwnerOnline(tenantId), false);
    assert.equal(hasActiveAuthenticatedOwnerSse(tenantId), false);
    authStream.req.destroy();

    // 4. Logout route (/api/auth/logout) revokes JWT, marks Owner offline, and disconnects owner SSE clients
    recordOwnerHeartbeat({ tenantId, userId, role: 'ADMIN', sessionId: 'logout-tab' });
    const mockLogoutSse = createMockSseRes();
    registerSseClient(tenantId, userId, 'ADMIN', mockLogoutSse as any, {
      sessionId: 'logout-tab',
      authenticated: true,
    });
    assert.equal(isStoreOwnerOnline(tenantId), true);

    const logoutResp = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': ownerToken,
      },
      body: JSON.stringify({ sessionId: 'logout-tab' }),
    });
    assert.equal(logoutResp.status, 200);
    assert.equal(isTokenRevoked(ownerToken), true);
    assert.equal(isStoreOwnerOnline(tenantId), false);
    assert.equal(hasActiveAuthenticatedOwnerSse(tenantId), false);

    // 5. Revoked token trying to reconnect SSE must stay authenticated=false (offline)
    const revokedStream = await new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve) => {
      const req = http.get(
        `${baseUrl}/api/notifications/stream?__token=${encodeURIComponent(ownerToken)}&sessionId=revoked-tab`,
        (res) => {
          res.once('data', () => resolve({ req, res }));
        }
      );
    });
    assert.equal(isStoreOwnerOnline(tenantId), false, 'Revoked token SSE must NOT mark Owner online');
    revokedStream.req.destroy();
  } finally {
    disconnectOwnerSseClients(tenantId);
    resetOwnerPresenceForTests();
    resetRevokedTokensForTests();
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Smart SuperAdmin Delivery: SuperAdmin Online receives SSE + FCM push and NEVER sends email; SuperAdmin Offline sends email reliably with zero push/SSE duplicates', async () => {
  resetServerNotificationDedupeCache();
  resetOwnerPresenceForTests();

  const storeOwnerRes = createMockSseRes();
  const unregisterOwner = registerSseClient(501, 10, 'ADMIN', storeOwnerRes as any, {
    sessionId: 'owner-501',
    authenticated: true,
  });

  try {
    // Isolation check: Store Owner online MUST NOT count as SuperAdmin online
    assert.equal(isStoreOwnerOnline(501), true);
    assert.equal(isSuperAdminOnline(), false);
    assert.equal(isPlatformSuperAdminOnline(), false);

    // Case A: SuperAdmin has 0 FCM tokens -> Email Fallback triggers reliably
    const fallbackEmails: any[] = [];
    let fallbackFcmCalls = 0;

    await notifyPlatformAnnouncement(
      {
        id: 701,
        eventId: 'sa-trial-fallback-1',
        tenantId: null,
        targetRole: 'SUPERADMIN',
        title: 'New Free Trial: Star Footwear',
        message: 'Registered by owner@starfootwear.com',
        type: 'INFO',
        actionUrl: '/superadmin',
        actionLabel: 'View Store',
      },
      {
        fetchFcmTokensFn: async () => [],
        sendFcmPushToTokensFn: async () => {
          fallbackFcmCalls++;
          return { success: true, sentCount: 0, failureCount: 0 };
        },
        dispatchSuperAdminEmailAlertFn: async (payload) => {
          fallbackEmails.push(payload);
          return true;
        },
      }
    );

    assert.equal(fallbackEmails.length, 1, 'SuperAdmin alert with 0 FCM tokens MUST trigger email fallback');
    assert.equal(fallbackEmails[0].title, 'New Free Trial: Star Footwear');
    assert.equal(fallbackFcmCalls, 0);
    assert.equal(storeOwnerRes.chunks.length, 0);

    // Case A2: SuperAdmin has active FCM token (even with browser closed) -> FCM primary delivers, email suppressed
    const primaryFcmBatches: string[][] = [];
    let suppressedEmailCount = 0;
    await notifyPlatformAnnouncement(
      {
        id: 7011,
        eventId: 'sa-trial-fcm-primary-1',
        tenantId: null,
        targetRole: 'SUPERADMIN',
        title: 'New Free Trial: Crescent Footwear',
        message: 'Registered by owner@crescent.com',
        type: 'INFO',
        actionUrl: '/superadmin',
        actionLabel: 'View Store',
      },
      {
        fetchFcmTokensFn: async () => ['fcm-superadmin-1'],
        sendFcmPushToTokensFn: async (tokens) => {
          primaryFcmBatches.push(tokens);
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchSuperAdminEmailAlertFn: async () => {
          suppressedEmailCount++;
          return true;
        },
      }
    );
    assert.deepEqual(primaryFcmBatches, [['fcm-superadmin-1']]);
    assert.equal(suppressedEmailCount, 0, 'SuperAdmin FCM primary must suppress redundant email fallback');

    // Case B: SuperAdmin Online via authenticated SSE -> SSE + FCM sent, Email suppressed
    const saRes = createMockSseRes();
    const unregisterSa = registerSseClient(0, 1, 'SUPERADMIN', saRes as any, {
      sessionId: 'sa-tab-1',
      authenticated: true,
    });
    assert.equal(hasActiveAuthenticatedSuperAdminSse(), true);
    assert.equal(isSuperAdminOnline(), true);
    assert.equal(isPlatformSuperAdminOnline(), true);

    const onlineFcmBatches: string[][] = [];
    let onlineEmailCount = 0;

    await notifyPlatformAnnouncement(
      {
        id: 702,
        eventId: 'sa-renewal-online-1',
        tenantId: null,
        targetRole: 'SUPERADMIN',
        title: 'Renewal Request: Metro Shoes',
        message: 'Yearly extension requested',
        type: 'SYSTEM',
        actionUrl: '/superadmin',
        actionLabel: 'Review Store',
      },
      {
        fetchFcmTokensFn: async () => ['fcm-superadmin-1', 'fcm-superadmin-2'],
        sendFcmPushToTokensFn: async (tokens) => {
          onlineFcmBatches.push(tokens);
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchSuperAdminEmailAlertFn: async () => {
          onlineEmailCount++;
          return true;
        },
      }
    );

    assert.equal(saRes.chunks.length, 1, 'Online SuperAdmin MUST receive SSE announcement');
    assert.deepEqual(onlineFcmBatches, [['fcm-superadmin-1', 'fcm-superadmin-2']]);
    assert.equal(onlineEmailCount, 0, 'Online SuperAdmin MUST NOT receive email alert');
    unregisterSa();

    // Case C: SuperAdmin Online via Heartbeat (without SSE) -> FCM sent, Email suppressed
    recordSuperAdminHeartbeat({ userId: 1, role: 'SUPERADMIN', sessionId: 'sa-mobile-1' });
    assert.equal(hasActiveAuthenticatedSuperAdminSse(), false);
    assert.equal(hasFreshSuperAdminHeartbeat(), true);
    assert.equal(isSuperAdminOnline(), true);

    const heartbeatFcmBatches: string[][] = [];
    let heartbeatEmailCount = 0;

    await notifyPlatformAnnouncement(
      {
        id: 703,
        eventId: 'sa-security-heartbeat-1',
        tenantId: null,
        targetRole: 'SUPERADMIN',
        title: 'Security Alert: Multiple Failed Logins',
        message: 'Detected 5 failed attempts',
        type: 'SECURITY',
        actionUrl: '/superadmin',
      },
      {
        fetchFcmTokensFn: async () => ['fcm-superadmin-mobile'],
        sendFcmPushToTokensFn: async (tokens) => {
          heartbeatFcmBatches.push(tokens);
          return { success: true, sentCount: tokens.length, failureCount: 0 };
        },
        dispatchSuperAdminEmailAlertFn: async () => {
          heartbeatEmailCount++;
          return true;
        },
      }
    );

    assert.deepEqual(heartbeatFcmBatches, [['fcm-superadmin-mobile']]);
    assert.equal(heartbeatEmailCount, 0);

    // Case D: SuperAdmin presence lifecycle (multi-tab, TTL expiry, SSE close grace window)
    const t0 = 1_700_000_000_000;
    resetOwnerPresenceForTests();
    recordSuperAdminHeartbeat({ userId: 1, role: 'SUPERADMIN', sessionId: 'sa-a', now: t0 });
    recordSuperAdminHeartbeat({ userId: 1, role: 'SUPERADMIN', sessionId: 'sa-b', now: t0 });
    assert.equal(getActiveSuperAdminSessions(t0).length, 2);
    markSuperAdminSessionOffline({ userId: 1, sessionId: 'sa-b' });
    assert.equal(isSuperAdminOnline(t0), true);
    markSuperAdminSessionOffline({ userId: 1, sessionId: 'sa-a' });
    assert.equal(isSuperAdminOnline(t0), false);

    recordSuperAdminHeartbeat({ userId: 1, role: 'SUPERADMIN', sessionId: 'sa-c', now: t0 });
    assert.equal(isSuperAdminOnline(t0 + OWNER_HEARTBEAT_TTL_MS - 1), true);
    assert.equal(isSuperAdminOnline(t0 + OWNER_HEARTBEAT_TTL_MS + 1), false);

    recordSuperAdminHeartbeat({ userId: 1, role: 'SUPERADMIN', sessionId: 'sa-d', now: t0 });
    shrinkSuperAdminSessionGraceWindow({ userId: 1, sessionId: 'sa-d', now: t0 });
    assert.equal(isSuperAdminOnline(t0 + OWNER_SSE_GRACE_TTL_MS - 1), true);
    assert.equal(isSuperAdminOnline(t0 + OWNER_SSE_GRACE_TTL_MS + 1), false);
    assert.equal(isSuperAdminRole('SUPERADMIN'), true);
    assert.equal(isSuperAdminRole('ADMIN'), false);

    // Case E: SuperAdmin Email template & dispatchSuperAdminEmailAlert formatting
    const rendered = buildSuperAdminAlertEmailHtml(
      {
        title: 'Renewal Request: City Shoes',
        message: 'Requested 12-month renewal',
        type: 'SYSTEM',
        actionLabel: 'Review Store',
      },
      'https://example.com/superadmin'
    );
    assert.match(rendered.subject, /\[SuperAdmin Alert\] Renewal Request: City Shoes/);
    assert.match(rendered.html, /City Shoes/);
    assert.match(rendered.html, /https:\/\/example\.com\/superadmin/);

    const sentEmails: any[] = [];
    const emailDispatched = await dispatchSuperAdminEmailAlert(
      {
        title: 'New Free Trial: Peak Footwear',
        message: 'Store activated trial',
        type: 'INFO',
      },
      {
        fetchRecipientEmailsFn: async () => ['sarbaazsoft@gmail.com'],
        sendEmailFn: async (opts) => {
          sentEmails.push(opts);
          return { delivered: true, provider: 'resend' };
        },
      }
    );
    assert.equal(emailDispatched, true);
    assert.equal(sentEmails.length, 1);
    assert.deepEqual(sentEmails[0].to, ['sarbaazsoft@gmail.com']);
  } finally {
    unregisterOwner();
    disconnectSuperAdminSseClients();
    resetOwnerPresenceForTests();
    resetServerNotificationDedupeCache();
  }
});

test('HTTP Integration: Unauthenticated SuperAdmin SSE blocked, and /presence/offline + /auth/logout transition SuperAdmin Offline', async () => {
  resetOwnerPresenceForTests();
  resetRevokedTokensForTests();
  resetServerNotificationDedupeCache();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/notifications', notificationRoutes);

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const saUserId = 1;
  const saToken = generateToken({
    id: saUserId,
    tenantId: 0,
    name: 'Platform SuperAdmin',
    email: 'sarbaazsoft@gmail.com',
    role: 'SUPERADMIN',
    status: 'APPROVED',
  });

  try {
    // 1. Unauthenticated SSE claiming role=SUPERADMIN must NOT mark SuperAdmin online
    const unauthReq = await new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve) => {
      const req = http.get(`${baseUrl}/api/notifications/stream?__tenantId=0&role=SUPERADMIN&userId=1`, (res) => {
        resolve({ req, res });
      });
    });
    assert.equal(isSuperAdminOnline(), false, 'Unauthenticated SSE MUST NOT mark SuperAdmin online');
    unauthReq.req.destroy();

    // 2. Authenticated SuperAdmin SSE stream marks SuperAdmin Online with tenantId=0
    const authStream = await new Promise<{ req: http.ClientRequest; res: http.IncomingMessage }>((resolve) => {
      const req = http.get(
        `${baseUrl}/api/notifications/stream?__token=${encodeURIComponent(saToken)}&sessionId=sa-http-1`,
        (res) => {
          res.once('data', () => resolve({ req, res }));
        }
      );
    });
    assert.equal(hasActiveAuthenticatedSuperAdminSse(), true);
    assert.equal(isSuperAdminOnline(), true);

    // 3. POST /api/notifications/presence/offline transitions SuperAdmin Offline immediately
    const offlineResp = await fetch(
      `${baseUrl}/api/notifications/presence/offline?__token=${encodeURIComponent(saToken)}&sessionId=sa-http-1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ sessionId: 'sa-http-1' }),
      }
    );
    assert.equal(offlineResp.status, 200);
    assert.equal(isSuperAdminOnline(), false);
    assert.equal(hasActiveAuthenticatedSuperAdminSse(), false);
    authStream.req.destroy();

    // 4. POST /api/auth/logout with SUPERADMIN token revokes token & marks SuperAdmin offline
    recordSuperAdminHeartbeat({ userId: saUserId, role: 'SUPERADMIN', sessionId: 'sa-logout-tab' });
    const mockLogoutSaSse = createMockSseRes();
    registerSseClient(0, saUserId, 'SUPERADMIN', mockLogoutSaSse as any, {
      sessionId: 'sa-logout-tab',
      authenticated: true,
    });
    assert.equal(isSuperAdminOnline(), true);

    const logoutResp = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': saToken,
      },
      body: JSON.stringify({ sessionId: 'sa-logout-tab' }),
    });
    assert.equal(logoutResp.status, 200);
    assert.equal(isTokenRevoked(saToken), true);
    assert.equal(isSuperAdminOnline(), false);
    assert.equal(hasActiveAuthenticatedSuperAdminSse(), false);
  } finally {
    disconnectSuperAdminSseClients();
    resetOwnerPresenceForTests();
    resetRevokedTokensForTests();
    resetServerNotificationDedupeCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
