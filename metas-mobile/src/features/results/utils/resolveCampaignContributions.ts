import type { Campaign } from '@/features/campaigns/types/campaign.types';
import type { EmployeeCampaignContribution } from '@/features/employees/types/employee.types';

export interface ResolvedCampaignContribution {
  campaign: Campaign;
  contributedQuantity: number;
}

export function resolveCampaignContributions(
  campaigns: readonly Campaign[],
  contributions: readonly EmployeeCampaignContribution[],
): ResolvedCampaignContribution[] {
  return contributions.reduce<ResolvedCampaignContribution[]>((resolved, contribution) => {
    const campaign = campaigns.find((item) => item.id === contribution.campaignId);
    const contributedQuantity =
      Number.isFinite(contribution.contributedQuantity) && contribution.contributedQuantity > 0
        ? Math.floor(contribution.contributedQuantity)
        : 0;

    if (campaign && campaign.targetQuantity !== null && contributedQuantity > 0) {
      resolved.push({ campaign, contributedQuantity });
    }

    return resolved;
  }, []);
}
