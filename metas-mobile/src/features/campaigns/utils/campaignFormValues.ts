import type { CampaignFormValues } from '@/features/campaigns/types/campaign.types';

export function changeCampaignQuantityControl(
  values: CampaignFormValues,
  usesQuantity: boolean,
): CampaignFormValues {
  if (values.usesQuantity === usesQuantity) {
    return values;
  }

  return { ...values, targetQuantity: '', usesQuantity };
}
