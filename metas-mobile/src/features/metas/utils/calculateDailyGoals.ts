import type { GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';
import type {
  DailyGoalsCalculationResult,
  DailyGoalsStatus,
  TeamDistribution,
} from '@/features/metas/types/teamDistribution.types';
import { calculateCurrentGoalMetrics } from '@/features/metas/utils/calculateCurrentGoal';
import { calculateWeightedDailyDistribution } from '@/features/metas/utils/calculateWeightedDailyDistribution';

export { calculateTeamWeightSummary } from '@/features/metas/utils/calculateWeightedDailyDistribution';

function createEmptyResult(
  status: Exclude<DailyGoalsStatus, 'success'>,
  message: string,
  remainingAmount = 0,
): DailyGoalsCalculationResult {
  return {
    dailyStoreGoal: 0,
    message,
    remainingAmount,
    roles: [],
    status,
    totalTeamWeight: 0,
  };
}

function hasValidGeneralSettings(settings: GoalGeneralSettings): boolean {
  return (
    Number.isFinite(settings.monthlyTarget) &&
    settings.monthlyTarget > 0 &&
    Number.isFinite(settings.soldAmount) &&
    settings.soldAmount >= 0 &&
    Number.isInteger(settings.remainingBusinessDays) &&
    settings.remainingBusinessDays >= 0 &&
    Number.isInteger(settings.totalBusinessDays) &&
    settings.totalBusinessDays > 0 &&
    settings.remainingBusinessDays <= settings.totalBusinessDays
  );
}

export function calculateDailyGoals(
  settings: GoalGeneralSettings,
  team: readonly TeamDistribution[],
): DailyGoalsCalculationResult {
  if (!hasValidGeneralSettings(settings)) {
    return createEmptyResult('invalid-settings', 'Revise os valores informados para calcular.');
  }

  const currentGoalMetrics = calculateCurrentGoalMetrics(settings);
  const { remaining: remainingAmount } = currentGoalMetrics;
  const result = calculateWeightedDailyDistribution({
    remainingAmount,
    remainingDays: settings.remainingBusinessDays,
    team,
  });

  switch (result.status) {
    case 'success':
      return { ...result, status: 'success' };
    case 'completed':
      return createEmptyResult('goal-achieved', 'Meta mensal atingida.');
    case 'no-days':
      return createEmptyResult(
        'no-days',
        'Não há dias restantes para calcular as metas.',
        remainingAmount,
      );
    case 'empty-team':
      return createEmptyResult(
        'empty-team',
        'Cadastre ao menos um funcionário na equipe.',
        remainingAmount,
      );
    case 'zero-weight':
      return createEmptyResult(
        'zero-weight',
        'O peso total da equipe precisa ser maior que zero.',
        remainingAmount,
      );
    case 'invalid-input':
      return createEmptyResult('invalid-settings', 'Revise os valores informados para calcular.');
  }
}
