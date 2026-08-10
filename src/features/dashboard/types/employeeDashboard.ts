import type { Campaign } from '@/features/campaigns/types/campaign.types';
import type { EmployeeRole } from '@/shared/types/userRole';

export interface EmployeeDashboardUser {
  cargo: EmployeeRole;
  nome: string;
}

export interface MonetaryGoal {
  objetivo: number;
  realizado: number;
}

export interface PerformanceSummaryData {
  hoje: number;
  mes: number;
  semana: number;
}

export interface EmployeeDashboardData {
  activeStoreCampaigns: Campaign[];
  metaMensal: MonetaryGoal;
  resumo: PerformanceSummaryData;
  usuario: EmployeeDashboardUser;
}
