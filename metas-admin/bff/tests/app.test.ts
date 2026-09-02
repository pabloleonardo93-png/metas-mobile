import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp, type BffLogger } from '../src/app.js';
import type { AdminBffConfig } from '../src/config.js';
import { BffError } from '../src/errors.js';
import type { MetasApiClient, MetasApiRequest } from '../src/upstream/metasApiClient.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_TOKEN = 'a'.repeat(64);
const ROTATED_TOKEN = 'b'.repeat(64);
const config: AdminBffConfig = {
  apiBaseUrl: 'https://api.example.test',
  apiTimeoutMs: 8_000,
  csrfCookieName: '__Host-metas-admin-csrf',
  csrfSecret: 'test-csrf-secret-with-at-least-thirty-two-characters',
  expectedHost: 'admin.example.test',
  isProduction: true,
  nodeEnvironment: 'test',
  port: 4_174,
  publicOrigin: 'https://admin.example.test',
  sessionCookieName: '__Host-metas-admin-session',
};

const logger: BffLogger = { error: vi.fn(), info: vi.fn() };

const createClient = (implementation?: (input: MetasApiRequest) => Promise<unknown>) => {
  const requestMock = vi.fn(implementation ?? (() => Promise.resolve(null)));
  return { client: { request: requestMock } satisfies MetasApiClient, requestMock };
};

const cookieHeader = (response: request.Response): string => {
  const values: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : typeof values === 'string'
      ? [values]
      : [];
  return cookies.map((value) => value.split(';')[0]).join('; ');
};

const setCookieHeaders = (response: request.Response): string[] => {
  const values: unknown = response.headers['set-cookie'];
  if (Array.isArray(values))
    return values.filter((value): value is string => typeof value === 'string');
  return typeof values === 'string' ? [values] : [];
};

const bodyFrom = <Body>(response: request.Response): Body => {
  const parsed: unknown = JSON.parse(response.text);
  return parsed as Body;
};

const csrfTokenFrom = (response: request.Response): string =>
  bodyFrom<{ csrfToken: string }>(response).csrfToken;

const establishCsrf = async (app: ReturnType<typeof createApp>, sessionToken?: string) => {
  const response = await request(app)
    .get('/api/security/csrf')
    .set('host', config.expectedHost)
    .set('cookie', sessionToken ? `${config.sessionCookieName}=${sessionToken}` : '');
  expect(response.status).toBe(200);
  return { cookie: cookieHeader(response), token: csrfTokenFrom(response) };
};

const postMutation = (
  app: ReturnType<typeof createApp>,
  path: string,
  csrf: { cookie: string; token: string },
  body: object,
  sessionToken?: string,
) =>
  request(app)
    .post(path)
    .set('host', config.expectedHost)
    .set('origin', config.publicOrigin)
    .set('content-type', 'application/json')
    .set('x-csrf-token', csrf.token)
    .set(
      'cookie',
      [csrf.cookie, sessionToken ? `${config.sessionCookieName}=${sessionToken}` : '']
        .filter(Boolean)
        .join('; '),
    )
    .send(body);

