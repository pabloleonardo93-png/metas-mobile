import type { ManagerDashboardData } from '@/features/dashboard/types/managerDashboard';

export const managerDashboardMock = {
  manager: {
    name: 'Gestor',
    role: 'GESTOR',
  },
  team: [
    {
      role: 'BALCONISTA',
      quantity: 3,
      progress: 68,
    },
    {
      role: 'FARMACEUTICO',
      quantity: 1,
      progress: 74,
    },
    {
      role: 'CAIXA',
      quantity: 1,
      progress: 61,
    },
  ],
  employeesNearGoal: [
    {
      id: 'ana',
      name: 'Ana',
      role: 'BALCONISTA',
      progress: 92,
    },
    {
      id: 'carlos',
      name: 'Carlos',
      role: 'FARMACEUTICO',
      progress: 87,
    },
  ],
} satisfies ManagerDashboardData;
