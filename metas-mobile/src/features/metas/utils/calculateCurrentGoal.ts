import type {
  CurrentGoalMetrics,
  GoalGeneralSettings,
} from '@/features/metas/types/goalSettings.types';
import { calculateProgress } from '@/shared/utils/calculateProgress';
import {
  calculateDailyGoalAmount,
  calculateRemainingGoalAmount,
} from '@/shared/utils/goalCalculations';

function normalizeAmount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function calculateCurrentGoalMetrics(goal: GoalGeneralSettings): CurrentGoalMetrics {
  const target = normalizeAmount(goal.monthlyTarget);
  const sold = normalizeAmount(goal.soldAmount);
  const remaining = calculateRemainingGoalAmount(target, sold);
  const remainingBusinessDays =
    Number.isInteger(goal.remainingBusinessDays) && goal.remainingBusinessDays > 0
      ? goal.remainingBusinessDays
      : 0;

  return {
    dailyTarget: calculateDailyGoalAmount(remaining, remainingBusinessDays),
    progress: calculateProgress(sold, target),
    remaining,
    remainingBusinessDays,
    sold,
    target,
  };
}
