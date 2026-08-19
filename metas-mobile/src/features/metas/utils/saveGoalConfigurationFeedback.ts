import { getGoalApiErrorMessage } from '@/features/metas/utils/goalApiError';

export interface GoalSaveFeedback {
  message: string;
  type: 'error' | 'success';
}

export async function saveGoalConfigurationWithFeedback(
  save: () => Promise<void>,
): Promise<GoalSaveFeedback> {
  try {
    await save();
    return { message: 'Configuração salva com sucesso.', type: 'success' };
  } catch (error: unknown) {
    return { message: getGoalApiErrorMessage(error), type: 'error' };
  }
}
