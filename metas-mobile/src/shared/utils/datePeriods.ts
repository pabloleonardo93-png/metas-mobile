import {
  formatLocalDateIso,
  isValidCivilDateIso,
  type LocalDateSource,
} from '@/shared/utils/localDate';

const CIVIL_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export interface PeriodDayCounts {
  remainingDays: number;
  totalDays: number;
}

interface CivilDateParts {
  day: number;
  month: number;
  year: number;
}

function parseCivilDate(value: string): CivilDateParts | null {
  if (!isValidCivilDateIso(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  return { day, month, year };
}

function toCivilDayNumber(value: CivilDateParts): number {
  return Date.UTC(value.year, value.month - 1, value.day) / CIVIL_DAY_MILLISECONDS;
}

function countInclusiveDays(start: CivilDateParts, end: CivilDateParts): number {
  return toCivilDayNumber(end) - toCivilDayNumber(start) + 1;
}

export function calculateMonthDayCounts(
  monthValue: string,
  today: LocalDateSource = new Date(),
): PeriodDayCounts | null {
  const match = MONTH_PATTERN.exec(monthValue);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1900 || year > 9999 || month < 1 || month > 12) return null;

  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const targetMonthIndex = year * 12 + month - 1;
  const currentMonthIndex = today.getFullYear() * 12 + today.getMonth();

  if (targetMonthIndex < currentMonthIndex) {
    return { remainingDays: 0, totalDays };
  }

  if (targetMonthIndex > currentMonthIndex) {
    return { remainingDays: totalDays, totalDays };
  }

  return {
    remainingDays: Math.max(totalDays - today.getDate() + 1, 0),
    totalDays,
  };
}

export function calculatePeriodDayCounts(
  startDate: string,
  endDate: string,
  today: LocalDateSource = new Date(),
): PeriodDayCounts | null {
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);
  if (!start || !end || toCivilDayNumber(end) < toCivilDayNumber(start)) return null;

  const totalDays = countInclusiveDays(start, end);
  const todayValue = formatLocalDateIso(today);

  if (todayValue < startDate) {
    return { remainingDays: totalDays, totalDays };
  }

  if (todayValue > endDate) {
    return { remainingDays: 0, totalDays };
  }

  const current = parseCivilDate(todayValue);
  if (!current) return null;

  return {
    remainingDays: countInclusiveDays(current, end),
    totalDays,
  };
}
