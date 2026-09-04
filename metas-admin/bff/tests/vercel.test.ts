import { readFileSync } from 'node:fs';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createVercelApp } from '../src/vercel.js';

const environment = {
  METAS_ADMIN_CSRF_SECRET: 'a-secure-test-secret-with-at-least-32-chars',
  METAS_ADMIN_EXPECTED_HOST: 'project-name.vercel.app',
  METAS_ADMIN_PUBLIC_ORIGIN: 'https://project-name.vercel.app',
  METAS_API_BASE_URL: 'https://api.example.test',
  NODE_ENV: 'production',
};

const deploymentRoot = path.resolve(import.meta.dirname, '../..');

describe('Vercel deployment adapter', () => {
  it('creates the Express handler without opening a local listener', async () => {
    const listen = vi.spyOn(express.application, 'listen');
    const app = createVercelApp(environment);

    expect(listen).not.toHaveBeenCalled();
    expect(app.get('trust proxy')).toBe(false);
    const response = await request(app)
      .get('/api/security/csrf')
      .set('host', 'project-name.vercel.app');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    listen.mockRestore();
  });

  it('keeps API routes out of the SPA fallback and uses only same-application rewrites', () => {
    const configuration = JSON.parse(
      readFileSync(path.join(deploymentRoot, 'vercel.json'), 'utf8'),
    ) as {
      headers: Array<{ headers: Array<{ key: string; value: string }>; source: string }>;
      rewrites: Array<{ destination: string; source: string }>;
    };

    expect(configuration.rewrites).toEqual([
      { destination: '/index.html', source: '/((?!api(?:/|$)|assets(?:/|$)).*)' },
    ]);
    expect(configuration.rewrites.every(({ destination }) => !destination.startsWith('http'))).toBe(
      true,
    );
    const spaFallback = new RegExp(`^${configuration.rewrites[0]?.source ?? ''}$`, 'u');
    expect(spaFallback.test('/dashboard')).toBe(true);
    expect(spaFallback.test('/api/auth/me')).toBe(false);
    expect(spaFallback.test('/assets/index.js')).toBe(false);
    const apiHeaders = configuration.headers.find(({ source }) => source === '/api/(.*)');
    expect(apiHeaders?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
  });

  it('publishes a restrictive CSP for the static SPA', () => {
    const configuration = JSON.parse(
      readFileSync(path.join(deploymentRoot, 'vercel.json'), 'utf8'),
    ) as {
      headers: Array<{ headers: Array<{ key: string; value: string }>; source: string }>;
    };
    const spaHeaders = configuration.headers.find(({ headers }) =>
      headers.some(({ key }) => key === 'Content-Security-Policy'),
    );
    const csp = spaHeaders?.headers.find(({ key }) => key === 'Content-Security-Policy')?.value;

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://accounts.google.com/gsi/client');
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/(?:^|\s)\*(?:;|\s|$)/u);
  });
});
