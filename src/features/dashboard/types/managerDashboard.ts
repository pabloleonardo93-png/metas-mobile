import type { EmployeeRole, UserRole } from '@/shared/types/userRole';
import type { CurrentGoalMetrics } from '@/features/metas/types/goalSettings.types';

export interface ManagerDashboardUser {
  name: string;
  role: Extract<UserRole, 'GESTOR'>;
}

export interface ManagerTeamPerformance {
  progress: number;
  quantity: number;
  role: EmployeeRole;
}

export interface ManagerEmployeeNearGoal {
  id: string;
  name: string;
  progress: number;
  role: EmployeeRole;
}

export interface ManagerDashboardData {
  employeesNearGoal: ManagerEmployeeNearGoal[];
  manager: ManagerDashboardUser;
  team: ManagerTeamPerformance[];
}

export interface ManagerDashboardMetrics extends CurrentGoalMetrics {
  activeEmployees: number;
  activeCampaigns: number;
}
