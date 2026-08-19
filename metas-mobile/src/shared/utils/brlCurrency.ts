const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function sanitizeBrlCurrencyInput(value: string): string {
  if (value.includes('-')) {
    return '';
  }

  const compactValue = value.replace(/R\$/gi, '').replace(/\s/g, '');
  const commaIndex = compactValue.lastIndexOf(',');

  if (commaIndex >= 0) {
    const integerPart = compactValue.slice(0, commaIndex).replace(/\D/g, '');
    const decimalPart = compactValue
      .slice(commaIndex + 1)
      .replace(/\D/g, '')
      .slice(0, 2);

    return `${integerPart || '0'},${decimalPart}`;
  }

  const dotParts = compactValue.split('.');

  if (dotParts.length === 2 && /^\d{1,2}$/.test(dotParts[1] ?? '')) {
    const integerPart = (dotParts[0] ?? '').replace(/\D/g, '');
    return `${integerPart || '0'},${dotParts[1]}`;
  }

  return compactValue.replace(/\D/g, '');
}

export function parseBrlCurrencyToCents(value: string): number | null {
  if (value.includes('-')) {
    return null;
  }

  const normalizedValue = sanitizeBrlCurrencyInput(value);

  if (!/^\d+(,\d{0,2})?$/.test(normalizedValue)) {
    return null;
  }

  const [integerPart, decimalPart = ''] = normalizedValue.split(',');
  const cents = BigInt(integerPart) * 100n + BigInt(decimalPart.padEnd(2, '0'));

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
