import { sessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import { CampaignApiClient } from '@/features/campaigns/services/campaignApiClient';
import { apiRequest } from '@/shared/api/apiClient';

export const campaignsApi = new CampaignApiClient(apiRequest, sessionTokenStorage);
