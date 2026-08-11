import type { CurrentGoal } from '@/features/metas/types/goalSettings.types';

export const currentGoalMock = {
  id: 'goal-2026-08',
  month: 'Agosto 2026',
  monthlyTarget: 500_000,
  remainingBusinessDays: 20,
  soldAmount: 120_000,
  status: 'EM_ANDAMENTO',
  totalBusinessDays: 26,
} satisfies CurrentGoal;
