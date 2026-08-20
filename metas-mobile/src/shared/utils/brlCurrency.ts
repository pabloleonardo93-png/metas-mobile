const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function sanitizeBrlCurrencyInput(value: string): string {
  if (value.includes('-')) {
    return '';
  }

  return value.replace(/[^\d.,]/g, '');
}

export function isEditableBrlCurrencyInput(value: string): boolean {
  if (value === '') {
    return true;
  }

  const parts = value.split(',');
  if (parts.length > 2) {
    return false;
  }

  const [integerPart, decimalPart] = parts;
  if (!integerPart || (decimalPart !== undefined && !/^\d{0,2}$/.test(decimalPart))) {
    return false;
  }

  return /^\d+$/.test(integerPart) || /^\d{1,3}(?:\.\d{3})*(?:\.\d{0,3})?$/.test(integerPart);
}

export function parseBrlCurrencyToCents(value: string): number | null {
  const normalizedValue = value.trim();
  const match = /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(normalizedValue);
  if (!match) {
    return null;
  }

  const integerDigits = match[1].replace(/\./g, '');
  const decimalDigits = (match[2] ?? '').padEnd(2, '0');
  const cents = BigInt(`${integerDigits}${decimalDigits}`);

  if (cents > MAX_SAFE_CENTS) {
    return null;
  }

  return Number(cents);
}

export function formatCentsForBrlInput(cents: number, group = true): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    return '';
  }

  const integerPart = Math.floor(cents / 100).toString();
  const decimalPart = (cents % 100).toString().padStart(2, '0');

  return `${group ? groupThousands(integerPart) : integerPart},${decimalPart}`;
}

export function normalizeBrlCurrencyInput(value: string): string | null {
  const cents = parseBrlCurrencyToCents(value);
  return cents === null ? null : formatCentsForBrlInput(cents);
}

export function formatCentsAsBrl(cents: number): string {
  const formattedValue = formatCentsForBrlInput(cents);
  return formattedValue ? `R$ ${formattedValue}` : 'R$ 0,00';
}

export function reaisToCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToReais(cents: number): number {
  return Number.isSafeInteger(cents) && cents >= 0 ? cents / 100 : Number.NaN;
}
