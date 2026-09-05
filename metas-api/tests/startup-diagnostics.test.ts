import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import type { LogContext, Logger } from '../src/shared/logging/logger.js';
import { parseEnv } from '../src/config/env.js';
import {
  logServerStartupFailure,
  runStartupConnectionPhases,
  runStartupPhase,
  startupFailureDescriptors,
  type StartupPhaseError,
} from '../src/startupDiagnostics.js';

class RecordingLogger implements Logger {
  readonly entries: Array<{ context?: LogContext; event: string; level: 'error' | 'info' }> = [];

  error(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event, level: 'error' });
  }

  info(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event, level: 'info' });
  }
}

const sensitiveDetails = [
  'DATABASE_URL=postgresql://runtime:password@database.example.test/metas',
  'PLATFORM_ADMIN_DATABASE_URL=postgresql://admin:secret@admin-db.example.test/metas',
  'rediss://default:redis-password@redis.example.test:6379',
  'process.env',
].join(' ');

const syntheticFailure = (name = 'Error'): Error => {
  const error = new Error(sensitiveDetails);
  error.name = name;
  Object.assign(error, {
    code: 'SENSITIVE_EXTERNAL_CODE',
    connectionString: sensitiveDetails,
    sql: `SELECT '${sensitiveDetails}'`,
  });
  return error;
};

const validEnvironment = {
  DATABASE_URL: 'postgresql://runtime:synthetic-password@database.example.test/metas',
  GOOGLE_ADMIN_ALLOWED_CLIENT_IDS: 'admin-client-id.example.test',
  GOOGLE_ALLOWED_CLIENT_IDS: 'mobile-client-id.example.test',
  NODE_ENV: 'test',
  PLATFORM_ADMIN_AUTH_ENABLED: 'true',
  PLATFORM_ADMIN_DATABASE_URL:
    'postgresql://platform-admin:synthetic-password@admin-database.example.test/metas',
  PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 7).toString('base64url'),
  PLATFORM_ADMIN_RATE_LIMIT_STORE: 'memory',
  PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS: 'https://admin.example.test',
  PLATFORM_ADMIN_WEBAUTHN_RP_ID: 'admin.example.test',
  PLATFORM_ADMIN_WEBAUTHN_RP_NAME: 'Metas Admin',
} satisfies NodeJS.ProcessEnv;

const captureFailure = async (operation: () => Promise<unknown>): Promise<RecordingLogger> => {
  const logger = new RecordingLogger();
  await assert.rejects(operation, (error: StartupPhaseError) => {
    logServerStartupFailure(logger, error);
    return true;
  });
  return logger;
};

const assertSanitized = (logger: RecordingLogger): void => {
  const serialized = JSON.stringify(logger.entries);
  assert.doesNotMatch(
    serialized,
    /postgresql:|rediss:|synthetic-password|secret-too-short|redis-password|process\.env|SENSITIVE_EXTERNAL_CODE|SELECT/iu,
  );
  assert.deepEqual(
    logger.entries.map(({ event }) => event),
    ['startup_phase_failed', 'server_start_failed'],
  );
};

await test('environment validation failure reports only its sanitized phase', async () => {
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.environmentValidation, () => {
      throw syntheticFailure();
    }),
  );

  assert.deepEqual(logger.entries[0]?.context, {
    errorCode: 'ENVIRONMENT_VALIDATION_FAILED',
    errorType: 'Error',
    phase: 'environment_validation',
  });
  assertSanitized(logger);
});

await test('environment diagnostics never expose invalid URL or credential values', async () => {
  const invalidUrl = 'mysql://sensitive-user:sensitive-password@private.example.test/metas';
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.environmentValidation, () =>
      parseEnv({ ...validEnvironment, DATABASE_URL: invalidUrl }),
    ),
  );

  assert.deepEqual(logger.entries[0]?.context?.invalidFields, ['DATABASE_URL']);
  const serialized = JSON.stringify(logger.entries);
  assert.doesNotMatch(serialized, /sensitive-user|sensitive-password|private\.example\.test/iu);
  assert.doesNotMatch(serialized, /must be a PostgreSQL URL/iu);
  assertSanitized(logger);
});

await test('environment diagnostics report only allowlisted field names', async () => {
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.environmentValidation, () =>
      parseEnv({ ...validEnvironment, PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET: 'secret-too-short' }),
    ),
  );

  assert.deepEqual(logger.entries[0]?.context, {
    errorCode: 'ENVIRONMENT_VALIDATION_FAILED',
    errorType: 'Error',
    invalidFields: ['PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET'],
    phase: 'environment_validation',
  });
  assert.doesNotMatch(JSON.stringify(logger.entries), /secret-too-short|must encode/iu);
  assertSanitized(logger);
});

