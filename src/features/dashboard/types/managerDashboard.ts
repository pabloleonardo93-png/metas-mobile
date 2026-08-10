import type { EmployeeRole, UserRole } from '@/shared/types/userRole';

export interface ManagerDashboardUser {
  name: string;
  role: Extract<UserRole, 'GESTOR'>;
}

export interface ManagerStoreGoal {
  remainingBusinessDays: number;
  sold: number;
  target: number;
  totalBusinessDays: number;
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
  goal: ManagerStoreGoal;
  manager: ManagerDashboardUser;
  team: ManagerTeamPerformance[];
}

export interface ManagerDashboardMetrics {
  activeEmployees: number;
  dailyTarget: number;
  activeCampaigns: number;
  progress: number;
  remaining: number;
  remainingBusinessDays: number;
  sold: number;
  target: number;
}
