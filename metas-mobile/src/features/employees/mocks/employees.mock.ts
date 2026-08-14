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

export const employeesMock = [
  currentManagerMock,
  {
    id: 'joao',
    name: 'João',
    email: 'joao@farmacia.demo',
    role: 'GESTOR',
    status: 'ATIVO',
    joinedAt: '2023-03-06',
  },
  currentEmployeeMock,
  {
    id: 'carlos-silva',
    name: 'Carlos Silva',
    email: 'carlos.silva@farmacia.demo',
    role: 'BALCONISTA',
    status: 'ATIVO',
    joinedAt: '2024-04-08',
    performance: {
      monthSalesAmount: 7_200,
      campaignContributions: [
        { campaignId: 'protetor-solar-la-roche', contributedQuantity: 6 },
        { campaignId: 'omega-3-equaliv', contributedQuantity: 4 },
      ],
    },
  },
  {
    id: 'mariana-santos',
    name: 'Mariana Santos',
    email: 'mariana.santos@farmacia.demo',
    role: 'BALCONISTA',
    status: 'ATIVO',
    joinedAt: '2024-08-12',
    performance: {
      monthSalesAmount: 6_100,
      campaignContributions: [{ campaignId: 'protetor-solar-la-roche', contributedQuantity: 5 }],
    },
  },
  {
    id: 'juliana-costa',
    name: 'Juliana Costa',
    email: 'juliana.costa@farmacia.demo',
    role: 'FARMACEUTICO',
    status: 'ATIVO',
    joinedAt: '2023-11-13',
    performance: {
      monthSalesAmount: 8_700,
      campaignContributions: [{ campaignId: 'vitamina-c-equaliv', contributedQuantity: 7 }],
    },
  },
  {
    id: 'pedro-lima',
    name: 'Pedro Lima',
    email: 'pedro.lima@farmacia.demo',
    role: 'CAIXA',
    status: 'ATIVO',
    joinedAt: '2025-01-20',
    performance: {
      monthSalesAmount: 6_500,
      campaignContributions: [{ campaignId: 'omega-3-equaliv', contributedQuantity: 3 }],
    },
  },
] satisfies Employee[];
