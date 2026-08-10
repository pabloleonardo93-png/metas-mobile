import type { TeamRole } from '@/features/metas/types/teamDistribution.types';

export const ROLE_WEIGHTS = {
  BALCONISTA: 1,
  FARMACEUTICO: 0.7,
  CAIXA: 0.3,
} as const satisfies Record<TeamRole, number>;

export const TEAM_ROLE_LABELS = {
  BALCONISTA: {
    plural: 'Balconistas',
    singular: 'Balconista',
  },
  FARMACEUTICO: {
    plural: 'Farmacêuticos',
    singular: 'Farmacêutico',
  },
  CAIXA: {
    plural: 'Caixas',
    singular: 'Caixa',
  },
} as const satisfies Record<TeamRole, { plural: string; singular: string }>;
