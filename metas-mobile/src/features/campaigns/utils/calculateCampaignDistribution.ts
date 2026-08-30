import type { Employee } from '@/features/employees/types/employee.types';
import { TEAM_ROLES } from '@/features/metas/config/teamRoles';
import type { TeamDistribution, TeamRole } from '@/features/metas/types/teamDistribution.types';
import {
  allocateIntegerAmountByWeight,
  calculateWeightedDailyDistribution,
  type WeightedDailyDistributionResult,
  type WeightedDailyDistributionStatus,
} from '@/features/metas/utils/calculateWeightedDailyDistribution';
import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { calculatePeriodDayCounts } from '@/shared/utils/datePeriods';
import type { LocalDateSource } from '@/shared/utils/localDate';

export interface CampaignDailyDistributionResult extends WeightedDailyDistributionResult {
  message?: string;
}

export interface CampaignEmployeeFinancialDistribution {
  dailyAmountCents: number;
  employeeId: string;
  employeeName: string;
  remainingAmountCents: number;
  role: TeamRole;
  weight: number;
}

export interface CampaignFinancialDistributionResult {
  dailyStoreAmountCents: number;
  employees: CampaignEmployeeFinancialDistribution[];
  message?: string;
  remainingAmountCents: number;
  remainingDays: number;
  status: WeightedDailyDistributionStatus;
  totalTeamWeight: number;
}

const STATUS_MESSAGES: Record<Exclude<WeightedDailyDistributionStatus, 'success'>, string> = {
  completed: 'A quantidade prevista para a campanha já foi atingida.',
  'empty-team': 'Cadastre ao menos um funcionário ativo na equipe.',
  'invalid-input': 'Não foi possível calcular a distribuição desta campanha.',
  'no-days': 'Não há dias restantes para distribuir a campanha.',
  'zero-weight': 'O peso total da equipe precisa ser maior que zero.',
};

const FINANCIAL_STATUS_MESSAGES: Record<
  Exclude<WeightedDailyDistributionStatus, 'success'>,
  string
> = {
  completed: 'A meta financeira da campanha já foi atingida.',
  'empty-team': 'Cadastre ao menos um funcionário ativo na equipe.',
  'invalid-input': 'Não foi possível calcular a distribuição financeira desta campanha.',
  'no-days': 'Não há dias restantes para distribuir a meta financeira.',
  'zero-weight': 'O peso total da equipe precisa ser maior que zero.',
};

type EligibleCampaignEmployee = Employee & { role: TeamRole };

function isTeamRole(role: Employee['role']): role is TeamRole {
  return TEAM_ROLES.some((teamRole) => teamRole === role);
}

function isEligibleCampaignEmployee(employee: Employee): employee is EligibleCampaignEmployee {
  return employee.status === 'ATIVO' && isTeamRole(employee.role);
}

function sortEligibleEmployees(
  left: EligibleCampaignEmployee,
  right: EligibleCampaignEmployee,
): number {
  const roleOrder = TEAM_ROLES.indexOf(left.role) - TEAM_ROLES.indexOf(right.role);
  if (roleOrder !== 0) return roleOrder;

  const nameOrder = left.name.localeCompare(right.name, 'pt-BR');
  return nameOrder !== 0 ? nameOrder : left.id.localeCompare(right.id);
}

export function createCurrentTeamDistribution(
  employees: readonly Employee[],
  configuredTeam: readonly TeamDistribution[],
): TeamDistribution[] {
  const quantityByRole = new Map<TeamRole, number>(TEAM_ROLES.map((role) => [role, 0]));
  const weightByRole = new Map(configuredTeam.map(({ role, weight }) => [role, weight]));

  for (const employee of employees) {
    if (!isEligibleCampaignEmployee(employee)) continue;
    quantityByRole.set(employee.role, (quantityByRole.get(employee.role) ?? 0) + 1);
  }

  return TEAM_ROLES.map((role) => ({
    quantity: quantityByRole.get(role) ?? 0,
    role,
    weight: weightByRole.get(role) ?? 0,
  }));
}

