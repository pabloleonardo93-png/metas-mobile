import type { UserRole } from '@/shared/types/userRole';

export type EmployeeStatus = 'ATIVO' | 'INATIVO';

export interface EmployeeCampaignContribution {
  campaignId: string;
  contributedQuantity: number;
}

export interface EmployeeSalesSnapshot {
  campaignContributions: EmployeeCampaignContribution[];
  monthSalesAmount: number;
}

export interface Employee {
  email: string;
  googleLinked: boolean;
  performance?: EmployeeSalesSnapshot;
  id: string;
  joinedAt: string;
  name: string;
  role: UserRole;
  status: EmployeeStatus;
}

export interface EmployeeAccessEmailInput {
  email: string;
}

export type EmployeeInput = Pick<Employee, 'email' | 'joinedAt' | 'name' | 'role' | 'status'>;

export type EmployeeRoleFilter = 'ALL' | UserRole;

export interface EmployeeFormValues {
  email: string;
  joinedAt: string;
  name: string;
  role: '' | UserRole;
  status: EmployeeStatus;
}

export type EmployeeFormErrors = Partial<Record<keyof EmployeeFormValues, string>>;

export type TeamRoleSummary = Record<UserRole, number>;
