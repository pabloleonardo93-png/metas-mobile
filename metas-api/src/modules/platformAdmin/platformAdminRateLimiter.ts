import { createHmac } from 'node:crypto';

import { createClient } from 'redis';

export const platformAdminRateLimitOperations = [
  'GOOGLE_LOGIN',
  'WEBAUTHN_REGISTRATION_OPTIONS',
  'WEBAUTHN_REGISTRATION_VERIFY',
  'WEBAUTHN_AUTHENTICATION_OPTIONS',
  'WEBAUTHN_AUTHENTICATION_VERIFY',
  'FIRST_ENROLLMENT_REQUEST',
] as const;

export type PlatformAdminRateLimitOperation = (typeof platformAdminRateLimitOperations)[number];

export interface PlatformAdminRateLimitPolicy {
  limit: number;
  windowMs: number;
}

export type PlatformAdminRateLimitPolicies = Readonly<
  Record<PlatformAdminRateLimitOperation, PlatformAdminRateLimitPolicy>
>;

export interface PlatformAdminRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface PlatformAdminRateLimiter {
  consume(
    operation: PlatformAdminRateLimitOperation,
    identityParts: readonly string[],
  ): Promise<PlatformAdminRateLimitDecision>;
}

interface RedisScriptStore {
  eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown>;
}

interface MemoryWindow {
  count: number;
  expiresAt: number;
}

const fixedWindowScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

const retryAfterSeconds = (remainingMilliseconds: number): number =>
  Math.max(1, Math.ceil(remainingMilliseconds / 1000));

const rateLimitKey = (
  secret: string,
  operation: PlatformAdminRateLimitOperation,
  identityParts: readonly string[],
): string => {
  if (identityParts.length === 0 || identityParts.some((part) => part.length === 0)) {
    throw new Error('Platform admin rate limit identity is invalid.');
  }

  const digest = createHmac('sha256', secret)
    .update(JSON.stringify(identityParts), 'utf8')
    .digest('base64url');
  return `metas:pa:rl:v1:${operation.toLowerCase()}:${digest}`;
};

const readScriptResult = (result: unknown): [number, number] => {
  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    typeof result[0] !== 'number' ||
    typeof result[1] !== 'number'
  ) {
    throw new Error('Platform admin rate limit store returned an invalid response.');
  }
  return [result[0], result[1]];
};

export class PlatformAdminRateLimitStoreUnavailableError extends Error {
  public constructor() {
    super('Platform admin shared rate limit store is unavailable.');
    this.name = 'PlatformAdminRateLimitStoreUnavailableError';
  }
}

export class RedisPlatformAdminRateLimiter implements PlatformAdminRateLimiter {
  public constructor(
    private readonly store: RedisScriptStore,
    private readonly keySecret: string,
    private readonly policies: PlatformAdminRateLimitPolicies,
  ) {}

  public async consume(
    operation: PlatformAdminRateLimitOperation,
    identityParts: readonly string[],
  ): Promise<PlatformAdminRateLimitDecision> {
    const policy = this.policies[operation];
    const key = rateLimitKey(this.keySecret, operation, identityParts);
    try {
      const [count, ttl] = readScriptResult(
        await this.store.eval(fixedWindowScript, {
          arguments: [String(policy.windowMs)],
          keys: [key],
        }),
      );
      return {
        allowed: count <= policy.limit,
        retryAfterSeconds: retryAfterSeconds(ttl > 0 ? ttl : policy.windowMs),
      };
    } catch {
      throw new PlatformAdminRateLimitStoreUnavailableError();
    }
  }
}

export class MemoryPlatformAdminRateLimiter implements PlatformAdminRateLimiter {
  private readonly windows = new Map<string, MemoryWindow>();

  public constructor(
    private readonly keySecret: string,
    private readonly policies: PlatformAdminRateLimitPolicies,
    private readonly now: () => number = Date.now,
  ) {}

  public consume(
    operation: PlatformAdminRateLimitOperation,
    identityParts: readonly string[],
  ): Promise<PlatformAdminRateLimitDecision> {
    const currentTime = this.now();
    const policy = this.policies[operation];
    const key = rateLimitKey(this.keySecret, operation, identityParts);
    const existing = this.windows.get(key);
    const window =
      existing && existing.expiresAt > currentTime
        ? existing
        : { count: 0, expiresAt: currentTime + policy.windowMs };
    window.count += 1;
    this.windows.set(key, window);
    return Promise.resolve({
      allowed: window.count <= policy.limit,
      retryAfterSeconds: retryAfterSeconds(window.expiresAt - currentTime),
    });
  }
}

export const createPlatformAdminRedisClient = (url: string): ReturnType<typeof createClient> =>
  createClient({
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => (retries >= 3 ? false : Math.min(100 * 2 ** retries, 1_000)),
    },
    url,
  });
