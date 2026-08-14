import { ROLE_WEIGHTS } from '@/features/metas/config/teamRoles';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';

export const teamDistributionMock = [
  {
    quantity: 3,
    role: 'BALCONISTA',
    weight: ROLE_WEIGHTS.BALCONISTA,
  },
  {
    quantity: 1,
    role: 'FARMACEUTICO',
    weight: ROLE_WEIGHTS.FARMACEUTICO,
  },
  {
    quantity: 1,
    role: 'CAIXA',
    weight: ROLE_WEIGHTS.CAIXA,
  },
] satisfies TeamDistribution[];
