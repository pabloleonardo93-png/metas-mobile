import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sequelize, Transaction } from 'sequelize';

import { loadEnv } from '../src/config/env.js';
import { parsePlatformAdminBootstrapInput } from '../src/database/admin/platformAdminBootstrapInput.js';
import { parsePlatformAdminMfaRecoveryOperationalInput } from '../src/database/admin/platformAdminMfaRecoveryInput.js';
import { assertPlatformAdminOperatorConnectionSecurity } from '../src/database/connectionSecurity.js';
import { databaseRoles } from '../src/database/roles.js';
import { generateSessionToken, hashSessionToken } from '../src/modules/auth/sessionToken.js';
import { InvalidGoogleIdTokenError } from '../src/modules/auth/googleIdTokenVerifier.js';
import { PostgresPlatformAdminAuthenticationService } from '../src/modules/platformAdmin/platformAdminAuthenticationService.js';
import { requireRecentPlatformAdminStepUp } from '../src/modules/platformAdmin/requireRecentPlatformAdminStepUp.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { withPlatformAdminDatabaseContext } from '../src/shared/database/withPlatformAdminDatabaseContext.js';

const testRateLimitKeySecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
  assert.equal(databaseRoles.platformAdminOperator, 'metas_platform_admin_operator');
  assert.notEqual(databaseRoles.platformAdminOperator, databaseRoles.migrationRunner);
  assert.notEqual(databaseRoles.platformAdminRuntime, databaseRoles.runtime);
});

await test('first enrollment operator guard accepts only the dedicated current_user', async () => {
  const createRoleDatabase = (roleName: string) =>
    ({
      query: (sql: string): Promise<unknown> =>
        Promise.resolve(
          sql.includes('current_user::TEXT')
            ? [
                {
                  bypassRls: false,
                  canCreateDatabase: false,
                  canCreateRole: false,
                  canLogin: true,
                  canReplicate: false,
                  isMemberMigrationOwner: roleName === databaseRoles.migrationRunner,
                  isMemberMigrationRunner: roleName === databaseRoles.migrationRunner,
                  isMemberPlatformAdminOperator: roleName === databaseRoles.platformAdminOperator,
                  isMemberPlatformAdminRuntime: roleName === databaseRoles.platformAdminRuntime,
                  isMemberRuntime: roleName === databaseRoles.runtime,
                  isSuperuser: roleName === 'postgres',
                  roleName,
                },
              ]
            : [{ count: '0' }],
        ),
    }) as unknown as Sequelize;

  await assert.doesNotReject(
    assertPlatformAdminOperatorConnectionSecurity(
      createRoleDatabase(databaseRoles.platformAdminOperator),
    ),
  );
  for (const roleName of [
    'postgres',
    databaseRoles.migrationRunner,
    databaseRoles.runtime,
    databaseRoles.platformAdminRuntime,
    'arbitrary_login',
  ]) {
    await assert.rejects(
      assertPlatformAdminOperatorConnectionSecurity(createRoleDatabase(roleName)),
    );
  }
});

