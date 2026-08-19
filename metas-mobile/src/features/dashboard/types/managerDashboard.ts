import type { EmployeeRole } from '@/shared/types/userRole';
import type { CurrentGoalMetrics } from '@/features/metas/types/goalSettings.types';

export interface ManagerTeamPerformance {
  quantity: number;
  role: EmployeeRole;
}

export interface ManagerDashboardMetrics extends CurrentGoalMetrics {
  activeEmployees: number;
  activeCampaigns: number;
}
