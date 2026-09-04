import type { Logger } from '../../shared/logging/logger.js';

export type PlatformAdminRedisCheckFailureCode =
  | 'CLEANUP_FAILED'
  | 'CONNECTION_FAILED'
  | 'INVALID_CONFIGURATION'
  | 'PING_FAILED'
  | 'UNEXPECTED_RESPONSE';

export interface PlatformAdminRedisCheckClient {
  readonly isOpen: boolean;
  close(): Promise<unknown>;
  connect(): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  ping(): Promise<string>;
}

export interface PlatformAdminRedisCheckDependencies {
  createClient(url: string): PlatformAdminRedisCheckClient;
  loadRedisUrl(): string;
  logger: Logger;
}

const logFailure = (logger: Logger, code: PlatformAdminRedisCheckFailureCode): void => {
  logger.error('platform_admin_redis_check_failed', { code });
};

export const runPlatformAdminRedisCheck = async (
  dependencies: PlatformAdminRedisCheckDependencies,
): Promise<number> => {
  let redisUrl: string;
  try {
    redisUrl = dependencies.loadRedisUrl();
  } catch {
    logFailure(dependencies.logger, 'INVALID_CONFIGURATION');
    return 1;
  }

  let client: PlatformAdminRedisCheckClient;
  try {
    client = dependencies.createClient(redisUrl);
  } catch {
    logFailure(dependencies.logger, 'CONNECTION_FAILED');
    return 1;
  }
  client.on('error', () => undefined);

  dependencies.logger.info('platform_admin_redis_check_started');
  let result = 0;

  try {
    try {
      await client.connect();
      dependencies.logger.info('platform_admin_redis_check_connected');
    } catch {
      logFailure(dependencies.logger, 'CONNECTION_FAILED');
      return 1;
    }

    let response: string;
    try {
      response = await client.ping();
    } catch {
      logFailure(dependencies.logger, 'PING_FAILED');
      return 1;
    }

    if (response !== 'PONG') {
      logFailure(dependencies.logger, 'UNEXPECTED_RESPONSE');
      return 1;
    }

    dependencies.logger.info('platform_admin_redis_ping_succeeded');
  } finally {
    if (client.isOpen) {
      try {
        await client.close();
      } catch {
        logFailure(dependencies.logger, 'CLEANUP_FAILED');
        result = 1;
      }
    }
  }

  return result;
};
