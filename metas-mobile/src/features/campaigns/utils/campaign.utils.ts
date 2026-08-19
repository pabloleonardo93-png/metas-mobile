import type {
  Campaign,
  CampaignFilter,
  CampaignMetrics,
} from '@/features/campaigns/types/campaign.types';
import { calculateProgress } from '@/shared/utils/calculateProgress';

function normalizeQuantity(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function calculateCampaignMetrics(campaign: Campaign): CampaignMetrics {
  const targetQuantity = normalizeQuantity(campaign.targetQuantity);
  const soldQuantity = normalizeQuantity(campaign.soldQuantity);

  return {
    progress: calculateProgress(soldQuantity, targetQuantity),
    remainingQuantity: Math.max(targetQuantity - soldQuantity, 0),
    soldQuantity,
    targetQuantity,
  };
}

export function filterCampaigns(
  campaigns: readonly Campaign[],
  search: string,
  statusFilter: CampaignFilter,
): Campaign[] {
  const normalizedSearch = normalizeSearchText(search);

  return campaigns.filter((campaign) => {
    if (statusFilter !== 'ALL' && campaign.status !== statusFilter) {
      return false;
    }

    return !normalizedSearch || normalizeSearchText(campaign.name).includes(normalizedSearch);
  });
}

export function countActiveCampaigns(campaigns: readonly Campaign[]): number {
  return campaigns.filter((campaign) => campaign.status === 'ATIVA').length;
}

export function selectActiveCampaigns(campaigns: readonly Campaign[]): Campaign[] {
  return campaigns.filter((campaign) => campaign.status === 'ATIVA');
}
