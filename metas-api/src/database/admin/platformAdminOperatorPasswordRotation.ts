import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { z } from 'zod';

import type { DatabaseConnectionParameters } from '../../config/database.js';
import type { NorthflankAdminDatabaseEnv } from '../../config/env.js';
import type { Logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

export const platformAdminOperatorRoleName = databaseRoles.platformAdminOperator;

export type PlatformAdminOperatorPasswordRotationFailureCode =
  | 'ADMIN_CONNECTION_FAILED'
  | 'CLEANUP_FAILED'
  | 'INVALID_CONFIGURATION'
  | 'LOGIN_VERIFICATION_FAILED'
  | 'OPERATOR_SECURITY_VALIDATION_FAILED'
  | 'PASSWORD_ROTATION_FAILED'
  | 'ROLE_CONFIGURATION_INVALID'
  | 'ROLE_NOT_FOUND'
  | 'UNEXPECTED_OPERATOR_IDENTITY';

interface PlatformAdminOperatorPasswordRotationConfiguration {
  adminDatabase: NorthflankAdminDatabaseEnv;
  operatorPassword: string;
}

export interface PlatformAdminOperatorPasswordRotationDependencies {
  assertOperatorConnectionSecurity(database: Sequelize): Promise<void>;
  createDatabase(
    parameters: DatabaseConnectionParameters,
    databaseSslServerName?: string,
  ): Sequelize;
  disconnectDatabase(database: Sequelize): Promise<void>;
  loadConfiguration(): PlatformAdminOperatorPasswordRotationConfiguration;
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
  constructor(readonly code: PlatformAdminOperatorPasswordRotationFailureCode) {
    super(code);
    this.name = 'RotationFailure';
  }
}

const operatorPasswordSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

export const parsePlatformAdminOperatorPassword = (environment: NodeJS.ProcessEnv): string => {
  const parsed = operatorPasswordSchema.safeParse(environment.PLATFORM_ADMIN_OPERATOR_DB_PASSWORD);
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
      replacements: { roleName: platformAdminOperatorRoleName },
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
  await database.query(
    `ALTER ROLE "${platformAdminOperatorRoleName}" PASSWORD ${passwordLiteral}`,
    { transaction },
  );
};

const verifyOperatorIdentity = async (database: Sequelize): Promise<void> => {
  await database.authenticate();
  const users = await database.query<CurrentUser>('SELECT current_user::TEXT AS "currentUser"', {
    type: QueryTypes.SELECT,
  });
  if (users[0]?.currentUser !== platformAdminOperatorRoleName) {
    throw new RotationFailure('UNEXPECTED_OPERATOR_IDENTITY');
  }
};

const logFailure = (
  logger: Logger,
  code: PlatformAdminOperatorPasswordRotationFailureCode,
): void => {
  logger.error('platform_admin_operator_password_rotation_failed', {
    code,
    roleName: platformAdminOperatorRoleName,
  });
};

export const runPlatformAdminOperatorPasswordRotation = async (
  dependencies: PlatformAdminOperatorPasswordRotationDependencies,
): Promise<number> => {
  let configuration: PlatformAdminOperatorPasswordRotationConfiguration;
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

  let operatorDatabase: Sequelize | undefined;
  let failureCode: PlatformAdminOperatorPasswordRotationFailureCode | undefined;

  dependencies.logger.info('platform_admin_operator_password_rotation_started', {
    roleName: platformAdminOperatorRoleName,
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
        await rotatePassword(adminDatabase, configuration.operatorPassword, transaction);
      });
    } catch (error) {
      if (error instanceof RotationFailure) {
        throw error;
      }
      throw new RotationFailure('PASSWORD_ROTATION_FAILED');
    }

    try {
      operatorDatabase = dependencies.createDatabase(
        {
          database: configuration.adminDatabase.database,
          host: configuration.adminDatabase.host,
          password: configuration.operatorPassword,
          port: configuration.adminDatabase.port,
          username: platformAdminOperatorRoleName,
        },
        configuration.adminDatabase.sslServerName,
      );
      await verifyOperatorIdentity(operatorDatabase);
    } catch (error) {
      if (error instanceof RotationFailure && error.code === 'UNEXPECTED_OPERATOR_IDENTITY') {
        throw error;
      }
      throw new RotationFailure('LOGIN_VERIFICATION_FAILED');
    }

    try {
      await dependencies.assertOperatorConnectionSecurity(operatorDatabase);
    } catch {
      throw new RotationFailure('OPERATOR_SECURITY_VALIDATION_FAILED');
    }
  } catch (error) {
    failureCode = error instanceof RotationFailure ? error.code : 'PASSWORD_ROTATION_FAILED';
  } finally {
    for (const database of [operatorDatabase, adminDatabase]) {
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

  dependencies.logger.info('platform_admin_operator_password_rotation_succeeded', {
    roleName: platformAdminOperatorRoleName,
    verificationStatus: 'verified',
  });
  return 0;
};
