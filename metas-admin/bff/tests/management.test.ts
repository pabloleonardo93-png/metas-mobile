import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AdminBffConfig } from '../src/config.js';
import { createMetasApiClient } from '../src/upstream/metasApiClient.js';
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
const cookie = config.sessionCookieName + '=' + 'a'.repeat(64);
describe('gestão no BFF', () => {
  it('exige cookie e valida filtros antes do upstream', async () => {
    const upstream = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const app = createApp({ config, client: { request: upstream }, staticDirectory: null });
    expect(
      (await request(app).get('/api/management/pharmacies').set('host', config.expectedHost))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/management/employees?role=ROOT')
          .set('host', config.expectedHost)
          .set('cookie', cookie)
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .get('/api/management/pharmacies?unexpected=true')
          .set('host', config.expectedHost)
          .set('cookie', cookie)
      ).status,
    ).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
    expect(
      (
        await request(app)
          .get('/api/management/employees?q=Pessoa&role=GESTOR')
          .set('host', config.expectedHost)
          .set('cookie', cookie)
      ).status,
    ).toBe(200);
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', sessionToken: 'a'.repeat(64) }),
    );
  });
  it.each(['pharmacies', 'employees'] as const)(
    'aceita os filtros iniciais do frontend para %s e preserva o contrato upstream',
    async (resource) => {
      const upstream = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      const app = createApp({ config, client: { request: upstream }, staticDirectory: null });

      const response = await request(app)
        .get(`/api/management/${resource}?page=1&pageSize=20&q=&status=ALL&role=ALL`)
        .set('host', config.expectedHost)
        .set('cookie', cookie);

      expect(response.status).toBe(200);
      expect(upstream).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: `/v1/platform-admin/management/${resource}?q=&status=ALL&role=ALL&page=1&pageSize=20`,
        }),
      );
    },
  );
  it('mutações exigem CSRF e Origin, preservando token somente no servidor', async () => {
    const upstream = vi.fn().mockResolvedValue({ id, sessionToken: 'must-not-leak' });
    const app = createApp({ config, client: { request: upstream }, staticDirectory: null });
    const body = {
      name: 'Farmácia Teste',
      slug: 'teste',
      timezone: 'America/Sao_Paulo',
      isActive: true,
    };
    const denied = await request(app)
      .post('/api/management/pharmacies')
      .set('host', config.expectedHost)
      .set('cookie', cookie)
      .set('origin', config.publicOrigin)
      .send(body);
    expect(denied.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    const csrf = await request(app)
      .get('/api/security/csrf')
      .set('host', config.expectedHost)
      .set('cookie', cookie);
    const token = (JSON.parse(csrf.text) as { csrfToken: string }).csrfToken;
    const setCookies = csrf.headers['set-cookie'] as unknown as string[];
    const csrfCookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    const response = await request(app)
      .post('/api/management/pharmacies')
      .set('host', config.expectedHost)
      .set('cookie', cookie + '; ' + csrfCookie)
      .set('origin', config.publicOrigin)
      .set('x-csrf-token', token)
      .send(body);
    expect(response.status).toBe(201);
    expect(JSON.parse(response.text)).toEqual({ id });
    expect(response.text).not.toContain('must-not-leak');
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/v1/platform-admin/management/pharmacies', body }),
    );

    const employee = {
      name: 'Pessoa Teste',
      email: 'pessoa@example.test',
      storeId: id,
      role: 'GESTOR',
    };
    const employeeResponse = await request(app)
      .post('/api/management/employees')
      .set('host', config.expectedHost)
      .set('cookie', cookie + '; ' + csrfCookie)
      .set('origin', config.publicOrigin)
      .set('x-csrf-token', token)
      .send(employee);
    expect(employeeResponse.status).toBe(201);
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/platform-admin/management/employees',
        body: employee,
      }),
    );

    for (const invalid of [
      { ...employee, role: 'ROOT' },
      { ...employee, email: 'invalido' },
      { ...employee, unexpected: true },
    ]) {
      expect(
        (
          await request(app)
            .post('/api/management/employees')
            .set('host', config.expectedHost)
            .set('cookie', cookie + '; ' + csrfCookie)
            .set('origin', config.publicOrigin)
            .set('x-csrf-token', token)
            .send(invalid)
        ).status,
      ).toBe(422);
    }
  });
  it('rejeita resposta inesperada e sanitiza erro de domínio e mensagem upstream', async () => {
    const app = createApp({
      config,
      client: { request: () => Promise.resolve({ secret: 'must-not-leak' }) },
      staticDirectory: null,
    });
    const invalid = await request(app)
      .get('/api/management/pharmacies')
      .set('host', config.expectedHost)
      .set('cookie', cookie);
    expect(invalid.status).toBe(502);
    expect(invalid.text).not.toContain('must-not-leak');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'LAST_ACTIVE_MANAGER_REQUIRED',
          message: 'secret driver message',
        }),
        { status: 409 },
      ),
    );
    const client = createMetasApiClient(config, fetchMock);
    await expect(
      client.request({
        method: 'POST',
        path: `/v1/platform-admin/management/employees/${id}`,
        requestId: id,
        sessionToken: 'synthetic',
      }),
    ).rejects.toMatchObject({
      code: 'LAST_ACTIVE_MANAGER_REQUIRED',
      message: 'A farmácia precisa manter ao menos um gestor ativo.',
    });
  });
});
