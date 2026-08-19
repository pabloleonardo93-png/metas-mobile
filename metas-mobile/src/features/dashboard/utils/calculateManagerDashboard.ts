import type {
  ManagerDashboardMetrics,
  ManagerTeamPerformance,
} from '@/features/dashboard/types/managerDashboard';
import type { TeamRoleSummary } from '@/features/employees/types/employee.types';
import { TEAM_ROLES } from '@/features/metas/config/teamRoles';
import type { GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';
import { calculateCurrentGoalMetrics } from '@/features/metas/utils/calculateCurrentGoal';

export function buildManagerTeamPerformance(summary: TeamRoleSummary): ManagerTeamPerformance[] {
  return TEAM_ROLES.filter((role) => summary[role] > 0).map((role) => ({
    quantity: summary[role],
    role,
  }));
}

export function calculateManagerDashboardMetrics(
  goal: GoalGeneralSettings,
  activeEmployees: number,
  activeCampaigns: number,
): ManagerDashboardMetrics {
  const currentGoalMetrics = calculateCurrentGoalMetrics(goal);

  return {
    activeEmployees: Number.isInteger(activeEmployees) && activeEmployees > 0 ? activeEmployees : 0,
    activeCampaigns: Number.isInteger(activeCampaigns) && activeCampaigns > 0 ? activeCampaigns : 0,
    ...currentGoalMetrics,
  };
}
