import type { GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';
import type {
  DailyGoalsCalculationResult,
  DailyGoalsStatus,
  TeamDistribution,
  TeamWeightSummary,
} from '@/features/metas/types/teamDistribution.types';
import { calculateCurrentGoalMetrics } from '@/features/metas/utils/calculateCurrentGoal';

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

function hasValidTeam(team: readonly TeamDistribution[]): boolean {
  return team.every(
    ({ quantity, weight }) =>
      Number.isInteger(quantity) && quantity >= 0 && Number.isFinite(weight) && weight >= 0,
  );
}

export function calculateTeamWeightSummary(team: readonly TeamDistribution[]): TeamWeightSummary {
  const roles = team.map((role) => {
    const hasValidValues =
      Number.isInteger(role.quantity) &&
      role.quantity >= 0 &&
      Number.isFinite(role.weight) &&
      role.weight >= 0;
    const weightedGroupValue = hasValidValues ? role.quantity * role.weight : 0;

    return {
      ...role,
      weightedGroupValue:
        Number.isFinite(weightedGroupValue) && weightedGroupValue >= 0 ? weightedGroupValue : 0,
    };
  });
  const totalTeamWeight = roles.reduce((total, role) => total + role.weightedGroupValue, 0);

  return {
    roles,
    totalTeamWeight: Number.isFinite(totalTeamWeight) && totalTeamWeight >= 0 ? totalTeamWeight : 0,
  };
}

export function calculateDailyGoals(
  settings: GoalGeneralSettings,
  team: readonly TeamDistribution[],
): DailyGoalsCalculationResult {
  if (!hasValidGeneralSettings(settings) || !hasValidTeam(team)) {
    return createEmptyResult('invalid-settings', 'Revise os valores informados para calcular.');
  }

  const currentGoalMetrics = calculateCurrentGoalMetrics(settings);
  const { remaining: remainingAmount } = currentGoalMetrics;

  if (remainingAmount === 0) {
    return createEmptyResult('goal-achieved', 'Meta mensal atingida.');
  }

  if (settings.remainingBusinessDays === 0) {
    return createEmptyResult(
      'no-days',
      'Não há dias restantes para calcular as metas.',
      remainingAmount,
    );
  }

  const totalEmployees = team.reduce((total, role) => total + role.quantity, 0);

  if (totalEmployees === 0) {
    return createEmptyResult(
      'empty-team',
      'Cadastre ao menos um funcionário na equipe.',
      remainingAmount,
    );
  }

  const weightSummary = calculateTeamWeightSummary(team);
  const { totalTeamWeight } = weightSummary;

  if (!Number.isFinite(totalTeamWeight) || totalTeamWeight <= 0) {
    return createEmptyResult(
      'zero-weight',
      'O peso total da equipe precisa ser maior que zero.',
      remainingAmount,
    );
  }

  const dailyStoreGoal = currentGoalMetrics.dailyTarget;

  if (!Number.isFinite(dailyStoreGoal) || dailyStoreGoal < 0) {
    return createEmptyResult('invalid-settings', 'Revise os valores informados para calcular.');
  }

  const roles = weightSummary.roles
    .filter((role) => role.quantity > 0)
    .map((role) => {
      const weightedGroupShare = role.weightedGroupValue / totalTeamWeight;
      const dailyGoalPerEmployee = (dailyStoreGoal * role.weight) / totalTeamWeight;
      const dailyGoalForGroup = dailyGoalPerEmployee * role.quantity;

      return {
        ...role,
        dailyGoalForGroup:
          Number.isFinite(dailyGoalForGroup) && dailyGoalForGroup >= 0 ? dailyGoalForGroup : 0,
        dailyGoalPerEmployee:
          Number.isFinite(dailyGoalPerEmployee) && dailyGoalPerEmployee >= 0
            ? dailyGoalPerEmployee
            : 0,
        weightedGroupShare:
          Number.isFinite(weightedGroupShare) && weightedGroupShare >= 0 ? weightedGroupShare : 0,
      };
    });

  return {
    dailyStoreGoal,
    remainingAmount,
    roles,
    status: 'success',
    totalTeamWeight,
  };
}
