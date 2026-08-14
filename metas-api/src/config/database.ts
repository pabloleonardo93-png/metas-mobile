import { Sequelize } from 'sequelize';

import { assertRuntimeConnectionSecurity } from '../database/connectionSecurity.js';
import type { AppEnv } from './env.js';

export interface DatabaseConnectionParameters {
  database: string;
  host: string;
  password: string;
  port: number;
  username: string;
}

export const createDatabase = (env: AppEnv): Sequelize =>
  createDatabaseFromUrl(env.databaseUrl, env.databaseSsl, 10, env.databaseSslServerName);

export const createDatabaseFromUrl = (
  databaseUrl: string,
  databaseSsl: boolean,
  poolMax = 10,
  databaseSslServerName?: string,
): Sequelize => {
  const connectionUrl = new URL(databaseUrl);
  if (databaseSsl) {
    // pg-connection-string replaces the explicit TLS object when sslmode is present.
    connectionUrl.searchParams.delete('sslmode');
  }

  return new Sequelize(connectionUrl.toString(), {
    dialect: 'postgres',
    logging: false,
    pool: {
      acquire: 30_000,
      idle: 10_000,
      max: poolMax,
      min: 0,
    },
    ...(databaseSsl
      ? {
          dialectOptions: {
            ssl: {
              rejectUnauthorized: true,
              require: true,
              ...(databaseSslServerName ? { servername: databaseSslServerName } : {}),
            },
          },
        }
      : {}),
  });
};

export const createDatabaseFromParameters = (
  parameters: DatabaseConnectionParameters,
  databaseSslServerName?: string,
  poolMax = 1,
): Sequelize =>
  new Sequelize({
    database: parameters.database,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        rejectUnauthorized: true,
        require: true,
        ...(databaseSslServerName ? { servername: databaseSslServerName } : {}),
      },
    },
    host: parameters.host,
    logging: false,
    password: parameters.password,
    pool: {
      acquire: 30_000,
      idle: 10_000,
      max: poolMax,
      min: 0,
    },
    port: parameters.port,
    username: parameters.username,
  });

export const connectDatabase = async (database: Sequelize): Promise<void> => {
  await database.authenticate();
  await assertRuntimeConnectionSecurity(database);
};

export const disconnectDatabase = async (database: Sequelize): Promise<void> => {
  await database.close();
};
