import type { AuthenticatedSession } from '../auth/auth.types.js';

export type CampaignStatus = 'AGENDADA' | 'ATIVA' | 'ENCERRADA';

export interface CampaignDto {
  createdAt: string;
  endDate: string;
  id: string;
  lockVersion: number;
  name: string;
  soldAmountCents: string;
  soldQuantity: number | null;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: string;
  targetQuantity: number | null;
  updatedAt: string;
}

export interface CampaignProgressEntryDto {
  amountCents: string;
  campaignId: string;
  createdAt: string;
  createdByName: string;
  createdByUserId: string;
  id: string;
  quantity: number | null;
}

export interface CampaignProgressInput {
  amountCents: string;
  quantity: number | null;
}

export interface CampaignProgressResultDto {
  campaign: CampaignDto;
  entry: CampaignProgressEntryDto;
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
  createProgress(
    session: AuthenticatedSession,
    campaignId: string,
    input: CampaignProgressInput,
  ): Promise<CampaignProgressResultDto>;
  getById(session: AuthenticatedSession, campaignId: string): Promise<CampaignDto>;
  list(session: AuthenticatedSession): Promise<CampaignDto[]>;
  listProgress(
    session: AuthenticatedSession,
    campaignId: string,
  ): Promise<CampaignProgressEntryDto[]>;
  update(
    session: AuthenticatedSession,
    campaignId: string,
    input: CampaignMutationInput,
    expectedLockVersion: number,
  ): Promise<CampaignDto>;
}
