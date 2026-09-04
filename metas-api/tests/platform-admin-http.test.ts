import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { createApp, type AppOptions } from '../src/app.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminLoginResult,
  PlatformAdminMeResult,
  PlatformAdminRequestMetadata,
  PlatformAdminSession,
} from '../src/modules/platformAdmin/platformAdmin.types.js';
import {
  MemoryPlatformAdminRateLimiter,
  PlatformAdminRateLimitStoreUnavailableError,
  type PlatformAdminRateLimitPolicies,
} from '../src/modules/platformAdmin/platformAdminRateLimiter.js';
import type {
  PlatformAdminFirstEnrollmentRequestResult,
  PlatformAdminMfaRecoveryRequestResult,
  PlatformAdminWebAuthnAuthenticationOptionsResult,
  PlatformAdminWebAuthnService,
  PlatformAdminWebAuthnVerificationResult,
} from '../src/modules/platformAdmin/platformAdminWebAuthn.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger, LogContext } from '../src/shared/logging/logger.js';

const platformToken = 'p'.repeat(43);
const employeeToken = 'e'.repeat(43);
const platformSession: PlatformAdminSession = {
  assuranceLevel: 'GOOGLE_ONLY',
  expiresAt: '2026-09-01T12:00:00.000Z',
  mfaVerifiedAt: null,
  platformAdminId: '018f47a1-3d11-7c14-a8bf-0242ac120010',
  sessionId: '018f47a1-3d11-7c14-a8bf-0242ac120011',
  stepUpVerifiedAt: null,
};
const loginResult: PlatformAdminLoginResult = {
  admin: {
    assuranceLevel: 'GOOGLE_ONLY',
    displayName: 'Admin Teste',
    id: platformSession.platformAdminId,
    primaryEmail: 'admin@example.test',
  },
  expiresAt: platformSession.expiresAt,
  sessionToken: platformToken,
};
const meResult: PlatformAdminMeResult = {
  assuranceLevel: 'GOOGLE_ONLY',
  displayName: 'Admin Teste',
  hasWebAuthnCredential: false,
  hasWebAuthnCredentialHistory: false,
  id: platformSession.platformAdminId,
  primaryEmail: 'admin@example.test',
  status: 'ACTIVE',
};

class FakePlatformAdminAuthenticationService implements PlatformAdminAuthenticationService {
  public loginError: Error | null = null;
  public logoutCalled = false;
  public loginMetadata: PlatformAdminRequestMetadata | null = null;

  public authenticateSession(token: string): Promise<PlatformAdminSession> {
    if (token !== platformToken) {
      return Promise.reject(
        new AppError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.'),
      );
    }
    return Promise.resolve(platformSession);
  }

  public getMe(): Promise<PlatformAdminMeResult> {
    return Promise.resolve(meResult);
  }

  public loginWithGoogle(
    _idToken: string,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminLoginResult> {
    this.loginMetadata = metadata;
    return this.loginError ? Promise.reject(this.loginError) : Promise.resolve(loginResult);
  }

  public logout(): Promise<void> {
    this.logoutCalled = true;
    return Promise.resolve();
  }
}

const webAuthnVerificationResult: PlatformAdminWebAuthnVerificationResult = {
  assuranceLevel: 'MFA_VERIFIED',
  mfaVerifiedAt: '2026-08-31T12:00:00.000Z',
  sessionToken: 'n'.repeat(43),
  stepUpVerifiedAt: '2026-08-31T12:00:00.000Z',
};

class FakePlatformAdminWebAuthnService implements PlatformAdminWebAuthnService {
  public authenticationVerifications = 0;
  public registrationVerifications = 0;

  public requestFirstEnrollment(): Promise<PlatformAdminFirstEnrollmentRequestResult> {
    return Promise.resolve({
      approvalExpiresAt: null,
      expiresAt: '2026-09-01T12:15:00.000Z',
      requestId: '018f47a1-3d11-7c14-a8bf-0242ac120022',
      status: 'PENDING',
    });
  }

  public requestMfaRecovery(): Promise<PlatformAdminMfaRecoveryRequestResult> {
    return Promise.resolve({
      approvalExpiresAt: null,
      expiresAt: '2026-09-01T12:15:00.000Z',
      requestId: '018f47a1-3d11-7c14-a8bf-0242ac120023',
      status: 'PENDING',
    });
  }

