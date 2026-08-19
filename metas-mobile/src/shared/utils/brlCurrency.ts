const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function sanitizeBrlCurrencyInput(value: string): string {
  if (value.includes('-')) {
    return '';
  }

  const digits = value.replace(/\D/g, '');
  const cents = BigInt(digits || '0');

  if (cents > MAX_SAFE_CENTS) {
    return '';
  }

  return formatCentsForBrlInput(Number(cents));
}

export function getBrlCurrencyValueAfterBackspace(value: string): string {
  const cents = parseBrlCurrencyToCents(value);
  if (cents === null || cents === 0) {
    return formatCentsForBrlInput(0);
  }

  return formatCentsForBrlInput(Math.floor(cents / 10));
}

export function shouldPreserveBrlZeroDuringDeletion(
  currentValue: string,
  nextValue: string,
): boolean {
  return (
    nextValue.length < currentValue.length &&
    parseBrlCurrencyToCents(currentValue) === 0 &&
    (nextValue.length === 0 || parseBrlCurrencyToCents(nextValue) === 0)
  );
}

export function parseBrlCurrencyToCents(value: string): number | null {
  if (value.includes('-')) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  const cents = BigInt(digits);

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