describe('Admin BFF security boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues an anonymous signed CSRF token with hardened headers', async () => {
    const { client } = createClient();
    const app = createApp({ client, config, logger, staticDirectory: null });
    const response = await request(app).get('/api/security/csrf').set('host', config.expectedHost);

    expect(response.status).toBe(200);
    expect(bodyFrom<{ csrfToken: string }>(response).csrfToken).toMatch(/^anonymous\./u);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['permissions-policy']).toContain('publickey-credentials-get=(self)');
    const cookies = setCookieHeaders(response);
    expect(cookies[0]).toContain('__Host-metas-admin-csrf=');
    expect(cookies[0]).toContain('Secure');
    expect(cookies[0]).not.toContain('Domain=');
  });

  it('rejects untrusted Host and exact Origin mismatches', async () => {
    const { client } = createClient();
    const app = createApp({ client, config, logger, staticDirectory: null });
    expect(
      (await request(app).get('/api/security/csrf').set('host', 'evil.example.test')).status,
    ).toBe(403);

    const csrf = await establishCsrf(app);
    const response = await request(app)
      .post('/api/auth/google')
      .set('host', config.expectedHost)
      .set('origin', 'https://admin.example.test.evil.invalid')
      .set('content-type', 'application/json')
      .set('x-csrf-token', csrf.token)
      .set('cookie', csrf.cookie)
      .send({ credential: 'c'.repeat(40) });
    expect(response.status).toBe(403);
    expect(bodyFrom<{ code: string }>(response).code).toBe('UNTRUSTED_ORIGIN');
  });

  it('protects login with CSRF and keeps the API bearer out of the response', async () => {
    const { client, requestMock } = createClient(() =>
      Promise.resolve({
        admin: {
          assuranceLevel: 'GOOGLE_ONLY',
          displayName: 'Admin Teste',
          id: ADMIN_ID,
          primaryEmail: 'admin@example.test',
        },
        expiresAt: '2026-09-01T12:00:00.000Z',
        sessionToken: SESSION_TOKEN,
      }),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const csrf = await establishCsrf(app);
    const response = await postMutation(app, '/api/auth/google', csrf, {
      credential: 'google-id-token-that-is-never-returned',
    });

    expect(response.status).toBe(200);
    const body = bodyFrom<{ csrfToken: string }>(response);
    expect(body).not.toHaveProperty('sessionToken');
    expect(JSON.stringify(body)).not.toContain(SESSION_TOKEN);
    expect(body).not.toHaveProperty('admin.id');
    expect(body.csrfToken).toMatch(/^session\./u);
    expect(setCookieHeaders(response).join(';')).toContain(
      `__Host-metas-admin-session=${SESSION_TOKEN}`,
    );
    expect(setCookieHeaders(response).join(';')).toContain('HttpOnly');
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { idToken: 'google-id-token-that-is-never-returned' },
        path: '/v1/platform-admin/auth/google',
      }),
    );
  });

  it('rejects missing CSRF, unexpected fields and non-JSON mutations', async () => {
    const { client, requestMock } = createClient();
    const app = createApp({ client, config, logger, staticDirectory: null });
    const missingCsrf = await request(app)
      .post('/api/auth/google')
      .set('host', config.expectedHost)
      .set('origin', config.publicOrigin)
      .set('content-type', 'application/json')
      .send({ credential: 'c'.repeat(40) });
    expect(missingCsrf.status).toBe(403);

    const csrf = await establishCsrf(app);
    const wrongCsrf = await request(app)
      .post('/api/auth/google')
      .set('host', config.expectedHost)
      .set('origin', config.publicOrigin)
      .set('content-type', 'application/json')
      .set('x-csrf-token', 'wrong-token')
      .set('cookie', csrf.cookie)
      .send({ credential: 'c'.repeat(40) });
    expect(wrongCsrf.status).toBe(403);

    const massAssignment = await postMutation(app, '/api/auth/google', csrf, {
      credential: 'c'.repeat(40),
      platformAdminId: ADMIN_ID,
    });
    expect(massAssignment.status).toBe(422);

    const invalidMedia = await request(app)
      .post('/api/auth/google')
      .set('host', config.expectedHost)
      .set('origin', config.publicOrigin)
      .set('content-type', 'text/plain')
      .send('credential=value');
    expect(invalidMedia.status).toBe(415);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized JSON without leaking parser details', async () => {
    const { client } = createClient();
    const app = createApp({ client, config, logger, staticDirectory: null });
    const csrf = await establishCsrf(app);
    const headers = {
      cookie: csrf.cookie,
      host: config.expectedHost,
      origin: config.publicOrigin,
      'x-csrf-token': csrf.token,
    };
    const malformed = await request(app)
      .post('/api/auth/google')
      .set(headers)
      .set('content-type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(bodyFrom<{ code: string }>(malformed).code).toBe('INVALID_JSON');

    const oversized = await request(app)
      .post('/api/auth/google')
      .set(headers)
      .set('content-type', 'application/json')
      .send({ credential: 'x'.repeat(140_000) });
    expect(oversized.status).toBe(413);
    expect(bodyFrom<{ code: string }>(oversized).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('forwards the server-side session only to explicit upstream routes', async () => {
    const { client, requestMock } = createClient(() =>
      Promise.resolve({
        assuranceLevel: 'MFA_VERIFIED',
        displayName: 'Admin Teste',
        hasWebAuthnCredential: true,
        id: ADMIN_ID,
        primaryEmail: 'admin@example.test',
        status: 'ACTIVE',
      }),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const me = await request(app)
      .get('/api/auth/me')
      .set('host', config.expectedHost)
      .set('cookie', `${config.sessionCookieName}=${SESSION_TOKEN}`);
    expect(me.status).toBe(200);
    expect(bodyFrom<unknown>(me)).toEqual({
      assuranceLevel: 'MFA_VERIFIED',
      displayName: 'Admin Teste',
      hasWebAuthnCredential: true,
      primaryEmail: 'admin@example.test',
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/platform-admin/me',
        sessionToken: SESSION_TOKEN,
      }),
    );
    expect(
      (await request(app).get('/api/arbitrary-proxy').set('host', config.expectedHost)).status,
    ).toBe(404);
  });

  it('forwards only a CSRF-protected first enrollment request and returns minimal status', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    const { client, requestMock } = createClient(() =>
      Promise.resolve({
        approvalExpiresAt: null,
        expiresAt: '2026-09-01T12:15:00.000Z',
        requestId,
        status: 'PENDING',
      }),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const csrf = await establishCsrf(app, SESSION_TOKEN);
    const response = await postMutation(
      app,
      '/api/mfa/first-enrollment/request',
      csrf,
      {},
      SESSION_TOKEN,
    );

    expect(response.status).toBe(202);
    expect(bodyFrom<unknown>(response)).toEqual({
      approvalExpiresAt: null,
      expiresAt: '2026-09-01T12:15:00.000Z',
      requestId,
      status: 'PENDING',
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {},
        path: '/v1/platform-admin/mfa/first-enrollment/request',
        sessionToken: SESSION_TOKEN,
      }),
    );
    const massAssignment = await postMutation(
      app,
      '/api/mfa/first-enrollment/request',
      csrf,
      { platformAdminId: ADMIN_ID },
      SESSION_TOKEN,
    );
    expect(massAssignment.status).toBe(422);
  });

  it('rotates the HttpOnly cookie after WebAuthn without returning the bearer', async () => {
    const { client } = createClient(() =>
      Promise.resolve({
        assuranceLevel: 'MFA_VERIFIED',
        mfaVerifiedAt: '2026-09-01T10:00:00.000Z',
        sessionToken: ROTATED_TOKEN,
        stepUpVerifiedAt: '2026-09-01T10:00:00.000Z',
      }),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const csrf = await establishCsrf(app, SESSION_TOKEN);
    const response = await postMutation(
      app,
      '/api/mfa/webauthn/authentication/verify',
      csrf,
      {
        challengeId: CHALLENGE_ID,
        response: {
          clientExtensionResults: {},
          id: 'credential',
          rawId: 'credential',
          response: {
            authenticatorData: 'data',
            clientDataJSON: 'client',
            signature: 'signature',
          },
          type: 'public-key',
        },
      },
      SESSION_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(bodyFrom<unknown>(response))).not.toContain(ROTATED_TOKEN);
    expect(setCookieHeaders(response).join(';')).toContain(
      `__Host-metas-admin-session=${ROTATED_TOKEN}`,
    );
    expect(setCookieHeaders(response).join(';')).not.toContain(
      `__Host-metas-admin-session=${SESSION_TOKEN}`,
    );
  });

  it('binds a CSRF token to the current session cookie', async () => {
    const { client, requestMock } = createClient();
    const app = createApp({ client, config, logger, staticDirectory: null });
    const anonymousCsrf = await establishCsrf(app);
    const response = await postMutation(app, '/api/auth/logout', anonymousCsrf, {}, SESSION_TOKEN);
    expect(response.status).toBe(403);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('revokes upstream logout, clears the bearer cookie and returns only a fresh CSRF token', async () => {
    const { client, requestMock } = createClient();
    const app = createApp({ client, config, logger, staticDirectory: null });
    const csrf = await establishCsrf(app, SESSION_TOKEN);
    const response = await postMutation(app, '/api/auth/logout', csrf, {}, SESSION_TOKEN);

    expect(response.status).toBe(200);
    expect(bodyFrom<{ csrfToken: string }>(response).csrfToken).toMatch(/^anonymous\./u);
    expect(setCookieHeaders(response).join(';')).toContain(
      '__Host-metas-admin-session=; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0',
    );
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/platform-admin/auth/logout',
        sessionToken: SESSION_TOKEN,
      }),
    );
  });

  it('clears an expired session cookie after /me and treats revoked logout as complete', async () => {
    const { client } = createClient(() =>
      Promise.reject(new BffError(401, 'UNAUTHORIZED', 'Sua sessão expirou. Entre novamente.')),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const me = await request(app)
      .get('/api/auth/me')
      .set('host', config.expectedHost)
      .set('cookie', `${config.sessionCookieName}=${SESSION_TOKEN}`);
    expect(me.status).toBe(401);
    expect(setCookieHeaders(me).join(';')).toContain(
      '__Host-metas-admin-session=; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0',
    );

    const csrf = await establishCsrf(app, SESSION_TOKEN);
    const logout = await postMutation(app, '/api/auth/logout', csrf, {}, SESSION_TOKEN);
    expect(logout.status).toBe(200);
    expect(setCookieHeaders(logout).join(';')).toContain('Max-Age=0');
  });

  it('maps internal upstream errors to a sanitized response', async () => {
    const { client } = createClient(() =>
      Promise.reject(
        new BffError(502, 'UPSTREAM_REQUEST_FAILED', 'Não foi possível concluir a operação.'),
      ),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const response = await request(app)
      .get('/api/auth/me')
      .set('host', config.expectedHost)
      .set('cookie', `${config.sessionCookieName}=${SESSION_TOKEN}`);
    expect(response.status).toBe(502);
    expect(bodyFrom<unknown>(response)).toEqual(
      expect.objectContaining({
        code: 'UPSTREAM_REQUEST_FAILED',
        message: 'Não foi possível concluir a operação.',
      }),
    );
  });

  it('preserves a bounded Retry-After without exposing limiter internals', async () => {
    const { client } = createClient(() =>
      Promise.reject(new BffError(429, 'TOO_MANY_REQUESTS', 'Aguarde antes de tentar.', 42)),
    );
    const app = createApp({ client, config, logger, staticDirectory: null });
    const response = await request(app)
      .get('/api/auth/me')
      .set('host', config.expectedHost)
      .set('cookie', `${config.sessionCookieName}=${SESSION_TOKEN}`);
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
    expect(response.text).not.toContain('redis');
  });
});
