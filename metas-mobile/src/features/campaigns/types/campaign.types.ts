export type CampaignStatus = 'ATIVA' | 'AGENDADA' | 'ENCERRADA';

export interface Campaign {
  createdAt: string;
  endDate: string;
  id: string;
  lockVersion: number;
  name: string;
  soldAmountCents: number;
  soldQuantity: number | null;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: number;
  targetQuantity: number | null;
  updatedAt: string;
}

export interface CampaignProgressEntry {
  amountCents: number;
  campaignId: string;
  createdAt: string;
  createdByName: string;
  createdByUserId: string;
  id: string;
  quantity: number | null;
}

export interface CampaignProgressInput {
  amountCents: number;
  quantity: number | null;
}

export interface CampaignProgressResult {
  campaign: Campaign;
  entry: CampaignProgressEntry;
}

export type CampaignInput = Pick<
  Campaign,
  'endDate' | 'name' | 'startDate' | 'targetAmountCents' | 'targetQuantity'
>;

export type CampaignFilter = 'ALL' | CampaignStatus;

export interface CampaignFormValues {
  endDate: string;
  name: string;
  startDate: string;
  targetAmount: string;
  targetQuantity: string;
  usesQuantity: boolean;
}

export type CampaignFormErrors = Partial<Record<keyof CampaignFormValues, string>>;

export interface CampaignMetrics {
  financialProgress: number;
  quantity: CampaignQuantityMetrics | null;
  remainingAmountCents: number;
  soldAmountCents: number;
  targetAmountCents: number;
}

export interface CampaignQuantityMetrics {
  progress: number;
  remainingQuantity: number;
  soldQuantity: number;
  targetQuantity: number;
}
