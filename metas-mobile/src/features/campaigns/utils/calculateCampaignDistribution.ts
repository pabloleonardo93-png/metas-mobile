import type { Employee } from '@/features/employees/types/employee.types';
import { TEAM_ROLES } from '@/features/metas/config/teamRoles';
import type { TeamDistribution, TeamRole } from '@/features/metas/types/teamDistribution.types';
import {
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

const STATUS_MESSAGES: Record<Exclude<WeightedDailyDistributionStatus, 'success'>, string> = {
  completed: 'A quantidade prevista para a campanha já foi atingida.',
  'empty-team': 'Cadastre ao menos um funcionário ativo na equipe.',
  'invalid-input': 'Não foi possível calcular a distribuição desta campanha.',
  'no-days': 'Não há dias restantes para distribuir a campanha.',
  'zero-weight': 'O peso total da equipe precisa ser maior que zero.',
};

function isTeamRole(role: Employee['role']): role is TeamRole {
  return TEAM_ROLES.some((teamRole) => teamRole === role);
}

export function createCurrentTeamDistribution(
  employees: readonly Employee[],
  configuredTeam: readonly TeamDistribution[],
): TeamDistribution[] {
  const quantityByRole = new Map<TeamRole, number>(TEAM_ROLES.map((role) => [role, 0]));
  const weightByRole = new Map(configuredTeam.map(({ role, weight }) => [role, weight]));

  for (const employee of employees) {
    if (employee.status !== 'ATIVO' || !isTeamRole(employee.role)) continue;
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
): CampaignDailyDistributionResult {
  const metrics = calculateCampaignMetrics(campaign);
  const dayCounts = calculatePeriodDayCounts(campaign.startDate, campaign.endDate, today);

  if (!dayCounts) {
    return {
      dailyStoreGoal: 0,
      message: STATUS_MESSAGES['invalid-input'],
      remainingAmount: metrics.remainingQuantity,
      roles: [],
      status: 'invalid-input',
      totalTeamWeight: 0,
    };
  }

  const result = calculateWeightedDailyDistribution({
    remainingAmount: metrics.remainingQuantity,
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
