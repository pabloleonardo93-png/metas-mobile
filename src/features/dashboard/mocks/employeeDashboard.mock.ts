import type { EmployeeDashboardData } from '@/features/dashboard/types/employeeDashboard';

export const employeeDashboardMock = {
  usuario: {
    nome: 'Pablo',
  },
  metaMensal: {
    objetivo: 10_000,
    realizado: 8_450,
  },
  metasPrioritarias: [
    {
      id: '1',
      produto: 'Vitamina X',
      objetivo: 50,
      realizado: 38,
      unidade: 'unidades',
    },
    {
      id: '2',
      produto: 'Protetor Solar Y',
      objetivo: 30,
      realizado: 22,
      unidade: 'unidades',
    },
  ],
  resumo: {
    hoje: 540,
    semana: 2_850,
    mes: 8_450,
  },
} satisfies EmployeeDashboardData;
