export function calculateRemainingGoalAmount(target: number, sold: number): number {
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(sold) || sold < 0) {
    return 0;
  }

  return Math.max(target - sold, 0);
}

export function calculateDailyGoalAmount(remainingAmount: number, remainingDays: number): number {
  if (
    !Number.isFinite(remainingAmount) ||
    remainingAmount < 0 ||
    !Number.isInteger(remainingDays) ||
    remainingDays <= 0
  ) {
    return 0;
  }

  const dailyGoal = remainingAmount / remainingDays;

  return Number.isFinite(dailyGoal) && dailyGoal >= 0 ? dailyGoal : 0;
}