  public createAuthenticationOptions(): Promise<PlatformAdminWebAuthnAuthenticationOptionsResult> {
    return Promise.resolve({
      challengeId: '018f47a1-3d11-7c14-a8bf-0242ac120020',
      options: { challenge: 'challenge', rpId: 'admin.example.test' },
      purpose: 'AUTHENTICATION',
    });
  }

  public createRegistrationOptions(): ReturnType<
    PlatformAdminWebAuthnService['createRegistrationOptions']
  > {
    return Promise.resolve({
      challengeId: '018f47a1-3d11-7c14-a8bf-0242ac120021',
      options: {
        attestation: 'none',
        authenticatorSelection: { userVerification: 'required' },
        challenge: 'challenge',
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        rp: { id: 'admin.example.test', name: 'Metas Admin' },
        user: { displayName: 'Admin', id: 'admin-id', name: 'admin@example.test' },
      },
    });
  }

  public createRecoveryRegistrationOptions(): ReturnType<
    PlatformAdminWebAuthnService['createRecoveryRegistrationOptions']
  > {
    return this.createRegistrationOptions();
  }

  public verifyAuthentication(): Promise<PlatformAdminWebAuthnVerificationResult> {
    this.authenticationVerifications += 1;
    return Promise.resolve(webAuthnVerificationResult);
  }

  public verifyRegistration(): Promise<PlatformAdminWebAuthnVerificationResult> {
    this.registrationVerifications += 1;
    return Promise.resolve(webAuthnVerificationResult);
  }

  public verifyRecoveryRegistration(): Promise<PlatformAdminWebAuthnVerificationResult> {
    this.registrationVerifications += 1;
    return Promise.resolve(webAuthnVerificationResult);
  }
}

const logEntries: Array<{ context?: LogContext; event: string }> = [];
const logger: Logger = {
  error: (event, context) => logEntries.push({ event, ...(context ? { context } : {}) }),
  info: (event, context) => logEntries.push({ event, ...(context ? { context } : {}) }),
};

const createRateLimiter = (
  overrides: Partial<PlatformAdminRateLimitPolicies> = {},
): MemoryPlatformAdminRateLimiter => {
  const policy = { limit: 100, windowMs: 60_000 };
  return new MemoryPlatformAdminRateLimiter('test-rate-limit-key-secret-32-bytes', {
    FIRST_ENROLLMENT_REQUEST: policy,
    GOOGLE_LOGIN: policy,
    MFA_RECOVERY_OPTIONS: policy,
    MFA_RECOVERY_REQUEST: policy,
    MFA_RECOVERY_VERIFY: policy,
    WEBAUTHN_AUTHENTICATION_OPTIONS: policy,
    WEBAUTHN_AUTHENTICATION_VERIFY: policy,
    WEBAUTHN_REGISTRATION_OPTIONS: policy,
    WEBAUTHN_REGISTRATION_VERIFY: policy,
    ...overrides,
  });
};

const createPlatformAdminTestApp = (options: AppOptions) =>
  createApp({ platformAdminRateLimiter: createRateLimiter(), ...options });

const parseJson = <Result extends object>(text: string): Result => {
  const value: unknown = JSON.parse(text);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as Result;
};

await test('platform admin login accepts only the strict Google token contract', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
  });

  for (const field of ['platformAdminId', 'role', 'storeId', 'assuranceLevel']) {
    await request(app)
      .post('/v1/platform-admin/auth/google')
      .send({ idToken: 'x'.repeat(20), [field]: 'attacker-controlled' })
      .expect(422);
  }
});

await test('platform admin login returns a minimal contract without logging credentials', async () => {
  logEntries.length = 0;
  const service = new FakePlatformAdminAuthenticationService();
  const response = await request(
    createPlatformAdminTestApp({ logger, platformAdminAuthenticationService: service }),
  )
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'google-admin-id-token-private' })
    .expect(200);

  assert.deepEqual(parseJson<PlatformAdminLoginResult>(response.text), loginResult);
  assert.match(service.loginMetadata?.requestId ?? '', /^[0-9a-f-]{36}$/u);
  assert.doesNotMatch(JSON.stringify(logEntries), /google-admin-id-token|p{43}/u);
});

await test('unprovisioned or invalid administrative identities receive a controlled denial', async () => {
  const service = new FakePlatformAdminAuthenticationService();
  service.loginError = new AppError(
    403,
    'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED',
    'Não foi possível autorizar o acesso administrativo.',
  );
  const response = await request(
    createPlatformAdminTestApp({ logger, platformAdminAuthenticationService: service }),
  )
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(403);

  assert.equal(
    parseJson<{ code: string }>(response.text).code,
    'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED',
  );
});

