import { QueryTypes, type Sequelize } from 'sequelize';

import { withPlatformAdminDatabaseContext } from '../../shared/database/withPlatformAdminDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { PlatformAdminSession } from '../platformAdmin/platformAdmin.types.js';
import {
  platformAdminAccessListSchema,
  type PlatformAdminAccessList,
  type PlatformAdminInvitationInput,
} from './platformAdminAccess.contracts.js';

const knownErrors: Readonly<Record<string, [number, string]>> = {
  PLATFORM_ADMIN_ACCESS_ALREADY_EXISTS: [409, 'Esta conta já possui acesso administrativo.'],
  PLATFORM_ADMIN_INVITATION_ALREADY_PENDING: [
    409,
    'Já existe um acesso pendente para este e-mail.',
  ],
  PLATFORM_ADMIN_INVITATION_NOT_AVAILABLE: [409, 'Este acesso pendente não está mais disponível.'],
  PLATFORM_ADMIN_SELF_APPROVAL_FORBIDDEN: [
    403,
    'Outra pessoa administradora deve aprovar esta solicitação.',
  ],
  FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE: [409, 'Esta solicitação não está mais disponível.'],
  PLATFORM_ADMIN_STEP_UP_REQUIRED: [403, 'Confirme sua identidade novamente para continuar.'],
  MANAGEMENT_MFA_REQUIRED: [403, 'Confirme sua identidade novamente para continuar.'],
  MANAGEMENT_FORBIDDEN: [403, 'Operação não autorizada.'],
  PLATFORM_ADMIN_ACCESS_INVALID_INPUT: [422, 'Revise os dados informados.'],
};

const accessError = (error: unknown): AppError => {
  const parent = error && typeof error === 'object' && 'parent' in error ? error.parent : null;
  const details = parent && typeof parent === 'object' ? parent : error;
  const message =
    details && typeof details === 'object' && 'message' in details ? details.message : null;
  if (typeof message === 'string' && Object.hasOwn(knownErrors, message)) {
    const [status, safeMessage] = knownErrors[message]!;
    return new AppError(status, message, safeMessage);
  }
  return new AppError(
    503,
    'PLATFORM_ADMIN_ACCESS_UNAVAILABLE',
    'Não foi possível concluir a operação.',
  );
};

export interface PlatformAdminAccessService {
  list(session: PlatformAdminSession): Promise<PlatformAdminAccessList>;
  invite(
    session: PlatformAdminSession,
    input: PlatformAdminInvitationInput,
    requestId: string,
  ): Promise<{ id: string }>;
  cancel(
    session: PlatformAdminSession,
    invitationId: string,
    requestId: string,
  ): Promise<{ id: string }>;
  approveFirstEnrollment(
    session: PlatformAdminSession,
    enrollmentRequestId: string,
    requestId: string,
  ): Promise<{ id: string }>;
}

export class PostgresPlatformAdminAccessService implements PlatformAdminAccessService {
  public constructor(
    private readonly database: Sequelize,
    private readonly stepUpTtlSeconds: number,
    private readonly invitationTtlSeconds = 604_800,
    private readonly approvalTtlSeconds = 300,
  ) {}

  private context<Result>(
    session: PlatformAdminSession,
    callback: Parameters<typeof withPlatformAdminDatabaseContext<Result>>[2],
  ) {
    return withPlatformAdminDatabaseContext(
      this.database,
      { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
      callback,
    );
  }

  private minimumStepUpAt(): Date {
    return new Date(Date.now() - this.stepUpTtlSeconds * 1000);
  }

  public async list(session: PlatformAdminSession): Promise<PlatformAdminAccessList> {
    try {
      return await this.context(session, async (transaction) => {
        const rows = await this.database.query<{ result: unknown }>(
          'SELECT metas.read_platform_admin_access() AS result',
          { transaction, type: QueryTypes.SELECT },
        );
        return platformAdminAccessListSchema.parse(rows[0]?.result);
      });
    } catch (error) {
      throw accessError(error);
    }
  }

  public async invite(
    session: PlatformAdminSession,
    input: PlatformAdminInvitationInput,
    requestId: string,
  ): Promise<{ id: string }> {
    try {
      return await this.context(session, async (transaction) => {
        const rows = await this.database.query<{ id: string }>(
          `SELECT metas.create_platform_admin_invitation(
            :displayName, :email,
            CURRENT_TIMESTAMP + make_interval(secs => :invitationTtlSeconds),
            :minimumStepUpAt, CAST(:requestId AS UUID)
          ) AS id`,
          {
            replacements: {
              ...input,
              invitationTtlSeconds: this.invitationTtlSeconds,
              minimumStepUpAt: this.minimumStepUpAt(),
              requestId,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (!rows[0]?.id) throw new Error('PLATFORM_ADMIN_ACCESS_UNAVAILABLE');
        return { id: rows[0].id };
      });
    } catch (error) {
      throw accessError(error);
    }
  }

  public async cancel(
    session: PlatformAdminSession,
    invitationId: string,
    requestId: string,
  ): Promise<{ id: string }> {
    try {
      return await this.context(session, async (transaction) => {
        const rows = await this.database.query<{ id: string }>(
          `SELECT metas.cancel_platform_admin_invitation(
            CAST(:invitationId AS UUID), :minimumStepUpAt, CAST(:requestId AS UUID)
          ) AS id`,
          {
            replacements: { invitationId, minimumStepUpAt: this.minimumStepUpAt(), requestId },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (!rows[0]?.id) throw new Error('PLATFORM_ADMIN_ACCESS_UNAVAILABLE');
        return { id: rows[0].id };
      });
    } catch (error) {
      throw accessError(error);
    }
  }

  public async approveFirstEnrollment(
    session: PlatformAdminSession,
    enrollmentRequestId: string,
    requestId: string,
  ): Promise<{ id: string }> {
    try {
      return await this.context(session, async (transaction) => {
        const rows = await this.database.query<{ id: string }>(
          `SELECT metas.approve_platform_admin_first_enrollment_by_admin(
            CAST(:enrollmentRequestId AS UUID),
            CURRENT_TIMESTAMP + make_interval(secs => :approvalTtlSeconds),
            :minimumStepUpAt, CAST(:requestId AS UUID)
          ) AS id`,
          {
            replacements: {
              enrollmentRequestId,
              approvalTtlSeconds: this.approvalTtlSeconds,
              minimumStepUpAt: this.minimumStepUpAt(),
              requestId,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (!rows[0]?.id) throw new Error('PLATFORM_ADMIN_ACCESS_UNAVAILABLE');
        return { id: rows[0].id };
      });
    } catch (error) {
      throw accessError(error);
    }
  }
}
