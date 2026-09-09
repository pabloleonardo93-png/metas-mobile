import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDatabaseFromParameters, disconnectDatabase } from '../../config/database.js';
import { loadNorthflankAdminDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { assertPlatformAdminOperatorConnectionSecurity } from '../connectionSecurity.js';
import {
  parsePlatformAdminOperatorPassword,
  runPlatformAdminOperatorPasswordRotation,
} from './platformAdminOperatorPasswordRotation.js';

export const runPlatformAdminOperatorPasswordRotationCli = async (): Promise<number> =>
  runPlatformAdminOperatorPasswordRotation({
    assertOperatorConnectionSecurity: assertPlatformAdminOperatorConnectionSecurity,
    createDatabase: createDatabaseFromParameters,
    disconnectDatabase,
    loadConfiguration: () => {
      const adminDatabase = loadNorthflankAdminDatabaseEnv();
      return {
        adminDatabase,
        operatorPassword: parsePlatformAdminOperatorPassword(process.env),
      };
    },
    logger,
  });

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runPlatformAdminOperatorPasswordRotationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