await test('employee sessions cannot authenticate platform admin routes', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
  });

  await request(app)
    .get('/v1/platform-admin/me')
    .set('Authorization', `Bearer ${employeeToken}`)
    .expect(401);
});

await test('platform admin me returns only the administrative DTO', async () => {
  const response = await request(
    createPlatformAdminTestApp({
      logger,
      platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    }),
  )
    .get('/v1/platform-admin/me')
    .set('Authorization', `Bearer ${platformToken}`)
    .expect(200);
  const body = parseJson<PlatformAdminMeResult>(response.text);

  assert.deepEqual(body, meResult);
  assert.equal('tokenHash' in body, false);
  assert.equal('providerSubject' in body, false);
  assert.equal('sessionId' in body, false);
});

await test('platform admin logout authenticates and revokes through its own service', async () => {
  const service = new FakePlatformAdminAuthenticationService();
  await request(createPlatformAdminTestApp({ logger, platformAdminAuthenticationService: service }))
    .post('/v1/platform-admin/auth/logout')
    .set('Authorization', `Bearer ${platformToken}`)
    .expect(204);
  assert.equal(service.logoutCalled, true);
});

await test('platform admin login uses a dedicated stricter rate limit', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminRateLimiter: createRateLimiter({
      GOOGLE_LOGIN: { limit: 1, windowMs: 60_000 },
    }),
  });

  await request(app)
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(200);
  const response = await request(app)
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(429);
  assert.equal(parseJson<{ code: string }>(response.text).code, 'TOO_MANY_REQUESTS');
});

await test('no public HTTP route provisions a platform admin', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
  });
  await request(app).post('/v1/platform-admin').send({}).expect(404);
  await request(app).post('/v1/platform-admin/bootstrap').send({}).expect(404);
});

await test('WebAuthn routes require the dedicated administrative session', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: new FakePlatformAdminWebAuthnService(),
  });
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/registration/options')
    .send({})
    .expect(401);
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/authentication/options')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({})
    .expect(401);
});

await test('WebAuthn option endpoints reject mass assignment and return server challenges', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: new FakePlatformAdminWebAuthnService(),
  });
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/registration/options')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({ assuranceLevel: 'MFA_VERIFIED' })
    .expect(422);
  const response = await request(app)
    .post('/v1/platform-admin/mfa/webauthn/authentication/options')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({})
    .expect(200);
  assert.equal(parseJson<{ purpose: string }>(response.text).purpose, 'AUTHENTICATION');
});

await test('first enrollment request is strict and exposes only operational status', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: new FakePlatformAdminWebAuthnService(),
  });
  const path = '/v1/platform-admin/mfa/first-enrollment/request';
  await request(app)
    .post(path)
    .set('Authorization', `Bearer ${platformToken}`)
    .send({ platformAdminId: platformSession.platformAdminId })
    .expect(422);
  const response = await request(app)
    .post(path)
    .set('Authorization', `Bearer ${platformToken}`)
    .send({})
    .expect(202);
  const body = parseJson<PlatformAdminFirstEnrollmentRequestResult>(response.text);
  assert.equal(body.status, 'PENDING');
  assert.equal(body.requestId, '018f47a1-3d11-7c14-a8bf-0242ac120022');
  assert.doesNotMatch(response.text, /token|challenge|google|subject|secret/iu);
});

await test('MFA recovery routes are explicit, strict and return only controlled contracts', async () => {
  const webAuthnService = new FakePlatformAdminWebAuthnService();
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: webAuthnService,
  });
  const authorization = `Bearer ${platformToken}`;
  const requestPath = '/v1/platform-admin/mfa/recovery/request';
  await request(app)
    .post(requestPath)
    .set('Authorization', authorization)
    .send({ approved: true, platformAdminId: platformSession.platformAdminId })
    .expect(422);
  const recoveryRequest = await request(app)
    .post(requestPath)
    .set('Authorization', authorization)
    .send({})
    .expect(202);
  assert.deepEqual(parseJson<PlatformAdminMfaRecoveryRequestResult>(recoveryRequest.text), {
    approvalExpiresAt: null,
    expiresAt: '2026-09-01T12:15:00.000Z',
    requestId: '018f47a1-3d11-7c14-a8bf-0242ac120023',
    status: 'PENDING',
  });
  await request(app)
    .post('/v1/platform-admin/mfa/recovery/webauthn/options')
    .set('Authorization', authorization)
    .send({ tokenVersion: 1 })
    .expect(422);
  await request(app)
    .post('/v1/platform-admin/mfa/recovery/webauthn/options')
    .set('Authorization', authorization)
    .send({})
    .expect(200);
  await request(app)
    .post('/v1/platform-admin/mfa/recovery/webauthn/verify')
    .set('Authorization', authorization)
    .send({
      assuranceLevel: 'MFA_VERIFIED',
      challengeId: '018f47a1-3d11-7c14-a8bf-0242ac120021',
      response: {
        clientExtensionResults: {},
        id: 'credential_id',
        rawId: 'credential_id',
        response: { attestationObject: 'attestation', clientDataJSON: 'client_data' },
        type: 'public-key',
      },
    })
    .expect(422);
  assert.equal(webAuthnService.registrationVerifications, 0);
});

