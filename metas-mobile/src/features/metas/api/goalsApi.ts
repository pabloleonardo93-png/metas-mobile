import { sessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import { GoalConfigurationApiClient } from '@/features/metas/services/goalConfigurationApiClient';
import { apiRequest } from '@/shared/api/apiClient';

export const goalsApi = new GoalConfigurationApiClient(apiRequest, sessionTokenStorage);
