import { createServer, type Server } from 'node:http';

import { createApp } from './app.js';
import {
  connectDatabase,
  connectPlatformAdminDatabase,
  createDatabase,
  createPlatformAdminDatabase,
  disconnectDatabase,
} from './config/database.js';
import { loadEnv } from './config/env.js';
import { PostgresAuthenticationService } from './modules/auth/authenticationService.js';
import { OfficialGoogleIdTokenVerifier } from './modules/auth/googleIdTokenVerifier.js';
import { PostgresCampaignService } from './modules/campaigns/campaignService.js';
import { PostgresEmployeeService } from './modules/employees/employeeService.js';
import { PostgresGoalService } from './modules/goals/goalService.js';
import { PostgresPlatformAdminAuthenticationService } from './modules/platformAdmin/platformAdminAuthenticationService.js';
import {
  createPlatformAdminRedisClient,
  MemoryPlatformAdminRateLimiter,
  RedisPlatformAdminRateLimiter,
  type PlatformAdminRateLimitPolicies,
} from './modules/platformAdmin/platformAdminRateLimiter.js';
import { officialPlatformAdminWebAuthnAdapter } from './modules/platformAdmin/platformAdminWebAuthnAdapter.js';
import { PostgresPlatformAdminWebAuthnService } from './modules/platformAdmin/platformAdminWebAuthnService.js';
import { AuthenticatedRealtimeServer } from './realtime/realtimeServer.js';
import { logger } from './shared/logging/logger.js';

const listen = async (server: Server, host: string, port: number): Promise<void> =>
  await new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      reject(error);
    };

    server.once('error', handleError);
    server.listen(port, host, () => {
      server.off('error', handleError);
      resolve();
    });
  });

