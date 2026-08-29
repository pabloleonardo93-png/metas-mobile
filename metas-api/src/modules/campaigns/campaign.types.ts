import type { AuthenticatedSession } from '../auth/auth.types.js';

export type CampaignStatus = 'AGENDADA' | 'ATIVA' | 'ENCERRADA';

export interface CampaignDto {
  createdAt: string;
  endDate: string;
  id: string;
  lockVersion: number;
  name: string;
  soldQuantity: number;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: string;
  targetQuantity: number | null;
  updatedAt: string;
}

export interface CampaignMutationInput {
  endDate: string;
  name: string;
  startDate: string;
  targetAmountCents: string;
  targetQuantity: number | null;
}

export interface CampaignService {
  close(
    session: AuthenticatedSession,
    campaignId: string,
    expectedLockVersion: number,
  ): Promise<CampaignDto>;
  create(session: AuthenticatedSession, input: CampaignMutationInput): Promise<CampaignDto>;
  getById(session: AuthenticatedSession, campaignId: string): Promise<CampaignDto>;
  list(session: AuthenticatedSession): Promise<CampaignDto[]>;
  update(
    session: AuthenticatedSession,
    campaignId: string,
    input: CampaignMutationInput,
    expectedLockVersion: number,
  ): Promise<CampaignDto>;
}
