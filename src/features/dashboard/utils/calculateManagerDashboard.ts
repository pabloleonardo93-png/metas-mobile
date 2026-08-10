import { calculateProgress } from '@/features/dashboard/utils/calculateProgress';
import type {
  ManagerDashboardMetrics,
  ManagerStoreGoal,
  ManagerTeamPerformance,
} from '@/features/dashboard/types/managerDashboard';
import {
  calculateDailyGoalAmount,
  calculateRemainingGoalAmount,
} from '@/shared/utils/goalCalculations';

function normalizeAmount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function countActiveEmployees(team: readonly ManagerTeamPerformance[]): number {
  return team.reduce((total, item) => {
    const quantity = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;

    return total + quantity;
  }, 0);
}

export function calculateManagerDashboardMetrics(
  goal: ManagerStoreGoal,
  team: readonly ManagerTeamPerformance[],
  activeCampaigns: number,
): ManagerDashboardMetrics {
  const target = normalizeAmount(goal.target);
  const sold = normalizeAmount(goal.sold);
  const remaining = calculateRemainingGoalAmount(target, sold);
  const remainingBusinessDays =
    Number.isInteger(goal.remainingBusinessDays) && goal.remainingBusinessDays > 0
      ? goal.remainingBusinessDays
      : 0;

  return {
    activeEmployees: countActiveEmployees(team),
    dailyTarget: calculateDailyGoalAmount(remaining, remainingBusinessDays),
    activeCampaigns: Number.isInteger(activeCampaigns) && activeCampaigns > 0 ? activeCampaigns : 0,
    progress: calculateProgress(sold, target),
    remaining,
    remainingBusinessDays,
    sold,
    target,
  };
}
