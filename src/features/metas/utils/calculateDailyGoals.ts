import type { GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';
import type {
  DailyGoalsCalculationResult,
  DailyGoalsStatus,
  TeamDistribution,
} from '@/features/metas/types/teamDistribution.types';

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

export function calculateDailyGoals(
  settings: GoalGeneralSettings,
  team: readonly TeamDistribution[],
): DailyGoalsCalculationResult {
  if (!hasValidGeneralSettings(settings) || !hasValidTeam(team)) {
    return createEmptyResult('invalid-settings', 'Revise os valores informados para calcular.');
  }

  const remainingAmount = Math.max(settings.monthlyTarget - settings.soldAmount, 0);

  if (remainingAmount === 0) {
    return createEmptyResult('goal-achieved', 'Meta mensal atingida.');
  }

  if (settings.remainingBusinessDays === 0) {
    return createEmptyResult(
      'no-business-days',
      'Não há dias úteis restantes para calcular as metas.',
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

  const totalTeamWeight = team.reduce((total, role) => total + role.quantity * role.weight, 0);

  if (!Number.isFinite(totalTeamWeight) || totalTeamWeight <= 0) {
    return createEmptyResult(
      'zero-weight',
      'O peso total da equipe precisa ser maior que zero.',
      remainingAmount,
    );
  }

  const dailyStoreGoal = remainingAmount / settings.remainingBusinessDays;

  if (!Number.isFinite(dailyStoreGoal) || dailyStoreGoal < 0) {
    return createEmptyResult('invalid-settings', 'Revise os valores informados para calcular.');
  }

  const roles = team
    .filter((role) => role.quantity > 0)
    .map((role) => ({
      ...role,
      dailyGoalPerEmployee: (dailyStoreGoal * role.weight) / totalTeamWeight,
    }));

  return {
    dailyStoreGoal,
    remainingAmount,
    roles,
    status: 'success',
    totalTeamWeight,
  };
}
