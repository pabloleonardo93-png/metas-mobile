import type { CampaignStatus } from '@/features/campaigns/types/campaign.types';

export const CAMPAIGN_STATUS_LABELS = {
  AGENDADA: 'Agendada',
  ATIVA: 'Ativa',
  ENCERRADA: 'Encerrada',
} as const satisfies Record<CampaignStatus, string>;
