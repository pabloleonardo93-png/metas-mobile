import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { AdminBffConfig } from '../src/config.js';

const id = '11111111-1111-4111-8111-111111111111';
const config: AdminBffConfig = {
  apiBaseUrl: 'https://api.example.test',
  apiTimeoutMs: 1000,
  csrfCookieName: '__Host-metas-admin-csrf',
  csrfSecret: 'synthetic-secret-at-least-thirty-two-characters',
  expectedHost: 'admin.example.test',
  isProduction: true,
  nodeEnvironment: 'test',
  port: 4174,
  publicOrigin: 'https://admin.example.test',
  sessionCookieName: '__Host-metas-admin-session',
};
const sessionCookie = config.sessionCookieName + '=' + 'a'.repeat(64);

const csrf = async (
  app: ReturnType<typeof createApp>,
): Promise<{ cookie: string; token: string }> => {
  const response = await request(app)
    .get('/api/security/csrf')
    .set('host', config.expectedHost)
    .set('cookie', sessionCookie);
  const setCookies = response.headers['set-cookie'] as unknown as string[];
  return {
    cookie: sessionCookie + '; ' + setCookies.map((value) => value.split(';')[0]).join('; '),
    token: (JSON.parse(response.text) as { csrfToken: string }).csrfToken,
  };
};

describe('acessos de administradores no BFF', () => {
  it('lista apenas com sessão e projeta a resposta segura do upstream', async () => {
    const upstream = vi.fn().mockResolvedValue({
      items: [
        {
          id,
          displayName: 'Admin Teste',
          email: 'admin@example.test',
          status: 'ACTIVE',
          invitationId: null,
          enrollmentRequestId: null,
          lastAccessAt: null,
          secret: 'must-not-leak',
        },
      ],
      secret: 'must-not-leak',
    });
    const app = createApp({ config, client: { request: upstream }, staticDirectory: null });
    expect(
      (await request(app).get('/api/administrators').set('host', config.expectedHost)).status,
    ).toBe(401);

    const response = await request(app)
      .get('/api/administrators')
      .set('host', config.expectedHost)
      .set('cookie', sessionCookie);
    expect(response.status).toBe(502);
    expect(response.text).not.toContain('must-not-leak');

    upstream.mockResolvedValueOnce({ items: [] });
    expect(
      (
        await request(app)
          .get('/api/administrators')
          .set('host', config.expectedHost)
          .set('cookie', sessionCookie)
      ).status,
    ).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/v1/platform-admin/administrators',
        sessionToken: 'a'.repeat(64),
      }),
    );
  });

  it('cria convite com CSRF, normaliza campos e rejeita mass assignment', async () => {
    const upstream = vi.fn().mockResolvedValue({ id });
    const app = createApp({ config, client: { request: upstream }, staticDirectory: null });
    const body = { displayName: '  Nova Admin  ', email: 'NOVA@EXAMPLE.TEST' };

    expect(
      (
        await request(app)
          .post('/api/administrators')
          .set('host', config.expectedHost)
          .set('origin', config.publicOrigin)
          .set('cookie', sessionCookie)
          .send(body)
      ).status,
    ).toBe(403);
    const authority = await csrf(app);
    const response = await request(app)
      .post('/api/administrators')
      .set('host', config.expectedHost)
      .set('origin', config.publicOrigin)
      .set('cookie', authority.cookie)
      .set('x-csrf-token', authority.token)
      .send(body);
    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: { displayName: 'Nova Admin', email: 'nova@example.test' },
        method: 'POST',
        path: '/v1/platform-admin/administrators',
      }),
    );

    const invalid = await request(app)
      .post('/api/administrators')
      .set('host', config.expectedHost)
      .set('origin', config.publicOrigin)
      .set('cookie', authority.cookie)
      .set('x-csrf-token', authority.token)
      .send({ ...body, role: 'SUPERUSER' });
    expect(invalid.status).toBe(422);
  });

  it('encaminha cancelamento e aprovação sem aceitar corpo ou identificador arbitrário', async () => {
    const upstream = vi.fn().mockResolvedValue({ id });
    const app = createApp({ config, client: { request: upstream }, staticDirectory: null });
    const authority = await csrf(app);
    const post = (path: string, body: object = {}) =>
      request(app)
        .post(path)
        .set('host', config.expectedHost)
        .set('origin', config.publicOrigin)
        .set('cookie', authority.cookie)
        .set('x-csrf-token', authority.token)
        .send(body);

    expect((await post(`/api/administrators/${id}/cancel`)).status).toBe(200);
    expect((await post(`/api/administrators/first-enrollment/${id}/approve`)).status).toBe(200);
    expect((await post('/api/administrators/not-a-uuid/cancel')).status).toBe(422);
    expect((await post(`/api/administrators/${id}/cancel`, { role: 'ROOT' })).status).toBe(422);
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/v1/platform-admin/administrators/${id}/cancel`, body: {} }),
    );
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/v1/platform-admin/administrators/first-enrollment/${id}/approve`,
        body: {},
      }),
    );
  });
});