await test('platform admin routes fail closed when the shared limiter is unavailable', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminRateLimiter: {
      consume: () => Promise.reject(new PlatformAdminRateLimitStoreUnavailableError()),
    },
  });
  const response = await request(app)
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'x'.repeat(20) })
    .expect(503);
  assert.equal(
    parseJson<{ code: string }>(response.text).code,
    'PLATFORM_ADMIN_RATE_LIMIT_UNAVAILABLE',
  );
});

await test('WebAuthn verification contracts are strict and never accept authority fields', async () => {
  const webAuthnService = new FakePlatformAdminWebAuthnService();
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: webAuthnService,
  });
  const authenticationResponse = {
    challengeId: '018f47a1-3d11-7c14-a8bf-0242ac120020',
    response: {
      clientExtensionResults: {},
      id: 'credential_id',
      rawId: 'credential_id',
      response: {
        authenticatorData: 'authenticator_data',
        clientDataJSON: 'client_data',
        signature: 'signature',
      },
      type: 'public-key',
    },
  };
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/authentication/verify')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({ ...authenticationResponse, platformAdminId: platformSession.platformAdminId })
    .expect(422);
  const response = await request(app)
    .post('/v1/platform-admin/mfa/webauthn/authentication/verify')
    .set('Authorization', `Bearer ${platformToken}`)
    .send(authenticationResponse)
    .expect(200);
  assert.equal(webAuthnService.authenticationVerifications, 1);
  assert.equal(parseJson<{ assuranceLevel: string }>(response.text).assuranceLevel, 'MFA_VERIFIED');
  assert.doesNotMatch(response.text, /tokenHash|credentialPublicKey|challengeHash/u);
});

await test('WebAuthn registration verification returns only rotated session assurance data', async () => {
  const webAuthnService = new FakePlatformAdminWebAuthnService();
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: webAuthnService,
  });
  const response = await request(app)
    .post('/v1/platform-admin/mfa/webauthn/registration/verify')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({
      challengeId: '018f47a1-3d11-7c14-a8bf-0242ac120021',
      friendlyName: 'Notebook administrativo',
      response: {
        clientExtensionResults: {},
        id: 'credential_id',
        rawId: 'credential_id',
        response: {
          attestationObject: 'attestation_object',
          clientDataJSON: 'client_data',
          transports: ['internal'],
        },
        type: 'public-key',
      },
    })
    .expect(200);
  assert.equal(webAuthnService.registrationVerifications, 1);
  assert.deepEqual(
    parseJson<PlatformAdminWebAuthnVerificationResult>(response.text),
    webAuthnVerificationResult,
  );
});

await test('WebAuthn endpoints have independent administrative rate limiters', async () => {
  const app = createPlatformAdminTestApp({
    logger,
    platformAdminAuthenticationService: new FakePlatformAdminAuthenticationService(),
    platformAdminWebAuthnService: new FakePlatformAdminWebAuthnService(),
    platformAdminRateLimiter: createRateLimiter({
      WEBAUTHN_AUTHENTICATION_OPTIONS: { limit: 1, windowMs: 60_000 },
      WEBAUTHN_REGISTRATION_OPTIONS: { limit: 1, windowMs: 60_000 },
    }),
  });
  const authorization = `Bearer ${platformToken}`;
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/registration/options')
    .set('Authorization', authorization)
    .send({})
    .expect(200);
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/registration/options')
    .set('Authorization', authorization)
    .send({})
    .expect(429);
  await request(app)
    .post('/v1/platform-admin/mfa/webauthn/authentication/options')
    .set('Authorization', authorization)
    .send({})
    .expect(200);
});
