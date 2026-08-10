import type { EmployeeRole } from '@/shared/types/userRole';

export type TeamRole = EmployeeRole;

export interface TeamDistribution {
  quantity: number;
  role: TeamRole;
  weight: number;
}

export interface DailyGoalByRole extends TeamDistribution {
  dailyGoalPerEmployee: number;
}

export type DailyGoalsStatus =
  | 'success'
  | 'goal-achieved'
  | 'invalid-settings'
  | 'no-business-days'
  | 'empty-team'
  | 'zero-weight';

export interface DailyGoalsCalculationResult {
  dailyStoreGoal: number;
  message?: string;
  remainingAmount: number;
  roles: DailyGoalByRole[];
  status: DailyGoalsStatus;
  totalTeamWeight: number;
}
