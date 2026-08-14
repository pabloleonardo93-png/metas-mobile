import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sequelize } from 'sequelize';
import { Umzug } from 'umzug';

import { logger } from '../shared/logging/logger.js';
import { MigrationStorage } from './migrationStorage.js';

const currentFilePath = fileURLToPath(import.meta.url);
const migrationsGlob = join(
  dirname(currentFilePath),
  'migrations',
  `[0-9][0-9][0-9]-*${extname(currentFilePath)}`,
).replaceAll('\\', '/');

export const createMigrator = (database: Sequelize): Umzug<Sequelize> =>
  new Umzug({
    context: database,
    migrations: { glob: migrationsGlob },
    storage: new MigrationStorage(database),
    logger: {
      debug: (message) => logger.info('migration_debug', { message: JSON.stringify(message) }),
      error: (message) => logger.error('migration_error', { message: JSON.stringify(message) }),
      info: (message) => logger.info('migration_info', { message: JSON.stringify(message) }),
      warn: (message) => logger.info('migration_warning', { message: JSON.stringify(message) }),
    },
  });