await test('MFA recovery operator input requires an explicit request and bounded approval TTL', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(
    parsePlatformAdminMfaRecoveryOperationalInput({
      PLATFORM_ADMIN_MFA_RECOVERY_APPROVAL_TTL_SECONDS: '180',
      PLATFORM_ADMIN_MFA_RECOVERY_REQUEST_ID: requestId,
    }),
    { approvalTtlSeconds: 180, requestId },
  );
  assert.throws(() => parsePlatformAdminMfaRecoveryOperationalInput({}));
  assert.throws(() =>
    parsePlatformAdminMfaRecoveryOperationalInput({
      PLATFORM_ADMIN_MFA_RECOVERY_APPROVAL_TTL_SECONDS: '301',
      PLATFORM_ADMIN_MFA_RECOVERY_REQUEST_ID: requestId,
    }),
  );
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
    'PLATFORM_ADMIN_FIRST_ENROLLMENT_APPROVAL_TTL_SECONDS',
    'PLATFORM_ADMIN_FIRST_ENROLLMENT_PENDING_TTL_SECONDS',
    'PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS',
    'PLATFORM_ADMIN_MFA_RECOVERY_PENDING_TTL_SECONDS',
    'PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_OPTIONS_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_VERIFY_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_FIRST_ENROLLMENT_REQUEST_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_GOOGLE_LOGIN_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_MFA_RECOVERY_OPTIONS_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_MFA_RECOVERY_REQUEST_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_MFA_RECOVERY_VERIFY_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET',
    'PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL',
    'PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_OPTIONS_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_VERIFY_MAX',
    'PLATFORM_ADMIN_RATE_LIMIT_STORE',
    'PLATFORM_ADMIN_RATE_LIMIT_WINDOW_SECONDS',
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
      PLATFORM_ADMIN_FIRST_ENROLLMENT_APPROVAL_TTL_SECONDS: '300',
      PLATFORM_ADMIN_FIRST_ENROLLMENT_PENDING_TTL_SECONDS: '900',
      PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS: '1800',
      PLATFORM_ADMIN_MFA_RECOVERY_PENDING_TTL_SECONDS: '900',
      PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_OPTIONS_MAX: '10',
      PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_VERIFY_MAX: '5',
      PLATFORM_ADMIN_RATE_LIMIT_FIRST_ENROLLMENT_REQUEST_MAX: '3',
      PLATFORM_ADMIN_RATE_LIMIT_GOOGLE_LOGIN_MAX: '5',
      PLATFORM_ADMIN_RATE_LIMIT_MFA_RECOVERY_OPTIONS_MAX: '3',
      PLATFORM_ADMIN_RATE_LIMIT_MFA_RECOVERY_REQUEST_MAX: '2',
      PLATFORM_ADMIN_RATE_LIMIT_MFA_RECOVERY_VERIFY_MAX: '3',
      PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET: testRateLimitKeySecret,
      PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_OPTIONS_MAX: '10',
      PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_VERIFY_MAX: '5',
      PLATFORM_ADMIN_RATE_LIMIT_STORE: 'memory',
      PLATFORM_ADMIN_RATE_LIMIT_WINDOW_SECONDS: '900',
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
    process.env.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL = 'rediss://redis.example.test:6379';
    process.env.PLATFORM_ADMIN_RATE_LIMIT_STORE = 'redis';
    assert.doesNotThrow(loadEnv);

    process.env.PLATFORM_ADMIN_WEBAUTHN_RP_ID = 'project-name.vercel.app';
    process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = 'https://project-name.vercel.app';
    assert.doesNotThrow(loadEnv);

    process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = 'https://preview-project-name.vercel.app';
    assert.throws(loadEnv, /PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS/u);
    process.env.PLATFORM_ADMIN_WEBAUTHN_RP_ID = '*.vercel.app';
    process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = 'https://*.vercel.app';
    assert.throws(loadEnv, /PLATFORM_ADMIN_WEBAUTHN_RP_ID/u);

    process.env.PLATFORM_ADMIN_WEBAUTHN_RP_ID = 'admin.example.test';
    process.env.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS = 'https://admin.example.test';

    process.env.PLATFORM_ADMIN_RATE_LIMIT_STORE = 'memory';
    assert.throws(loadEnv, /PLATFORM_ADMIN_RATE_LIMIT_STORE/u);
    process.env.PLATFORM_ADMIN_RATE_LIMIT_STORE = 'redis';

    delete process.env.PLATFORM_ADMIN_RATE_LIMIT_STORE;
    assert.throws(loadEnv, /PLATFORM_ADMIN_RATE_LIMIT_STORE/u);
    process.env.PLATFORM_ADMIN_RATE_LIMIT_STORE = 'redis';

    process.env.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL = 'redis://redis.example.test:6379';
    assert.throws(loadEnv, /PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL/u);
    process.env.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL = 'rediss://redis.example.test:6379';

    delete process.env.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL;
    assert.throws(loadEnv, /PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL/u);
    process.env.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL = 'rediss://redis.example.test:6379';

    delete process.env.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET;
    assert.throws(loadEnv, /PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET/u);
    process.env.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET = 'short-secret';
    assert.throws(loadEnv, /PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET/u);
    process.env.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET = testRateLimitKeySecret;

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
