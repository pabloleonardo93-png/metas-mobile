import type {
  ManagerDashboardMetrics,
  ManagerTeamPerformance,
} from '@/features/dashboard/types/managerDashboard';
import type { GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';
import { calculateCurrentGoalMetrics } from '@/features/metas/utils/calculateCurrentGoal';

function countActiveEmployees(team: readonly ManagerTeamPerformance[]): number {
  return team.reduce((total, item) => {
    const quantity = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;

    return total + quantity;
  }, 0);
}

export function calculateManagerDashboardMetrics(
  goal: GoalGeneralSettings,
  team: readonly ManagerTeamPerformance[],
  activeCampaigns: number,
): ManagerDashboardMetrics {
  const currentGoalMetrics = calculateCurrentGoalMetrics(goal);

  return {
    activeEmployees: countActiveEmployees(team),
    activeCampaigns: Number.isInteger(activeCampaigns) && activeCampaigns > 0 ? activeCampaigns : 0,
    ...currentGoalMetrics,
  };
}
