import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp } from '../src/app.js';
import type {
  AuthenticatedSession,
  AuthenticationService,
  LoginResult,
  MeResult,
} from '../src/modules/auth/auth.types.js';
import { hashSessionToken } from '../src/modules/auth/sessionToken.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger, LogContext } from '../src/shared/logging/logger.js';

const rawToken = 'a'.repeat(43);
const session: AuthenticatedSession = {
  employeeId: '018f47a1-3d11-7c14-a8bf-0242ac120003',
  role: 'BALCONISTA',
  storeId: '018f47a1-3d11-7c14-a8bf-0242ac120004',
  tokenHash: hashSessionToken(rawToken),
  userId: '018f47a1-3d11-7c14-a8bf-0242ac120002',
};
const loginResult: LoginResult = {
  expiresAt: '2026-08-19T12:00:00.000Z',
  sessionToken: rawToken,
  user: { id: session.userId, name: 'Test User', role: 'BALCONISTA' },
};
const meResult: MeResult = {
  email: 'user@example.test',
  id: session.userId,
  joinedOn: '2026-08-01',
  name: 'Test User',
  role: 'BALCONISTA',
  status: 'ATIVO',
};

class FakeAuthenticationService implements AuthenticationService {
  public loginError: Error | null = null;
  public logoutCalled = false;

  public authenticateSession(token: string): Promise<AuthenticatedSession> {
    if (token !== rawToken) {
      return Promise.reject(new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.'));
    }
    return Promise.resolve(session);
  }

  public getMe(): Promise<MeResult> {
    return Promise.resolve(meResult);
  }

  public loginWithGoogle(): Promise<LoginResult> {
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

await test('auth routes reject unknown authority fields', async () => {
  const app = createApp({ authenticationService: new FakeAuthenticationService(), logger });
  for (const field of ['role', 'storeId']) {
    await request(app)
      .post('/v1/auth/google')
      .send({ idToken: 'x'.repeat(20), [field]: 'attacker-controlled' })
      .expect(422);
  }
});

await test('Google login returns the minimal contract and does not log tokens', async () => {
  logEntries.length = 0;
  const app = createApp({ authenticationService: new FakeAuthenticationService(), logger });
  const response = await request(app)
    .post('/v1/auth/google')
    .send({ idToken: 'google-id-token-not-logged' })
    .expect(200);
  assert.deepEqual(parseJson<LoginResult>(response.text), loginResult);
  assert.doesNotMatch(JSON.stringify(logEntries), /google-id-token|a{43}/u);
});

await test('invalid Google tokens use a controlled 401 response', async () => {
  const service = new FakeAuthenticationService();
  service.loginError = new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Token inválido.');
  const response = await request(createApp({ authenticationService: service, logger }))
    .post('/v1/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(401);
  assert.equal(parseJson<{ code: string }>(response.text).code, 'INVALID_GOOGLE_TOKEN');
});

await test('GET /v1/me requires Bearer and returns only the profile DTO', async () => {
  const app = createApp({ authenticationService: new FakeAuthenticationService(), logger });
  await request(app).get('/v1/me').expect(401);
  const response = await request(app)
    .get('/v1/me')
    .set('Authorization', `Bearer ${rawToken}`)
    .expect(200);
  const body = parseJson<MeResult>(response.text);
  assert.deepEqual(body, meResult);
  assert.equal('providerSubject' in body, false);
  assert.equal('tokenHash' in body, false);
});

await test('logout authenticates and returns 204', async () => {
  const service = new FakeAuthenticationService();
  await request(createApp({ authenticationService: service, logger }))
    .post('/v1/auth/logout')
    .set('Authorization', `Bearer ${rawToken}`)
    .expect(204);
  assert.equal(service.logoutCalled, true);
});

await test('Google login applies its dedicated rate limit', async () => {
  const app = createApp({
    authRateLimit: { limit: 1, windowMs: 60_000 },
    authenticationService: new FakeAuthenticationService(),
    logger,
  });
  await request(app)
    .post('/v1/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(200);
  const response = await request(app)
    .post('/v1/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(429);
  assert.equal(parseJson<{ code: string }>(response.text).code, 'TOO_MANY_REQUESTS');
});