const closeServer = async (server: Server): Promise<void> =>
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  const database = createDatabase(env);
  const platformAdminDatabase = env.platformAdminAuthEnabled
    ? createPlatformAdminDatabase(env)
    : null;
  const platformAdminRedisClient =
    env.platformAdminAuthEnabled &&
    env.platformAdminRateLimitStore === 'redis' &&
    env.platformAdminRateLimitRedisUrl
      ? createPlatformAdminRedisClient(env.platformAdminRateLimitRedisUrl)
      : null;

  platformAdminRedisClient?.on('error', (error: Error) => {
    logger.error('platform_admin_rate_limit_store_error', { errorType: error.name });
  });

  try {
    await connectDatabase(database);
    if (platformAdminDatabase) {
      await connectPlatformAdminDatabase(platformAdminDatabase);
    }
    if (platformAdminRedisClient) {
      await platformAdminRedisClient.connect();
      await platformAdminRedisClient.ping();
    }
  } catch (error: unknown) {
    logger.error('database_connection_failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    await disconnectDatabase(database).catch(() => undefined);
    await platformAdminDatabase?.close().catch(() => undefined);
    await platformAdminRedisClient?.close().catch(() => undefined);
    throw new Error('Server bootstrap failed', { cause: error });
  }

  const authenticationService = new PostgresAuthenticationService(
    database,
    new OfficialGoogleIdTokenVerifier(env.googleAllowedClientIds),
    env.sessionTtlSeconds,
  );
  const platformAdminAuthenticationService = platformAdminDatabase
    ? new PostgresPlatformAdminAuthenticationService(
        platformAdminDatabase,
        new OfficialGoogleIdTokenVerifier(env.googleAdminAllowedClientIds),
        env.platformAdminSessionTtlSeconds,
        env.platformAdminIdleTimeoutSeconds,
      )
    : undefined;
  const rateLimitWindowMs = env.platformAdminRateLimitWindowSeconds * 1000;
  const platformAdminRateLimitPolicies: PlatformAdminRateLimitPolicies = {
    FIRST_ENROLLMENT_REQUEST: {
      limit: env.platformAdminRateLimitFirstEnrollmentRequestMax,
      windowMs: rateLimitWindowMs,
    },
    GOOGLE_LOGIN: {
      limit: env.platformAdminRateLimitGoogleLoginMax,
      windowMs: rateLimitWindowMs,
    },
    WEBAUTHN_AUTHENTICATION_OPTIONS: {
      limit: env.platformAdminRateLimitAuthenticationOptionsMax,
      windowMs: rateLimitWindowMs,
    },
    WEBAUTHN_AUTHENTICATION_VERIFY: {
      limit: env.platformAdminRateLimitAuthenticationVerifyMax,
      windowMs: rateLimitWindowMs,
    },
    WEBAUTHN_REGISTRATION_OPTIONS: {
      limit: env.platformAdminRateLimitRegistrationOptionsMax,
      windowMs: rateLimitWindowMs,
    },
    WEBAUTHN_REGISTRATION_VERIFY: {
      limit: env.platformAdminRateLimitRegistrationVerifyMax,
      windowMs: rateLimitWindowMs,
    },
  };
  const platformAdminRateLimiter = platformAdminAuthenticationService
    ? (() => {
        if (!env.platformAdminRateLimitKeySecret) {
          throw new Error('Platform admin rate limit key secret is required.');
        }
        return platformAdminRedisClient
          ? new RedisPlatformAdminRateLimiter(
              platformAdminRedisClient,
              env.platformAdminRateLimitKeySecret,
              platformAdminRateLimitPolicies,
            )
          : new MemoryPlatformAdminRateLimiter(
              env.platformAdminRateLimitKeySecret,
              platformAdminRateLimitPolicies,
            );
      })()
    : undefined;
  const platformAdminWebAuthnService =
    platformAdminDatabase &&
    env.platformAdminWebAuthnRpId &&
    env.platformAdminWebAuthnRpName &&
    env.platformAdminWebAuthnAllowedOrigins.length > 0
      ? new PostgresPlatformAdminWebAuthnService(
          platformAdminDatabase,
          officialPlatformAdminWebAuthnAdapter,
          {
            allowedOrigins: env.platformAdminWebAuthnAllowedOrigins,
            challengeTtlSeconds: env.platformAdminWebAuthnChallengeTtlSeconds,
            firstEnrollmentPendingTtlSeconds: env.platformAdminFirstEnrollmentPendingTtlSeconds,
            rpId: env.platformAdminWebAuthnRpId,
            rpName: env.platformAdminWebAuthnRpName,
            stepUpTtlSeconds: env.platformAdminWebAuthnStepUpTtlSeconds,
          },
        )
      : undefined;
  const server = createServer();
  const realtimeServer = new AuthenticatedRealtimeServer(server, authenticationService, logger);
  const app = createApp({
    authenticationService,
    campaignService: new PostgresCampaignService(database),
    corsOrigins: env.corsOrigins,
    employeeService: new PostgresEmployeeService(database),
    goalService: new PostgresGoalService(database),
    ...(platformAdminAuthenticationService ? { platformAdminAuthenticationService } : {}),
    ...(platformAdminRateLimiter ? { platformAdminRateLimiter } : {}),
    ...(platformAdminWebAuthnService ? { platformAdminWebAuthnService } : {}),
    realtimePublisher: realtimeServer,
    trustProxyHops: env.trustProxyHops,
  });
  server.on('request', app);
  let shuttingDown = false;

  const shutdown = async (signal: 'SIGINT' | 'SIGTERM'): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info('server_shutdown_started', { signal });

    try {
      await realtimeServer.close();
      await closeServer(server);
      await disconnectDatabase(database);
      await platformAdminDatabase?.close();
      await platformAdminRedisClient?.close();
      logger.info('server_shutdown_completed', { signal });
    } catch (error: unknown) {
      logger.error('server_shutdown_failed', {
        signal,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await listen(server, env.host, env.port);
    logger.info('server_started', {
      environment: env.nodeEnv,
      host: env.host,
      port: env.port,
    });
  } catch (error: unknown) {
    await realtimeServer.close().catch(() => undefined);
    await disconnectDatabase(database).catch(() => undefined);
    await platformAdminDatabase?.close().catch(() => undefined);
    await platformAdminRedisClient?.close().catch(() => undefined);
    throw error;
  }
};

void bootstrap().catch((error: unknown) => {
  logger.error('server_start_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
