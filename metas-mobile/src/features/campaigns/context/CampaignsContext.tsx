import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';

import type { Campaign } from '@/features/campaigns/types/campaign.types';

interface CampaignsContextValue {
  campaigns: Campaign[];
}

const CampaignsContext = createContext<CampaignsContextValue | null>(null);

export function CampaignsProvider({ children }: PropsWithChildren) {
  const value = useMemo<CampaignsContextValue>(() => ({ campaigns: [] }), []);

  return <CampaignsContext.Provider value={value}>{children}</CampaignsContext.Provider>;
}

export function useCampaigns(): CampaignsContextValue {
  const context = useContext(CampaignsContext);

  if (!context) {
    throw new Error('useCampaigns deve ser usado dentro de CampaignsProvider.');
  }

  return context;
}
