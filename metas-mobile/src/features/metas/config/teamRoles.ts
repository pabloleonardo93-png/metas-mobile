import type { TeamRole } from '@/features/metas/types/teamDistribution.types';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';

export const TEAM_ROLES = [
  'BALCONISTA',
  'FARMACEUTICO',
  'CAIXA',
] as const satisfies readonly TeamRole[];

export const ROLE_WEIGHTS = {
  BALCONISTA: 1,
  FARMACEUTICO: 0.7,
  CAIXA: 0.3,
} as const satisfies Record<TeamRole, number>;

export const TEAM_ROLE_LABELS = {
  BALCONISTA: USER_ROLE_LABELS.BALCONISTA,
  FARMACEUTICO: USER_ROLE_LABELS.FARMACEUTICO,
  CAIXA: USER_ROLE_LABELS.CAIXA,
} as const satisfies Record<TeamRole, { plural: string; singular: string }>;
