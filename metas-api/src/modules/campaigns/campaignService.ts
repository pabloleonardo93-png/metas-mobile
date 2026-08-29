import { DatabaseError, QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { withDatabaseContext } from '../../shared/database/withDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import type {
  CampaignDto,
  CampaignMutationInput,
  CampaignService,
  CampaignStatus,
} from './campaign.types.js';

interface CampaignDatabaseRow {
  createdAt: Date | string;
  endDate: string;
  id: string;
  lockVersion: number;
  name: string;
  soldQuantity: number;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: string;
  targetQuantity: number | null;
  updatedAt: Date | string;
}

const requireManager = (session: AuthenticatedSession): void => {
  if (session.role !== 'GESTOR') {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
};

const databaseErrorContains = (error: unknown, signal: string): boolean =>
  error instanceof DatabaseError && error.parent.message.includes(signal);

const databaseErrorCode = (error: unknown): string | undefined =>
  error instanceof DatabaseError ? (error.parent as Error & { code?: string }).code : undefined;

const mapCampaignDatabaseError = (error: unknown, targetQuantity?: number | null): never => {
  if (databaseErrorContains(error, 'MANAGER_ACCESS_REQUIRED')) {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
  if (databaseErrorContains(error, 'CAMPAIGN_NOT_FOUND')) {
    throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
  }
  if (databaseErrorContains(error, 'CAMPAIGN_CLOSED')) {
    throw new AppError(409, 'CAMPAIGN_CLOSED', 'A campanha já está encerrada.');
  }
  if (databaseErrorContains(error, 'CAMPAIGN_CONFLICT')) {
    throw new AppError(
      409,
      'CAMPAIGN_CONFLICT',
      'A campanha foi alterada por outro Gestor. Recarregue e tente novamente.',
    );
  }
  const isInvalidCampaign =
    databaseErrorContains(error, 'INVALID_CAMPAIGN') || databaseErrorCode(error) === '22023';
  if (targetQuantity === null && (isInvalidCampaign || databaseErrorCode(error) === '23502')) {
    throw new AppError(
      503,
      'CAMPAIGN_QUANTITY_UNAVAILABLE',
      'Não foi possível salvar esta campanha no momento.',
    );
  }
  if (isInvalidCampaign) {
    throw new AppError(422, 'INVALID_INPUT', 'Os dados da campanha são inválidos.');
  }
  throw error;
};

const statusExpression = `
  CASE
    WHEN campaign.closed_at IS NOT NULL
      OR campaign.end_date < timezone(store.timezone, CURRENT_TIMESTAMP)::DATE
      THEN 'ENCERRADA'
    WHEN campaign.start_date > timezone(store.timezone, CURRENT_TIMESTAMP)::DATE
      THEN 'AGENDADA'
    ELSE 'ATIVA'
  END`;

const selectColumns = `
  campaign.id,
  campaign.name,
  campaign.target_quantity AS "targetQuantity",
  campaign.sold_quantity AS "soldQuantity",
  campaign.target_amount_cents::TEXT AS "targetAmountCents",
  campaign.start_date AS "startDate",
  campaign.end_date AS "endDate",
  ${statusExpression} AS status,
  campaign.lock_version AS "lockVersion",
  campaign.created_at AS "createdAt",
  campaign.updated_at AS "updatedAt"`;

const functionColumns = `
  id,
  name,
  target_quantity AS "targetQuantity",
  sold_quantity AS "soldQuantity",
  target_amount_cents AS "targetAmountCents",
  start_date AS "startDate",
  end_date AS "endDate",
  status,
  lock_version AS "lockVersion",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toCampaign = (row: CampaignDatabaseRow): CampaignDto => ({
  ...row,
  createdAt: toIsoString(row.createdAt),
  updatedAt: toIsoString(row.updatedAt),
});

export class PostgresCampaignService implements CampaignService {
  public constructor(private readonly database: Sequelize) {}

  public async list(session: AuthenticatedSession): Promise<CampaignDto[]> {
    const rows = await this.withContext(session, (transaction) =>
      this.database.query<CampaignDatabaseRow>(
        `SELECT ${selectColumns}
         FROM metas.campaigns campaign
         JOIN metas.stores store ON store.id = campaign.store_id
         ORDER BY campaign.start_date DESC, campaign.created_at DESC`,
        { transaction, type: QueryTypes.SELECT },
      ),
    );
    return rows.map(toCampaign);
  }

  public async getById(session: AuthenticatedSession, campaignId: string): Promise<CampaignDto> {
    const rows = await this.withContext(session, (transaction) =>
      this.database.query<CampaignDatabaseRow>(
        `SELECT ${selectColumns}
         FROM metas.campaigns campaign
         JOIN metas.stores store ON store.id = campaign.store_id
         WHERE campaign.id = :campaignId`,
        { replacements: { campaignId }, transaction, type: QueryTypes.SELECT },
      ),
    );
    const campaign = rows[0];
    if (!campaign) {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada.');
    }
    return toCampaign(campaign);
  }

  public async create(
    session: AuthenticatedSession,
    input: CampaignMutationInput,
  ): Promise<CampaignDto> {
    requireManager(session);
    return this.runMutation(session, 'manager_create_campaign', input);
  }

  public async update(
    session: AuthenticatedSession,
    campaignId: string,
    input: CampaignMutationInput,
    expectedLockVersion: number,
  ): Promise<CampaignDto> {
    requireManager(session);
    return this.runMutation(
      session,
      'manager_update_campaign',
      input,
      campaignId,
      expectedLockVersion,
    );
  }

  public async close(
    session: AuthenticatedSession,
    campaignId: string,
    expectedLockVersion: number,
  ): Promise<CampaignDto> {
    requireManager(session);
    try {
      const rows = await this.withContext(session, (transaction) =>
        this.database.query<CampaignDatabaseRow>(
          `SELECT ${functionColumns}
           FROM metas.manager_close_campaign(:campaignId, :expectedLockVersion)`,
          {
            replacements: { campaignId, expectedLockVersion },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      return this.requireMutationResult(rows);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      return mapCampaignDatabaseError(error);
    }
  }

  private async runMutation(
    session: AuthenticatedSession,
    functionName: 'manager_create_campaign' | 'manager_update_campaign',
    input: CampaignMutationInput,
    campaignId?: string,
    expectedLockVersion?: number,
  ): Promise<CampaignDto> {
    try {
      const rows = await this.withContext(session, (transaction) =>
        this.database.query<CampaignDatabaseRow>(
          `SELECT ${functionColumns}
           FROM metas.${functionName}(
             ${campaignId ? ':campaignId, ' : ''}
             :name,
             :targetQuantity,
             :targetAmountCents,
             :startDate,
             :endDate
             ${campaignId ? ', :expectedLockVersion' : ''}
           )`,
          {
            replacements: {
              ...input,
              ...(campaignId ? { campaignId, expectedLockVersion } : {}),
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      return this.requireMutationResult(rows);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      return mapCampaignDatabaseError(error, input.targetQuantity);
    }
  }

  private requireMutationResult(rows: CampaignDatabaseRow[]): CampaignDto {
    const campaign = rows[0];
    if (!campaign) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Ocorreu um erro interno.');
    }
    return toCampaign(campaign);
  }

  private withContext<Result>(
    session: AuthenticatedSession,
    callback: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result> {
    return withDatabaseContext(
      this.database,
      {
        employeeId: session.employeeId,
        storeId: session.storeId,
        userId: session.userId,
      },
      callback,
    );
  }
}
