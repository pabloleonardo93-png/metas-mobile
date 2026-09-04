import { loadNorthflankPlatformAdminRedisCheckEnv } from '../../config/env.js';
import { createPlatformAdminRedisClient } from '../../modules/platformAdmin/platformAdminRateLimiter.js';
import { runPlatformAdminRedisCheck } from '../../modules/platformAdmin/platformAdminRedisCheck.js';
import { logger } from '../../shared/logging/logger.js';

void runPlatformAdminRedisCheck({
  createClient: createPlatformAdminRedisClient,
  loadRedisUrl: () => loadNorthflankPlatformAdminRedisCheckEnv().redisUrl,
  logger,
}).then((exitCode) => {
  process.exitCode = exitCode;
});
