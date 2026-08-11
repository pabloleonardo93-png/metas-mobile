import type { ManagerDashboardData } from '@/features/dashboard/types/managerDashboard';
import { currentEmployeeMock } from '@/features/employees/mocks/employees.mock';

export const managerDashboardMock = {
  team: [
    {
      role: 'BALCONISTA',
      progress: 68,
    },
    {
      role: 'FARMACEUTICO',
      progress: 74,
    },
    {
      role: 'CAIXA',
      progress: 61,
    },
  ],
  employeesNearGoal: [
    {
      id: currentEmployeeMock.id,
      name: currentEmployeeMock.name,
      role: currentEmployeeMock.role,
      progress: 92,
    },
    {
      id: 'juliana-costa',
      name: 'Juliana Costa',
      role: 'FARMACEUTICO',
      progress: 87,
    },
  ],
} satisfies ManagerDashboardData;
