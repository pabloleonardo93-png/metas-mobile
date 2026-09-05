import { createDatabaseFromParameters, disconnectDatabase } from '../../config/database.js';
import { loadNorthflankAdminDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import {
  parsePlatformAdminRuntimePassword,
  runPlatformAdminRuntimePasswordRotation,
} from './platformAdminRuntimePasswordRotation.js';

void runPlatformAdminRuntimePasswordRotation({
  createDatabase: createDatabaseFromParameters,
  disconnectDatabase,
  loadConfiguration: () => {
    const adminDatabase = loadNorthflankAdminDatabaseEnv();
    return {
      adminDatabase,
      runtimePassword: parsePlatformAdminRuntimePassword(process.env),
    };
  },
  logger,
}).then((exitCode) => {
  process.exitCode = exitCode;
});
