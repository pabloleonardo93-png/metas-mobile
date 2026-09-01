import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const baseEnvironment = {
  METAS_ADMIN_CSRF_SECRET: 'a-secure-test-secret-with-at-least-32-chars',
  METAS_ADMIN_EXPECTED_HOST: 'admin.example.test',
  METAS_ADMIN_PUBLIC_ORIGIN: 'https://admin.example.test',
  METAS_API_BASE_URL: 'https://api.example.test',
  NODE_ENV: 'production',
};

describe('BFF configuration', () => {
  it('uses __Host cookies and HTTPS in production', () => {
    const config = loadConfig(baseEnvironment);
    expect(config.sessionCookieName).toBe('__Host-metas-admin-session');
    expect(config.csrfCookieName).toBe('__Host-metas-admin-csrf');
    expect(config.isProduction).toBe(true);
  });

  it('fails closed when Host differs from the trusted Origin', () => {
    expect(() =>
      loadConfig({ ...baseEnvironment, METAS_ADMIN_EXPECTED_HOST: 'evil.example.test' }),
    ).toThrow(/corresponder exatamente/u);
  });

  it('fails closed for HTTP origins in production', () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        METAS_ADMIN_EXPECTED_HOST: 'localhost:5173',
        METAS_ADMIN_PUBLIC_ORIGIN: 'http://localhost:5173',
      }),
    ).toThrow(/HTTPS/u);
  });

  it('requires a sufficiently strong CSRF secret', () => {
    expect(() => loadConfig({ ...baseEnvironment, METAS_ADMIN_CSRF_SECRET: 'short' })).toThrow();
  });

  it('uses distinct non-Secure cookie names for local HTTP development', () => {
    const config = loadConfig({
      ...baseEnvironment,
      METAS_ADMIN_EXPECTED_HOST: 'localhost:5173',
      METAS_ADMIN_PUBLIC_ORIGIN: 'http://localhost:5173',
      METAS_API_BASE_URL: 'http://127.0.0.1:3000',
      NODE_ENV: 'development',
    });
    expect(config.sessionCookieName).toBe('metas-admin-session-dev');
    expect(config.csrfCookieName).toBe('metas-admin-csrf-dev');
    expect(config.isProduction).toBe(false);
  });
});
