export type CampaignStatus = 'ATIVA' | 'AGENDADA' | 'ENCERRADA';

export interface Campaign {
  endDate: string;
  id: string;
  name: string;
  soldQuantity: number;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: number;
  targetQuantity: number;
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
}

export type CampaignFormErrors = Partial<Record<keyof CampaignFormValues, string>>;

export interface CampaignMetrics {
  progress: number;
  remainingQuantity: number;
  soldQuantity: number;
  targetQuantity: number;
}
