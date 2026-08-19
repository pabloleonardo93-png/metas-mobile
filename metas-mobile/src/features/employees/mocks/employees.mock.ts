import type { Employee } from '@/features/employees/types/employee.types';

export const currentManagerMock: Employee & { role: 'GESTOR' } = {
  id: 'pablo',
  name: 'Pablo',
  email: 'pablo@farmacia.demo',
  role: 'GESTOR',
  status: 'ATIVO',
  joinedAt: '2023-01-10',
};

export const currentEmployeeMock: Employee & { role: 'BALCONISTA' } = {
  id: 'ana-souza',
  name: 'Ana Souza',
  email: 'ana.souza@farmacia.demo',
  role: 'BALCONISTA',
  status: 'ATIVO',
  joinedAt: '2024-02-19',
  performance: {
    monthSalesAmount: 8_450,
    campaignContributions: [
      { campaignId: 'protetor-solar-la-roche', contributedQuantity: 8 },
      { campaignId: 'vitamina-c-equaliv', contributedQuantity: 5 },
    ],
  },
};
