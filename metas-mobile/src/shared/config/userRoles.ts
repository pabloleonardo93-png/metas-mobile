import type { UserRole } from '@/shared/types/userRole';

export const USER_ROLES = [
  'GESTOR',
  'BALCONISTA',
  'FARMACEUTICO',
  'CAIXA',
] as const satisfies readonly UserRole[];

export const USER_ROLE_LABELS = {
  GESTOR: {
    plural: 'Gestores',
    singular: 'Gestor',
  },
  BALCONISTA: {
    plural: 'Balconistas',
    singular: 'Balconista',
  },
  CAIXA: {
    plural: 'Caixas',
    singular: 'Caixa',
  },
  FARMACEUTICO: {
    plural: 'Farmacêuticos',
    singular: 'Farmacêutico',
  },
} as const satisfies Record<UserRole, { plural: string; singular: string }>;
