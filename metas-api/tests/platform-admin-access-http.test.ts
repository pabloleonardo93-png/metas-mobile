import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { createErrorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import { createPlatformAdminAccessRouter } from '../src/modules/platformAdminAccess/platformAdminAccess.routes.js';
import type { PlatformAdminAccessService } from '../src/modules/platformAdminAccess/platformAdminAccess.service.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminSession,
} from '../src/modules/platformAdmin/platformAdmin.types.js';
import {
  PlatformAdminRateLimitStoreUnavailableError,
  type PlatformAdminRateLimiter,
} from '../src/modules/platformAdmin/platformAdminRateLimiter.js';
import { AppError } from '../src/shared/errors/AppError.js';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const verifiedSession: PlatformAdminSession = {
  assuranceLevel: 'MFA_VERIFIED',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  mfaVerifiedAt: new Date().toISOString(),
  platformAdminId: id,
  sessionId: id,
  stepUpVerifiedAt: new Date().toISOString(),
};

const setup = (
  session: PlatformAdminSession = verifiedSession,
  limiter: PlatformAdminRateLimiter = {
    consume: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
  },
) => {
  const calls: Array<{ method: string; arguments: unknown[] }> = [];
  const service: PlatformAdminAccessService = {
    list: (...args) => {
      calls.push({ method: 'list', arguments: args });
      return Promise.resolve({ items: [] });
    },
    invite: (...args) => {
      calls.push({ method: 'invite', arguments: args });
      return Promise.resolve({ id: otherId });
    },
    cancel: (...args) => {
      calls.push({ method: 'cancel', arguments: args });
      return Promise.resolve({ id: otherId });
    },
    approveFirstEnrollment: (...args) => {
      calls.push({ method: 'approve', arguments: args });
      return Promise.resolve({ id: otherId });
    },
  };
  const authentication: PlatformAdminAuthenticationService = {
    authenticateSession: (token) =>
      token === 'synthetic'
        ? Promise.resolve(session)
        : Promise.reject(new AppError(401, 'UNAUTHORIZED', 'Sessão necessária.')),
    getMe: () => Promise.reject(new Error('not used')),
    loginWithGoogle: () => Promise.reject(new Error('not used')),
    logout: () => Promise.resolve(),
  };
  const app = express();
  app.use(express.json(), requestId);
  app.use(
    '/administrators',
    createPlatformAdminAccessRouter(authentication, service, limiter, 300),
  );
  app.use(createErrorHandler({ error: () => {}, info: () => {} }));
  return { app, calls };
};

void test('acessos administrativos exigem sessão MFA e step-up recente antes do serviço', async () => {
  const googleOnly = setup({
    ...verifiedSession,
    assuranceLevel: 'GOOGLE_ONLY',
    mfaVerifiedAt: null,
    stepUpVerifiedAt: null,
  });
  assert.equal((await request(googleOnly.app).get('/administrators')).status, 401);
  assert.equal(
    (await request(googleOnly.app).get('/administrators').auth('synthetic', { type: 'bearer' }))
      .status,
    403,
  );

  const stale = setup({
    ...verifiedSession,
    stepUpVerifiedAt: new Date(Date.now() - 301_000).toISOString(),
  });
  const response = await request(stale.app)
    .post('/administrators')
    .auth('synthetic', { type: 'bearer' })
    .send({ displayName: 'Nova Admin', email: 'nova@example.test' });
  assert.equal(response.status, 403);
  assert.equal(
    (JSON.parse(response.text) as { code: unknown }).code,
    'PLATFORM_ADMIN_STEP_UP_REQUIRED',
  );
  assert.equal(stale.calls.length, 0);
});

void test('convite, cancelamento e aprovação validam contratos estritos e encaminham contexto', async () => {
  const { app, calls } = setup();
  const auth = (builder: request.Test) => builder.auth('synthetic', { type: 'bearer' });

  assert.equal(
    (
      await auth(request(app).post('/administrators')).send({
        displayName: '  Nova Admin  ',
        email: 'NOVA@EXAMPLE.TEST',
      })
    ).status,
    201,
  );
  assert.deepEqual(calls[0]?.arguments.slice(1, 2), [
    { displayName: 'Nova Admin', email: 'nova@example.test' },
  ]);
  assert.equal(
    (await auth(request(app).post(`/administrators/${otherId}/cancel`)).send({})).status,
    200,
  );
  assert.equal(
    (await auth(request(app).post(`/administrators/first-enrollment/${otherId}/approve`)).send({}))
      .status,
    200,
  );
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['invite', 'cancel', 'approve'],
  );

  for (const response of [
    await auth(request(app).post('/administrators')).send({
      displayName: 'Nova Admin',
      email: 'invalid',
    }),
    await auth(request(app).post('/administrators')).send({
      displayName: 'Nova Admin',
      email: 'nova@example.test',
      role: 'SUPERUSER',
    }),
    await auth(request(app).post(`/administrators/${otherId}/cancel`)).send({ unexpected: true }),
    await auth(request(app).post('/administrators/not-a-uuid/cancel')).send({}),
  ]) {
    assert.equal(response.status, 422);
  }
});

void test('operações sensíveis aplicam rate limit e falham fechadas se o store estiver indisponível', async () => {
  const consumedOperations: string[] = [];
  const allowed = setup(verifiedSession, {
    consume: (operation) => {
      consumedOperations.push(operation);
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    },
  });
  assert.equal(
    (
      await request(allowed.app)
        .post('/administrators')
        .auth('synthetic', { type: 'bearer' })
        .send({ displayName: 'Nova Admin', email: 'nova@example.test' })
    ).status,
    201,
  );
  assert.deepEqual(consumedOperations, ['ADMIN_ACCESS_WRITE']);

  const denied = setup(
    {
      ...verifiedSession,
    },
    { consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 17 }) },
  );
  const deniedResponse = await request(denied.app)
    .post('/administrators')
    .auth('synthetic', { type: 'bearer' })
    .send({ displayName: 'Nova Admin', email: 'nova@example.test' });
  assert.equal(deniedResponse.status, 429);
  assert.equal(deniedResponse.headers['retry-after'], '17');
  assert.equal(denied.calls.length, 0);

  const unavailable = setup(verifiedSession, {
    consume: () => Promise.reject(new PlatformAdminRateLimitStoreUnavailableError()),
  });
  const unavailableResponse = await request(unavailable.app)
    .post('/administrators')
    .auth('synthetic', { type: 'bearer' })
    .send({ displayName: 'Nova Admin', email: 'nova@example.test' });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(
    (JSON.parse(unavailableResponse.text) as { code: unknown }).code,
    'PLATFORM_ADMIN_RATE_LIMIT_UNAVAILABLE',
  );
  assert.equal(unavailable.calls.length, 0);
});

void test('contratos de acesso administrativo dos três workspaces permanecem equivalentes', () => {
  const read = (relative: string) =>
    readFileSync(new URL(relative, import.meta.url), 'utf8')
      .replace(/\r\n/gu, '\n')
      .trim();
  const api = read('../src/modules/platformAdminAccess/platformAdminAccess.contracts.ts');
  assert.equal(read('../../metas-admin/bff/src/routes/platformAdminAccess.contracts.ts'), api);
  assert.equal(read('../../metas-admin/frontend/src/api/platformAdminAccess.contracts.ts'), api);
});
