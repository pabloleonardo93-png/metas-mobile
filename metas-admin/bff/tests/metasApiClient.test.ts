import { describe, expect, it, vi } from 'vitest';

import type { AdminBffConfig } from '../src/config.js';
import { BffError } from '../src/errors.js';
import { createMetasApiClient } from '../src/upstream/metasApiClient.js';

const config: AdminBffConfig = {
  apiBaseUrl: 'https://api.example.test',
  apiTimeoutMs: 1_000,
  csrfCookieName: '__Host-metas-admin-csrf',
  csrfSecret: 'test-csrf-secret-with-at-least-thirty-two-characters',
  expectedHost: 'admin.example.test',
  isProduction: true,
  nodeEnvironment: 'test',
  port: 4_174,
  publicOrigin: 'https://admin.example.test',
  sessionCookieName: '__Host-metas-admin-session',
};

describe('server-side Metas API client', () => {
  it('sends bearer and request ID only from the server to an explicit route', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const client = createMetasApiClient(config, fetchMock);
    await client.request({
      method: 'GET',
      path: '/v1/platform-admin/me',
      requestId: 'request-id',
      sessionToken: 'opaque-session-token',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.test/v1/platform-admin/me');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer opaque-session-token');
    expect(headers.get('x-request-id')).toBe('request-id');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps network and timeout failures without leaking the internal URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new Error('api.internal:5432')));
    const client = createMetasApiClient(config, fetchMock);

    await expect(
      client.request({
        method: 'GET',
        path: '/v1/platform-admin/me',
        requestId: 'request-id',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Serviço temporariamente indisponível.',
        statusCode: 503,
      }),
    );
  });

  it('does not forward detailed upstream errors to the browser boundary', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'INTERNAL_DATABASE_FAILURE',
            message: 'password=secret host=private.internal',
          }),
          { status: 500 },
        ),
      ),
    );
    const client = createMetasApiClient(config, fetchMock);

    try {
      await client.request({
        method: 'GET',
        path: '/v1/platform-admin/me',
        requestId: 'request-id',
      });
      throw new Error('Expected request to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(BffError);
      expect(error).toEqual(
        expect.objectContaining({
          code: 'UPSTREAM_REQUEST_FAILED',
          message: 'Não foi possível concluir a operação.',
        }),
      );
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('private.internal');
    }
  });

  it('maps a safe integer Retry-After from the API', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'TOO_MANY_REQUESTS' }), {
          headers: { 'retry-after': '17' },
          status: 429,
        }),
      ),
    );
    const client = createMetasApiClient(config, fetchMock);

    await expect(
      client.request({
        method: 'POST',
        path: '/v1/platform-admin/mfa/first-enrollment/request',
        requestId: 'request-id',
        sessionToken: 'opaque-session-token',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'TOO_MANY_REQUESTS',
        retryAfterSeconds: 17,
        statusCode: 429,
      }),
    );
  });
});
