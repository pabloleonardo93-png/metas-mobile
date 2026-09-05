import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { z } from 'zod';

import type { DatabaseConnectionParameters } from '../../config/database.js';
import type { NorthflankAdminDatabaseEnv } from '../../config/env.js';
import type { Logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

export const platformAdminRuntimeRoleName = databaseRoles.platformAdminRuntime;

export type PlatformAdminRuntimePasswordRotationFailureCode =
  | 'ADMIN_CONNECTION_FAILED'
  | 'CLEANUP_FAILED'
  | 'INVALID_CONFIGURATION'
  | 'LOGIN_VERIFICATION_FAILED'
  | 'PASSWORD_ROTATION_FAILED'
  | 'ROLE_CONFIGURATION_INVALID'
  | 'ROLE_NOT_FOUND'
  | 'UNEXPECTED_RUNTIME_IDENTITY';

interface PlatformAdminRuntimePasswordRotationConfiguration {
  adminDatabase: NorthflankAdminDatabaseEnv;
  runtimePassword: string;
}

export interface PlatformAdminRuntimePasswordRotationDependencies {
  createDatabase(
    parameters: DatabaseConnectionParameters,
    databaseSslServerName?: string,
  ): Sequelize;
  disconnectDatabase(database: Sequelize): Promise<void>;
  loadConfiguration(): PlatformAdminRuntimePasswordRotationConfiguration;
  logger: Logger;
}

interface RoleStatus {
  canLogin: boolean;
  isSuperuser: boolean;
}

interface PasswordLiteral {
  passwordLiteral: string;
}

interface CurrentUser {
  currentUser: string;
}

class RotationFailure extends Error {
  constructor(readonly code: PlatformAdminRuntimePasswordRotationFailureCode) {
    super(code);
    this.name = 'RotationFailure';
  }
}

const runtimePasswordSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

export const parsePlatformAdminRuntimePassword = (environment: NodeJS.ProcessEnv): string => {
  const parsed = runtimePasswordSchema.safeParse(environment.PLATFORM_ADMIN_RUNTIME_DB_PASSWORD);
  if (!parsed.success) {
    throw new RotationFailure('INVALID_CONFIGURATION');
  }
  return parsed.data;
};

const validateRole = async (database: Sequelize, transaction: Transaction): Promise<void> => {
  const roles = await database.query<RoleStatus>(
    `SELECT
       rolcanlogin AS "canLogin",
       rolsuper AS "isSuperuser"
     FROM pg_roles
     WHERE rolname = :roleName`,
    {
      replacements: { roleName: platformAdminRuntimeRoleName },
      transaction,
      type: QueryTypes.SELECT,
    },
  );
  const role = roles[0];
  if (!role) {
    throw new RotationFailure('ROLE_NOT_FOUND');
  }
  if (!role.canLogin || role.isSuperuser) {
    throw new RotationFailure('ROLE_CONFIGURATION_INVALID');
  }
};

const rotatePassword = async (
  database: Sequelize,
  password: string,
  transaction: Transaction,
): Promise<void> => {
  const literals = await database.query<PasswordLiteral>(
    'SELECT quote_literal(CAST($password AS TEXT)) AS "passwordLiteral"',
    {
      bind: { password },
      transaction,
      type: QueryTypes.SELECT,
    },
  );
  const passwordLiteral = literals[0]?.passwordLiteral;
  if (!passwordLiteral) {
    throw new RotationFailure('PASSWORD_ROTATION_FAILED');
  }

  // O literal vem de quote_literal() via bind; a instrução nunca é registrada.
  await database.query(`ALTER ROLE "${platformAdminRuntimeRoleName}" PASSWORD ${passwordLiteral}`, {
    transaction,
  });
};

const verifyRuntimeIdentity = async (database: Sequelize): Promise<void> => {
  await database.authenticate();
  const users = await database.query<CurrentUser>('SELECT current_user::TEXT AS "currentUser"', {
    type: QueryTypes.SELECT,
  });
  if (users[0]?.currentUser !== platformAdminRuntimeRoleName) {
    throw new RotationFailure('UNEXPECTED_RUNTIME_IDENTITY');
  }
};

const logFailure = (
  logger: Logger,
  code: PlatformAdminRuntimePasswordRotationFailureCode,
): void => {
  logger.error('platform_admin_runtime_password_rotation_failed', {
    code,
    roleName: platformAdminRuntimeRoleName,
  });
};

export const runPlatformAdminRuntimePasswordRotation = async (
  dependencies: PlatformAdminRuntimePasswordRotationDependencies,
): Promise<number> => {
  let configuration: PlatformAdminRuntimePasswordRotationConfiguration;
  try {
    configuration = dependencies.loadConfiguration();
  } catch {
    logFailure(dependencies.logger, 'INVALID_CONFIGURATION');
    return 1;
  }

  let adminDatabase: Sequelize;
  try {
    adminDatabase = dependencies.createDatabase(
      configuration.adminDatabase,
      configuration.adminDatabase.sslServerName,
    );
  } catch {
    logFailure(dependencies.logger, 'ADMIN_CONNECTION_FAILED');
    return 1;
  }

  let runtimeDatabase: Sequelize | undefined;
  let failureCode: PlatformAdminRuntimePasswordRotationFailureCode | undefined;

  dependencies.logger.info('platform_admin_runtime_password_rotation_started', {
    roleName: platformAdminRuntimeRoleName,
  });

  try {
    try {
      await adminDatabase.authenticate();
    } catch {
      throw new RotationFailure('ADMIN_CONNECTION_FAILED');
    }

    try {
      await adminDatabase.transaction(async (transaction) => {
        await validateRole(adminDatabase, transaction);
        await rotatePassword(adminDatabase, configuration.runtimePassword, transaction);
      });
    } catch (error) {
      if (error instanceof RotationFailure) {
        throw error;
      }
      throw new RotationFailure('PASSWORD_ROTATION_FAILED');
    }

    try {
      runtimeDatabase = dependencies.createDatabase(
        {
          database: configuration.adminDatabase.database,
          host: configuration.adminDatabase.host,
          password: configuration.runtimePassword,
          port: configuration.adminDatabase.port,
          username: platformAdminRuntimeRoleName,
        },
        configuration.adminDatabase.sslServerName,
      );
      await verifyRuntimeIdentity(runtimeDatabase);
    } catch (error) {
      if (error instanceof RotationFailure && error.code === 'UNEXPECTED_RUNTIME_IDENTITY') {
        throw error;
      }
      throw new RotationFailure('LOGIN_VERIFICATION_FAILED');
    }
  } catch (error) {
    failureCode = error instanceof RotationFailure ? error.code : 'PASSWORD_ROTATION_FAILED';
  } finally {
    for (const database of [runtimeDatabase, adminDatabase]) {
      if (!database) {
        continue;
      }
      try {
        await dependencies.disconnectDatabase(database);
      } catch {
        failureCode = 'CLEANUP_FAILED';
      }
    }
  }

  if (failureCode) {
    logFailure(dependencies.logger, failureCode);
    return 1;
  }

  dependencies.logger.info('platform_admin_runtime_password_rotation_succeeded', {
    roleName: platformAdminRuntimeRoleName,
    verificationStatus: 'verified',
  });
  return 0;
};