export function calculateCampaignDailyDistribution(
  campaign: Campaign,
  employees: readonly Employee[],
  configuredTeam: readonly TeamDistribution[],
  today: LocalDateSource = new Date(),
): CampaignDailyDistributionResult | null {
  const metrics = calculateCampaignMetrics(campaign);
  if (!metrics.quantity) return null;

  const dayCounts = calculatePeriodDayCounts(campaign.startDate, campaign.endDate, today);

  if (!dayCounts) {
    return {
      dailyStoreGoal: 0,
      message: STATUS_MESSAGES['invalid-input'],
      remainingAmount: metrics.quantity.remainingQuantity,
      roles: [],
      status: 'invalid-input',
      totalTeamWeight: 0,
    };
  }

  const result = calculateWeightedDailyDistribution({
    remainingAmount: metrics.quantity.remainingQuantity,
    remainingDays: campaign.status === 'ENCERRADA' ? 0 : dayCounts.remainingDays,
    team: createCurrentTeamDistribution(employees, configuredTeam),
  });

  if (result.status === 'success') return result;

  return {
    ...result,
    message:
      campaign.status === 'ENCERRADA' && result.status === 'no-days'
        ? 'Campanha encerrada. Não há distribuição diária pendente.'
        : STATUS_MESSAGES[result.status],
  };
}

export function calculateCampaignFinancialDistribution(
  campaign: Campaign,
  employees: readonly Employee[],
  configuredTeam: readonly TeamDistribution[],
  today: LocalDateSource = new Date(),
): CampaignFinancialDistributionResult {
  const metrics = calculateCampaignMetrics(campaign);
  const dayCounts = calculatePeriodDayCounts(campaign.startDate, campaign.endDate, today);

  if (
    !dayCounts ||
    !Number.isSafeInteger(campaign.targetAmountCents) ||
    campaign.targetAmountCents <= 0 ||
    !Number.isSafeInteger(campaign.soldAmountCents) ||
    campaign.soldAmountCents < 0
  ) {
    return {
      dailyStoreAmountCents: 0,
      employees: [],
      message: FINANCIAL_STATUS_MESSAGES['invalid-input'],
      remainingAmountCents: metrics.remainingAmountCents,
      remainingDays: 0,
      status: 'invalid-input',
      totalTeamWeight: 0,
    };
  }

  const remainingDays = campaign.status === 'ENCERRADA' ? 0 : dayCounts.remainingDays;
  const weightedResult = calculateWeightedDailyDistribution({
    remainingAmount: metrics.remainingAmountCents,
    remainingDays,
    team: createCurrentTeamDistribution(employees, configuredTeam),
  });

  if (weightedResult.status !== 'success') {
    return {
      dailyStoreAmountCents: 0,
      employees: [],
      message:
        campaign.status === 'ENCERRADA' && weightedResult.status === 'no-days'
          ? 'Campanha encerrada. Não há distribuição financeira futura.'
          : FINANCIAL_STATUS_MESSAGES[weightedResult.status],
      remainingAmountCents: metrics.remainingAmountCents,
      remainingDays,
      status: weightedResult.status,
      totalTeamWeight: weightedResult.totalTeamWeight,
    };
  }

  const weightByRole = new Map(configuredTeam.map(({ role, weight }) => [role, weight]));
  const eligibleEmployees = employees
    .filter(isEligibleCampaignEmployee)
    .filter((employee) => (weightByRole.get(employee.role) ?? 0) > 0)
    .sort(sortEligibleEmployees);
  const allocationInputs = eligibleEmployees.map((employee) => ({
    key: employee.id,
    weight: weightByRole.get(employee.role) ?? 0,
  }));
  const dailyStoreAmountCents = Math.round(weightedResult.dailyStoreGoal);
  const remainingAllocations = allocateIntegerAmountByWeight(
    metrics.remainingAmountCents,
    allocationInputs,
  );
  const dailyAllocations = allocateIntegerAmountByWeight(dailyStoreAmountCents, allocationInputs);

  if (!remainingAllocations || !dailyAllocations) {
    return {
      dailyStoreAmountCents: 0,
      employees: [],
      message: FINANCIAL_STATUS_MESSAGES['invalid-input'],
      remainingAmountCents: metrics.remainingAmountCents,
      remainingDays,
      status: 'invalid-input',
      totalTeamWeight: weightedResult.totalTeamWeight,
    };
  }

  const remainingByEmployee = new Map(remainingAllocations.map(({ amount, key }) => [key, amount]));
  const dailyByEmployee = new Map(dailyAllocations.map(({ amount, key }) => [key, amount]));

  return {
    dailyStoreAmountCents,
    employees: eligibleEmployees.map((employee) => ({
      dailyAmountCents: dailyByEmployee.get(employee.id) ?? 0,
      employeeId: employee.id,
      employeeName: employee.name,
      remainingAmountCents: remainingByEmployee.get(employee.id) ?? 0,
      role: employee.role,
      weight: weightByRole.get(employee.role) ?? 0,
    })),
    remainingAmountCents: metrics.remainingAmountCents,
    remainingDays,
    status: 'success',
    totalTeamWeight: weightedResult.totalTeamWeight,
  };
}
