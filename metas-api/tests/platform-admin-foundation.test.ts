import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sequelize, Transaction } from 'sequelize';

import { loadEnv } from '../src/config/env.js';
import { parsePlatformAdminBootstrapInput } from '../src/database/admin/platformAdminBootstrapInput.js';
import { databaseRoles } from '../src/database/roles.js';
import { generateSessionToken, hashSessionToken } from '../src/modules/auth/sessionToken.js';
import { InvalidGoogleIdTokenError } from '../src/modules/auth/googleIdTokenVerifier.js';
import { PostgresPlatformAdminAuthenticationService } from '../src/modules/platformAdmin/platformAdminAuthenticationService.js';
import { requireRecentPlatformAdminStepUp } from '../src/modules/platformAdmin/requireRecentPlatformAdminStepUp.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { withPlatformAdminDatabaseContext } from '../src/shared/database/withPlatformAdminDatabaseContext.js';

await test('platform admin database context rejects invalid authority before transaction', async () => {
  let transactionOpened = false;
  const database = {
    transaction: (): Promise<never> => {
      transactionOpened = true;
      return Promise.reject(new Error('Transaction should not be opened'));
    },
  } as unknown as Sequelize;

  await assert.rejects(
    withPlatformAdminDatabaseContext(
      database,
      { platformAdminId: 'invalid', sessionId: 'invalid' },
      () => Promise.resolve(undefined),
    ),
  );
  assert.equal(transactionOpened, false);
});

await test('platform admin context uses only parameterized transaction-local settings', async () => {
  const queries: Array<{ replacements: unknown; sql: string }> = [];
  const transaction = {} as Transaction;
  const database = {
    query: (sql: string, options: { replacements: unknown }): Promise<void> => {
      queries.push({ replacements: options.replacements, sql });
      return Promise.resolve();
    },
    transaction: async <Result>(
      callback: (currentTransaction: Transaction) => Promise<Result>,
    ): Promise<Result> => callback(transaction),
  } as unknown as Sequelize;
  const context = {
    platformAdminId: '018f47a1-3d11-7c14-a8bf-0242ac120010',
    sessionId: '018f47a1-3d11-7c14-a8bf-0242ac120011',
  };

  const result = await withPlatformAdminDatabaseContext(database, context, (currentTransaction) => {
    assert.equal(currentTransaction, transaction);
    return Promise.resolve('ok');
  });

  assert.equal(result, 'ok');
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /app\.current_platform_admin_id/u);
  assert.match(queries[0]?.sql ?? '', /app\.current_platform_admin_session_id/u);
  assert.deepEqual(queries[0]?.replacements, context);
});

await test('platform admin bootstrap requires explicit valid normalized data', () => {
  assert.deepEqual(
    parsePlatformAdminBootstrapInput({
      PLATFORM_ADMIN_BOOTSTRAP_DISPLAY_NAME: '  Admin Teste  ',
      PLATFORM_ADMIN_BOOTSTRAP_EMAIL: 'ADMIN@EXAMPLE.TEST',
      PLATFORM_ADMIN_BOOTSTRAP_GOOGLE_SUBJECT: 'google-subject-1',
    }),
    {
      displayName: 'Admin Teste',
      googleSubject: 'google-subject-1',
      primaryEmail: 'admin@example.test',
    },
  );
  assert.throws(() => parsePlatformAdminBootstrapInput({}));
  assert.throws(() =>
    parsePlatformAdminBootstrapInput({
      PLATFORM_ADMIN_BOOTSTRAP_DISPLAY_NAME: 'Admin',
      PLATFORM_ADMIN_BOOTSTRAP_EMAIL: 'invalid',
      PLATFORM_ADMIN_BOOTSTRAP_GOOGLE_SUBJECT: 'subject',
    }),
  );
});

await test('opaque session tokens carry 256 bits and persist as distinct SHA-256 hashes', () => {
  const first = generateSessionToken();
  const second = generateSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first, second);
  assert.equal(hashSessionToken(first).byteLength, 32);
  assert.notDeepEqual(hashSessionToken(first), hashSessionToken(second));
});

