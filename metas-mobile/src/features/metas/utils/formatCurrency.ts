const integerFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: 'currency',
});

const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

export function formatBrazilianCurrency(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) && value >= 0 ? value : 0);
}

export function formatDecimal(value: number): string {
  return decimalFormatter.format(Number.isFinite(value) && value >= 0 ? value : 0);
}

export function formatCurrencyInput(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '';
  }

  return integerFormatter.format(value);
}

export function formatCurrencyTextInput(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  return integerFormatter.format(Number(digits));
}

export function parseCurrencyInput(value: string): number {
  const digits = value.replace(/\D/g, '');

  return digits ? Number(digits) : Number.NaN;
}
