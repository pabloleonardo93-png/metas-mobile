import assert from 'node:assert/strict';
import test from 'node:test';

import type { LogContext, Logger } from '../src/shared/logging/logger.js';
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
    /DATABASE_URL|PLATFORM_ADMIN_DATABASE_URL|postgresql:|rediss:|password|secret|process\.env|SENSITIVE_EXTERNAL_CODE|SELECT/iu,
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
