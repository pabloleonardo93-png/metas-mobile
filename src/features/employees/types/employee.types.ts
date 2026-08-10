import type { UserRole } from '@/shared/types/userRole';

export type EmployeeStatus = 'ATIVO' | 'INATIVO';

export interface EmployeeCampaignContribution {
  campaignId: string;
  contributedQuantity: number;
}

export interface EmployeeGoalSummary {
  campaignContributions: EmployeeCampaignContribution[];
  currentAmount: number;
  targetAmount: number;
}

export interface Employee {
  email: string;
  goal?: EmployeeGoalSummary;
  id: string;
  joinedAt: string;
  name: string;
  role: UserRole;
  status: EmployeeStatus;
}

export type EmployeeInput = Pick<Employee, 'email' | 'name' | 'role' | 'status'>;

export type EmployeeRoleFilter = 'ALL' | UserRole;

export interface EmployeeFormValues {
  email: string;
  name: string;
  role: '' | UserRole;
  status: EmployeeStatus;
}

export type EmployeeFormErrors = Partial<Record<keyof EmployeeFormValues, string>>;

export type TeamRoleSummary = Record<UserRole, number>;
