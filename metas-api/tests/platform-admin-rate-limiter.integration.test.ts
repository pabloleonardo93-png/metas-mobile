import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlatformAdminRedisClient,
  RedisPlatformAdminRateLimiter,
  type PlatformAdminRateLimitPolicies,
} from '../src/modules/platformAdmin/platformAdminRateLimiter.js';

const redisUrl = process.env.TEST_PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL;
const policies: PlatformAdminRateLimitPolicies = {
  FIRST_ENROLLMENT_REQUEST: { limit: 3, windowMs: 60_000 },
  GOOGLE_LOGIN: { limit: 3, windowMs: 60_000 },
  WEBAUTHN_AUTHENTICATION_OPTIONS: { limit: 3, windowMs: 60_000 },
  WEBAUTHN_AUTHENTICATION_VERIFY: { limit: 3, windowMs: 60_000 },
  WEBAUTHN_REGISTRATION_OPTIONS: { limit: 3, windowMs: 60_000 },
  WEBAUTHN_REGISTRATION_VERIFY: { limit: 3, windowMs: 60_000 },
};

await test(
  'independent API instances share one atomic Redis rate limit window',
  { skip: redisUrl ? false : 'TEST_PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL is not configured' },
  async () => {
    assert.ok(redisUrl);
    const firstClient = createPlatformAdminRedisClient(redisUrl);
    const secondClient = createPlatformAdminRedisClient(redisUrl);
    firstClient.on('error', () => undefined);
    secondClient.on('error', () => undefined);
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    try {
      const secret = randomBytes(32).toString('base64url');
      const first = new RedisPlatformAdminRateLimiter(firstClient, secret, policies);
      const second = new RedisPlatformAdminRateLimiter(secondClient, secret, policies);
      const identity = ['admin-id', 'session-id', '192.0.2.1'];
      const decisions = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          (index % 2 === 0 ? first : second).consume('FIRST_ENROLLMENT_REQUEST', identity),
        ),
      );

      assert.equal(decisions.filter((decision) => decision.allowed).length, 3);
      assert.equal(decisions.filter((decision) => !decision.allowed).length, 9);
      assert.ok(decisions.every((decision) => decision.retryAfterSeconds > 0));
    } finally {
      await Promise.all([firstClient.close(), secondClient.close()]);
    }
  },
);
