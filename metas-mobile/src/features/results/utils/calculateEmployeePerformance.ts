import type {
  DailyGoalPerformance,
  DailyResultWithPerformance,
  EmployeeDailyResult,
  EmployeePerformanceSummary,
} from '@/features/results/types/employeePerformance.types';
import { calculateProgress } from '@/shared/utils/calculateProgress';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

interface ParsedIsoDate {
  month: number;
  timestamp: number;
  year: number;
}

function parseIsoDate(value: string): ParsedIsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { month, timestamp, year };
}

function normalizeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sumResults(
  results: readonly EmployeeDailyResult[],
  predicate: (date: ParsedIsoDate) => boolean,
): number {
  const total = results.reduce((sum, result) => {
    const parsedDate = parseIsoDate(result.date);

    return parsedDate && predicate(parsedDate) ? sum + normalizeAmount(result.soldAmount) : sum;
  }, 0);

  return Number.isFinite(total) && total >= 0 ? total : 0;
}

export function getTodaySales(
  results: readonly EmployeeDailyResult[],
  referenceDate: string,
): number {
  const reference = parseIsoDate(referenceDate);

  return reference ? sumResults(results, (date) => date.timestamp === reference.timestamp) : 0;
}

export function getCurrentWeekSales(
  results: readonly EmployeeDailyResult[],
  referenceDate: string,
): number {
  const reference = parseIsoDate(referenceDate);

  if (!reference) {
    return 0;
  }

  const weekDay = new Date(reference.timestamp).getUTCDay();
  const daysSinceMonday = weekDay === 0 ? 6 : weekDay - 1;
  const weekStart = reference.timestamp - daysSinceMonday * DAY_IN_MILLISECONDS;

  return sumResults(
    results,
    (date) => date.timestamp >= weekStart && date.timestamp <= reference.timestamp,
  );
}

export function getCurrentMonthSales(
  results: readonly EmployeeDailyResult[],
  referenceDate: string,
): number {
  const reference = parseIsoDate(referenceDate);

  if (!reference) {
    return 0;
  }

  return sumResults(
    results,
    (date) =>
      date.year === reference.year &&
      date.month === reference.month &&
      date.timestamp <= reference.timestamp,
  );
}

export function calculateEmployeePerformanceSummary(
  results: readonly EmployeeDailyResult[],
  referenceDate: string,
): EmployeePerformanceSummary {
  return {
    monthSales: getCurrentMonthSales(results, referenceDate),
    todaySales: getTodaySales(results, referenceDate),
    weekSales: getCurrentWeekSales(results, referenceDate),
  };
}

export function calculateDailyGoalPerformance(
  soldAmount: number,
  dailyGoal: number,
): DailyGoalPerformance {
  const normalizedSoldAmount = normalizeAmount(soldAmount);

  if (!Number.isFinite(dailyGoal) || dailyGoal <= 0) {
    return {
      dailyGoal: 0,
      exceededAmount: 0,
      progress: 0,
      remainingAmount: 0,
      soldAmount: normalizedSoldAmount,
      status: 'UNAVAILABLE',
    };
  }

  const normalizedDailyGoal = dailyGoal;
  const remainingAmount = Math.max(normalizedDailyGoal - normalizedSoldAmount, 0);
  const exceededAmount = Math.max(normalizedSoldAmount - normalizedDailyGoal, 0);
  const status =
    normalizedSoldAmount > normalizedDailyGoal
      ? 'EXCEEDED'
      : normalizedSoldAmount === normalizedDailyGoal
        ? 'ACHIEVED'
        : 'PENDING';

  return {
    dailyGoal: normalizedDailyGoal,
    exceededAmount,
    progress: calculateProgress(normalizedSoldAmount, normalizedDailyGoal),
    remainingAmount,
    soldAmount: normalizedSoldAmount,
    status,
  };
}

export function getRecentDailyResults(
  results: readonly EmployeeDailyResult[],
  referenceDate: string,
  dailyGoal: number,
  limit = 7,
): DailyResultWithPerformance[] {
  const reference = parseIsoDate(referenceDate);

  if (!reference || !Number.isInteger(limit) || limit <= 0) {
    return [];
  }

  const resultsByDate = new Map<string, number>();

  results.forEach((result) => {
    const parsedDate = parseIsoDate(result.date);

    if (!parsedDate || parsedDate.timestamp > reference.timestamp) {
      return;
    }

    resultsByDate.set(
      result.date,
      (resultsByDate.get(result.date) ?? 0) + normalizeAmount(result.soldAmount),
    );
  });

  return [...resultsByDate.entries()]
    .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
    .slice(0, limit)
    .map(([date, soldAmount]) => ({
      date,
      performance: calculateDailyGoalPerformance(soldAmount, dailyGoal),
      soldAmount,
    }));
}

export function formatResultDate(date: string): string {
  const parsedDate = parseIsoDate(date);

  if (!parsedDate) {
    return '--/--';
  }

  const [, month, day] = date.split('-');

  return `${day}/${month}`;
}
