import assert from 'node:assert/strict';
import test from 'node:test';

import type { LoginTicket, TokenPayload } from 'google-auth-library';

import {
  GoogleProviderNotConfiguredError,
  InvalidGoogleIdTokenError,
  OfficialGoogleIdTokenVerifier,
} from '../src/modules/auth/googleIdTokenVerifier.js';

const allowedAudience = 'allowed-client-id.apps.googleusercontent.com';

const validPayload = (): TokenPayload => ({
  aud: allowedAudience,
  email: 'employee@example.test',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 300,
  iat: Math.floor(Date.now() / 1000),
  iss: 'https://accounts.google.com',
  sub: 'google-subject-123',
});

const clientFor = (payload: TokenPayload | undefined) => ({
  verifyIdToken: (): Promise<LoginTicket> =>
    Promise.resolve({ getPayload: () => payload } as LoginTicket),
});

await test('Google verifier accepts a fully valid verified ID token payload', async () => {
  const verifier = new OfficialGoogleIdTokenVerifier([allowedAudience], clientFor(validPayload()));
  assert.deepEqual(await verifier.verify('valid-google-id-token'), {
    email: 'employee@example.test',
    subject: 'google-subject-123',
  });
});

await test('Google verifier rejects cryptographically invalid tokens', async () => {
  const verifier = new OfficialGoogleIdTokenVerifier([allowedAudience], {
    verifyIdToken: () => Promise.reject(new Error('signature invalid')),
  });
  await assert.rejects(verifier.verify('invalid-google-id-token'), InvalidGoogleIdTokenError);
});

for (const [label, mutate] of [
  ['expired', (payload: TokenPayload) => ({ ...payload, exp: 1 })],
  ['wrong audience', (payload: TokenPayload) => ({ ...payload, aud: 'another-client' })],
  ['unverified email', (payload: TokenPayload) => ({ ...payload, email_verified: false })],
] as const) {
  await test(`Google verifier rejects ${label} tokens`, async () => {
    const verifier = new OfficialGoogleIdTokenVerifier(
      [allowedAudience],
      clientFor(mutate(validPayload())),
    );
    await assert.rejects(verifier.verify('rejected-google-id-token'), InvalidGoogleIdTokenError);
  });
}

await test('Google verifier reports missing Client ID configuration without network access', async () => {
  const verifier = new OfficialGoogleIdTokenVerifier([], clientFor(validPayload()));
  await assert.rejects(verifier.verify('valid-google-id-token'), GoogleProviderNotConfiguredError);
});
