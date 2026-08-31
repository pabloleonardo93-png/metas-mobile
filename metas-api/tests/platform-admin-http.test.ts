import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../src/app.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminLoginResult,
  PlatformAdminMeResult,
  PlatformAdminRequestMetadata,
  PlatformAdminSession,
} from '../src/modules/platformAdmin/platformAdmin.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger, LogContext } from '../src/shared/logging/logger.js';

const platformToken = 'p'.repeat(43);
const employeeToken = 'e'.repeat(43);
const platformSession: PlatformAdminSession = {
  assuranceLevel: 'GOOGLE_ONLY',
  expiresAt: '2026-09-01T12:00:00.000Z',
  mfaVerifiedAt: null,
  platformAdminId: '018f47a1-3d11-7c14-a8bf-0242ac120010',
  sessionId: '018f47a1-3d11-7c14-a8bf-0242ac120011',
  stepUpVerifiedAt: null,
};
const loginResult: PlatformAdminLoginResult = {
  admin: {
    assuranceLevel: 'GOOGLE_ONLY',
    displayName: 'Admin Teste',
    id: platformSession.platformAdminId,
    primaryEmail: 'admin@example.test',
  },
  expiresAt: platformSession.expiresAt,
  sessionToken: platformToken,
};
const meResult: PlatformAdminMeResult = {
  assuranceLevel: 'GOOGLE_ONLY',
  displayName: 'Admin Teste',
  id: platformSession.platformAdminId,
  primaryEmail: 'admin@example.test',
  status: 'ACTIVE',
};

class FakePlatformAdminAuthenticationService implements PlatformAdminAuthenticationService {
  public loginError: Error | null = null;
  public logoutCalled = false;
  public loginMetadata: PlatformAdminRequestMetadata | null = null;

  public authenticateSession(token: string): Promise<PlatformAdminSession> {
    if (token !== platformToken) {
      return Promise.reject(
        new AppError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.'),
      );
    }
    return Promise.resolve(platformSession);
  }

  public getMe(): Promise<PlatformAdminMeResult> {
    return Promise.resolve(meResult);
  }

  public loginWithGoogle(
    _idToken: string,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminLoginResult> {
    this.loginMetadata = metadata;
    return this.loginError ? Promise.reject(this.loginError) : Promise.resolve(loginResult);
  }

  public logout(): Promise<void> {
    this.logoutCalled = true;
    return Promise.resolve();
  }
}

const logEntries: Array<{ context?: LogContext; event: string }> = [];
const logger: Logger = {
  error: (event, context) => logEntries.push({ event, ...(context ? { context } : {}) }),
  info: (event, context) => logEntries.push({ event, ...(context ? { context } : {}) }),
};

const parseJson = <Result extends object>(text: string): Result => {
  const value: unknown = JSON.parse(text);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as Result;
};

await test('platform admin login accepts only the strict Google token contract', async () => {
  const app = createApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
  });

  for (const field of ['platformAdminId', 'role', 'storeId', 'assuranceLevel']) {
    await request(app)
      .post('/v1/platform-admin/auth/google')
      .send({ idToken: 'x'.repeat(20), [field]: 'attacker-controlled' })
      .expect(422);
  }
});

await test('platform admin login returns a minimal contract without logging credentials', async () => {
  logEntries.length = 0;
  const service = new FakePlatformAdminAuthenticationService();
  const response = await request(createApp({ logger, platformAdminAuthenticationService: service }))
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'google-admin-id-token-private' })
    .expect(200);

  assert.deepEqual(parseJson<PlatformAdminLoginResult>(response.text), loginResult);
  assert.match(service.loginMetadata?.requestId ?? '', /^[0-9a-f-]{36}$/u);
  assert.doesNotMatch(JSON.stringify(logEntries), /google-admin-id-token|p{43}/u);
});

await test('unprovisioned or invalid administrative identities receive a controlled denial', async () => {
  const service = new FakePlatformAdminAuthenticationService();
  service.loginError = new AppError(
    403,
    'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED',
    'Não foi possível autorizar o acesso administrativo.',
  );
  const response = await request(createApp({ logger, platformAdminAuthenticationService: service }))
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(403);

  assert.equal(
    parseJson<{ code: string }>(response.text).code,
    'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED',
  );
});

await test('employee sessions cannot authenticate platform admin routes', async () => {
  const app = createApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
  });

  await request(app)
    .get('/v1/platform-admin/me')
    .set('Authorization', `Bearer ${employeeToken}`)
    .expect(401);
});

await test('platform admin me returns only the administrative DTO', async () => {
  const response = await request(
    createApp({
      logger,
      platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    }),
  )
    .get('/v1/platform-admin/me')
    .set('Authorization', `Bearer ${platformToken}`)
    .expect(200);
  const body = parseJson<PlatformAdminMeResult>(response.text);

  assert.deepEqual(body, meResult);
  assert.equal('tokenHash' in body, false);
  assert.equal('providerSubject' in body, false);
  assert.equal('sessionId' in body, false);
});

await test('platform admin logout authenticates and revokes through its own service', async () => {
  const service = new FakePlatformAdminAuthenticationService();
  await request(createApp({ logger, platformAdminAuthenticationService: service }))
    .post('/v1/platform-admin/auth/logout')
    .set('Authorization', `Bearer ${platformToken}`)
    .expect(204);
  assert.equal(service.logoutCalled, true);
});

await test('platform admin login uses a dedicated stricter rate limit', async () => {
  const app = createApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminRateLimit: { limit: 1, windowMs: 60_000 },
  });

  await request(app)
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(200);
  const response = await request(app)
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(429);
  assert.equal(parseJson<{ code: string }>(response.text).code, 'TOO_MANY_REQUESTS');
});

await test('no public HTTP route provisions a platform admin', async () => {
  const app = createApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
  });
  await request(app).post('/v1/platform-admin').send({}).expect(404);
  await request(app).post('/v1/platform-admin/bootstrap').send({}).expect(404);
});
