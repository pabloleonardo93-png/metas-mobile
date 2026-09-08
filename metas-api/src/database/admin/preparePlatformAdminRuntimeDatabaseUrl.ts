import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { logger } from '../../shared/logging/logger.js';
import { runPlatformAdminRuntimeDatabaseUrlPreparation } from './platformAdminRuntimeDatabaseUrlPreparation.js';

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runPlatformAdminRuntimeDatabaseUrlPreparation({
    arguments: process.argv.slice(2),
    environment: process.env,
    logger,
    outputDirectory: process.cwd(),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
