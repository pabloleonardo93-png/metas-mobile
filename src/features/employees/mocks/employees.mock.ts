import type { Employee } from '@/features/employees/types/employee.types';

export const employeesMock = [
  {
    id: 'pablo',
    name: 'Pablo',
    email: 'pablo@farmacia.demo',
    role: 'GESTOR',
    status: 'ATIVO',
    joinedAt: '2023-01-10',
  },
  {
    id: 'joao',
    name: 'João',
    email: 'joao@farmacia.demo',
    role: 'GESTOR',
    status: 'ATIVO',
    joinedAt: '2023-03-06',
  },
  {
    id: 'ana-souza',
    name: 'Ana Souza',
    email: 'ana.souza@farmacia.demo',
    role: 'BALCONISTA',
    status: 'ATIVO',
    joinedAt: '2024-02-19',
    goal: {
      currentAmount: 8_450,
      targetAmount: 10_000,
      campaignContributions: [
        { campaignId: 'protetor-solar-la-roche', contributedQuantity: 8 },
        { campaignId: 'vitamina-c-equaliv', contributedQuantity: 5 },
      ],
    },
  },
  {
    id: 'carlos-silva',
    name: 'Carlos Silva',
    email: 'carlos.silva@farmacia.demo',
    role: 'BALCONISTA',
    status: 'ATIVO',
    joinedAt: '2024-04-08',
    goal: {
      currentAmount: 7_200,
      targetAmount: 10_000,
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
    goal: {
      currentAmount: 6_100,
      targetAmount: 10_000,
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
    goal: {
      currentAmount: 8_700,
      targetAmount: 10_000,
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
    goal: {
      currentAmount: 6_500,
      targetAmount: 9_000,
      campaignContributions: [{ campaignId: 'omega-3-equaliv', contributedQuantity: 3 }],
    },
  },
] satisfies Employee[];
