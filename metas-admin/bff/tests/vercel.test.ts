import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createVercelApp, createVercelHandler } from '../src/vercel.js';

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

  it('restores nested read paths from the explicit Vercel rewrite', async () => {
    const handler = createVercelHandler(environment);
    const csrf = await request(handler)
      .get('/api/index?path=security%2Fcsrf')
      .set('host', 'project-name.vercel.app');
    expect(csrf.status).toBe(200);
    expect(csrf.headers['cache-control']).toBe('no-store');

    const authenticatedRoute = await request(handler)
      .get('/api/index?path=auth%2Fme')
      .set('host', 'project-name.vercel.app');
    expect(authenticatedRoute.status).toBe(401);
    expect(authenticatedRoute.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it.each([
    'auth/google',
    'auth/logout',
    'mfa/first-enrollment/request',
    'mfa/recovery/request',
    'mfa/recovery/webauthn/options',
    'mfa/recovery/webauthn/verify',
    'mfa/webauthn/registration/options',
    'mfa/webauthn/registration/verify',
    'mfa/webauthn/authentication/options',
    'mfa/webauthn/authentication/verify',
  ])('preserves the nested mutation route /api/%s', async (routePath) => {
    const response = await request(createVercelHandler(environment))
      .post(`/api/index?path=${encodeURIComponent(routePath)}`)
      .set('content-type', 'application/json')
      .set('host', 'project-name.vercel.app')
      .set('origin', 'https://project-name.vercel.app')
      .send({});
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
  });

  it('returns the BFF JSON 404 for an unknown rewritten API route', async () => {
    const response = await request(createVercelHandler(environment))
      .get('/api/index?path=rota-inexistente')
      .set('host', 'project-name.vercel.app');

    expect(response.status).toBe(404);
    expect(response.type).toBe('application/json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.text).not.toContain('<html');

    const ambiguousPath = await request(createVercelHandler(environment))
      .get('/api/index?path=auth%2Fme&path=security%2Fcsrf')
      .set('host', 'project-name.vercel.app');
    expect(ambiguousPath.status).toBe(404);
    expect(ambiguousPath.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('preserves exact Host and Origin validation after the rewrite', async () => {
    const handler = createVercelHandler(environment);
    const spoofedHost = await request(handler)
      .get('/api/index?path=security%2Fcsrf')
      .set('host', 'attacker.example.test')
      .set('x-forwarded-host', 'project-name.vercel.app');
    expect(spoofedHost.status).toBe(403);
    expect(spoofedHost.body).toMatchObject({ code: 'UNTRUSTED_HOST' });

    const untrustedOrigin = await request(handler)
      .post('/api/index?path=auth%2Flogout')
      .set('content-type', 'application/json')
      .set('host', 'project-name.vercel.app')
      .set('origin', 'https://attacker.example.test')
      .send({});
    expect(untrustedOrigin.status).toBe(403);
    expect(untrustedOrigin.body).toMatchObject({ code: 'UNTRUSTED_ORIGIN' });
  });

  it('keeps API routes out of the SPA fallback and uses only same-application rewrites', () => {
    const configuration = JSON.parse(
      readFileSync(path.join(deploymentRoot, 'vercel.json'), 'utf8'),
    ) as {
      headers: Array<{ headers: Array<{ key: string; value: string }>; source: string }>;
      outputDirectory: string;
      rewrites: Array<{ destination: string; source: string }>;
    };

    expect(configuration.rewrites).toEqual([
      {
        destination: '/api/index',
        source: '/api/:path*',
      },
      { destination: '/index.html', source: '/((?!api(?:/|$)|assets(?:/|$)).*)' },
    ]);
    expect(configuration.rewrites.every(({ destination }) => !destination.startsWith('http'))).toBe(
      true,
    );
    expect(existsSync(path.join(deploymentRoot, 'api', 'index.ts'))).toBe(true);
    expect(existsSync(path.join(deploymentRoot, 'api', '[...path].ts'))).toBe(false);
    const spaFallback = new RegExp(`^${configuration.rewrites[1]?.source ?? ''}$`, 'u');
    expect(configuration.outputDirectory).toBe('frontend/dist');
    expect(spaFallback.test('/')).toBe(true);
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
    const directives = new Map(
      csp
        ?.split(';')
        .map((directive) => directive.trim().split(/\s+/u))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name, sources]),
    );

    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('style-src')).toEqual([
      "'self'",
      'https://accounts.google.com/gsi/style',
    ]);
    expect(directives.get('style-src-elem')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://accounts.google.com/gsi/style',
    ]);
    expect(directives.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    expect(directives.get('script-src')).toEqual([
      "'self'",
      'https://accounts.google.com/gsi/client',
    ]);
    expect(directives.get('connect-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/']);
    expect(directives.get('frame-src')).toEqual(['https://accounts.google.com/gsi/']);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:']);
    expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
    expect(directives.get('script-src')).not.toContain("'unsafe-eval'");
    expect([...directives.values()].flat()).not.toContain('*');
  });
});
