import type {
  DailyGoalByRole,
  TeamDistribution,
  TeamWeightSummary,
} from '@/features/metas/types/teamDistribution.types';

export type WeightedDailyDistributionStatus =
  'success' | 'completed' | 'invalid-input' | 'no-days' | 'empty-team' | 'zero-weight';

export interface WeightedDailyDistributionResult {
  dailyStoreGoal: number;
  remainingAmount: number;
  roles: DailyGoalByRole[];
  status: WeightedDailyDistributionStatus;
  totalTeamWeight: number;
}

interface WeightedDailyDistributionInput {
  remainingAmount: number;
  remainingDays: number;
  team: readonly TeamDistribution[];
}

function createEmptyResult(
  status: Exclude<WeightedDailyDistributionStatus, 'success'>,
  remainingAmount = 0,
): WeightedDailyDistributionResult {
  return {
    dailyStoreGoal: 0,
    remainingAmount,
    roles: [],
    status,
    totalTeamWeight: 0,
  };
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

export function calculateWeightedDailyDistribution({
  remainingAmount,
  remainingDays,
  team,
}: WeightedDailyDistributionInput): WeightedDailyDistributionResult {
  if (
    !Number.isFinite(remainingAmount) ||
    remainingAmount < 0 ||
    !Number.isInteger(remainingDays) ||
    remainingDays < 0 ||
    !hasValidTeam(team)
  ) {
    return createEmptyResult('invalid-input');
  }

  if (remainingAmount === 0) {
    return createEmptyResult('completed');
  }

  if (remainingDays === 0) {
    return createEmptyResult('no-days', remainingAmount);
  }

  const totalEmployees = team.reduce((total, role) => total + role.quantity, 0);

  if (totalEmployees === 0) {
    return createEmptyResult('empty-team', remainingAmount);
  }

  const weightSummary = calculateTeamWeightSummary(team);
  const { totalTeamWeight } = weightSummary;

  if (!Number.isFinite(totalTeamWeight) || totalTeamWeight <= 0) {
    return createEmptyResult('zero-weight', remainingAmount);
  }

  const dailyStoreGoal = remainingAmount / remainingDays;

  if (!Number.isFinite(dailyStoreGoal) || dailyStoreGoal < 0) {
    return createEmptyResult('invalid-input');
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
