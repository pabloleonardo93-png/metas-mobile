import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminApi, resetAdminApiStateForTests } from './adminApi';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

describe('adminApi browser boundary', () => {
  beforeEach(() => {
    resetAdminApiStateForTests();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('sends the Google credential only to the BFF and never exposes a bearer', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'anonymous.csrf' }))
      .mockResolvedValueOnce(
        jsonResponse({
          admin: {
            assuranceLevel: 'GOOGLE_ONLY',
            displayName: 'Admin',
            primaryEmail: 'admin@example.test',
          },
          csrfToken: 'session.csrf',
          expiresAt: '2026-09-01T12:00:00.000Z',
        }),
      );

    await adminApi.loginWithGoogle('google-id-token-for-admin-login');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/google',
      expect.objectContaining({
        body: JSON.stringify({ credential: 'google-id-token-for-admin-login' }),
        credentials: 'same-origin',
        method: 'POST',
      }),
    );
    const requestHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(requestHeaders.authorization).toBeUndefined();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it('refreshes an expired CSRF token once without retrying unrelated failures', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'first' }))
      .mockResolvedValueOnce(
        jsonResponse({ code: 'CSRF_VALIDATION_FAILED', message: 'expired' }, 403),
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'second' }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'anonymous.after.logout' }));

    await adminApi.logout();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
