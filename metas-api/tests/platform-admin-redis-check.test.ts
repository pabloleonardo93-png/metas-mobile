import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlatformAdminRedisCheckEnv } from '../src/config/env.js';
import {
  runPlatformAdminRedisCheck,
  type PlatformAdminRedisCheckClient,
} from '../src/modules/platformAdmin/platformAdminRedisCheck.js';
import type { LogContext, Logger } from '../src/shared/logging/logger.js';

const testKeySecret = Buffer.alloc(32, 7).toString('base64url');
const testRedisUrl = 'rediss://default:test-password@redis.example.test:6379';

class RecordingLogger implements Logger {
  readonly entries: Array<{ context?: LogContext; event: string; level: 'error' | 'info' }> = [];

  error(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event, level: 'error' });
  }

  info(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event, level: 'info' });
  }
}

interface FakeClientOptions {
  closeError?: Error;
  connectError?: Error;
  pingError?: Error;
  pingResponse?: string;
}

class FakeRedisClient implements PlatformAdminRedisCheckClient {
  readonly calls: string[] = [];
  isOpen = false;
  private errorListener: ((error: Error) => void) | undefined;

  constructor(private readonly options: FakeClientOptions = {}) {}

  close(): Promise<void> {
    this.calls.push('close');
    if (this.options.closeError) return Promise.reject(this.options.closeError);
    this.isOpen = false;
    return Promise.resolve();
  }

  connect(): Promise<void> {
    this.calls.push('connect');
    this.isOpen = true;
    if (this.options.connectError) {
      this.errorListener?.(this.options.connectError);
      return Promise.reject(this.options.connectError);
    }
    return Promise.resolve();
  }

  on(event: 'error', listener: (error: Error) => void): void {
    assert.equal(event, 'error');
    this.errorListener = listener;
  }

  ping(): Promise<string> {
    this.calls.push('ping');
    if (this.options.pingError) return Promise.reject(this.options.pingError);
    return Promise.resolve(this.options.pingResponse ?? 'PONG');
  }
}

const validEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  PLATFORM_ADMIN_AUTH_ENABLED: 'false',
  PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET: testKeySecret,
  PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL: testRedisUrl,
  PLATFORM_ADMIN_RATE_LIMIT_STORE: 'redis',
});

const runWithClient = async (
  client: FakeRedisClient,
  logger = new RecordingLogger(),
): Promise<{ exitCode: number; logger: RecordingLogger }> => ({
  exitCode: await runPlatformAdminRedisCheck({
    createClient: () => client,
    loadRedisUrl: () => testRedisUrl,
    logger,
  }),
  logger,
});

await test('Redis check configuration accepts rediss with admin authentication disabled', () => {
  assert.deepEqual(parsePlatformAdminRedisCheckEnv(validEnvironment()), { redisUrl: testRedisUrl });
});

await test('Redis check configuration rejects insecure or incomplete configuration', () => {
  const withoutStore = validEnvironment();
  delete withoutStore.PLATFORM_ADMIN_RATE_LIMIT_STORE;
  assert.throws(() => parsePlatformAdminRedisCheckEnv(withoutStore), /RATE_LIMIT_STORE/u);

  const memoryStore = validEnvironment();
  memoryStore.PLATFORM_ADMIN_RATE_LIMIT_STORE = 'memory';
  assert.throws(() => parsePlatformAdminRedisCheckEnv(memoryStore), /RATE_LIMIT_STORE/u);

  const insecure = validEnvironment();
  insecure.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL = 'redis://redis.example.test:6379';
  assert.throws(() => parsePlatformAdminRedisCheckEnv(insecure), /RATE_LIMIT_REDIS_URL/u);

  const withoutUrl = validEnvironment();
  delete withoutUrl.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL;
  assert.throws(() => parsePlatformAdminRedisCheckEnv(withoutUrl), /RATE_LIMIT_REDIS_URL/u);

  const withoutSecret = validEnvironment();
  delete withoutSecret.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET;
  assert.throws(() => parsePlatformAdminRedisCheckEnv(withoutSecret), /RATE_LIMIT_KEY_SECRET/u);

  const invalidSecret = validEnvironment();
  invalidSecret.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET = 'short-secret';
  assert.throws(() => parsePlatformAdminRedisCheckEnv(invalidSecret), /RATE_LIMIT_KEY_SECRET/u);
});

await test('Redis check connects, requires PONG, closes, and returns success', async () => {
  const client = new FakeRedisClient();
  const { exitCode, logger } = await runWithClient(client);

  assert.equal(exitCode, 0);
  assert.deepEqual(client.calls, ['connect', 'ping', 'close']);
  assert.deepEqual(
    logger.entries.map(({ event }) => event),
    [
      'platform_admin_redis_check_started',
      'platform_admin_redis_check_connected',
      'platform_admin_redis_ping_succeeded',
    ],
  );
});

await test('Redis check rejects an unexpected PING response and closes', async () => {
  const client = new FakeRedisClient({ pingResponse: 'NOT_PONG' });
  const { exitCode, logger } = await runWithClient(client);

  assert.equal(exitCode, 1);
  assert.deepEqual(client.calls, ['connect', 'ping', 'close']);
  assert.equal(logger.entries.at(-1)?.context?.code, 'UNEXPECTED_RESPONSE');
});

await test('Redis check sanitizes connection failure and cleans an open client', async () => {
  const client = new FakeRedisClient({ connectError: new Error(testRedisUrl) });
  const { exitCode, logger } = await runWithClient(client);

  assert.equal(exitCode, 1);
  assert.deepEqual(client.calls, ['connect', 'close']);
  assert.equal(logger.entries.at(-1)?.context?.code, 'CONNECTION_FAILED');
  assert.doesNotMatch(JSON.stringify(logger.entries), /test-password|redis\.example/u);
});

await test('Redis check sanitizes PING failure and closes', async () => {
  const client = new FakeRedisClient({ pingError: new Error(testKeySecret) });
  const { exitCode, logger } = await runWithClient(client);

  assert.equal(exitCode, 1);
  assert.deepEqual(client.calls, ['connect', 'ping', 'close']);
  assert.equal(logger.entries.at(-1)?.context?.code, 'PING_FAILED');
  assert.doesNotMatch(JSON.stringify(logger.entries), new RegExp(testKeySecret, 'u'));
});

await test('Redis check reports invalid configuration without creating a client', async () => {
  const logger = new RecordingLogger();
  let createClientCalled = false;
  const exitCode = await runPlatformAdminRedisCheck({
    createClient: () => {
      createClientCalled = true;
      return new FakeRedisClient();
    },
    loadRedisUrl: () => {
      throw new Error(testKeySecret);
    },
    logger,
  });

  assert.equal(exitCode, 1);
  assert.equal(createClientCalled, false);
  assert.equal(logger.entries.at(-1)?.context?.code, 'INVALID_CONFIGURATION');
  assert.doesNotMatch(JSON.stringify(logger.entries), new RegExp(testKeySecret, 'u'));
});

await test('Redis check treats cleanup failure as unsuccessful', async () => {
  const client = new FakeRedisClient({ closeError: new Error('sensitive cleanup detail') });
  const { exitCode, logger } = await runWithClient(client);

  assert.equal(exitCode, 1);
  assert.deepEqual(client.calls, ['connect', 'ping', 'close']);
  assert.equal(logger.entries.at(-1)?.context?.code, 'CLEANUP_FAILED');
  assert.doesNotMatch(JSON.stringify(logger.entries), /sensitive cleanup detail/u);
});
