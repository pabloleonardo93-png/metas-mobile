import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryPlatformAdminRateLimiter,
  PlatformAdminRateLimitStoreUnavailableError,
  RedisPlatformAdminRateLimiter,
  type PlatformAdminRateLimitPolicies,
} from '../src/modules/platformAdmin/platformAdminRateLimiter.js';

const policies: PlatformAdminRateLimitPolicies = {
  FIRST_ENROLLMENT_REQUEST: { limit: 2, windowMs: 60_000 },
  MFA_RECOVERY_OPTIONS: { limit: 2, windowMs: 60_000 },
  MFA_RECOVERY_REQUEST: { limit: 1, windowMs: 60_000 },
  MFA_RECOVERY_VERIFY: { limit: 2, windowMs: 60_000 },
  GOOGLE_LOGIN: { limit: 2, windowMs: 60_000 },
  WEBAUTHN_AUTHENTICATION_OPTIONS: { limit: 2, windowMs: 60_000 },
  WEBAUTHN_AUTHENTICATION_VERIFY: { limit: 2, windowMs: 60_000 },
  WEBAUTHN_REGISTRATION_OPTIONS: { limit: 2, windowMs: 60_000 },
  WEBAUTHN_REGISTRATION_VERIFY: { limit: 2, windowMs: 60_000 },
};

await test('memory rate limiter isolates operations and expires windows deterministically', async () => {
  let now = 1_000;
  const limiter = new MemoryPlatformAdminRateLimiter(
    'memory-test-key-secret-with-32-bytes',
    policies,
    () => now,
  );
  const identity = ['admin-id', 'session-id', '203.0.113.8'];

  assert.equal((await limiter.consume('GOOGLE_LOGIN', identity)).allowed, true);
  assert.equal((await limiter.consume('GOOGLE_LOGIN', identity)).allowed, true);
  const blocked = await limiter.consume('GOOGLE_LOGIN', identity);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal((await limiter.consume('FIRST_ENROLLMENT_REQUEST', identity)).allowed, true);
  assert.equal((await limiter.consume('MFA_RECOVERY_REQUEST', identity)).allowed, true);
  assert.equal((await limiter.consume('MFA_RECOVERY_REQUEST', identity)).allowed, false);
  assert.equal((await limiter.consume('MFA_RECOVERY_OPTIONS', identity)).allowed, true);
  assert.equal((await limiter.consume('MFA_RECOVERY_VERIFY', identity)).allowed, true);
  assert.equal(
    (await limiter.consume('GOOGLE_LOGIN', ['another-admin', 'another-session', '203.0.113.8']))
      .allowed,
    true,
  );

  now += 60_001;
  assert.equal((await limiter.consume('GOOGLE_LOGIN', identity)).allowed, true);
});

await test('Redis limiter hashes identity parts and shares recovery counters by operation', async () => {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const store = {
    eval: (_script: string, options: { arguments: string[]; keys: string[] }) => {
      const key = options.keys[0] ?? '';
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      keys.push(key);
      return Promise.resolve([count, Number(options.arguments[0])]);
    },
  };
  const first = new RedisPlatformAdminRateLimiter(
    store,
    'redis-test-key-secret-with-32-bytes',
    policies,
  );
  const second = new RedisPlatformAdminRateLimiter(
    store,
    'redis-test-key-secret-with-32-bytes',
    policies,
  );
  const identity = ['admin-sensitive-id', 'session-sensitive-id', '203.0.113.9'];

  assert.equal((await first.consume('GOOGLE_LOGIN', identity)).allowed, true);
  assert.equal((await second.consume('GOOGLE_LOGIN', identity)).allowed, true);
  assert.equal((await first.consume('GOOGLE_LOGIN', identity)).allowed, false);
  assert.equal((await first.consume('MFA_RECOVERY_REQUEST', identity)).allowed, true);
  assert.equal((await second.consume('MFA_RECOVERY_REQUEST', identity)).allowed, false);
  assert.equal((await first.consume('MFA_RECOVERY_OPTIONS', identity)).allowed, true);
  assert.equal((await second.consume('MFA_RECOVERY_OPTIONS', identity)).allowed, true);
  assert.equal(new Set(keys).size, 3);
  assert.ok(keys.every((key) => !/admin-sensitive|session-sensitive|203\.0\.113\.9/u.test(key)));
});

await test('Redis limiter fails closed when its shared store is unavailable', async () => {
  const limiter = new RedisPlatformAdminRateLimiter(
    {
      eval: () => Promise.reject(new Error('connection details must remain internal')),
    },
    'redis-test-key-secret-with-32-bytes',
    policies,
  );

  await assert.rejects(
    limiter.consume('WEBAUTHN_AUTHENTICATION_VERIFY', ['admin', 'session', '127.0.0.1']),
    PlatformAdminRateLimitStoreUnavailableError,
  );
});
