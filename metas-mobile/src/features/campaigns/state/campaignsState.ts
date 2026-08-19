import type { Campaign } from '@/features/campaigns/types/campaign.types';

export interface CampaignsState {
  campaigns: Campaign[];
  errorMessage: string | null;
  status: 'error' | 'idle' | 'loading' | 'ready';
}

export type CampaignsAction =
  | { type: 'loadFailed'; errorMessage: string }
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; campaigns: Campaign[] }
  | { type: 'reset' }
  | { type: 'upserted'; campaign: Campaign };

export const initialCampaignsState: CampaignsState = {
  campaigns: [],
  errorMessage: null,
  status: 'idle',
};

export function campaignsReducer(state: CampaignsState, action: CampaignsAction): CampaignsState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, errorMessage: null, status: 'loading' };
    case 'loadSucceeded':
      return { campaigns: action.campaigns, errorMessage: null, status: 'ready' };
    case 'loadFailed':
      return { ...state, errorMessage: action.errorMessage, status: 'error' };
    case 'upserted': {
      const exists = state.campaigns.some((campaign) => campaign.id === action.campaign.id);
      return {
        campaigns: exists
          ? state.campaigns.map((campaign) =>
              campaign.id === action.campaign.id ? action.campaign : campaign,
            )
          : [action.campaign, ...state.campaigns],
        errorMessage: null,
        status: 'ready',
      };
    }
    case 'reset':
      return initialCampaignsState;
  }
}
