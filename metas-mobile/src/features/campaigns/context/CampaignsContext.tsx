import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { campaignsMock } from '@/features/campaigns/mocks/campaigns.mock';
import type { Campaign, CampaignInput } from '@/features/campaigns/types/campaign.types';
import { normalizeCampaign } from '@/features/campaigns/utils/campaign.utils';

interface CampaignsContextValue {
  campaigns: Campaign[];
  createCampaign: (input: CampaignInput) => Campaign;
  endCampaign: (campaignId: string) => void;
  updateCampaign: (campaignId: string, input: CampaignInput) => void;
}

const CampaignsContext = createContext<CampaignsContextValue | null>(null);

function cloneCampaigns(): Campaign[] {
  return campaignsMock.map((campaign) => normalizeCampaign({ ...campaign }));
}

export function CampaignsProvider({ children }: PropsWithChildren) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(cloneCampaigns);

  const createCampaign = useCallback((input: CampaignInput): Campaign => {
    const campaign = normalizeCampaign({
      ...input,
      id: `campaign-${Date.now()}`,
      soldQuantity: 0,
      status: 'ATIVA',
    });

    setCampaigns((currentCampaigns) => [campaign, ...currentCampaigns]);

    return campaign;
  }, []);

  const updateCampaign = useCallback((campaignId: string, input: CampaignInput) => {
    setCampaigns((currentCampaigns) =>
      currentCampaigns.map((campaign) =>
        campaign.id === campaignId ? normalizeCampaign({ ...campaign, ...input }) : campaign,
      ),
    );
  }, []);

  const endCampaign = useCallback((campaignId: string) => {
    setCampaigns((currentCampaigns) =>
      currentCampaigns.map((campaign) =>
        campaign.id === campaignId ? { ...campaign, status: 'ENCERRADA' } : campaign,
      ),
    );
  }, []);

  const value = useMemo(
    () => ({ campaigns, createCampaign, endCampaign, updateCampaign }),
    [campaigns, createCampaign, endCampaign, updateCampaign],
  );

  return <CampaignsContext.Provider value={value}>{children}</CampaignsContext.Provider>;
}

export function useCampaigns(): CampaignsContextValue {
  const context = useContext(CampaignsContext);

  if (!context) {
    throw new Error('useCampaigns deve ser usado dentro de CampaignsProvider.');
  }

  return context;
}
