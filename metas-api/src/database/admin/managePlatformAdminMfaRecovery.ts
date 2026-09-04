import { randomUUID } from 'node:crypto';

import { QueryTypes, type Sequelize } from 'sequelize';

import {
  createDatabaseFromParameters,
  createDatabaseFromUrl,
  disconnectDatabase,
} from '../../config/database.js';
import {
  loadNorthflankPlatformAdminOperatorDatabaseEnv,
  loadPlatformAdminOperatorDatabaseEnv,
} from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { assertPlatformAdminOperatorConnectionSecurity } from '../connectionSecurity.js';
import { parsePlatformAdminMfaRecoveryOperationalInput } from './platformAdminMfaRecoveryInput.js';

type Operation = 'approve' | 'status';

interface RecoveryStatusRow {
  approvalExpiresAt: Date | null;
  approvedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  displayName: string;
  enrollmentExpiresAt: Date | null;
  enrollmentStartedAt: Date | null;
  expiresAt: Date;
  primaryEmail: string;
  requestId: string;
  revokedAt: Date | null;
  status: string;
}

const createOperatorDatabase = (target: string | undefined): Sequelize => {
  if (target === 'northflank') {
    const env = loadNorthflankPlatformAdminOperatorDatabaseEnv();
    return createDatabaseFromParameters(
      {
        database: env.database,
        host: env.host,
        password: env.password,
        port: env.port,
        username: env.username,
      },
      env.sslServerName,
    );
  }
  if (target !== undefined) {
    throw new Error('Expected no target or the explicit target northflank.');
  }
  const env = loadPlatformAdminOperatorDatabaseEnv();
  return createDatabaseFromUrl(
    env.platformAdminOperatorDatabaseUrl,
    env.databaseSsl,
    1,
    env.databaseSslServerName,
  );
};

const readStatus = async (database: Sequelize, requestId: string): Promise<RecoveryStatusRow> => {
  const rows = await database.query<RecoveryStatusRow>(
    `SELECT
       recovery_request_id AS "requestId",
       primary_email AS "primaryEmail",
       display_name AS "displayName",
       request_status AS status,
       created_at AS "createdAt",
       expires_at AS "expiresAt",
       approved_at AS "approvedAt",
       approval_expires_at AS "approvalExpiresAt",
       enrollment_started_at AS "enrollmentStartedAt",
       enrollment_expires_at AS "enrollmentExpiresAt",
       completed_at AS "completedAt",
       revoked_at AS "revokedAt"
     FROM metas.get_platform_admin_mfa_recovery_status(CAST(:requestId AS UUID))`,
    { replacements: { requestId }, type: QueryTypes.SELECT },
  );
  const status = rows[0];
  if (!status) throw new Error('MFA recovery request was not found.');
  return status;
};

const approve = async (
  database: Sequelize,
  requestId: string,
  approvalTtlSeconds: number,
): Promise<RecoveryStatusRow> => {
  await database.query(
    `SELECT metas.approve_platform_admin_mfa_recovery(
       CAST(:requestId AS UUID),
       CURRENT_TIMESTAMP + make_interval(secs => :approvalTtlSeconds),
       CAST(:operationRequestId AS UUID)
     )`,
    {
      replacements: { approvalTtlSeconds, operationRequestId: randomUUID(), requestId },
      type: QueryTypes.SELECT,
    },
  );
  return readStatus(database, requestId);
};

const run = async (): Promise<void> => {
  const operation = process.argv[2] as Operation | undefined;
  if (operation !== 'approve' && operation !== 'status') {
    throw new Error('Expected the operation approve or status.');
  }
  const input = parsePlatformAdminMfaRecoveryOperationalInput(process.env);
  const database = createOperatorDatabase(process.argv[3]);
  try {
    await database.authenticate();
    await assertPlatformAdminOperatorConnectionSecurity(database);
    const status =
      operation === 'approve'
        ? await approve(database, input.requestId, input.approvalTtlSeconds)
        : await readStatus(database, input.requestId);
    logger.info('platform_admin_mfa_recovery_operation_completed', {
      approvalExpiresAt: status.approvalExpiresAt?.toISOString() ?? null,
      approvedAt: status.approvedAt?.toISOString() ?? null,
      completedAt: status.completedAt?.toISOString() ?? null,
      createdAt: status.createdAt.toISOString(),
      displayName: status.displayName,
      enrollmentExpiresAt: status.enrollmentExpiresAt?.toISOString() ?? null,
      enrollmentStartedAt: status.enrollmentStartedAt?.toISOString() ?? null,
      expiresAt: status.expiresAt.toISOString(),
      operation,
      primaryEmail: status.primaryEmail,
      requestId: status.requestId,
      revokedAt: status.revokedAt?.toISOString() ?? null,
      status: status.status,
    });
  } finally {
    await disconnectDatabase(database);
  }
};

void run().catch((error: unknown) => {
  logger.error('platform_admin_mfa_recovery_operation_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
