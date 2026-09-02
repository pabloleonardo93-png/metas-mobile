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
import { parsePlatformAdminFirstEnrollmentOperationalInput } from './platformAdminFirstEnrollmentInput.js';

type Operation = 'approve' | 'status';

interface FirstEnrollmentStatusRow {
  approvalExpiresAt: Date | null;
  approvedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  platformAdminId: string;
  requestId: string;
  revokedAt: Date | null;
  status: string;
}

const createPlatformAdminOperatorDatabase = (target: string | undefined): Sequelize => {
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

const readStatus = async (
  database: Sequelize,
  requestId: string,
): Promise<FirstEnrollmentStatusRow> => {
  const rows = await database.query<FirstEnrollmentStatusRow>(
    `SELECT
       enrollment_request_id AS "requestId",
       platform_admin_id AS "platformAdminId",
       request_status AS status,
       created_at AS "createdAt",
       expires_at AS "expiresAt",
       approved_at AS "approvedAt",
       approval_expires_at AS "approvalExpiresAt",
       consumed_at AS "consumedAt",
       revoked_at AS "revokedAt"
     FROM metas.get_platform_admin_first_enrollment_request_status(
       CAST(:requestId AS UUID)
     )`,
    { replacements: { requestId }, type: QueryTypes.SELECT },
  );
  const status = rows[0];
  if (!status) {
    throw new Error('First enrollment request was not found.');
  }
  return status;
};

const approve = async (
  database: Sequelize,
  requestId: string,
  approvalTtlSeconds: number,
): Promise<FirstEnrollmentStatusRow> => {
  const approvalExpiresAt = new Date(Date.now() + approvalTtlSeconds * 1000);
  await database.query(
    `SELECT metas.approve_platform_admin_first_enrollment(
       CAST(:requestId AS UUID), :approvalExpiresAt, CAST(:operationRequestId AS UUID)
     )`,
    {
      replacements: { approvalExpiresAt, operationRequestId: randomUUID(), requestId },
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
  const input = parsePlatformAdminFirstEnrollmentOperationalInput(process.env);
  const database = createPlatformAdminOperatorDatabase(process.argv[3]);
  try {
    await database.authenticate();
    await assertPlatformAdminOperatorConnectionSecurity(database);
    const status =
      operation === 'approve'
        ? await approve(database, input.requestId, input.approvalTtlSeconds)
        : await readStatus(database, input.requestId);
    logger.info('platform_admin_first_enrollment_operation_completed', {
      approvalExpiresAt: status.approvalExpiresAt?.toISOString() ?? null,
      approvedAt: status.approvedAt?.toISOString() ?? null,
      consumedAt: status.consumedAt?.toISOString() ?? null,
      createdAt: status.createdAt.toISOString(),
      expiresAt: status.expiresAt.toISOString(),
      operation,
      platformAdminId: status.platformAdminId,
      requestId: status.requestId,
      revokedAt: status.revokedAt?.toISOString() ?? null,
      status: status.status,
    });
  } finally {
    await disconnectDatabase(database);
  }
};

void run().catch((error: unknown) => {
  logger.error('platform_admin_first_enrollment_operation_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
