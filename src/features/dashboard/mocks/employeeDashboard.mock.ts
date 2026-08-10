import type { EmployeeDashboardData } from '@/features/dashboard/types/employeeDashboard';
import { campaignsMock } from '@/features/campaigns/mocks/campaigns.mock';
import {
  normalizeCampaign,
  selectActiveCampaigns,
} from '@/features/campaigns/utils/campaign.utils';

const activeStoreCampaigns = selectActiveCampaigns(
  campaignsMock.map((campaign) => normalizeCampaign({ ...campaign })),
).slice(0, 2);

export const employeeDashboardMock = {
  activeStoreCampaigns,
  usuario: {
    cargo: 'BALCONISTA',
    nome: 'Pablo',
  },
  metaMensal: {
    objetivo: 10_000,
    realizado: 8_450,
  },
  resumo: {
    hoje: 540,
    semana: 2_850,
    mes: 8_450,
  },
} satisfies EmployeeDashboardData;
