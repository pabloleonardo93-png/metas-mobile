import type { GoalHistoryItem } from '@/features/metas/types/goalSettings.types';

export const goalHistoryMock = [
  {
    id: 'goal-2026-07',
    month: 'Julho 2026',
    sold: 480_000,
    status: 'CONCLUIDA',
    target: 450_000,
  },
  {
    id: 'goal-2026-06',
    month: 'Junho 2026',
    sold: 410_000,
    status: 'CONCLUIDA',
    target: 420_000,
  },
] satisfies GoalHistoryItem[];
