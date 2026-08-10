export interface EmployeeDashboardUser {
  nome: string;
}

export interface MonetaryGoal {
  objetivo: number;
  realizado: number;
}

export interface PriorityGoal {
  id: string;
  objetivo: number;
  produto: string;
  realizado: number;
  unidade: string;
}

export interface PerformanceSummaryData {
  hoje: number;
  mes: number;
  semana: number;
}

export interface EmployeeDashboardData {
  metaMensal: MonetaryGoal;
  metasPrioritarias: PriorityGoal[];
  resumo: PerformanceSummaryData;
  usuario: EmployeeDashboardUser;
}
