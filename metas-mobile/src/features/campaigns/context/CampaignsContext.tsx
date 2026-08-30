import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { campaignsApi } from '@/features/campaigns/api/campaignsApi';
import { campaignsReducer, initialCampaignsState } from '@/features/campaigns/state/campaignsState';
import type {
  Campaign,
  CampaignInput,
  CampaignProgressEntry,
  CampaignProgressInput,
} from '@/features/campaigns/types/campaign.types';
import { getCampaignApiErrorMessage } from '@/features/campaigns/utils/campaignApiError';
import { useRealtime } from '@/realtime/RealtimeContext';

interface CampaignsContextValue {
  closeCampaign(campaign: Campaign): Promise<Campaign>;
  createCampaign(input: CampaignInput): Promise<Campaign>;
  campaigns: Campaign[];
  errorMessage: string | null;
  isLoading: boolean;
  listProgress(campaignId: string): Promise<CampaignProgressEntry[]>;
  refreshCampaigns(): Promise<void>;
  registerProgress(
    campaignId: string,
    input: CampaignProgressInput,
  ): Promise<CampaignProgressEntry>;
  updateCampaign(campaign: Campaign, input: CampaignInput): Promise<Campaign>;
}

const CampaignsContext = createContext<CampaignsContextValue | null>(null);

export function CampaignsProvider({ children }: PropsWithChildren) {
  const { status: authStatus, user } = useAuth();
  const { subscribe } = useRealtime();
  const [state, dispatch] = useReducer(campaignsReducer, initialCampaignsState);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const isManager = user?.role === 'GESTOR';
  const sessionKey = authStatus === 'authenticated' && user ? `${user.id}:${user.role}` : null;
  const sessionKeyRef = useRef<string | null>(sessionKey);

  const loadCampaigns = useCallback(
    (showLoading: boolean): Promise<void> => {
      if (!sessionKey) return Promise.resolve();
      if (loadPromiseRef.current) return loadPromiseRef.current;
      if (showLoading) dispatch({ type: 'loadStarted' });

      const request = campaignsApi
        .list(isManager)
        .then((campaigns) => {
          if (sessionKeyRef.current === sessionKey) {
            dispatch({ type: 'loadSucceeded', campaigns });
          }
        })
        .catch((error: unknown) => {
          if (sessionKeyRef.current === sessionKey) {
            dispatch({ type: 'loadFailed', errorMessage: getCampaignApiErrorMessage(error) });
          }
        })
        .finally(() => {
          if (loadPromiseRef.current === request) loadPromiseRef.current = null;
        });
      loadPromiseRef.current = request;
      return request;
    },
    [isManager, sessionKey],
  );

  const refreshCampaigns = useCallback(() => loadCampaigns(true), [loadCampaigns]);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
    loadPromiseRef.current = null;
    if (sessionKey) {
      void refreshCampaigns();
      return;
    }
    dispatch({ type: 'reset' });
  }, [refreshCampaigns, sessionKey]);

  useEffect(() => {
    if (!sessionKey) return undefined;
    return subscribe('campaigns.changed', () => loadCampaigns(false));
  }, [loadCampaigns, sessionKey, subscribe]);

  const createCampaign = useCallback(async (input: CampaignInput): Promise<Campaign> => {
    const campaign = await campaignsApi.create(input);
    dispatch({ type: 'upserted', campaign });
    return campaign;
  }, []);

  const updateCampaign = useCallback(
    async (campaign: Campaign, input: CampaignInput): Promise<Campaign> => {
      const updatedCampaign = await campaignsApi.update(campaign, input);
      dispatch({ type: 'upserted', campaign: updatedCampaign });
      return updatedCampaign;
    },
    [],
  );

  const closeCampaign = useCallback(async (campaign: Campaign): Promise<Campaign> => {
    const closedCampaign = await campaignsApi.close(campaign);
    dispatch({ type: 'upserted', campaign: closedCampaign });
    return closedCampaign;
  }, []);

  const listProgress = useCallback(
    (campaignId: string): Promise<CampaignProgressEntry[]> => campaignsApi.listProgress(campaignId),
    [],
  );

  const registerProgress = useCallback(
    async (campaignId: string, input: CampaignProgressInput): Promise<CampaignProgressEntry> => {
      const result = await campaignsApi.createProgress(campaignId, input);
      dispatch({ type: 'upserted', campaign: result.campaign });
      return result.entry;
    },
    [],
  );

  const value = useMemo<CampaignsContextValue>(
    () => ({
      campaigns: state.campaigns,
      closeCampaign,
      createCampaign,
      errorMessage: state.errorMessage,
      isLoading: state.status === 'idle' || state.status === 'loading',
      listProgress,
      refreshCampaigns,
      registerProgress,
      updateCampaign,
    }),
    [
      closeCampaign,
      createCampaign,
      listProgress,
      refreshCampaigns,
      registerProgress,
      state,
      updateCampaign,
    ],
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
