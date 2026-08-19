import type {
  Campaign,
  CampaignFilter,
  CampaignMetrics,
  CampaignStatus,
} from '@/features/campaigns/types/campaign.types';
import { getTodayIso, isValidIsoDate } from '@/features/campaigns/utils/campaignDates';
import { calculateProgress } from '@/shared/utils/calculateProgress';

function normalizeQuantity(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeMoneyCents(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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

export function resolveCampaignStatus(
  campaign: Campaign,
  todayIso = getTodayIso(),
): CampaignStatus {
  if (campaign.status === 'ENCERRADA') {
    return 'ENCERRADA';
  }

  if (
    !isValidIsoDate(campaign.startDate) ||
    !isValidIsoDate(campaign.endDate) ||
    !isValidIsoDate(todayIso)
  ) {
    return campaign.status;
  }

  if (todayIso < campaign.startDate) {
    return 'AGENDADA';
  }

  if (todayIso > campaign.endDate) {
    return 'ENCERRADA';
  }

  return 'ATIVA';
}

export function normalizeCampaign(campaign: Campaign, todayIso = getTodayIso()): Campaign {
  return {
    ...campaign,
    soldQuantity: normalizeQuantity(campaign.soldQuantity),
    status: resolveCampaignStatus(campaign, todayIso),
    targetAmountCents: normalizeMoneyCents(campaign.targetAmountCents),
    targetQuantity: normalizeQuantity(campaign.targetQuantity),
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