await test('cross-field diagnostics are deduplicated and deterministically ordered', async () => {
  const reusedClientId = 'sensitive-reused-client-id.apps.example.test';
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.environmentValidation, () =>
      parseEnv({
        ...validEnvironment,
        GOOGLE_ADMIN_ALLOWED_CLIENT_IDS: reusedClientId,
        GOOGLE_ALLOWED_CLIENT_IDS: reusedClientId,
      }),
    ),
  );

  assert.deepEqual(logger.entries[0]?.context?.invalidFields, [
    'GOOGLE_ADMIN_ALLOWED_CLIENT_IDS',
    'GOOGLE_ALLOWED_CLIENT_IDS',
  ]);
  assert.doesNotMatch(JSON.stringify(logger.entries), /sensitive-reused-client-id/u);
  assertSanitized(logger);
});

await test('unknown fields and raw schema messages cannot enter environment diagnostics', async () => {
  const arbitraryError = syntheticFailure();
  Object.assign(arbitraryError, {
    invalidFields: ['ARBITRARY_UNKNOWN_FIELD', sensitiveDetails],
    issues: [{ message: sensitiveDetails, path: ['ARBITRARY_UNKNOWN_FIELD'] }],
  });
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.environmentValidation, () => {
      throw arbitraryError;
    }),
  );

  assert.equal(logger.entries[0]?.context?.invalidFields, undefined);
  assertSanitized(logger);
});

await test('admin database connection and security failures have distinct phases', async () => {
  const connectionLogger = await captureFailure(() =>
    runStartupConnectionPhases({
      connectPlatformAdminDatabase: () =>
        Promise.reject(syntheticFailure('SequelizeConnectionError')),
      connectPrimaryDatabase: () => Promise.resolve(),
      validatePlatformAdminDatabaseSecurity: () => Promise.resolve(),
    }),
  );
  assert.deepEqual(connectionLogger.entries[0]?.context, {
    errorCode: 'PLATFORM_ADMIN_DB_CONNECTION_FAILED',
    errorType: 'SequelizeConnectionError',
    phase: 'platform_admin_database_connection',
  });
  assertSanitized(connectionLogger);

  const securityLogger = await captureFailure(() =>
    runStartupConnectionPhases({
      connectPlatformAdminDatabase: () => Promise.resolve(),
      connectPrimaryDatabase: () => Promise.resolve(),
      validatePlatformAdminDatabaseSecurity: () => Promise.reject(syntheticFailure()),
    }),
  );
  assert.deepEqual(securityLogger.entries[0]?.context, {
    errorCode: 'PLATFORM_ADMIN_DB_SECURITY_VALIDATION_FAILED',
    errorType: 'Error',
    phase: 'platform_admin_database_security_validation',
  });
  assertSanitized(securityLogger);
});

await test('Redis connection and PING failures have distinct phases', async () => {
  const connectionLogger = await captureFailure(() =>
    runStartupConnectionPhases({
      connectPlatformAdminRedis: () => Promise.reject(syntheticFailure()),
      connectPrimaryDatabase: () => Promise.resolve(),
      pingPlatformAdminRedis: () => Promise.resolve(),
    }),
  );
  assert.equal(
    connectionLogger.entries[0]?.context?.errorCode,
    'PLATFORM_ADMIN_REDIS_CONNECTION_FAILED',
  );
  assert.equal(connectionLogger.entries[0]?.context?.phase, 'platform_admin_redis_connection');
  assertSanitized(connectionLogger);

  const pingLogger = await captureFailure(() =>
    runStartupConnectionPhases({
      connectPlatformAdminRedis: () => Promise.resolve(),
      connectPrimaryDatabase: () => Promise.resolve(),
      pingPlatformAdminRedis: () => Promise.reject(syntheticFailure()),
    }),
  );
  assert.equal(pingLogger.entries[0]?.context?.errorCode, 'PLATFORM_ADMIN_REDIS_PING_FAILED');
  assert.equal(pingLogger.entries[0]?.context?.phase, 'platform_admin_redis_ping');
  assertSanitized(pingLogger);
});

await test('HTTP server initialization failure preserves the final alert event', async () => {
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.httpServerInitialization, () => {
      throw syntheticFailure('TypeError');
    }),
  );

  assert.deepEqual(logger.entries.at(-1)?.context, {
    errorCode: 'HTTP_SERVER_INITIALIZATION_FAILED',
    errorType: 'TypeError',
    phase: 'http_server_initialization',
  });
  assertSanitized(logger);
});

await test('untrusted error names and raw codes are not logged', async () => {
  const logger = await captureFailure(() =>
    runStartupPhase(startupFailureDescriptors.serviceInitialization, () => {
      throw syntheticFailure(sensitiveDetails);
    }),
  );

  assert.equal(logger.entries[0]?.context?.errorType, 'UnknownError');
  assert.equal(logger.entries[0]?.context?.errorCode, 'SERVICE_INITIALIZATION_FAILED');
  assertSanitized(logger);
});

await test('healthy startup phases do not emit failure events', async () => {
  const logger = new RecordingLogger();
  await runStartupPhase(startupFailureDescriptors.environmentValidation, () => ({ ok: true }));
  await runStartupConnectionPhases({ connectPrimaryDatabase: () => Promise.resolve() });

  assert.deepEqual(logger.entries, []);
});