await test('platform admin remains outside employee roles and has a dedicated database role', () => {
  const employeeRoles = ['BALCONISTA', 'CAIXA', 'FARMACEUTICO', 'GESTOR'];
  assert.equal(employeeRoles.includes('PLATFORM_ADMIN'), false);
  assert.equal(databaseRoles.platformAdminRuntime, 'metas_platform_admin_runtime');
  assert.notEqual(databaseRoles.platformAdminRuntime, databaseRoles.runtime);
});

await test('platform admin configuration keeps audiences separate and TTL below mobile sessions', () => {
  const keys = [
    'DATABASE_SSL',
    'DATABASE_URL',
    'GOOGLE_ADMIN_ALLOWED_CLIENT_IDS',
    'GOOGLE_ALLOWED_CLIENT_IDS',
    'HOST',
    'NODE_ENV',
    'PLATFORM_ADMIN_AUTH_ENABLED',
    'PLATFORM_ADMIN_DATABASE_URL',
    'PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS',
    'PLATFORM_ADMIN_SESSION_TTL_SECONDS',
    'PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS',
    'PLATFORM_ADMIN_WEBAUTHN_CHALLENGE_TTL_SECONDS',
    'PLATFORM_ADMIN_WEBAUTHN_RP_ID',
    'PLATFORM_ADMIN_WEBAUTHN_RP_NAME',
    'PLATFORM_ADMIN_WEBAUTHN_STEP_UP_TTL_SECONDS',
    'SESSION_TTL_SECONDS',
    'TRUST_PROXY_HOPS',
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    Object.assign(process.env, {
      DATABASE_SSL: 'false',
      DATABASE_URL: 'postgresql://runtime:placeholder@localhost:5432/metas_test',
      GOOGLE_ADMIN_ALLOWED_CLIENT_IDS: 'admin.apps.googleusercontent.com',
      GOOGLE_ALLOWED_CLIENT_IDS: 'mobile.apps.googleusercontent.com',
      HOST: '0.0.0.0',
      NODE_ENV: 'test',
      PLATFORM_ADMIN_AUTH_ENABLED: 'true',
      PLATFORM_ADMIN_DATABASE_URL:
        'postgresql://platform-admin:placeholder@localhost:5432/metas_test',
      PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS: '1800',
      PLATFORM_ADMIN_SESSION_TTL_SECONDS: '28800',
      PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS: 'https://admin.example.test',
      PLATFORM_ADMIN_WEBAUTHN_CHALLENGE_TTL_SECONDS: '300',
      PLATFORM_ADMIN_WEBAUTHN_RP_ID: 'admin.example.test',
      PLATFORM_ADMIN_WEBAUTHN_RP_NAME: 'Metas Admin',
      PLATFORM_ADMIN_WEBAUTHN_STEP_UP_TTL_SECONDS: '300',
      SESSION_TTL_SECONDS: '604800',
      TRUST_PROXY_HOPS: '1',
    });
    const environment = loadEnv();
    assert.equal(environment.platformAdminAuthEnabled, true);
    assert.ok(
      environment.platformAdminIdleTimeoutSeconds < environment.platformAdminSessionTtlSeconds,
    );
    assert.ok(environment.platformAdminSessionTtlSeconds < environment.sessionTtlSeconds);
    assert.deepEqual(environment.platformAdminWebAuthnAllowedOrigins, [
      'https://admin.example.test',
    ]);

    process.env.GOOGLE_ADMIN_ALLOWED_CLIENT_IDS = process.env.GOOGLE_ALLOWED_CLIENT_IDS;
    assert.throws(loadEnv, /GOOGLE_ADMIN_ALLOWED_CLIENT_IDS/u);

    process.env.GOOGLE_ADMIN_ALLOWED_CLIENT_IDS = 'admin.apps.googleusercontent.com';
    process.env.DATABASE_SSL = 'true';
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(loadEnv);

    for (const invalidOrigin of [
      '',
      'http://admin.example.test',
      'https://different.example.test',
      'https://malicious.admin.example.test',
      'https://admin.example.test.attacker.example',
    ]) {
      process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = invalidOrigin;
      assert.throws(loadEnv, /PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS/u);
    }

    process.env.PLATFORM_ADMIN_WEBAUTHN_RP_ID = 'localhost';
    process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = 'https://localhost';
    assert.throws(loadEnv, /PLATFORM_ADMIN_WEBAUTHN_RP_ID/u);

    process.env.PLATFORM_ADMIN_WEBAUTHN_RP_ID = '127.0.0.1';
    process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = 'https://127.0.0.1';
    assert.throws(loadEnv, /PLATFORM_ADMIN_WEBAUTHN_RP_ID/u);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

await test('platform admin authentication remains fail-closed without WebAuthn configuration', () => {
  const keys = [
    'DATABASE_URL',
    'GOOGLE_ADMIN_ALLOWED_CLIENT_IDS',
    'PLATFORM_ADMIN_AUTH_ENABLED',
    'PLATFORM_ADMIN_DATABASE_URL',
    'PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS',
    'PLATFORM_ADMIN_WEBAUTHN_RP_ID',
    'PLATFORM_ADMIN_WEBAUTHN_RP_NAME',
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://runtime:placeholder@localhost:5432/metas_test',
      GOOGLE_ADMIN_ALLOWED_CLIENT_IDS: 'admin.apps.googleusercontent.com',
      PLATFORM_ADMIN_AUTH_ENABLED: 'false',
    });
    delete process.env.PLATFORM_ADMIN_DATABASE_URL;
    delete process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS;
    delete process.env.PLATFORM_ADMIN_WEBAUTHN_RP_ID;
    delete process.env.PLATFORM_ADMIN_WEBAUTHN_RP_NAME;
    assert.equal(loadEnv().platformAdminAuthEnabled, false);

    process.env.PLATFORM_ADMIN_AUTH_ENABLED = 'true';
    assert.throws(loadEnv, /PLATFORM_ADMIN_DATABASE_URL/u);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

await test('recent platform admin step-up is server-derived and expires', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');
  const verifiedSession = {
    assuranceLevel: 'MFA_VERIFIED' as const,
    expiresAt: '2026-08-31T13:00:00.000Z',
    mfaVerifiedAt: '2026-08-31T11:55:00.000Z',
    platformAdminId: '018f47a1-3d11-7c14-a8bf-0242ac120010',
    sessionId: '018f47a1-3d11-7c14-a8bf-0242ac120011',
    stepUpVerifiedAt: '2026-08-31T11:59:00.000Z',
  };

  assert.doesNotThrow(() => requireRecentPlatformAdminStepUp(verifiedSession, 300, now));
  assert.throws(() =>
    requireRecentPlatformAdminStepUp(
      { ...verifiedSession, stepUpVerifiedAt: '2026-08-31T11:54:59.000Z' },
      300,
      now,
    ),
  );
  assert.throws(() =>
    requireRecentPlatformAdminStepUp(
      {
        ...verifiedSession,
        assuranceLevel: 'GOOGLE_ONLY',
        mfaVerifiedAt: null,
        stepUpVerifiedAt: null,
      },
      300,
      now,
    ),
  );
});

await test('invalid Google tokens are denied before any administrative database access', async () => {
  let databaseUsed = false;
  const database = {
    query: (): Promise<never> => {
      databaseUsed = true;
      return Promise.reject(new Error('Database should not be used'));
    },
  } as unknown as Sequelize;
  const service = new PostgresPlatformAdminAuthenticationService(
    database,
    { verify: () => Promise.reject(new InvalidGoogleIdTokenError()) },
    3_600,
    900,
  );

  await assert.rejects(
    service.loginWithGoogle('invalid-google-token', {
      ipAddress: null,
      requestId: '018f47a1-3d11-7c14-a8bf-0242ac120012',
      userAgent: null,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_GOOGLE_TOKEN',
  );
  assert.equal(databaseUsed, false);
});
