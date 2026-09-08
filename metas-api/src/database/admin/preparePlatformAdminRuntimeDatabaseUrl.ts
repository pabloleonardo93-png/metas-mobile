import { logger } from '../../shared/logging/logger.js';
import { runPlatformAdminRuntimeDatabaseUrlPreparation } from './platformAdminRuntimeDatabaseUrlPreparation.js';

void runPlatformAdminRuntimeDatabaseUrlPreparation({
  arguments: process.argv.slice(2),
  environment: process.env,
  logger,
  outputDirectory: process.cwd(),
}).then((exitCode) => {
  process.exitCode = exitCode;
});
