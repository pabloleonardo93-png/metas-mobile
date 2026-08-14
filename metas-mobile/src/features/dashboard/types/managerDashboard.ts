import type { EmployeeRole } from '@/shared/types/userRole';
import type { CurrentGoalMetrics } from '@/features/metas/types/goalSettings.types';

export interface ManagerTeamProgress {
  progress: number;
  role: EmployeeRole;
}

export interface ManagerTeamPerformance extends ManagerTeamProgress {
  quantity: number;
}

export interface ManagerEmployeeNearGoal {
  id: string;
  name: string;
  progress: number;
  role: EmployeeRole;
}

export interface ManagerDashboardData {
  employeesNearGoal: ManagerEmployeeNearGoal[];
  team: ManagerTeamProgress[];
}

export interface ManagerDashboardMetrics extends CurrentGoalMetrics {
  activeEmployees: number;
  activeCampaigns: number;
}
